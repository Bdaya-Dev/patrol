// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import 'package:patrol_cli_plus/src/crossplatform/app_options.dart';
import 'package:patrol_cli_plus/src/devices.dart';
import 'package:patrol_cli_plus/src/ios/ios_test_backend.dart';
import 'package:patrol_cli_plus/src/runner/flutter_command.dart';
import 'package:test/test.dart';

import '../src/fixtures.dart';

void main() {
  const flutterCommand = FlutterCommand('flutter');

  group('FlutterAppOptions.toFlutterTestDiscoveryInvocation', () {
    const flutterOptions = FlutterAppOptions(
      command: flutterCommand,
      target: 'patrol_test/test_bundle.dart',
      buildMode: BuildMode.debug,
      flavor: null,
      buildName: null,
      buildNumber: null,
      dartDefines: {'TARGET_ENV': 'staging'},
      dartDefineFromFilePaths: [],
    );

    test('runs only the explorer test and forwards the dart-defines', () {
      final invocation = flutterOptions.toFlutterTestDiscoveryInvocation(
        manifestOutputPath: '/tmp/manifest.json',
      );

      expect(
        invocation,
        equals([
          'flutter',
          'test',
          'patrol_test/test_bundle.dart',
          '--suppress-analytics',
          // Restricting the run to the explorer keeps the user's setUp/tearDown
          // (however they were registered) from executing during discovery.
          '--plain-name',
          'patrol_test_explorer',
          '--dart-define',
          'PATROL_TEST_DISCOVERY=true',
          '--dart-define',
          'PATROL_MANIFEST_OUTPUT=/tmp/manifest.json',
          '--dart-define',
          'TARGET_ENV=staging',
        ]),
      );
    });
  });

  group('AndroidAppOptions', () {
    late AndroidAppOptions options;

    group('correctly encodes default invocation', () {
      test('on Windows', () {
        const flutterOptions = FlutterAppOptions(
          command: flutterCommand,
          target: r'C:\Users\john\app\patrol_test\app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: ['somePath.json', 'someOtherPath.json'],
        );
        options = const AndroidAppOptions(
          flutter: flutterOptions,
          appServerPort: 1,
          testServerPort: 2,
          uninstall: false,
        );

        final invocation = options.toGradleAssembleTestInvocation(
          isWindows: true,
        );
        expect(
          invocation,
          equals([
            r'.\gradlew.bat',
            ':app:assembleDebugAndroidTest',
            r'-Ptarget=C:\Users\john\app\patrol_test\app_test.dart',
            '-Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true',
            '-Papp-server-port=1',
            '-Ptest-server-port=2',
            '-Ppatrol-enabled=true',
          ]),
        );
      });

      test('on macOS', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: '/Users/john/app/patrol_test/app_test.dart',
          buildMode: BuildMode.release,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: ['somePath.json', 'someOtherPath.json'],
        );
        options = const AndroidAppOptions(
          flutter: flutterOpts,
          appServerPort: 1,
          testServerPort: 2,
          uninstall: false,
        );

        final invocation = options.toGradleAssembleTestInvocation(
          isWindows: false,
        );
        expect(
          invocation,
          equals([
            './gradlew',
            ':app:assembleReleaseAndroidTest',
            '-Ptarget=/Users/john/app/patrol_test/app_test.dart',
            '-Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true',
            '-Papp-server-port=1',
            '-Ptest-server-port=2',
            '-Ppatrol-enabled=true',
          ]),
        );
      });
    });

    group('correctly encodes customized invocation', () {
      const dartDefines = {
        'EMAIL': 'user@example.com',
        'PASSWORD': 'ny4ncat',
        'foo': 'bar',
      };

      test('on Windows', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: r'C:\Users\john\app\patrol_test\app_test.dart',
          buildMode: BuildMode.release,
          flavor: 'dev',
          buildName: null,
          buildNumber: null,
          dartDefines: dartDefines,
          dartDefineFromFilePaths: [],
        );
        options = const AndroidAppOptions(
          flutter: flutterOpts,
          appServerPort: 1,
          testServerPort: 2,
          uninstall: true,
        );

        final invocation = options.toGradleAssembleTestInvocation(
          isWindows: true,
        );
        expect(
          invocation,
          equals([
            r'.\gradlew.bat',
            ':app:assembleDevReleaseAndroidTest',
            r'-Ptarget=C:\Users\john\app\patrol_test\app_test.dart',
            '-Pdart-defines=RU1BSUw9dXNlckBleGFtcGxlLmNvbQ==,UEFTU1dPUkQ9bnk0bmNhdA==,Zm9vPWJhcg==',
            '-Papp-server-port=1',
            '-Ptest-server-port=2',
            '-Ppatrol-enabled=true',
          ]),
        );
      });

      test('on macOS', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: '/Users/john/app/patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: 'dev',
          buildName: null,
          buildNumber: null,
          dartDefines: dartDefines,
          dartDefineFromFilePaths: [],
        );
        options = const AndroidAppOptions(
          flutter: flutterOpts,
          appServerPort: 1,
          testServerPort: 2,
          uninstall: true,
        );

        final invocation = options.toGradleAssembleTestInvocation(
          isWindows: false,
        );
        expect(
          invocation,
          equals([
            './gradlew',
            ':app:assembleDevDebugAndroidTest',
            '-Ptarget=/Users/john/app/patrol_test/app_test.dart',
            '-Pdart-defines=RU1BSUw9dXNlckBleGFtcGxlLmNvbQ==,UEFTU1dPUkQ9bnk0bmNhdA==,Zm9vPWJhcg==',
            '-Papp-server-port=1',
            '-Ptest-server-port=2',
            '-Ppatrol-enabled=true',
          ]),
        );
      });

      test('on macOS with no uninstall', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: '/Users/john/app/patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: 'dev',
          buildName: null,
          buildNumber: null,
          dartDefines: dartDefines,
          dartDefineFromFilePaths: [],
        );
        options = const AndroidAppOptions(
          flutter: flutterOpts,
          appServerPort: 1,
          testServerPort: 2,
          uninstall: false,
        );

        final invocation = options.toGradleConnectedTestInvocation(
          isWindows: false,
        );
        expect(
          invocation,
          equals([
            './gradlew',
            ':app:connectedDevDebugAndroidTest',
            '-Ptarget=/Users/john/app/patrol_test/app_test.dart',
            '-Pdart-defines=RU1BSUw9dXNlckBleGFtcGxlLmNvbQ==,UEFTU1dPUkQ9bnk0bmNhdA==,Zm9vPWJhcg==',
            '-Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true',
            '-Papp-server-port=1',
            '-Ptest-server-port=2',
            '-Ppatrol-enabled=true',
          ]),
        );
      });
    });
  });

  group('IOSAppOptions', () {
    late IOSAppOptions options;

    group(
      'correctly encodes default xcodebuild invocation for simulator with dartDefineFromFile path',
      () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: ['somePath.json', 'someOtherPath.json'],
        );

        setUp(() {
          options = IOSAppOptions(
            flutter: flutterOpts,
            scheme: 'Runner',
            configuration: 'Debug',
            simulator: true,
            osVersion: 'latest',
            testServerPort: 8081,
            appServerPort: 8082,
          );
        });

        test('when building tests', () {
          final flutterInvocation = options.toFlutterBuildInvocation(
            flutterOpts.buildMode,
          );

          expect(
            flutterInvocation,
            equals([
              ...['flutter', 'build', 'ios'],
              '--no-version-check',
              '--suppress-analytics',
              ...['--config-only', '--no-codesign', '--debug', '--simulator'],
              ...['--target', 'patrol_test/app_test.dart'],
              ...['--dart-define-from-file', 'somePath.json'],
              ...['--dart-define-from-file', 'someOtherPath.json'],
            ]),
          );

          final xcodebuildInvocation = options.buildForTestingInvocation();

          expect(
            xcodebuildInvocation,
            equals([
              ...['xcodebuild', 'build-for-testing'],
              ...['-workspace', 'Runner.xcworkspace'],
              ...['-scheme', 'Runner'],
              ...['-configuration', 'Debug'],
              ...['-sdk', 'iphonesimulator'],
              ...['-destination', 'generic/platform=iOS Simulator'],
              '-quiet',
              ...['-derivedDataPath', '../build/ios_integ'],
              r'OTHER_SWIFT_FLAGS=$(inherited) -D PATROL_ENABLED',
              r'OTHER_LDFLAGS=$(inherited) -weak_framework XCTest -F$(PLATFORM_DIR)/Developer/Library/Frameworks -L$(PLATFORM_DIR)/Developer/usr/lib',
              r'OTHER_CFLAGS=$(inherited) -D FULL_ISOLATION=0 -D CLEAR_PERMISSIONS=0',
            ]),
          );
        });

        test('when executing tests', () {
          const xcTestRunPath =
              '/Users/charlie/awesome_app/build/ios_integ/Build/Products/Runner_iphonesimulator16.4-arm64-x86_64.xctestrun';

          final xcodebuildInvocation = options.testWithoutBuildingInvocation(
            iosDevice,
            xcTestRunPath: xcTestRunPath,
            resultBundlePath: '',
          );

          expect(
            xcodebuildInvocation,
            equals([
              ...['xcodebuild', 'test-without-building'],
              ...['-xctestrun', xcTestRunPath],
              ...['-only-testing', 'RunnerUITests/RunnerUITests'],
              ...['-destination', 'platform=iOS,id=$iosDeviceId'],
              ...['-destination-timeout', '30'],
              ...['-resultBundlePath', ''],
            ]),
          );
        });
      },
    );

    group(
      'correctly encodes default xcodebuild invocation for simulator without dartDefineFromFile path',
      () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );

        setUp(() {
          options = IOSAppOptions(
            flutter: flutterOpts,
            scheme: 'Runner',
            configuration: 'Debug',
            simulator: true,
            osVersion: '17.5',
            testServerPort: 8081,
            appServerPort: 8082,
          );
        });

        test('when building tests', () {
          final flutterInvocation = options.toFlutterBuildInvocation(
            flutterOpts.buildMode,
          );

          expect(
            flutterInvocation,
            equals([
              ...['flutter', 'build', 'ios'],
              '--no-version-check',
              '--suppress-analytics',
              ...['--config-only', '--no-codesign', '--debug', '--simulator'],
              ...['--target', 'patrol_test/app_test.dart'],
            ]),
          );

          final xcodebuildInvocation = options.buildForTestingInvocation();

          expect(
            xcodebuildInvocation,
            equals([
              ...['xcodebuild', 'build-for-testing'],
              ...['-workspace', 'Runner.xcworkspace'],
              ...['-scheme', 'Runner'],
              ...['-configuration', 'Debug'],
              ...['-sdk', 'iphonesimulator'],
              ...['-destination', 'generic/platform=iOS Simulator'],
              '-quiet',
              ...['-derivedDataPath', '../build/ios_integ'],
              r'OTHER_SWIFT_FLAGS=$(inherited) -D PATROL_ENABLED',
              r'OTHER_LDFLAGS=$(inherited) -weak_framework XCTest -F$(PLATFORM_DIR)/Developer/Library/Frameworks -L$(PLATFORM_DIR)/Developer/usr/lib',
              r'OTHER_CFLAGS=$(inherited) -D FULL_ISOLATION=0 -D CLEAR_PERMISSIONS=0',
            ]),
          );
        });

        test('when executing tests', () {
          const xcTestRunPath =
              '/Users/charlie/awesome_app/build/ios_integ/Build/Products/Runner_iphonesimulator16.4-arm64-x86_64.xctestrun';

          final xcodebuildInvocation = options.testWithoutBuildingInvocation(
            iosDevice,
            xcTestRunPath: xcTestRunPath,
            resultBundlePath: '',
          );

          expect(
            xcodebuildInvocation,
            equals([
              ...['xcodebuild', 'test-without-building'],
              ...['-xctestrun', xcTestRunPath],
              ...['-only-testing', 'RunnerUITests/RunnerUITests'],
              ...['-destination', 'platform=iOS,id=$iosDeviceId'],
              ...['-destination-timeout', '30'],
              ...['-resultBundlePath', ''],
            ]),
          );
        });
      },
    );

    group('correctly encodes customized xcodebuild invocation for real device', () {
      const flutterOpts = FlutterAppOptions(
        command: flutterCommand,
        target: 'patrol_test/app_test.dart',
        buildMode: BuildMode.release,
        flavor: 'prod',
        buildName: '1.2.3',
        buildNumber: '123',
        dartDefines: {
          'EMAIL': 'user@example.com',
          'PASSWORD': 'ny4ncat',
          'foo': 'bar',
        },
        dartDefineFromFilePaths: [],
      );

      setUp(() {
        options = IOSAppOptions(
          flutter: flutterOpts,
          scheme: 'prod',
          configuration: 'Release-prod',
          simulator: false,
          osVersion: 'latest',
          testServerPort: 8081,
          appServerPort: 8082,
          fullIsolation: true,
        );
      });

      test('when building tests', () {
        final flutterInvocation = options.toFlutterBuildInvocation(
          flutterOpts.buildMode,
        );

        expect(
          flutterInvocation,
          equals([
            ...['flutter', 'build', 'ios'],
            '--no-version-check',
            '--suppress-analytics',
            ...['--config-only', '--no-codesign', '--release'],
            ...['--flavor', 'prod'],
            ...['--build-name', '1.2.3'],
            ...['--build-number', '123'],
            ...['--target', 'patrol_test/app_test.dart'],
            ...['--dart-define', 'EMAIL=user@example.com'],
            ...['--dart-define', 'PASSWORD=ny4ncat'],
            ...['--dart-define', 'foo=bar'],
          ]),
        );

        final xcodebuildInvocation = options.buildForTestingInvocation();

        expect(
          xcodebuildInvocation,
          equals([
            ...['xcodebuild', 'build-for-testing'],
            ...['-workspace', 'Runner.xcworkspace'],
            ...['-scheme', 'prod'],
            ...['-configuration', 'Release-prod'],
            ...['-sdk', 'iphoneos'],
            ...['-destination', 'generic/platform=iOS'],
            '-quiet',
            ...['-derivedDataPath', '../build/ios_integ'],
            r'OTHER_SWIFT_FLAGS=$(inherited) -D PATROL_ENABLED',
            r'OTHER_LDFLAGS=$(inherited) -weak_framework XCTest -F$(PLATFORM_DIR)/Developer/Library/Frameworks -L$(PLATFORM_DIR)/Developer/usr/lib',
            r'OTHER_CFLAGS=$(inherited) -D FULL_ISOLATION=1 -D CLEAR_PERMISSIONS=0',
          ]),
        );
      });
    });

    group('works when device name contains a comma', () {
      setUp(() {
        options = IOSAppOptions(
          flutter: const FlutterAppOptions(
            command: flutterCommand,
            target: 'patrol_test/app_test.dart',
            buildMode: BuildMode.debug,
            flavor: null,
            buildName: null,
            buildNumber: null,
            dartDefines: {},
            dartDefineFromFilePaths: [],
          ),
          scheme: 'Runner',
          configuration: 'Debug',
          simulator: false,
          osVersion: 'latest',
          testServerPort: 8081,
          appServerPort: 8082,
        );
      });

      test('testWithoutBuildingInvocation', () {
        const deviceWithCommaInName = Device(
          name: 'Test, test device',
          id: iosDeviceId,
          targetPlatform: TargetPlatform.iOS,
          real: true,
        );

        const xcTestRunPath =
            '/Users/charlie/awesome_app/build/ios_integ/Build/Products/Runner_iphoneos.xctestrun';

        final xcodebuildInvocation = options.testWithoutBuildingInvocation(
          deviceWithCommaInName,
          xcTestRunPath: xcTestRunPath,
          resultBundlePath: '',
        );

        expect(
          xcodebuildInvocation,
          equals([
            ...['xcodebuild', 'test-without-building'],
            ...['-xctestrun', xcTestRunPath],
            ...['-only-testing', 'RunnerUITests/RunnerUITests'],
            ...['-destination', 'platform=iOS,id=$iosDeviceId'],
            ...['-destination-timeout', '30'],
            ...['-resultBundlePath', ''],
          ]),
        );
      });
    });

    group('correctly targets a simulator device by UDID', () {
      test('test-without-building uses -destination id=<udid>', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );
        final simOptions = IOSAppOptions(
          flutter: flutterOpts,
          scheme: 'Runner',
          configuration: 'Debug',
          simulator: true,
          // Intentionally `latest` to prove it no longer affects the
          // simulator destination (targeting is now by exact UDID).
          osVersion: 'latest',
          testServerPort: 8081,
          appServerPort: 8082,
        );

        final xcodebuildInvocation = simOptions.testWithoutBuildingInvocation(
          iosSimulatorDevice,
          xcTestRunPath: 'some.xctestrun',
          resultBundlePath: '',
        );

        // A booted simulator is targeted by its exact UDID, NOT by
        // `platform=iOS Simulator,OS=latest,name=...` which xcodebuild fails to
        // resolve ("Unable to find a device matching ..." -> exit 70).
        expect(
          xcodebuildInvocation,
          equals([
            ...['xcodebuild', 'test-without-building'],
            ...['-xctestrun', 'some.xctestrun'],
            ...['-only-testing', 'RunnerUITests/RunnerUITests'],
            ...['-destination', 'id=$iosSimulatorDeviceId'],
            ...['-destination-timeout', '30'],
            ...['-resultBundlePath', ''],
          ]),
        );
      });

      test('test-without-building emits one -only-testing per selector', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );
        final simOptions = IOSAppOptions(
          flutter: flutterOpts,
          scheme: 'Runner',
          configuration: 'Debug',
          simulator: true,
          osVersion: 'latest',
          testServerPort: 8081,
          appServerPort: 8082,
        );

        final xcodebuildInvocation = simOptions.testWithoutBuildingInvocation(
          iosSimulatorDevice,
          xcTestRunPath: 'some.xctestrun',
          resultBundlePath: '',
          onlyTesting: ['testA', 'testB'],
        );

        expect(
          xcodebuildInvocation,
          equals([
            ...['xcodebuild', 'test-without-building'],
            ...['-xctestrun', 'some.xctestrun'],
            ...['-only-testing', 'RunnerUITests/RunnerUITests/testA'],
            ...['-only-testing', 'RunnerUITests/RunnerUITests/testB'],
            ...['-destination', 'id=$iosSimulatorDeviceId'],
            ...['-destination-timeout', '30'],
            ...['-resultBundlePath', ''],
          ]),
        );
      });
    });
  });

  group('MacOSAppOptions', () {
    late MacOSAppOptions options;

    group('correctly encodes Flutter build invocation with build flags', () {
      test('with build name and number', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.release,
          flavor: 'prod',
          buildName: '2.1.0',
          buildNumber: '210',
          dartDefines: {'ENV': 'production'},
          dartDefineFromFilePaths: [],
        );

        options = MacOSAppOptions(
          flutter: flutterOpts,
          scheme: 'prod',
          configuration: 'Release-prod',
          appServerPort: 8082,
          testServerPort: 8081,
        );

        final flutterInvocation = options.toFlutterBuildInvocation(
          flutterOpts.buildMode,
        );

        expect(
          flutterInvocation,
          equals([
            ...['flutter', 'build', 'macos'],
            '--no-version-check',
            '--suppress-analytics',
            ...['--config-only', '--release'],
            ...['--flavor', 'prod'],
            ...['--build-name', '2.1.0'],
            ...['--build-number', '210'],
            ...['--target', 'patrol_test/app_test.dart'],
            ...['--dart-define', 'ENV=production'],
          ]),
        );
      });

      test('without build name and number', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );

        options = MacOSAppOptions(
          flutter: flutterOpts,
          scheme: 'Runner',
          configuration: 'Debug',
          appServerPort: 8082,
          testServerPort: 8081,
        );

        final flutterInvocation = options.toFlutterBuildInvocation(
          flutterOpts.buildMode,
        );

        expect(
          flutterInvocation,
          equals([
            ...['flutter', 'build', 'macos'],
            '--no-version-check',
            '--suppress-analytics',
            ...['--config-only', '--debug'],
            ...['--target', 'patrol_test/app_test.dart'],
          ]),
        );
      });
    });
  });

  group('WebAppOptions', () {
    late WebAppOptions options;

    group('correctly encodes Flutter build invocation', () {
      test('with minimal configuration', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );

        options = const WebAppOptions(flutter: flutterOpts);

        final flutterInvocation = options.toFlutterBuildInvocation();

        expect(
          flutterInvocation,
          equals([
            'flutter',
            'build',
            'web',
            '--target=patrol_test/app_test.dart',
            '--debug',
          ]),
        );
      });

      test('with release build mode', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'integration_test/app_test.dart',
          buildMode: BuildMode.release,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );

        options = const WebAppOptions(flutter: flutterOpts);

        final flutterInvocation = options.toFlutterBuildInvocation();

        expect(
          flutterInvocation,
          equals([
            'flutter',
            'build',
            'web',
            '--target=integration_test/app_test.dart',
            '--release',
          ]),
        );
      });

      test('with dart defines', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {
            'EMAIL': 'user@example.com',
            'PASSWORD': 'ny4ncat',
            'API_KEY': 'secret123',
          },
          dartDefineFromFilePaths: [],
        );

        options = const WebAppOptions(flutter: flutterOpts);

        final flutterInvocation = options.toFlutterBuildInvocation();

        expect(
          flutterInvocation,
          equals([
            'flutter',
            'build',
            'web',
            '--target=patrol_test/app_test.dart',
            '--debug',
            '--dart-define=EMAIL=user@example.com',
            '--dart-define=PASSWORD=ny4ncat',
            '--dart-define=API_KEY=secret123',
          ]),
        );
      });

      test('with dart define from file paths', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.release,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: ['defines.json', 'secrets.env'],
        );

        options = const WebAppOptions(flutter: flutterOpts);

        final flutterInvocation = options.toFlutterBuildInvocation();

        expect(
          flutterInvocation,
          equals([
            'flutter',
            'build',
            'web',
            '--target=patrol_test/app_test.dart',
            '--release',
            '--dart-define-from-file=defines.json',
            '--dart-define-from-file=secrets.env',
          ]),
        );
      });

      test('with both dart defines and dart define from file', () {
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/web_test.dart',
          buildMode: BuildMode.profile,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {'ENV': 'production', 'DEBUG_MODE': 'false'},
          dartDefineFromFilePaths: ['config.json'],
        );

        options = const WebAppOptions(flutter: flutterOpts);

        final flutterInvocation = options.toFlutterBuildInvocation();

        expect(
          flutterInvocation,
          equals([
            'flutter',
            'build',
            'web',
            '--target=patrol_test/web_test.dart',
            '--profile',
            '--dart-define=ENV=production',
            '--dart-define=DEBUG_MODE=false',
            '--dart-define-from-file=config.json',
          ]),
        );
      });

      test('with custom flutter command arguments', () {
        const customFlutterCommand = FlutterCommand('flutter', [
          '--verbose',
          '--no-pub',
        ]);

        const flutterOpts = FlutterAppOptions(
          command: customFlutterCommand,
          target: 'test/my_test.dart',
          buildMode: BuildMode.debug,
          flavor: null,
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );

        options = const WebAppOptions(flutter: flutterOpts);

        final flutterInvocation = options.toFlutterBuildInvocation();

        expect(
          flutterInvocation,
          equals([
            'flutter',
            '--verbose',
            '--no-pub',
            'build',
            'web',
            '--target=test/my_test.dart',
            '--debug',
          ]),
        );
      });

      test('flavor is ignored for web builds', () {
        // Note: Web builds don't support flavors, so this should be handled
        // by not including --flavor in the command
        const flutterOpts = FlutterAppOptions(
          command: flutterCommand,
          target: 'patrol_test/app_test.dart',
          buildMode: BuildMode.release,
          flavor: 'production', // This should be ignored for web
          buildName: null,
          buildNumber: null,
          dartDefines: {},
          dartDefineFromFilePaths: [],
        );

        options = const WebAppOptions(flutter: flutterOpts);

        final flutterInvocation = options.toFlutterBuildInvocation();

        // Verify that --flavor is NOT included in the invocation
        expect(
          flutterInvocation,
          equals([
            'flutter',
            'build',
            'web',
            '--target=patrol_test/app_test.dart',
            '--release',
          ]),
        );
        expect(flutterInvocation, isNot(contains('--flavor')));
      });
    });

    group('carries web tag filters for the Playwright runner', () {
      const flutterOpts = FlutterAppOptions(
        command: flutterCommand,
        target: 'patrol_test/app_test.dart',
        buildMode: BuildMode.profile,
        flavor: null,
        buildName: null,
        buildNumber: null,
        dartDefines: {},
        dartDefineFromFilePaths: [],
      );

      test('grep / grepInvert default to null (no filter)', () {
        options = const WebAppOptions(flutter: flutterOpts);
        expect(options.grep, isNull);
        expect(options.grepInvert, isNull);
      });

      test('grep / grepInvert are carried through (from --tags / '
          '--exclude-tags)', () {
        options = const WebAppOptions(
          flutter: flutterOpts,
          grep: '@billing-plans,@tap-hosted-checkout',
          grepInvert: '@slow',
        );
        expect(options.grep, '@billing-plans,@tap-hosted-checkout');
        expect(options.grepInvert, '@slow');
      });
    });

    group('carries the web error gate config for the Playwright runner '
        '(F-B)', () {
      const flutterOpts = FlutterAppOptions(
        command: flutterCommand,
        target: 'patrol_test/app_test.dart',
        buildMode: BuildMode.profile,
        flavor: null,
        buildName: null,
        buildNumber: null,
        dartDefines: {},
        dartDefineFromFilePaths: [],
      );

      test('errorDetection defaults to false and errorAllow to null '
          '(gate off by default)', () {
        options = const WebAppOptions(flutter: flutterOpts);
        expect(options.errorDetection, isFalse);
        expect(options.errorAllow, isNull);
      });

      test('errorDetection / errorAllow are carried through (from '
          '--web-error-detection / --web-error-allow)', () {
        options = const WebAppOptions(
          flutter: flutterOpts,
          errorDetection: true,
          errorAllow: 'is unimplemented,UNIMPLEMENTED',
        );
        expect(options.errorDetection, isTrue);
        expect(options.errorAllow, 'is unimplemented,UNIMPLEMENTED');
      });
    });

    group('carries the cross-origin auth-flow spec for the Playwright '
        'runner (F-A)', () {
      const flutterOpts = FlutterAppOptions(
        command: flutterCommand,
        target: 'patrol_test/app_test.dart',
        buildMode: BuildMode.profile,
        flavor: null,
        buildName: null,
        buildNumber: null,
        dartDefines: {},
        dartDefineFromFilePaths: [],
      );

      test('authFlow defaults to null (no auth prelude runs)', () {
        options = const WebAppOptions(flutter: flutterOpts);
        expect(options.authFlow, isNull);
      });

      test('authFlow is carried through (from --web-auth-flow)', () {
        const spec =
            '{"loginUrlPattern":"https://dev-auth.invora.app",'
            '"loginNameSelector":"input[name=loginName]",'
            '"loginNameEnvVar":"E2E_USERNAME",'
            '"passwordSelector":"input[type=password]",'
            '"passwordEnvVar":"E2E_PASSWORD",'
            '"submitSelector":"button[type=submit]",'
            '"successUrlPattern":"https://dev-dashboard.invora.app"}';
        options = const WebAppOptions(flutter: flutterOpts, authFlow: spec);
        expect(options.authFlow, spec);
      });

      test(
        'authStateFile defaults to null (auth flow runs fresh every time)',
        () {
          options = const WebAppOptions(flutter: flutterOpts);
          expect(options.authStateFile, isNull);
        },
      );

      test('authStateFile is carried through (from --web-auth-state-file)', () {
        options = const WebAppOptions(
          flutter: flutterOpts,
          authStateFile: '.patrol_auth_state.json',
        );
        expect(options.authStateFile, '.patrol_auth_state.json');
      });

      test(
        'authFlowModule defaults to null (registration escape hatch unused)',
        () {
          options = const WebAppOptions(flutter: flutterOpts);
          expect(options.authFlowModule, isNull);
        },
      );

      test(
        'authFlowModule is carried through (from --web-auth-flow-module)',
        () {
          options = const WebAppOptions(
            flutter: flutterOpts,
            authFlowModule: 'patrol_test/ci/real_dev_register_flow.ts',
          );
          expect(
            options.authFlowModule,
            'patrol_test/ci/real_dev_register_flow.ts',
          );
        },
      );
    });

    group('toEnvironmentVariables', () {
      const flutterOpts = FlutterAppOptions(
        command: flutterCommand,
        target: 'patrol_test/app_test.dart',
        buildMode: BuildMode.debug,
        flavor: null,
        buildName: null,
        buildNumber: null,
        dartDefines: {},
        dartDefineFromFilePaths: [],
      );

      test(
        'omits unset options (only the always-on error-gate flag remains)',
        () {
          options = const WebAppOptions(flutter: flutterOpts);

          expect(
            options.toEnvironmentVariables(),
            equals({'PATROL_WEB_ERROR_DETECTION': 'false'}),
          );
        },
      );

      test('includes only the options that were set', () {
        options = const WebAppOptions(
          flutter: flutterOpts,
          timeout: 30000,
          headless: true,
          channel: 'chrome',
        );

        expect(
          options.toEnvironmentVariables(),
          equals({
            'PATROL_WEB_TIMEOUT': '30000',
            'PATROL_WEB_HEADLESS': 'true',
            'PATROL_WEB_CHANNEL': 'chrome',
            'PATROL_WEB_ERROR_DETECTION': 'false',
          }),
        );
      });

      test('stringifies every supported option', () {
        options = const WebAppOptions(
          flutter: flutterOpts,
          retries: 2,
          video: 'on',
          timeout: 30000,
          workers: 4,
          reporter: 'html',
          locale: 'en-US',
          timezone: 'UTC',
          colorScheme: 'dark',
          geolocation: '{"latitude":1,"longitude":2}',
          permissions: '["geolocation"]',
          userAgent: 'test-agent',
          viewport: '{"width":800,"height":600}',
          globalTimeout: 60000,
          shard: '1/2',
          headless: false,
          browserArgs: '["--no-sandbox"]',
          channel: 'msedge',
          executablePath: '/usr/bin/chromium',
          slowMo: 100,
          chromiumSandbox: false,
          downloadsPath: '/tmp/downloads',
          ignoreDefaultArgs: 'true',
          proxy: '{"server":"http://localhost:8080"}',
          browserTimeout: 5000,
          tracesDir: '/tmp/traces',
          bypassCsp: true,
          ignoreHttpsErrors: true,
          offline: false,
          httpCredentials: '{"username":"user","password":"pass"}',
          extraHttpHeaders: '{"X-Test":"1"}',
          screenshot: 'only-on-failure',
          trace: 'retain-on-failure',
          storageState: '/tmp/state.json',
          acceptDownloads: true,
          initTimeout: 120000,
          grep: '@billing,@checkout',
          grepInvert: '@slow',
          errorDetection: true,
          errorAllow: 'is unimplemented,UNIMPLEMENTED',
          authFlow: '{"loginUrlPattern":"https://idp.example"}',
          authStateFile: '.patrol_auth_state.json',
          authFlowModule: 'patrol_test/ci/flow.ts',
        );

        expect(
          options.toEnvironmentVariables(),
          equals({
            'PATROL_WEB_RETRIES': '2',
            'PATROL_WEB_VIDEO': 'on',
            'PATROL_WEB_TIMEOUT': '30000',
            'PATROL_WEB_WORKERS': '4',
            'PATROL_WEB_REPORTER': 'html',
            'PATROL_WEB_LOCALE': 'en-US',
            'PATROL_WEB_TIMEZONE': 'UTC',
            'PATROL_WEB_COLOR_SCHEME': 'dark',
            'PATROL_WEB_GEOLOCATION': '{"latitude":1,"longitude":2}',
            'PATROL_WEB_PERMISSIONS': '["geolocation"]',
            'PATROL_WEB_USER_AGENT': 'test-agent',
            'PATROL_WEB_VIEWPORT': '{"width":800,"height":600}',
            'PATROL_WEB_GLOBAL_TIMEOUT': '60000',
            'PATROL_WEB_SHARD': '1/2',
            'PATROL_WEB_HEADLESS': 'false',
            'PATROL_WEB_BROWSER_ARGS': '["--no-sandbox"]',
            'PATROL_WEB_CHANNEL': 'msedge',
            'PATROL_WEB_EXECUTABLE_PATH': '/usr/bin/chromium',
            'PATROL_WEB_SLOW_MO': '100',
            'PATROL_WEB_CHROMIUM_SANDBOX': 'false',
            'PATROL_WEB_DOWNLOADS_PATH': '/tmp/downloads',
            'PATROL_WEB_IGNORE_DEFAULT_ARGS': 'true',
            'PATROL_WEB_PROXY': '{"server":"http://localhost:8080"}',
            'PATROL_WEB_BROWSER_TIMEOUT': '5000',
            'PATROL_WEB_TRACES_DIR': '/tmp/traces',
            'PATROL_WEB_BYPASS_CSP': 'true',
            'PATROL_WEB_IGNORE_HTTPS_ERRORS': 'true',
            'PATROL_WEB_OFFLINE': 'false',
            'PATROL_WEB_HTTP_CREDENTIALS':
                '{"username":"user","password":"pass"}',
            'PATROL_WEB_EXTRA_HTTP_HEADERS': '{"X-Test":"1"}',
            'PATROL_WEB_SCREENSHOT': 'only-on-failure',
            'PATROL_WEB_TRACE': 'retain-on-failure',
            'PATROL_WEB_STORAGE_STATE': '/tmp/state.json',
            'PATROL_WEB_ACCEPT_DOWNLOADS': 'true',
            'PATROL_WEB_INIT_TIMEOUT': '120000',
            'PATROL_WEB_GREP': '@billing,@checkout',
            'PATROL_WEB_GREP_INVERT': '@slow',
            'PATROL_WEB_ERROR_DETECTION': 'true',
            'PATROL_WEB_ERROR_ALLOW': 'is unimplemented,UNIMPLEMENTED',
            'PATROL_WEB_AUTH_FLOW': '{"loginUrlPattern":"https://idp.example"}',
            'PATROL_WEB_AUTH_STATE_FILE': '.patrol_auth_state.json',
            'PATROL_WEB_AUTH_FLOW_MODULE': 'patrol_test/ci/flow.ts',
          }),
        );
      });
    });
  });
}
