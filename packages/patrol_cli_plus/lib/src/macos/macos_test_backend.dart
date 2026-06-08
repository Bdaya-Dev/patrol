import 'dart:async';
import 'dart:convert';
import 'dart:io' show File, Process;

import 'package:dispose_scope/dispose_scope.dart';
import 'package:file/file.dart' hide File;
import 'package:glob/glob.dart';
import 'package:path/path.dart' show join;
import 'package:patrol_cli_plus/src/base/exceptions.dart';
import 'package:patrol_cli_plus/src/base/logger.dart';
import 'package:patrol_cli_plus/src/base/process.dart';
import 'package:patrol_cli_plus/src/coverage/vm_connection_details.dart';
import 'package:patrol_cli_plus/src/crossplatform/app_options.dart';
import 'package:patrol_cli_plus/src/devices.dart';
import 'package:platform/platform.dart';
import 'package:process/process.dart';

enum BuildMode {
  debug,
  profile,
  release;

  static const _defaultScheme = 'Runner';

  /// Name of this build mode in the Xcode Build Configuration format.
  ///
  /// Flutter build mode name starts with with a lowercase letter, for example
  /// `debug` or `release`.
  ///
  /// Xcode Build Configuration names starts with an uppercase letter, for
  /// example 'Debug' or 'Release'.
  String get xcodeName => name.replaceFirst(name[0], name[0].toUpperCase());

  // It's the same as xcodeName, but let's keep it for clarity.
  /// Name of this build mode as a part of Gradle task name.
  String get androidName => xcodeName;

  String createScheme(String? flavor) {
    if (flavor == null) {
      return _defaultScheme;
    }
    return flavor;
  }

  String createConfiguration(String? flavor) {
    if (flavor == null) {
      return xcodeName;
    }
    return '$xcodeName-$flavor';
  }
}

class MacOSTestBackend {
  MacOSTestBackend({
    required ProcessManager processManager,
    required Platform platform,
    required FileSystem fs,
    required Directory rootDirectory,
    required DisposeScope parentDisposeScope,
    required Logger logger,
  }) : _processManager = processManager,
       _platform = platform,
       _fs = fs,
       _rootDirectory = rootDirectory,
       _disposeScope = DisposeScope(),
       _logger = logger {
    _disposeScope.disposedBy(parentDisposeScope);
  }

  static const _xcodebuildInterrupted = -15;

  final ProcessManager _processManager;
  final Platform _platform;
  final FileSystem _fs;
  final Directory _rootDirectory;
  final DisposeScope _disposeScope;
  final Logger _logger;

  final _vmConnectionController = StreamController<VMConnectionDetails>();

  Stream<VMConnectionDetails> get vmConnectionStream =>
      _vmConnectionController.stream;

  static const _vmServiceInfoPath = '/tmp/patrol_vm_service.json';

  Timer? _filePoller;

  void _startPollingVmServiceFile() {
    String? lastUri;
    _filePoller = Timer.periodic(const Duration(seconds: 1), (_) {
      final file = File(_vmServiceInfoPath);
      if (!file.existsSync()) {
        return;
      }
      try {
        final content = file.readAsStringSync();
        final json = jsonDecode(content) as Map<String, dynamic>;
        final uri = json['uri'] as String?;
        if (uri != null && uri != lastUri) {
          lastUri = uri;
          final details = VMConnectionDetails.tryExtractFromLogs(
            'listening on $uri',
          );
          if (details != null) {
            _logger.detail('Captured VM service URI from file');
            _vmConnectionController.add(details);
          }
        }
      } catch (_) {}
    });
  }

  Future<void> build(MacOSAppOptions options) async {
    await _disposeScope.run((scope) async {
      final subject = options.description;
      final task = _logger.task(
        'Building $subject (${options.flutter.buildMode.name})',
      );

      Process process;

      // flutter build macos --config-only

      var flutterBuildKilled = false;
      process = await _processManager.start(
        options.toFlutterBuildInvocation(options.flutter.buildMode),
        runInShell: true,
      );
      scope.addDispose(() {
        process.kill();
        flutterBuildKilled = true; // `flutter build` has exit code 0 on SIGINT
      });
      process.listenStdOut((l) => _logger.detail('\t$l')).disposedBy(scope);
      process.listenStdErr((l) => _logger.err('\t$l')).disposedBy(scope);
      var exitCode = await process.exitCode;
      final flutterCommand = options.flutter.command;
      if (exitCode != 0) {
        final cause =
            '`$flutterCommand build macos` exited with code $exitCode';
        task.fail('Failed to build $subject ($cause)');
        throwToolExit(cause);
      } else if (flutterBuildKilled) {
        final cause = '`$flutterCommand build macos` was interrupted';
        task.fail('Failed to build $subject ($cause)');
        throwToolInterrupted(cause);
      }

      // xcodebuild build-for-testing

      process =
          await _processManager.start(
              options.buildForTestingInvocation(),
              runInShell: true,
              workingDirectory: _rootDirectory.childDirectory('macos').path,
            )
            ..disposedBy(scope);
      process.listenStdOut((l) => _logger.detail('\t$l')).disposedBy(scope);
      process.listenStdErr((l) => _logger.err('\t$l')).disposedBy(scope);
      exitCode = await process.exitCode;
      if (exitCode == 0) {
        task.complete('Completed building $subject');
      } else if (exitCode == _xcodebuildInterrupted) {
        const cause = 'xcodebuild was interrupted';
        task.fail('Failed to execute tests of $subject ($cause)');
        throwToolInterrupted(cause);
      } else {
        final cause = 'xcodebuild exited with code $exitCode';
        task.fail('Failed to build $subject ($cause)');
        throwToolExit(cause);
      }
    });
  }

