import 'dart:async';
import 'dart:convert';
import 'dart:io' as io;

import 'package:adb_plus/adb.dart';
import 'package:coverage/coverage.dart' as coverage;
import 'package:dispose_scope/dispose_scope.dart';
import 'package:file/file.dart';
import 'package:glob/glob.dart';
import 'package:patrol_cli_plus/src/base/logger.dart';
import 'package:patrol_cli_plus/src/coverage/coverage_common.dart';
import 'package:patrol_cli_plus/src/coverage/device_to_host_port_transformer.dart';
import 'package:patrol_cli_plus/src/coverage/vm_connection_details.dart';
import 'package:patrol_cli_plus/src/devices.dart';
import 'package:patrol_cli_plus/src/runner/flutter_command.dart';
import 'package:platform/platform.dart';
import 'package:process/process.dart';
import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart';

class CoverageTool {
  CoverageTool({
    required FileSystem fs,
    required Directory rootDirectory,
    required ProcessManager processManager,
    required Platform platform,
    required Adb adb,
    required DisposeScope parentDisposeScope,
    required Logger logger,
  }) : _fs = fs,
       _rootDirectory = rootDirectory,
       _processManager = processManager,
       _platform = platform,
       _adb = adb,
       _logger = logger,
       _disposeScope = DisposeScope() {
    _disposeScope.disposedBy(parentDisposeScope);
  }

  final FileSystem _fs;
  final Directory _rootDirectory;
  final ProcessManager _processManager;
  final Platform _platform;
  final Adb _adb;
  final Logger _logger;
  final DisposeScope _disposeScope;

  Future<void> run({
    required Device device,
    required Set<RegExp> packagesRegExps,
    required TargetPlatform platform,
    required Logger logger,
    required Set<Glob> ignoreGlobs,
    required FlutterCommand flutterCommand,
    bool includeWorkspacePackages = false,
    Stream<VMConnectionDetails>? vmConnectionStream,
    bool proactive = false,
  }) async {
    final homeDirectory =
        _platform.environment['HOME'] ?? _platform.environment['USERPROFILE'];
    final hitMap = <String, coverage.HitMap>{};

    // Resolved once per run; the package_config.json contents do not change
    // mid-run and we'd otherwise re-walk + re-parse for every test isolate.
    final packages = await getCoveragePackages(
      rootDirectory: _rootDirectory,
      packagesRegExps: packagesRegExps,
      includeWorkspacePackages: includeWorkspacePackages,
      logger: _logger,
    );

    await _disposeScope.run((scope) async {
      final Stream<VMConnectionDetails> vmConnectionDetailsStream;

      final portTransformer = DeviceToHostPortTransformer(
        device: device,
        devicePlatform: platform,
        adb: _adb,
        logger: logger,
      );

      if (vmConnectionStream != null) {
        vmConnectionDetailsStream = vmConnectionStream
            .transform(portTransformer)
            .asBroadcastStream();
      } else {
        final logsProcess =
            await _processManager.start(
                [
                  flutterCommand.executable,
                  ...flutterCommand.arguments,
                  'logs',
                  '-d',
                  device.id,
                ],
                workingDirectory: homeDirectory,
                runInShell: true,
              )
              ..disposedBy(scope);

        vmConnectionDetailsStream = logsProcess.stdout
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .map(VMConnectionDetails.tryExtractFromLogs)
            .where((details) => details != null)
            .cast<VMConnectionDetails>()
            .transform(portTransformer)
            .asBroadcastStream();
      }

      if (proactive) {
        // Proactive mode: collect immediately from each VM URI without
        // waiting for extension events. Used on iOS where COVERAGE_ENABLED
        // is skipped to avoid keeping the VM service alive.
        // Skip the first URI (discovery phase — no test runs, no coverage).
        var count = 0;
        var skippedFirst = false;
        final coverageCollectionCompleter = Completer<void>()
          ..disposedBy(scope, null);
        vmConnectionDetailsStream
            .asyncMap((details) async {
              if (!skippedFirst) {
                skippedFirst = true;
                logger.detail('Skipping discovery VM URI');
                return <String, coverage.HitMap>{};
              }
              final service = await vmServiceConnectUri(
                details.webSocketUri.toString(),
              );
              Timer? cleanupTimer;
              try {
                cleanupTimer = Timer(const Duration(seconds: 5), () {
                  logger.warn(
                    'Proactive coverage timed out, closing connection',
                  );
                  service.dispose();
                });
                final data = await coverage.collect(
                  details.uri,
                  false,
                  false,
                  false,
                  packages,
                  serviceOverrideForTesting: service,
                );
                cleanupTimer.cancel();
                return coverage.HitMap.parseJson(
                  data['coverage'] as List<Map<String, dynamic>>,
                );
              } on Exception catch (e) {
                cleanupTimer?.cancel();
                logger.warn('Proactive coverage failed for ${details.uri}: $e');
                return <String, coverage.HitMap>{};
              } finally {
                try {
                  await service.dispose();
                } catch (_) {}
              }
            })
            .listen((cov) {
              hitMap.merge(cov);
              logger.info('Collected proactive coverage ${++count}');
            })
          ..onDone(coverageCollectionCompleter.complete)
          ..disposedBy(scope);
        await coverageCollectionCompleter.future;
      } else {
        // Event-based mode: skip the first VM URI (test discovery phase) and
        // collect coverage from each subsequent URI via waitForCoverageCollection
        // events until the stream closes.
        var skippedFirst = false;
        var count = 0;
        final coverageCollectionCompleter = Completer<void>()
          ..disposedBy(scope, null);
        vmConnectionDetailsStream
            .asyncMap((details) async {
              if (!skippedFirst) {
                skippedFirst = true;
                logger.detail('Skipping discovery VM URI');
                return <String, coverage.HitMap>{};
              }
              try {
                return await _collectFromVM(
                  packages: packages,
                  connectionDetails: details,
                );
              } on Exception catch (e) {
                logger.warn('Coverage collection failed: $e');
                return <String, coverage.HitMap>{};
              }
            })
            .listen((cov) {
              if (cov.isNotEmpty) {
                hitMap.merge(cov);
                logger.info('Collected coverage ${++count}');
              }
            })
          ..onDone(coverageCollectionCompleter.complete)
          ..disposedBy(scope);
        await coverageCollectionCompleter.future;
      }

      await formatAndSaveLcovReport(
        fs: _fs,
        hitMap: hitMap,
        packagePath: _rootDirectory.path,
        ignoreGlobs: ignoreGlobs,
        logger: logger,
      );
    });
  }

