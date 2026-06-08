import 'dart:io' as io;

import 'package:adb_plus/adb.dart';
import 'package:http/http.dart' as http;
import 'package:mocktail/mocktail.dart';
import 'package:patrol_cli_plus/src/analytics/analytics.dart';
import 'package:patrol_cli_plus/src/android/android_test_backend.dart';
import 'package:patrol_cli_plus/src/base/logger.dart' as logger;
import 'package:patrol_cli_plus/src/compatibility_checker/compatibility_checker.dart';
import 'package:patrol_cli_plus/src/dart_defines_reader.dart';
import 'package:patrol_cli_plus/src/devices.dart';
import 'package:patrol_cli_plus/src/ios/ios_test_backend.dart';
import 'package:patrol_cli_plus/src/macos/macos_test_backend.dart';
import 'package:patrol_cli_plus/src/pubspec_reader.dart';
import 'package:patrol_cli_plus/src/test_bundler.dart';
import 'package:patrol_cli_plus/src/test_finder.dart';
import 'package:process/process.dart' as process;
import 'package:pub_updater/pub_updater.dart' as pub;

class MockHttpClient extends Mock implements http.Client {}

class MockPubUpdater extends Mock implements pub.PubUpdater {}

class MockProcess extends Mock implements io.Process {}

class MockProcessManager extends Mock implements process.ProcessManager {}

class MockProgress extends Mock implements logger.Progress {}

class MockTask extends Mock implements logger.ProgressTask {}

class MockLogger extends Mock implements logger.Logger {}

class MockDeviceFinder extends Mock implements DeviceFinder {}

class MockAndroidTestBackend extends Mock implements AndroidTestBackend {}

class MockIOSTestBackend extends Mock implements IOSTestBackend {}

class MockMacOSTestBackend extends Mock implements MacOSTestBackend {}

class MockTestFinderFactory extends Mock implements TestFinderFactory {}

class MockTestFinder extends Mock implements TestFinder {}

class MockTestBundler extends Mock implements TestBundler {}

class MockDartDefinesReader extends Mock implements DartDefinesReader {}

class MockPubspecReader extends Mock implements PubspecReader {}

class MockCompatibilityChecker extends Mock implements CompatibilityChecker {}

class MockAdb extends Mock implements Adb {}

class MockAnalytics extends Mock implements Analytics {
  @override
  bool get firstRun => false;

  @override
  bool get enabled => false;

  @override
  Future<bool> sendCommand(
    FlutterVersion flutterVersion,
    String name, {
    Map<String, Object?> eventData = const {},
  }) async {
    return false;
  }
}