  /// Executes the tests of the given [options] on the given [device].
  ///
  /// [build] must be called before this method.
  ///
  /// If [interruptible] is true, then no exception is thrown on SIGINT. This is
  /// used for Hot Restart.
  Future<void> execute(
    MacOSAppOptions options,
    Device device, {
    bool interruptible = false,
  }) async {
    await _disposeScope.run((scope) async {
      final subject = '${options.description} on ${device.description}';
      final task = _logger.task('Running $subject');

      // Delete stale VM service info file and start polling for new ones
      final infoFile = File(_vmServiceInfoPath);
      if (infoFile.existsSync()) {
        infoFile.deleteSync();
      }
      _startPollingVmServiceFile();

      final resultsPath = resultBundlePath(
        timestamp: DateTime.now().millisecondsSinceEpoch,
      );

      final sdkVersion = await getSdkVersion();
      final process =
          await _processManager.start(
              options.testWithoutBuildingInvocation(
                device,
                xcTestRunPath: await xcTestRunPath(
                  scheme: options.scheme,
                  sdkVersion: sdkVersion,
                ),
                resultBundlePath: resultsPath,
              ),
              runInShell: true,
              environment: {
                ..._platform.environment,
                'TEST_RUNNER_PATROL_TEST_PORT': options.testServerPort
                    .toString(),
                'TEST_RUNNER_PATROL_APP_PORT': options.appServerPort.toString(),
              },
              workingDirectory: _rootDirectory.childDirectory('macos').path,
            )
            ..disposedBy(_disposeScope);
      process.listenStdOut((l) => _logger.detail('\t$l')).disposedBy(scope);
      process.listenStdErr((l) => _logger.err('\t$l')).disposedBy(scope);

      final exitCode = await process.exitCode;
      _filePoller?.cancel();
      await _vmConnectionController.close();

      if (exitCode == 0) {
        task.complete('Completed executing $subject');
      } else if (exitCode != 0 && interruptible) {
        task.complete('App shut down on request');
      } else if (exitCode == _xcodebuildInterrupted) {
        const cause = 'xcodebuild was interrupted';
        task.fail('Failed to execute tests of $subject ($cause)');
        throwToolInterrupted(cause);
      } else {
        final cause = 'xcodebuild exited with code $exitCode';
        task.fail('Failed to execute tests of $subject ($cause)');
        throwToolExit(cause);
      }
    });
  }

  Future<String> xcTestRunPath({
    required String scheme,
    required String sdkVersion,
    bool absolutePath = true,
  }) async {
    final glob = Glob('${scheme}_macosx$sdkVersion*.xctestrun');

    var root = 'build/macos_integ/Build/Products';
    if (absolutePath) {
      root = join(_rootDirectory.absolute.path, root);
    }
    _logger.detail('Looking for .xctestrun matching ${glob.pattern} at $root');
    final files = await glob.listFileSystem(_fs, root: root).toList();
    if (files.isEmpty) {
      final cause = 'No .xctestrun file was found at $root';
      throwToolExit(cause);
    }

    _logger.detail(
      'Found ${files.length} match(es), the first one will be used',
    );
    for (final file in files) {
      _logger.detail('Found ${file.absolute.path}');
    }

    if (absolutePath) {
      return files.first.absolute.path;
    }
    return files.first.path;
  }

  /// [timestamp] (milliseconds since UNIX epoch) is required for the generation
  /// of unique path for the results bundle.
  String resultBundlePath({required int timestamp}) {
    return _fs
        .file(
          join(
            _rootDirectory.path,
            'build',
            'macos_results_$timestamp.xcresult',
          ),
        )
        .absolute
        .path;
  }

  Future<String> getSdkVersion() async {
    final processResult = await _processManager.run([
      'xcodebuild',
      '-showsdks',
      '-json',
    ], runInShell: true);

    String? sdkVersion;
    String? platform;
    final jsonOutput = jsonDecode(processResult.stdOut) as List<dynamic>;
    for (final sdkJson in jsonOutput) {
      final sdk = sdkJson as Map<String, dynamic>;
      if (sdk['platform'] == 'macosx') {
        sdkVersion = sdk['sdkVersion'] as String;
        platform = sdk['platform'] as String;
        break;
      }
    }

    if (sdkVersion == null) {
      throw Exception('xcodebuild: could not find SDK version');
    }

    _logger.detail('Assuming SDK version $sdkVersion for $platform');
    return sdkVersion;
  }
}
