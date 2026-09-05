import 'comment_style.dart';

/// The substring that identifies a file as already carrying the "changed
/// file" notice, independent of which attribution name was used.
const String headerMarker = 'from the original LeanCode Patrol source';

/// Builds the notice text to embed in a modified file (before it's wrapped
/// in a comment).
String headerTextFor(String attribution) =>
    'Modified by $attribution from the original LeanCode Patrol source '
    '(Apache-2.0). See NOTICE.md.';

String _commentLine(CommentStyle style, String headerText) {
  return switch (style) {
    LineCommentStyle(:final prefix) => '$prefix $headerText',
    BlockCommentStyle(:final open, :final close) => '$open$headerText$close',
    NonCommentableStyle() => throw ArgumentError(
      'Cannot embed a header comment in a NonCommentableStyle file.',
    ),
  };
}

const _bom = '﻿';

List<String> _splitLines(String text) {
  final body = text.startsWith(_bom) ? text.substring(_bom.length) : text;
  var lines = body.split(RegExp(r'\r\n|\n'));
  if (body.endsWith('\n') && lines.isNotEmpty && lines.last.isEmpty) {
    lines = lines.sublist(0, lines.length - 1);
  }
  return lines;
}

/// Where the header goes: line 1, except right after a shebang first line
/// or after a leading YAML frontmatter block (`---` ... `---`).
int _insertPositionFor(List<String> lines) {
  if (lines.isNotEmpty && lines[0].startsWith('#!')) return 1;
  if (lines.isNotEmpty && lines[0] == '---') {
    final closingIndex = lines.indexWhere((line) => line == '---', 1);
    if (closingIndex != -1) return closingIndex + 1;
  }
  return 0;
}

/// Whether [text] already carries the "changed file" notice.
///
/// Looks for [headerMarker] within the five lines that follow the header's
/// insertion point (after any shebang or frontmatter), as well as the first
/// five lines of the file — so a header that sits after a long frontmatter is
/// still recognised, and one buried deep in the body is not.
bool hasHeader(String text) {
  final lines = _splitLines(text);
  final start = _insertPositionFor(lines);
  final window = {...lines.take(5), ...lines.skip(start).take(5)};
  return window.any((line) => line.contains(headerMarker));
}

/// Returns [text] with a "changed file" comment inserted, formatted for
/// [style], using [headerText] as the notice body.
///
/// - Placement is line 1, except: right after a shebang (`#!`) first line,
///   and after a leading YAML frontmatter block (`---` ... `---`).
/// - No-op (returns [text] unchanged) if [hasHeader] already reports the
///   marker — this makes the operation idempotent even if the attribution
///   wording changes between runs.
/// - Preserves the file's line-ending style (CRLF vs LF) and a leading
///   UTF-8 BOM, if present.
String insertHeader(String text, CommentStyle style, String headerText) {
  if (style is NonCommentableStyle) {
    throw ArgumentError(
      'Cannot insert a header into a NonCommentableStyle file.',
    );
  }

  final hasBom = text.startsWith(_bom);
  final body = hasBom ? text.substring(_bom.length) : text;

  if (body.isEmpty) {
    final headerLine = '${_commentLine(style, headerText)}\n';
    return hasBom ? '$_bom$headerLine' : headerLine;
  }

  final newline = body.contains('\r\n') ? '\r\n' : '\n';
  final endsWithNewline = body.endsWith('\n');
  final lines = _splitLines(body);

  if (hasHeader(body)) {
    return text;
  }

  final insertPos = _insertPositionFor(lines);
  final headerLine = _commentLine(style, headerText);
  final newLines = [
    ...lines.take(insertPos),
    headerLine,
    ...lines.skip(insertPos),
  ];

  var result = newLines.join(newline);
  if (endsWithNewline || lines.isEmpty) {
    result += newline;
  }

  return hasBom ? '$_bom$result' : result;
}
