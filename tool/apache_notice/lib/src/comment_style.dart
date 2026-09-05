import 'package:path/path.dart' as p;

/// How (or whether) a "changed file" notice can be embedded as a comment in
/// a given file.
sealed class CommentStyle {
  const CommentStyle();
}

/// A single-line comment style, e.g. `//` or `#`.
final class LineCommentStyle extends CommentStyle {
  const LineCommentStyle(this.prefix);

  final String prefix;

  @override
  bool operator ==(Object other) =>
      other is LineCommentStyle && other.prefix == prefix;

  @override
  int get hashCode => Object.hash(LineCommentStyle, prefix);

  @override
  String toString() => 'LineCommentStyle($prefix)';
}

/// A block comment style with an opening and closing delimiter that must sit
/// on the same line, e.g. `<!-- ... -->` or `{/* ... */}`.
final class BlockCommentStyle extends CommentStyle {
  const BlockCommentStyle(this.open, this.close);

  final String open;
  final String close;

  @override
  bool operator ==(Object other) =>
      other is BlockCommentStyle && other.open == open && other.close == close;

  @override
  int get hashCode => Object.hash(BlockCommentStyle, open, close);

  @override
  String toString() => 'BlockCommentStyle($open, $close)';
}

/// The file cannot (or must not) carry an inline notice comment: binary
/// formats, data formats without a comment syntax, LICENSE files, and
/// extensionless files that aren't scripts.
final class NonCommentableStyle extends CommentStyle {
  const NonCommentableStyle();

  @override
  bool operator ==(Object other) => other is NonCommentableStyle;

  @override
  int get hashCode => (NonCommentableStyle).hashCode;

  @override
  String toString() => 'NonCommentableStyle()';
}

const _lineCommentExtensions = {
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
};

const _hashCommentExtensions = {
  'yaml',
  'yml',
  'sh',
  'rb',
  'podspec',
  'toml',
  'properties',
};

const _hashCommentNames = {
  'CMakeLists.txt',
  'Podfile',
  'Fastfile',
  'Appfile',
  'Matchfile',
};

// `.gitignore` and `.gitattributes` are dotfiles: `path.extension()` treats
// a leading dot as "no extension" (the Unix dotfile convention), so these
// have to be matched against the basename's suffix instead.
const _hashCommentBasenameSuffixes = {'.gitignore', '.gitattributes'};

const _mdExtensions = {'md', 'mdc'};
const _mdxExtensions = {'mdx'};

const _nonCommentableExtensions = {
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
};

const _nonCommentableNames = {'package-lock.json'};

// Files the Flutter tool rewrites from scratch on `flutter pub get` /
// `flutter create`. A header inserted into one of these is stripped by the
// next regeneration and would turn the CI check red, so they are listed in
// NOTICE.md instead of annotated.
const _flutterGeneratedNames = {
  'GeneratedPluginRegistrant.swift',
  'GeneratedPluginRegistrant.java',
  'GeneratedPluginRegistrant.m',
  'GeneratedPluginRegistrant.h',
  'generated_plugin_registrant.cc',
  'generated_plugin_registrant.h',
  'generated_plugins.cmake',
  '.metadata',
  '.flutter-plugins-dependencies',
};

/// Whether [path] is a file the Flutter tool regenerates wholesale (see
/// [_flutterGeneratedNames]); such files never get an in-file header.
bool isFlutterGeneratedFile(String path) =>
    _flutterGeneratedNames.contains(p.basename(path));

/// Extension without the leading dot, lower-cased, or '' if there is none.
String _extensionOf(String path) {
  final ext = p.extension(path);
  return ext.isEmpty ? '' : ext.substring(1).toLowerCase();
}

/// Determines the [CommentStyle] a "modified" notice would use for [path].
///
/// [firstLine] is the file's first line of text, used only to detect a
/// shebang (`#!`) on an extensionless file; pass it whenever it's cheaply
/// available. [isBinary] should be true when the file's first 8 KiB contains
/// a NUL byte (or any other check for "this isn't text").
///
/// LICENSE files are always [NonCommentableStyle] — they must never be
/// touched, regardless of what a comment convention might otherwise suggest.
CommentStyle commentStyleFor(
  String path, {
  String? firstLine,
  bool isBinary = false,
}) {
  if (isBinary) return const NonCommentableStyle();

  final base = p.basename(path);
  if (base == 'LICENSE' || base.startsWith('LICENSE.')) {
    return const NonCommentableStyle();
  }
  if (_nonCommentableNames.contains(base)) {
    return const NonCommentableStyle();
  }
  if (isFlutterGeneratedFile(path)) {
    return const NonCommentableStyle();
  }
  if (_hashCommentNames.contains(base)) {
    return const LineCommentStyle('#');
  }
  for (final suffix in _hashCommentBasenameSuffixes) {
    if (base.endsWith(suffix)) {
      return const LineCommentStyle('#');
    }
  }

  final ext = _extensionOf(path);

  if (_nonCommentableExtensions.contains(ext)) {
    return const NonCommentableStyle();
  }
  if (_lineCommentExtensions.contains(ext)) {
    return const LineCommentStyle('//');
  }
  if (_hashCommentExtensions.contains(ext)) {
    return const LineCommentStyle('#');
  }
  if (_mdExtensions.contains(ext)) {
    return const BlockCommentStyle('<!-- ', ' -->');
  }
  if (_mdxExtensions.contains(ext)) {
    return const BlockCommentStyle('{/* ', ' */}');
  }

  if (ext.isEmpty) {
    if (firstLine != null && firstLine.startsWith('#!')) {
      return const LineCommentStyle('#');
    }
    return const NonCommentableStyle();
  }

  // Unknown extension: play it safe and treat it as data we can't safely
  // annotate with a comment.
  return const NonCommentableStyle();
}
