import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'comment_style.dart';
import 'git.dart';
import 'header.dart';
import 'modified_set.dart';
import 'notice.dart';
import 'package_mapping.dart';
import 'rename_check.dart';

/// One §4(b) compliance problem found by [runApacheNotice].
class Violation {
  Violation(this.path, this.reason);

  final String path;

  /// One of: `'missing header'`, `'stale header'`, `'NOTICE.md stale'`,
  /// `'NOTICE.md missing'`, `'unmapped rename'`.
  final String reason;

  @override
  String toString() => '$path: $reason';
}

/// Options for one run of the tool.
class RunOptions {
  RunOptions({
    required this.repoPath,
    required this.forkPoint,
    required this.attribution,
    required this.fix,
  });

  final String repoPath;
  final String forkPoint;
  final String attribution;
  final bool fix;
}

/// The outcome of one run: the violations found (before any fix was
/// applied) and the exit code the CLI should use.
class RunResult {
  RunResult({required this.violations, required this.exitCode});

  final List<Violation> violations;
  final int exitCode;
}

bool _isNulInFirst8KiB(List<int> bytes) {
  final end = bytes.length < 8192 ? bytes.length : 8192;
  for (var i = 0; i < end; i++) {
    if (bytes[i] == 0) return true;
  }
  return false;
}

String _firstLine(String content) {
  final idx = content.indexOf('\n');
  final line = idx == -1 ? content : content.substring(0, idx);
  return line.endsWith('\r') ? line.substring(0, line.length - 1) : line;
}

Map<String, List<String>> _scopedRemovedByPackage(List<String> removed) {
  final map = <String, List<String>>{};
  for (final pkg in forkPackageNames) {
    map[pkg] = [
      for (final path in removed)
        if (relativeToPackage(path, pkg) case final rel?) rel,
    ];
  }
  return map;
}

Map<String, List<String>> _scopedModifiedByPackage(List<String> modified) {
  final map = <String, List<String>>{};
  for (final pkg in forkPackageNames) {
    map[pkg] = [
      for (final path in modified)
        if (relativeToPackage(path, pkg) case final rel?) rel,
    ];
  }
  return map;
}

/// Runs the check (and, if [RunOptions.fix] is set, the fix) described by
/// [options] against a real git repository, printing any violations found
/// to [out] (one per line, as `<path>: <reason>`).
RunResult runApacheNotice(RunOptions options, {required StringSink out}) {
  final repo = GitRepo.discover(options.repoPath);
  repo.checkRevExists(options.forkPoint);

  final modifiedSet = computeModifiedSet(repo, options.forkPoint);
  final headerText = headerTextFor(options.attribution);
  final violations = <Violation>[];

  // 0. Every rename git can detect (>= 50% similarity) between the fork
  // point and HEAD must be explained by either the generic packages/<x> ->
  // packages/<x>_plus rule or an entry in [explicitRenameMap] -- otherwise
  // a rename has slipped past both and would silently show up as
  // removed+added instead of modified. Not auto-fixable: there's no safe
  // way to guess the right mapping, so this is reported even under --fix.
  for (final rename in repo.renamesBetween(options.forkPoint, 'HEAD')) {
    final unexplained = isUnexplainedRename(
      rename,
      existsInTree: (path) => File(p.join(repo.root, path)).existsSync(),
    );
    if (!unexplained) continue;
    violations.add(
      Violation('${rename.oldPath} -> ${rename.newPath}', 'unmapped rename'),
    );
  }

  // 1. Every modified file needs an in-file header, unless it can't carry
  // one (NOTICE.md will list it instead).
  for (final relPath in modifiedSet.modified) {
    final absPath = p.join(repo.root, relPath);
    final file = File(absPath);
    final bytes = file.readAsBytesSync();
    final isBinary = _isNulInFirst8KiB(bytes);
    String? firstLine;
    if (!isBinary && p.extension(relPath).isEmpty) {
      firstLine = _firstLine(utf8.decode(bytes, allowMalformed: true));
    }
    final style = commentStyleFor(
      relPath,
      firstLine: firstLine,
      isBinary: isBinary,
    );
    if (style is NonCommentableStyle) continue;

    final content = utf8.decode(bytes, allowMalformed: true);
    if (hasHeader(content)) continue;

    if (options.fix) {
      final updated = insertHeader(content, style, headerText);
      file.writeAsBytesSync(utf8.encode(updated));
    } else {
      violations.add(Violation(relPath, 'missing header'));
    }
  }

  // 1b. A file that is byte-identical to upstream apart from its notice line
  // must not claim a modification: the notice is stale (upstream adopted the
  // fork's change, or the fork point moved past it) and gets removed.
  for (final relPath in modifiedSet.staleHeader) {
    if (options.fix) {
      final file = File(p.join(repo.root, relPath));
      final content = utf8.decode(file.readAsBytesSync(), allowMalformed: true);
      file.writeAsBytesSync(utf8.encode(removeHeader(content)));
    } else {
      violations.add(Violation(relPath, 'stale header'));
    }
  }

  // 2. NOTICE.md files must exist and match the generated content exactly.
  final modifiedByPkg = _scopedModifiedByPackage(modifiedSet.modified);
  final removedByPkg = _scopedRemovedByPackage(modifiedSet.removed);

  final expectedByNoticePath = <String, String>{
    'NOTICE.md': generateNotice(
      attribution: options.attribution,
      forkPointSha: options.forkPoint,
      modifiedPaths: modifiedSet.modified,
      removedPaths: modifiedSet.removed,
    ),
    for (final pkg in forkPackageNames)
      if (Directory(p.join(repo.root, 'packages', pkg)).existsSync())
        'packages/$pkg/NOTICE.md': generateNotice(
          attribution: options.attribution,
          forkPointSha: options.forkPoint,
          modifiedPaths: modifiedByPkg[pkg] ?? const [],
          removedPaths: removedByPkg[pkg] ?? const [],
        ),
  };

  for (final entry in expectedByNoticePath.entries) {
    final noticePath = entry.key;
    final expected = entry.value;
    final file = File(p.join(repo.root, noticePath));
    if (!file.existsSync()) {
      if (options.fix) {
        file.parent.createSync(recursive: true);
        file.writeAsStringSync(expected);
      } else {
        violations.add(Violation(noticePath, 'NOTICE.md missing'));
      }
      continue;
    }
    final actual = file.readAsStringSync();
    if (!noticeUpToDate(actual, expected)) {
      if (options.fix) {
        file.writeAsStringSync(expected);
      } else {
        violations.add(Violation(noticePath, 'NOTICE.md stale'));
      }
    }
  }

  violations.sort((a, b) => a.path.compareTo(b.path));

  if (options.fix) {
    // Re-run as a plain check so the exit code reflects the tree as it is
    // now, not what the fix pass assumed it did.
    return runApacheNotice(
      RunOptions(
        repoPath: options.repoPath,
        forkPoint: options.forkPoint,
        attribution: options.attribution,
        fix: false,
      ),
      out: out,
    );
  }

  for (final violation in violations) {
    out.writeln(violation.toString());
  }
  return RunResult(
    violations: violations,
    exitCode: violations.isEmpty ? 0 : 1,
  );
}
