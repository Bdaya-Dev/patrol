@Timeout(Duration(minutes: 2))
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:test/test.dart';

void main() {
  final toolDir = Directory.current.path;
  final binPath = p.join(toolDir, 'bin', 'apache_notice.dart');

  late Directory tempDir;
  late String repoRoot;
  late String forkPointSha;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('apache_notice_test_');
    repoRoot = tempDir.path;

    _git(repoRoot, ['init', '-q', '-b', 'main']);
    _git(repoRoot, ['config', 'user.email', 'test@example.com']);
    _git(repoRoot, ['config', 'user.name', 'Test']);
    _git(repoRoot, ['config', 'core.autocrlf', 'false']);

    // --- "upstream" commit ---
    _write(repoRoot, 'packages/patrol/a.dart', 'void a() {}\n');
    _write(repoRoot, 'packages/patrol/keep.dart', 'void keep() {}\n');
    _write(repoRoot, 'docs/x.mdx', '---\ntitle: X\n---\n\nHello\n');
    _write(repoRoot, 'a.json', '{"a": 1}\n');
    _git(repoRoot, ['add', '-A']);
    _git(repoRoot, ['commit', '-q', '-m', 'upstream']);
    forkPointSha = _git(repoRoot, ['rev-parse', 'HEAD']).trim();

    // --- "fork" commit: rename patrol -> patrol_plus ---
    File(p.join(repoRoot, 'packages', 'patrol', 'a.dart')).deleteSync();
    File(p.join(repoRoot, 'packages', 'patrol', 'keep.dart')).deleteSync();
    Directory(p.join(repoRoot, 'packages', 'patrol')).deleteSync();
    _write(
      repoRoot,
      'packages/patrol_plus/a.dart',
      'void a() { print("changed"); }\n',
    );
    _write(repoRoot, 'packages/patrol_plus/keep.dart', 'void keep() {}\n');
    _write(repoRoot, 'packages/patrol_plus/n.dart', 'void n() {}\n');
    _write(repoRoot, 'docs/x.mdx', '---\ntitle: X\n---\n\nHello changed\n');
    _write(repoRoot, 'a.json', '{"a": 2}\n');
    _git(repoRoot, ['add', '-A']);
    _git(repoRoot, ['commit', '-q', '-m', 'fork']);
  });

  tearDown(() {
    tempDir.deleteSync(recursive: true);
  });

  test('--check finds exactly the expected violations', () {
    final result = _runTool(toolDir, binPath, [
      '--check',
      '--repo',
      repoRoot,
      '--fork-point',
      forkPointSha,
    ]);

    expect(result.exitCode, 1, reason: result.stderr as String);
    final stdout = result.stdout as String;

    expect(stdout, contains('packages/patrol_plus/a.dart: missing header'));
    expect(stdout, contains('docs/x.mdx: missing header'));
    expect(stdout, contains('NOTICE.md: NOTICE.md missing'));
    expect(
      stdout,
      contains('packages/patrol_plus/NOTICE.md: NOTICE.md missing'),
    );

    // Unchanged / newly-added files must never be flagged.
    expect(stdout, isNot(contains('keep.dart')));
    expect(stdout, isNot(contains('patrol_plus/n.dart: ')));
    // a.json cannot carry a header comment, so it's never a "missing header"
    // violation on its own.
    expect(stdout, isNot(contains('a.json: missing header')));
  });

  test('--fix inserts headers correctly and writes NOTICE files', () {
    final fixResult = _runTool(toolDir, binPath, [
      '--fix',
      '--repo',
      repoRoot,
      '--fork-point',
      forkPointSha,
    ]);
    expect(fixResult.exitCode, 0, reason: fixResult.stderr as String);

    final aDartLines = File(
      p.join(repoRoot, 'packages/patrol_plus/a.dart'),
    ).readAsStringSync().split('\n');
    expect(
      aDartLines[0],
      contains(
        '// Modified by Bdaya-Dev from the original LeanCode Patrol source',
      ),
    );
    expect(aDartLines[1], 'void a() { print("changed"); }');

    final mdxLines = File(
      p.join(repoRoot, 'docs/x.mdx'),
    ).readAsStringSync().split('\n');
    expect(mdxLines[0], '---');
    expect(mdxLines[1], 'title: X');
    expect(mdxLines[2], '---');
    expect(
      mdxLines[3],
      contains(
        '{/* Modified by Bdaya-Dev from the original LeanCode Patrol source',
      ),
    );
    expect(mdxLines[4], '');
    expect(mdxLines[5], 'Hello changed');

    // keep.dart was never modified, so it must not get a header.
    final keepContent = File(
      p.join(repoRoot, 'packages/patrol_plus/keep.dart'),
    ).readAsStringSync();
    expect(keepContent, 'void keep() {}\n');

    // n.dart is new (no upstream counterpart), so it must not get a header.
    final nContent = File(
      p.join(repoRoot, 'packages/patrol_plus/n.dart'),
    ).readAsStringSync();
    expect(nContent, 'void n() {}\n');

    // a.json can't carry a comment: untouched, but listed in NOTICE.
    final jsonContent = File(p.join(repoRoot, 'a.json')).readAsStringSync();
    expect(jsonContent, '{"a": 2}\n');

    final rootNotice = File(p.join(repoRoot, 'NOTICE.md')).readAsStringSync();
    expect(
      rootNotice,
      contains('a.json (cannot carry a comment — listed here)'),
    );
    expect(
      rootNotice,
      contains('packages/patrol_plus/a.dart (notice in file)'),
    );
    expect(rootNotice, contains('docs/x.mdx (notice in file)'));
    expect(rootNotice, isNot(contains('keep.dart')));
    expect(rootNotice, isNot(contains('patrol_plus/n.dart')));
    expect(rootNotice, contains(forkPointSha));

    final pkgNotice = File(
      p.join(repoRoot, 'packages/patrol_plus/NOTICE.md'),
    ).readAsStringSync();
    expect(pkgNotice, contains('a.dart (notice in file)'));
    expect(pkgNotice, isNot(contains('a.json')));

    // The tree must now be compliant.
    final checkResult = _runTool(toolDir, binPath, [
      '--check',
      '--repo',
      repoRoot,
      '--fork-point',
      forkPointSha,
    ]);
    expect(checkResult.exitCode, 0, reason: checkResult.stdout as String);
    expect((checkResult.stdout as String).trim(), isEmpty);
  });

  test('--fix is idempotent', () {
    _runTool(toolDir, binPath, [
      '--fix',
      '--repo',
      repoRoot,
      '--fork-point',
      forkPointSha,
    ]);
    final before = _snapshot(repoRoot);

    final second = _runTool(toolDir, binPath, [
      '--fix',
      '--repo',
      repoRoot,
      '--fork-point',
      forkPointSha,
    ]);
    expect(second.exitCode, 0);

    final after = _snapshot(repoRoot);
    expect(after, equals(before));
  });
}

