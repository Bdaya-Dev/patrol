import 'dart:io';

import 'package:path/path.dart' as p;

import 'git.dart';
import 'package_mapping.dart';

/// The result of comparing the working tree against the upstream tree at
/// the fork point.
class ModifiedSetResult {
  ModifiedSetResult({required this.modified, required this.removed});

  /// Working-tree paths (posix-style, relative to the repo root, sorted)
  /// that have an upstream counterpart whose bytes differ.
  final List<String> modified;

  /// Fork-named paths (posix-style, sorted) that existed upstream but have
  /// no working-tree counterpart.
  final List<String> removed;
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
    } else {
      removed.add(workingPath);
    }
  }

  final hashes = repo.hashObjectForPaths(candidatePaths);

  final modified = <String>[
    for (final path in candidatePaths)
      if (hashes[path] != workingPathToUpstreamSha[path]) path,
  ];

  modified.sort();
  removed.sort();
  return ModifiedSetResult(modified: modified, removed: removed);
}
