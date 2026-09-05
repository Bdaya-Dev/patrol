import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'git.dart';
import 'header.dart';
import 'package_mapping.dart';

/// The result of comparing the working tree against the upstream tree at
/// the fork point.
class ModifiedSetResult {
  ModifiedSetResult({
    required this.modified,
    required this.removed,
    this.staleHeader = const [],
  });

  /// Working-tree paths (posix-style, relative to the repo root, sorted)
  /// that have an upstream counterpart whose bytes differ -- ignoring a
  /// "changed file" notice line, see [staleHeader].
  final List<String> modified;

  /// Fork-named paths (posix-style, sorted) that existed upstream but have
  /// no working-tree counterpart.
  final List<String> removed;

  /// Working-tree paths (posix-style, sorted) that carry a "changed file"
  /// notice but are otherwise byte-identical to their upstream counterpart:
  /// the notice is the only difference, so it falsely claims a modification
  /// (typically because upstream has since adopted the fork's change, or the
  /// fork point moved past it). These are *not* in [modified].
  final List<String> staleHeader;
}

bool _isNulInFirst8KiB(List<int> bytes) {
  final end = bytes.length < 8192 ? bytes.length : 8192;
  for (var i = 0; i < end; i++) {
    if (bytes[i] == 0) return true;
  }
  return false;
}

/// Whether the file at [absPath] differs from the upstream blob [upstreamSha]
/// only by its "changed file" notice line.
bool _differsOnlyByHeader(
  GitRepo repo,
  String relPath,
  String absPath,
  String upstreamSha,
) {
  final bytes = File(absPath).readAsBytesSync();
  if (_isNulInFirst8KiB(bytes)) return false;
  final content = utf8.decode(bytes, allowMalformed: true);
  if (!hasHeader(content)) return false;
  final stripped = removeHeader(content);
  return repo.hashObjectForContent(relPath, utf8.encode(stripped)) ==
      upstreamSha;
}

const _excludedDirNames = {'node_modules', '.git'};

bool _isExcluded(String posixPath) {
  final parts = posixPath.split('/');
  return parts.any(_excludedDirNames.contains);
}

/// Computes the Apache-2.0 §4(b) "modified" set: every working-tree file
/// with an upstream counterpart at [forkPoint] whose bytes differ, plus the
/// set of upstream files with no working-tree counterpart ("removed").
///
/// Files added by the fork (no upstream counterpart) are not part of either
/// set.
ModifiedSetResult computeModifiedSet(GitRepo repo, String forkPoint) {
  final upstream = repo.lsTreeBlobs(forkPoint);

  // For every upstream blob, where would it live in the fork's working
  // tree, and what hash should it have if untouched?
  final workingPathToUpstreamSha = <String, String>{};
  for (final entry in upstream.entries) {
    if (_isExcluded(entry.key)) continue;
    final workingPath = mapUpstreamPathToWorkingPath(entry.key);
    if (workingPath == null) continue; // packages/patrol_mcp/** -- ignored
    if (_isExcluded(workingPath)) continue;
    workingPathToUpstreamSha[workingPath] = entry.value;
  }

  final candidatePaths = <String>[];
  final removed = <String>[];
  for (final workingPath in workingPathToUpstreamSha.keys) {
    final absPath = p.join(repo.root, workingPath);
    if (File(absPath).existsSync()) {
      candidatePaths.add(workingPath);
    } else if (Link(absPath).existsSync()) {
      // A symbolic link (e.g. upstream's `.claude/skills -> ../.agents/skills`)
      // is a blob in the tree but not a file on disk: it cannot carry a
      // notice and is not "removed" just because it points at a directory.
      continue;
    } else {
      removed.add(workingPath);
    }
  }

  final hashes = repo.hashObjectForPaths(candidatePaths);

  final modified = <String>[];
  final staleHeader = <String>[];
  for (final path in candidatePaths) {
    final upstreamSha = workingPathToUpstreamSha[path]!;
    if (hashes[path] == upstreamSha) continue;
    final absPath = p.join(repo.root, path);
    if (_differsOnlyByHeader(repo, path, absPath, upstreamSha)) {
      staleHeader.add(path);
    } else {
      modified.add(path);
    }
  }

  modified.sort();
  removed.sort();
  staleHeader.sort();
  return ModifiedSetResult(
    modified: modified,
    removed: removed,
    staleHeader: staleHeader,
  );
}