void _write(String repoRoot, String relPath, String content) {
  final file = File(p.join(repoRoot, relPath));
  file.parent.createSync(recursive: true);
  file.writeAsStringSync(content);
}

String _git(String repoRoot, List<String> args) {
  final result = Process.runSync(
    'git',
    args,
    workingDirectory: repoRoot,
    stdoutEncoding: utf8,
    stderrEncoding: utf8,
  );
  if (result.exitCode != 0) {
    fail('git ${args.join(' ')} failed: ${result.stderr}');
  }
  return result.stdout as String;
}

ProcessResult _runTool(String toolDir, String binPath, List<String> args) {
  return Process.runSync(
    'dart',
    ['run', binPath, ...args],
    workingDirectory: toolDir,
    stdoutEncoding: utf8,
    stderrEncoding: utf8,
  );
}

/// A deterministic content snapshot of every tracked-ish file under
/// [repoRoot] (skipping `.git`), for idempotency comparisons.
Map<String, String> _snapshot(String repoRoot) {
  final map = <String, String>{};
  for (final entity in Directory(repoRoot).listSync(recursive: true)) {
    if (entity is! File) continue;
    final rel = p.relative(entity.path, from: repoRoot).replaceAll(r'\', '/');
    if (rel.startsWith('.git/')) continue;
    map[rel] = entity.readAsStringSync();
  }
  return map;
}