  Future<Map<String, coverage.HitMap>> _collectFromVM({
    required Set<String> packages,
    required VMConnectionDetails connectionDetails,
  }) async {
    final serviceClient = await vmServiceConnectUri(
      connectionDetails.webSocketUri.toString(),
    );
    _disposeScope.addDispose(serviceClient.dispose);

    // Poll for ext.patrol.coverageReady service extension.
    // Unlike postEvent (fire-and-forget), registered extensions are
    // discoverable via isolate.extensionRPCs after the fact.
    String? mainIsolateId;
    final deadline = DateTime.now().add(const Duration(seconds: 15));
    while (DateTime.now().isBefore(deadline)) {
      try {
        final vm = await serviceClient.getVM();
        for (final isolateRef in vm.isolates ?? <IsolateRef>[]) {
          final isolate = await serviceClient.getIsolate(isolateRef.id!);
          if (isolate.extensionRPCs?.contains('ext.patrol.coverageReady') ??
              false) {
            final response = await serviceClient.callServiceExtension(
              'ext.patrol.coverageReady',
              isolateId: isolateRef.id,
            );
            mainIsolateId = response.json?['mainIsolateId'] as String?;
            break;
          }
        }
      } on Exception {
        // VM might not be ready yet
      }
      if (mainIsolateId != null) {
        break;
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }

    if (mainIsolateId == null) {
      _logger.warn('ext.patrol.coverageReady not found within 15s');
      await serviceClient.dispose();
      return {};
    }

    // Dispose the polling connection BEFORE collecting coverage.
    // markTestCompleted (inside _collectAndMarkTestCompleted) unblocks the
    // binding, which triggers XCTest to launch the next test. If this
    // connection is still open at that point, terminate() fails.
    await serviceClient.dispose();

    return <String, coverage.HitMap>{}..merge(
      await _collectAndMarkTestCompleted(
        connectionDetails: connectionDetails,
        packages: packages,
        mainIsolateId: mainIsolateId,
      ),
    );
  }

  Future<Map<String, coverage.HitMap>> _collectAndMarkTestCompleted({
    required VMConnectionDetails connectionDetails,
    required Set<String> packages,
    required String mainIsolateId,
  }) async {
    final service = await vmServiceConnectUri(
      connectionDetails.webSocketUri.toString(),
    );
    final cleanupTimer = Timer(const Duration(seconds: 3), () {
      _logger.warn('coverage.collect() timed out after 3s, closing connection');
      service.dispose();
    });
    Map<String, dynamic>? data;
    try {
      data = await coverage.collect(
        connectionDetails.uri,
        false,
        false,
        false,
        packages,
        serviceOverrideForTesting: service,
      );
      cleanupTimer.cancel();
    } on Exception catch (e) {
      cleanupTimer.cancel();
      _logger.warn('coverage.collect() failed: $e');
    }

    // Always send markTestCompleted so the binding unblocks, even if
    // coverage collection failed or timed out.
    try {
      final socket =
          await io.WebSocket.connect(connectionDetails.webSocketUri.toString())
            ..add(
              jsonEncode({
                'jsonrpc': '2.0',
                'id': 21,
                'method': 'ext.patrol.markTestCompleted',
                'params': {
                  'isolateId': mainIsolateId,
                  'command': 'markTestCompleted',
                },
              }),
            );
      await socket.close();
    } on Exception catch (e) {
      _logger.warn('markTestCompleted failed: $e');
    }

    if (data == null) {
      return {};
    }
    return coverage.HitMap.parseJson(
      data['coverage'] as List<Map<String, dynamic>>,
    );
  }
}

extension<T> on Completer<T> {
  void disposedBy(DisposeScope disposeScope, T disposeValue) {
    disposeScope.addDispose(() {
      if (!isCompleted) {
        complete(disposeValue);
      }
    });
  }
}
