import 'package:apache_notice/src/comment_style.dart';
import 'package:apache_notice/src/header.dart';
import 'package:test/test.dart';

void main() {
  const headerText =
      'Modified by Bdaya-Dev from the original LeanCode Patrol source '
      '(Apache-2.0). See NOTICE.md.';

  group('insertHeader', () {
    test('plain file gets header on line 1', () {
      final result = insertHeader(
        'void main() {}\n',
        const LineCommentStyle('//'),
        headerText,
      );
      expect(result, '// $headerText\nvoid main() {}\n');
    });

    test('shebang file gets header on line 2', () {
      const input = '#!/usr/bin/env bash\necho hi\n';
      final result = insertHeader(
        input,
        const LineCommentStyle('#'),
        headerText,
      );
      expect(result, '#!/usr/bin/env bash\n# $headerText\necho hi\n');
    });

    test('markdown with frontmatter gets header after closing ---', () {
      const input = '---\ntitle: x\n---\n\ncontent\n';
      final result = insertHeader(
        input,
        const BlockCommentStyle('<!-- ', ' -->'),
        headerText,
      );
      expect(result, '---\ntitle: x\n---\n<!-- $headerText -->\n\ncontent\n');
    });

    test(
      'mdx with frontmatter gets header after closing --- using jsx comments',
      () {
        const input = '---\ntitle: x\n---\n\n<Component />\n';
        final result = insertHeader(
          input,
          const BlockCommentStyle('{/* ', ' */}'),
          headerText,
        );
        expect(
          result,
          '---\ntitle: x\n---\n{/* $headerText */}\n\n<Component />\n',
        );
      },
    );

    test('markdown without frontmatter gets header on line 1', () {
      const input = '# Title\n\ncontent\n';
      final result = insertHeader(
        input,
        const BlockCommentStyle('<!-- ', ' -->'),
        headerText,
      );
      expect(result, '<!-- $headerText -->\n# Title\n\ncontent\n');
    });

    test('preserves CRLF line endings', () {
      const input = 'void main() {}\r\n';
      final result = insertHeader(
        input,
        const LineCommentStyle('//'),
        headerText,
      );
      expect(result, '// $headerText\r\nvoid main() {}\r\n');
    });

    test('preserves CRLF for a shebang file too', () {
      const input = '#!/usr/bin/env bash\r\necho hi\r\n';
      final result = insertHeader(
        input,
        const LineCommentStyle('#'),
        headerText,
      );
      expect(result, '#!/usr/bin/env bash\r\n# $headerText\r\necho hi\r\n');
    });

    test('preserves a leading UTF-8 BOM', () {
      const bom = '﻿';
      final input = '${bom}void main() {}\n';
      final result = insertHeader(
        input,
        const LineCommentStyle('//'),
        headerText,
      );
      expect(result, '$bom// $headerText\nvoid main() {}\n');
    });

    test('handles an empty file', () {
      final result = insertHeader('', const LineCommentStyle('//'), headerText);
      expect(result, '// $headerText\n');
    });

    test('handles a file with no trailing newline', () {
      const input = 'void main() {}';
      final result = insertHeader(
        input,
        const LineCommentStyle('//'),
        headerText,
      );
      expect(result, '// $headerText\nvoid main() {}');
    });

    test('is idempotent when the marker is already present', () {
      final input = '// $headerText\nvoid main() {}\n';
      final result = insertHeader(
        input,
        const LineCommentStyle('//'),
        headerText,
      );
      expect(result, input);
    });

    test(
      'is idempotent within the first five lines even with different attribution wording',
      () {
        const input =
            '// Modified by SomeoneElse from the original LeanCode Patrol '
            'source (Apache-2.0). See NOTICE.md.\nvoid main() {}\n';
        final result = insertHeader(
          input,
          const LineCommentStyle('//'),
          headerText,
        );
        expect(result, input);
      },
    );

    test('throws for a non-commentable style', () {
      expect(
        () => insertHeader('x', const NonCommentableStyle(), headerText),
        throwsArgumentError,
      );
    });

    test(
      'is idempotent when the header follows a frontmatter longer than four lines',
      () {
        // A five-line frontmatter pushes the header to line 6, past a naive
        // "first five lines" window — the real docs/index.mdx shape.
        final input =
            '---\ntitle: x\na: 1\nb: 2\nc: 3\n---\n{/* $headerText */}\n\ncontent\n';
        final result = insertHeader(
          input,
          const BlockCommentStyle('{/* ', ' */}'),
          headerText,
        );
        expect(result, input);
      },
    );
  });

  group('hasHeader', () {
    test('false for a file without the marker', () {
      expect(hasHeader('void main() {}\n'), isFalse);
    });

    test('true when the marker is on line 1', () {
      expect(hasHeader('// $headerText\nvoid main() {}\n'), isTrue);
    });

    test('true when the marker follows a shebang', () {
      expect(
        hasHeader('#!/usr/bin/env bash\n# $headerText\necho hi\n'),
        isTrue,
      );
    });

    test('true when the marker follows a frontmatter longer than four lines', () {
      final input =
          '---\ntitle: x\na: 1\nb: 2\nc: 3\nd: 4\n---\n<!-- $headerText -->\n\n# T\n';
      expect(hasHeader(input), isTrue);
    });

    test('false when the marker only appears deep in the body', () {
      final input = '---\ntitle: x\n---\n\n# T\n\n\n\n\n\n\ntext $headerText\n';
      expect(hasHeader(input), isFalse);
    });
  });
}
