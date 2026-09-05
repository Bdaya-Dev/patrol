// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import 'dart:async';
import 'dart:convert';
import 'dart:io' as io;

import 'package:path/path.dart';

/// Exactly like example_test.dart but with expectation that fails.
const exampleTestWithFailingContents = r'''
import 'package:flutter/material.dart';

import 'common.dart';

void main() {
  patrol(
    'This test is used to `test patrol develop`',
    ($) async {
      await createApp($);

      await $(FloatingActionButton).tap();
      expect($(#counterText).text, '1');

      await $(#textField).enterText('Hello, Flutter!');
      expect($('Hello, Flutter!'), findsOneWidget);

      await $.platform.mobile.pressHome();
      await $.platform.mobile.openApp();

      expect($(#counterText).text, '1');
      await $(FloatingActionButton).tap();

      expect($(#counterText).text, '2');
      expect($('Hello, fail here!'), findsOneWidget);
    },
  );
}
''';

void main(List<String> args) async {
  _verifyWorkingDirectory();

  const afterBuildCompletedTimeout = Duration(minutes: 5, seconds: 30);
  const inactivityTimeout = Duration(minutes: 15);

  final stopwatch = Stopwatch()..start();
  String elapsed() => '${stopwatch.elapsed.inSeconds}s';

  var isFirstTestPassed = false;
  var isReloaded = false;
  Timer? inactivityTimer;
  final output = StringBuffer();

  // What the harness is currently waiting for. Every failure path prints it,
  // so a red run names the stalled step instead of a bare timeout.
  var waitingFor =
      'the first test run to finish ("All tests were executed") '
      'and Hot Restart to attach ("Hot Restart: attached to the app")';

  final exampleAppDirectory = io.Directory(join('..', 'e2e_app'));
  final exampleTestFile = io.File(
    join(exampleAppDirectory.path, 'patrol_test', 'example_test.dart'),
  );

  await _printDeviceState();

  print(
    '[harness] ${elapsed()} starting `patrol_plus develop` '
    'in ${exampleAppDirectory.absolute.path}',
  );
  final process = await io.Process.start(
    'patrol_plus',
    [
      'develop',
      ...['--target', 'patrol_test/example_test.dart'],
      ...['--no-open-devtools'],
      ...args,
      '--verbose',
    ],
    runInShell: true,
    workingDirectory: exampleAppDirectory.path,
  );

  Never fail(String reason, {int exitCode = 1}) {
    print('[harness] ${elapsed()} FAILED while waiting for $waitingFor');
    print('[harness] $reason');
    print('[harness] isFirstTestPassed: $isFirstTestPassed');
    print('[harness] isReloaded: $isReloaded');
    print('[harness] Running file:');
    print(exampleTestFile.readAsStringSync());
    print('[harness] End of the running file');
    print('[harness] Exiting with exit code $exitCode');
    io.exit(exitCode);
  }

  // On the happy path `patrol develop` never exits on its own: the harness
  // exits first, below, as soon as the restarted test fails as expected. So an
  // exit before that point means the build or the test run failed. Fail right
  // away instead of sitting out the inactivity timer with the real error
  // buried in the scrollback.
  unawaited(
    process.exitCode.then((code) {
      fail(
        '`patrol develop` exited with code $code',
        exitCode: code == 0 ? 1 : code,
      );
    }),
  );

  process.stderr
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .listen((msg) => print('[patrol develop] $msg'));

  process.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen((
    data,
  ) {
    print('[patrol develop] $data');
    output.write(data);
    final stringOutput = output.toString();

    if (isFirstTestPassed == false &&
        stringOutput.contains(
          'All tests were executed. Press "r" to start again or "q" to quit',
        )) {
      isFirstTestPassed = true;
      print('[harness] ${elapsed()} first test run finished');
    }

    final isReadyToRestart =
        isFirstTestPassed &&
        isReloaded == false &&
        stringOutput.contains('Hot Restart: attached to the app');

    if (isReadyToRestart) {
      exampleTestFile.writeAsStringSync(exampleTestWithFailingContents);
      process.stdin.add('R'.codeUnits);
      isReloaded = true;
      waitingFor =
          'the restarted test to fail as expected '
          '("When the exception was thrown")';
      print(
        '[harness] ${elapsed()} Hot Restart attached, '
        'rewrote example_test.dart and sent "R"',
      );
    }

    final isRestartedTestFailed =
        isFirstTestPassed &&
        isReloaded &&
        stringOutput.contains('When the exception was thrown');

    if (isRestartedTestFailed) {
      print(
        '[harness] ${elapsed()} exampleTestWithFailingContents was '
        'successfully restarted as example_test and it has failed as expected',
      );
      print('[harness] Exiting with exit code 0');
      // TODO: kill `patrol develop` process and its children
      io.exit(0);
    }

    inactivityTimer?.cancel();

    if (stringOutput.contains('Completed building')) {
      inactivityTimer = Timer(afterBuildCompletedTimeout, () {
        fail(
          '${afterBuildCompletedTimeout.inSeconds} seconds of inactivity '
          'after the build completed, something went wrong...',
        );
      });
    } else {
      inactivityTimer = Timer(inactivityTimeout, () {
        fail(
          '${inactivityTimeout.inMinutes} minutes of inactivity before the '
          'build completed, something went wrong...',
        );
      });
    }
  });
}

void _verifyWorkingDirectory() {
  if (!io.Directory.current.path.endsWith('cli_tests')) {
    print('This test must be run from dev/cli_tests directory');
    io.exit(1);
  }
}

/// Prints what adb sees before `patrol develop` starts, so a run that never
/// gets past device discovery shows whether the emulator was actually up.
Future<void> _printDeviceState() async {
  for (final command in [
    ['adb', 'devices', '-l'],
    ['adb', 'shell', 'getprop', 'sys.boot_completed'],
  ]) {
    try {
      final result = await io.Process.run(
        command.first,
        command.skip(1).toList(),
        runInShell: true,
      );
      print(
        '[harness] \$ ${command.join(' ')} (exit ${result.exitCode})\n'
                '${result.stdout}${result.stderr}'
            .trimRight(),
      );
    } on Exception catch (err) {
      print('[harness] \$ ${command.join(' ')} failed: $err');
    }
  }
}
