import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

/// A git or usage-level failure (maps to CLI exit code 2).
class GitError implements Exception {
  GitError(this.message);

  final String message;

  @override
  String toString() => message;
}

/// A thin wrapper around the `git` executable, scoped to one repository
/// root.
class GitRepo {
  GitRepo(this.root);

  /// Absolute path to the repository's working-tree root (the directory
  /// that contains `.git`).
  final String root;

  /// Walks up from [startDir] looking for a `.git` directory or file (the
  /// latter covers worktrees and submodules), returning the first directory
  /// that has one.
  static GitRepo discover(String startDir) {
    var dir = Directory(startDir).absolute;
    while (true) {
      final gitEntry = p.join(dir.path, '.git');
      if (Directory(gitEntry).existsSync() || File(gitEntry).existsSync()) {
        return GitRepo(dir.path);
      }
      final parent = dir.parent;
      if (p.equals(parent.path, dir.path)) {
        throw GitError(
          'Not a git repository (or any parent directory): $startDir',
        );
      }
      dir = parent;
    }
  }

  ProcessResult _run(List<String> args) {
    final ProcessResult result;
    try {
      result = Process.runSync(
        'git',
        args,
        workingDirectory: root,
        stdoutEncoding: utf8,
        stderrEncoding: utf8,
      );
    } on ProcessException catch (e) {
      throw GitError('Failed to run git ${args.join(' ')}: $e');
    }
    if (result.exitCode != 0) {
      throw GitError(
        'git ${args.join(' ')} failed (exit ${result.exitCode}): '
        '${result.stderr}',
      );
    }
    return result;
  }

  /// Verifies [rev] resolves to a commit reachable in this repository.
  void checkRevExists(String rev) {
    _run(['cat-file', '-e', '$rev^{commit}']);
  }

  /// Returns a map of path (posix-style, relative to the repo root) to blob
  /// SHA-1, for every blob in the tree at [rev]. Non-blob entries (e.g.
  /// submodule gitlinks) are excluded.
  Map<String, String> lsTreeBlobs(String rev) {
    final result = _run(['ls-tree', '-r', rev]);
    final map = <String, String>{};
    for (final line in const LineSplitter().convert(result.stdout as String)) {
      if (line.isEmpty) continue;
      final tab = line.indexOf('\t');
      if (tab == -1) continue;
      final meta = line
          .substring(0, tab)
          .split(' ')
          .where((s) => s.isNotEmpty)
          .toList();
      if (meta.length < 3 || meta[1] != 'blob') continue;
      final path = line.substring(tab + 1);
      map[path] = meta[2];
    }
    return map;
  }

  /// Computes the git blob SHA-1 that `git add` would produce for each of
  /// [relativePaths] (paths relative to [root]), as they currently sit on
  /// disk -- i.e. this is what a `git diff` would compare against, filters
  /// (line-ending normalization, etc.) included.
  ///
  /// Returns a map from path to hash; a path git couldn't hash (e.g. it
  /// vanished between the existence check and this call) is simply absent
  /// from the result.
  Map<String, String> hashObjectForPaths(List<String> relativePaths) {
    final map = <String, String>{};
    const chunkSize = 200;
    for (var i = 0; i < relativePaths.length; i += chunkSize) {
      final end = (i + chunkSize < relativePaths.length)
          ? i + chunkSize
          : relativePaths.length;
      final chunk = relativePaths.sublist(i, end);
      if (chunk.isEmpty) continue;
      final result = _run(['hash-object', '--', ...chunk]);
      final lines = const LineSplitter().convert(result.stdout as String);
      for (var j = 0; j < chunk.length && j < lines.length; j++) {
        map[chunk[j]] = lines[j];
      }
    }
    return map;
  }
}
