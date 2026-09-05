import 'package:apache_notice/src/comment_style.dart';
import 'package:test/test.dart';

void main() {
  group('commentStyleFor', () {
    const lineExts = [
      'dart',
      'kt',
      'kts',
      'swift',
      'm',
      'mm',
      'h',
      'c',
      'cc',
      'cpp',
      'ts',
      'tsx',
      'js',
      'jsx',
      'gradle',
      'java',
      'xcconfig',
      'rc',
    ];
    for (final ext in lineExts) {
      test('.$ext uses // comments', () {
        expect(
          commentStyleFor('lib/foo.$ext'),
          equals(const LineCommentStyle('//')),
        );
      });
    }

    const hashExts = [
      'yaml',
      'yml',
      'sh',
      'rb',
      'podspec',
      'toml',
      'gitignore',
      'gitattributes',
      'properties',
    ];
    for (final ext in hashExts) {
      test('.$ext uses # comments', () {
        expect(
          commentStyleFor('some/file.$ext'),
          equals(const LineCommentStyle('#')),
        );
      });
    }

    for (final name in [
      'CMakeLists.txt',
      'Podfile',
      'Fastfile',
      'Appfile',
      'Matchfile',
    ]) {
      test('$name uses # comments', () {
        expect(
          commentStyleFor('ios/$name'),
          equals(const LineCommentStyle('#')),
        );
      });
    }

    for (final name in ['.gitignore', '.gitattributes']) {
      test(
        'a literal $name dotfile uses # comments (no extension to key off)',
        () {
          expect(commentStyleFor(name), equals(const LineCommentStyle('#')));
          expect(
            commentStyleFor('packages/patrol_plus/$name'),
            equals(const LineCommentStyle('#')),
          );
        },
      );
    }

    test('.md uses html comments', () {
      expect(
        commentStyleFor('docs/readme.md'),
        equals(const BlockCommentStyle('<!-- ', ' -->')),
      );
    });

    test('.mdc uses html comments', () {
      expect(
        commentStyleFor('docs/readme.mdc'),
        equals(const BlockCommentStyle('<!-- ', ' -->')),
      );
    });

    test('.mdx uses jsx comments', () {
      expect(
        commentStyleFor('docs/page.mdx'),
        equals(const BlockCommentStyle('{/* ', ' */}')),
      );
    });

    test('extensionless file with shebang first line uses # comments', () {
      expect(
        commentStyleFor('scripts/build', firstLine: '#!/usr/bin/env bash'),
        equals(const LineCommentStyle('#')),
      );
    });

    test('extensionless file without shebang is non-commentable', () {
      expect(
        commentStyleFor('scripts/build', firstLine: 'echo hi'),
        equals(const NonCommentableStyle()),
      );
    });

    test('extensionless file with unknown first line is non-commentable', () {
      expect(
        commentStyleFor('scripts/build'),
        equals(const NonCommentableStyle()),
      );
    });

    const nonCommentableExts = [
      'json',
      'lock',
      'plist',
      'pbxproj',
      'xml',
      'svg',
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'ico',
      'pdf',
      'jar',
      'aar',
      'zip',
    ];
    for (final ext in nonCommentableExts) {
      test('.$ext is non-commentable', () {
        expect(
          commentStyleFor('some/file.$ext'),
          equals(const NonCommentableStyle()),
        );
      });
    }

    test('package-lock.json is non-commentable', () {
      expect(
        commentStyleFor('web/package-lock.json'),
        equals(const NonCommentableStyle()),
      );
    });

    test('a file whose first 8KiB contains a NUL byte is non-commentable', () {
      expect(
        commentStyleFor('lib/data.dart', isBinary: true),
        equals(const NonCommentableStyle()),
      );
    });

    test('LICENSE is non-commentable and never touched', () {
      expect(commentStyleFor('LICENSE'), equals(const NonCommentableStyle()));
      expect(
        commentStyleFor('packages/patrol_plus/LICENSE'),
        equals(const NonCommentableStyle()),
      );
    });

    test('unknown extension defaults to non-commentable', () {
      expect(
        commentStyleFor('some/file.weirdext'),
        equals(const NonCommentableStyle()),
      );
    });

    test('extension matching is case-insensitive', () {
      expect(
        commentStyleFor('lib/Foo.DART'),
        equals(const LineCommentStyle('//')),
      );
      expect(
        commentStyleFor('some/File.PNG'),
        equals(const NonCommentableStyle()),
      );
    });
  });

  group('Flutter-regenerated files', () {
    // `flutter pub get` / `flutter create` rewrite these from scratch, so a
    // header inserted into them is stripped on the next run and would turn
    // CI red; they are listed in NOTICE.md instead.
    const regenerated = [
      'dev/e2e_app/macos/Flutter/GeneratedPluginRegistrant.swift',
      'dev/e2e_app/ios/Runner/GeneratedPluginRegistrant.m',
      'dev/e2e_app/ios/Runner/GeneratedPluginRegistrant.h',
      'x/android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java',
      'dev/e2e_app/linux/flutter/generated_plugin_registrant.cc',
      'dev/e2e_app/linux/flutter/generated_plugin_registrant.h',
      'dev/e2e_app/windows/flutter/generated_plugins.cmake',
      'dev/e2e_app/.metadata',
      'dev/e2e_app/.flutter-plugins-dependencies',
    ];

    for (final path in regenerated) {
      test('$path is non-commentable and flagged as regenerated', () {
        expect(commentStyleFor(path), equals(const NonCommentableStyle()));
        expect(isFlutterGeneratedFile(path), isTrue);
      });
    }

    test('ordinary Swift/Dart/cmake files are not flagged as regenerated', () {
      expect(
        isFlutterGeneratedFile('darwin/Classes/PatrolPlugin.swift'),
        isFalse,
      );
      expect(isFlutterGeneratedFile('lib/src/binding.dart'), isFalse);
      expect(isFlutterGeneratedFile('linux/CMakeLists.txt'), isFalse);
    });
  });
}
