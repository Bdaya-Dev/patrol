import 'package:apache_notice/src/package_mapping.dart';
import 'package:test/test.dart';

void main() {
  group('explicitRenameMap', () {
    test('has exactly the two known outside-package-rule renames', () {
      expect(explicitRenameMap, {
        'packages/patrol/darwin/patrol.podspec':
            'packages/patrol_plus/darwin/patrol_plus.podspec',
        'dev/e2e_app/patrol_test/macos/macos_app_test.dart':
            'dev/e2e_app/patrol_test/e2e/mobile_automation_test.dart',
      });
    });
  });

  group('mapUpstreamPathToWorkingPath', () {
    test('podspec renamed outside the package-dir rule resolves via the '
        'explicit map', () {
      expect(
        mapUpstreamPathToWorkingPath('packages/patrol/darwin/patrol.podspec'),
        'packages/patrol_plus/darwin/patrol_plus.podspec',
      );
    });

    test('macos e2e test file moved outside packages/ resolves via the '
        'explicit map', () {
      expect(
        mapUpstreamPathToWorkingPath(
          'dev/e2e_app/patrol_test/macos/macos_app_test.dart',
        ),
        'dev/e2e_app/patrol_test/e2e/mobile_automation_test.dart',
      );
    });

    test('a package file NOT in the explicit map still resolves via the '
        'generic packages/<x> -> packages/<x>_plus rule', () {
      // packages/patrol/lib/patrol.dart has no filename change, only its
      // package directory was renamed -- already handled by the generic
      // rule, so it must NOT be in explicitRenameMap.
      expect(
        explicitRenameMap.containsKey('packages/patrol/lib/patrol.dart'),
        isFalse,
      );
      expect(
        mapUpstreamPathToWorkingPath('packages/patrol/lib/patrol.dart'),
        'packages/patrol_plus/lib/patrol.dart',
      );
    });

    group('darwin SwiftPM subtree', () {
      test('the SwiftPM package dir follows the package rename', () {
        expect(
          mapUpstreamPathToWorkingPath(
            'packages/patrol/darwin/patrol/Package.swift',
          ),
          'packages/patrol_plus/darwin/patrol_plus/Package.swift',
        );
        expect(
          mapUpstreamPathToWorkingPath(
            'packages/patrol/darwin/patrol/Sources/PatrolImpl/'
            'AutomatorServer/AutomatorServer.swift',
          ),
          'packages/patrol_plus/darwin/patrol_plus/Sources/PatrolImpl/'
          'AutomatorServer/AutomatorServer.swift',
        );
      });

      test('the public Clang target dir and its umbrella header follow the '
          'package rename too', () {
        expect(
          mapUpstreamPathToWorkingPath(
            'packages/patrol/darwin/patrol/Sources/patrol/include/'
            'PatrolIntegrationTestIosRunner.h',
          ),
          'packages/patrol_plus/darwin/patrol_plus/Sources/patrol_plus/'
          'include/PatrolIntegrationTestIosRunner.h',
        );
        expect(
          mapUpstreamPathToWorkingPath(
            'packages/patrol/darwin/patrol/Sources/patrol/include/patrol.h',
          ),
          'packages/patrol_plus/darwin/patrol_plus/Sources/patrol_plus/'
          'include/patrol_plus.h',
        );
        expect(
          mapUpstreamPathToWorkingPath(
            'packages/patrol/darwin/patrol/Sources/patrol/patrol.m',
          ),
          'packages/patrol_plus/darwin/patrol_plus/Sources/patrol_plus/'
          'patrol.m',
        );
      });

      test('other darwin files and other packages are untouched by the '
          'SwiftPM rule', () {
        expect(
          mapUpstreamPathToWorkingPath('packages/patrol/darwin/.clang-format'),
          'packages/patrol_plus/darwin/.clang-format',
        );
        expect(
          mapUpstreamPathToWorkingPath(
            'packages/patrol_finders/darwin/patrol/x.swift',
          ),
          'packages/patrol_finders_plus/darwin/patrol/x.swift',
        );
      });
    });

    test('patrol_mcp is still dropped entirely, not shadowed by the '
        'explicit map', () {
      expect(
        mapUpstreamPathToWorkingPath('packages/patrol_mcp/lib/patrol_mcp.dart'),
        isNull,
      );
    });
  });
}
