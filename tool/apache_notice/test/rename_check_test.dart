import 'package:apache_notice/src/git.dart';
import 'package:apache_notice/src/rename_check.dart';
import 'package:test/test.dart';

void main() {
  group('isUnexplainedRename', () {
    RenameEntry r(int sim, String from, String to) =>
        RenameEntry(similarity: sim, oldPath: from, newPath: to);

    test('identical-content renames are never violations', () {
      expect(
        isUnexplainedRename(
          r(100, 'packages/patrol/a.yaml', 'packages/patrol_log_plus/a.yaml'),
          existsInTree: (_) => false,
        ),
        isFalse,
      );
    });

    test('a rename the package rule explains is not a violation', () {
      expect(
        isUnexplainedRename(
          r(
            80,
            'packages/patrol/lib/x.dart',
            'packages/patrol_plus/lib/x.dart',
          ),
          existsInTree: (_) => true,
        ),
        isFalse,
      );
    });

    test('a rename the explicit map explains is not a violation', () {
      expect(
        isUnexplainedRename(
          r(
            75,
            'packages/patrol/darwin/patrol.podspec',
            'packages/patrol_plus/darwin/patrol_plus.podspec',
          ),
          existsInTree: (_) => true,
        ),
        isFalse,
      );
    });

    test('a cross-package pairing is not a violation when the mapped '
        'counterpart still exists', () {
      // git paired upstream patrol/analysis_options.yaml with the fork's
      // patrol_finders_plus/analysis_options.yaml (identical small files),
      // but packages/patrol_plus/analysis_options.yaml is right there.
      expect(
        isUnexplainedRename(
          r(
            60,
            'packages/patrol/analysis_options.yaml',
            'packages/patrol_finders_plus/analysis_options.yaml',
          ),
          existsInTree: (p) =>
              p == 'packages/patrol_plus/analysis_options.yaml',
        ),
        isFalse,
      );
    });

    test('a genuine unmapped rename is a violation', () {
      expect(
        isUnexplainedRename(
          r(
            70,
            'packages/patrol/darwin/old.podspec',
            'packages/patrol_plus/darwin/new.podspec',
          ),
          existsInTree: (_) => false,
        ),
        isTrue,
      );
    });
  });
}
