import 'package:patrol_cli_plus/src/android/android_test_backend.dart';
import 'package:test/test.dart';

// Regression for Bdaya-Dev/oidc#418.
//
// Gradle exits 0 when connectedAndroidTest enumerates zero JUnit classes --
// which is what happens when the app has no androidTest source set, or its
// testInstrumentationRunner is not PatrolJUnitRunner. Judging the run by exit
// code alone therefore reports a ~7-second "Total: 0" as a pass. The consuming
// repo's Android job was green for its entire life having never executed a
// single test, which is why it could not catch an Android redirect regression.

void main() {
  group('isVacuousRun', () {
    test('flags a zero-test run that gradle reported as successful', () {
      expect(
        isVacuousRun(exitCode: 0, interruptible: false, totalTests: 0),
        isTrue,
      );
    });

    test('does not flag a run that actually executed tests', () {
      expect(
        isVacuousRun(exitCode: 0, interruptible: false, totalTests: 4),
        isFalse,
      );
      expect(
        isVacuousRun(exitCode: 0, interruptible: false, totalTests: 1),
        isFalse,
      );
    });

    test('does not flag develop mode, which legitimately completes no test',
        () {
      expect(
        isVacuousRun(exitCode: 0, interruptible: true, totalTests: 0),
        isFalse,
      );
    });

    test('does not flag an already-failing run (its own error path owns it)',
        () {
      expect(
        isVacuousRun(exitCode: 1, interruptible: false, totalTests: 0),
        isFalse,
      );
    });
  });
}
