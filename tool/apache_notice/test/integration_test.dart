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

  group('explicit rename map', () {
    test('a file renamed outside the packages/<x> rule (in explicitRenameMap) '
        'is treated as modified, never as removed', () {
      final root = Directory.systemTemp
          .createTempSync('apache_notice_test_podspec_')
          .path;
      addTearDown(() => Directory(root).deleteSync(recursive: true));

      _git(root, ['init', '-q', '-b', 'main']);
      _git(root, ['config', 'user.email', 'test@example.com']);
      _git(root, ['config', 'user.name', 'Test']);
      _git(root, ['config', 'core.autocrlf', 'false']);

      _write(
        root,
        'packages/patrol/darwin/patrol.podspec',
        "Pod::Spec.new do |s|\n  s.name = 'patrol'\nend\n",
      );
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'upstream']);
      final forkPoint = _git(root, ['rev-parse', 'HEAD']).trim();

      Directory(p.join(root, 'packages', 'patrol')).deleteSync(recursive: true);
      _write(
        root,
        'packages/patrol_plus/darwin/patrol_plus.podspec',
        "Pod::Spec.new do |s|\n  s.name = 'patrol_plus'\nend\n",
      );
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'fork']);

      final checkResult = _runTool(toolDir, binPath, [
        '--check',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(checkResult.exitCode, 1, reason: checkResult.stderr as String);
      final stdout = checkResult.stdout as String;
      expect(
        stdout,
        contains(
          'packages/patrol_plus/darwin/patrol_plus.podspec: missing header',
        ),
      );
      // Never classified as removed+added.
      expect(stdout, isNot(contains('unmapped rename')));

      final fixResult = _runTool(toolDir, binPath, [
        '--fix',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(fixResult.exitCode, 0, reason: fixResult.stderr as String);

      final podspecContent = File(
        p.join(root, 'packages/patrol_plus/darwin/patrol_plus.podspec'),
      ).readAsStringSync();
      expect(podspecContent, contains('# Modified by Bdaya-Dev'));

      final rootNotice = File(p.join(root, 'NOTICE.md')).readAsStringSync();
      expect(rootNotice, contains('## Removed files\n\n(none)'));
      expect(
        rootNotice,
        contains(
          'packages/patrol_plus/darwin/patrol_plus.podspec (notice in file)',
        ),
      );
      expect(rootNotice, isNot(contains('patrol.podspec')));
    });
  });

  group('unmapped rename', () {
    test('a rename git detects (>= 50% similarity) that is explained neither '
        'by the package-dir rule nor by explicitRenameMap is reported and '
        'is not auto-fixable', () {
      final root = Directory.systemTemp
          .createTempSync('apache_notice_test_unmapped_')
          .path;
      addTearDown(() => Directory(root).deleteSync(recursive: true));

      _git(root, ['init', '-q', '-b', 'main']);
      _git(root, ['config', 'user.email', 'test@example.com']);
      _git(root, ['config', 'user.name', 'Test']);
      _git(root, ['config', 'core.autocrlf', 'false']);

      _write(
        root,
        'docs/guide.md',
        'line one\nline two\nline three\nline four\nline five\n',
      );
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'upstream']);
      final forkPoint = _git(root, ['rev-parse', 'HEAD']).trim();

      File(p.join(root, 'docs', 'guide.md')).deleteSync();
      _write(
        root,
        'docs/other.md',
        'line one\nline two\nline three\nline four\nCHANGED\n',
      );
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'fork']);

      final checkResult = _runTool(toolDir, binPath, [
        '--check',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(checkResult.exitCode, 1, reason: checkResult.stderr as String);
      expect(
        checkResult.stdout as String,
        contains('docs/guide.md -> docs/other.md: unmapped rename'),
      );

      final fixResult = _runTool(toolDir, binPath, [
        '--fix',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      // Not auto-fixable: --fix must still exit 1 and still list it.
      expect(fixResult.exitCode, 1, reason: fixResult.stderr as String);
      expect(
        fixResult.stdout as String,
        contains('docs/guide.md -> docs/other.md: unmapped rename'),
      );
    });

    test('an identical-content rename (100% similarity) is never a '
        'violation', () {
      final root = Directory.systemTemp
          .createTempSync('apache_notice_test_r100_')
          .path;
      addTearDown(() => Directory(root).deleteSync(recursive: true));

      _git(root, ['init', '-q', '-b', 'main']);
      _git(root, ['config', 'user.email', 'test@example.com']);
      _git(root, ['config', 'user.name', 'Test']);
      _git(root, ['config', 'core.autocrlf', 'false']);

      _write(root, 'docs/guide.md', 'unchanged content\n');
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'upstream']);
      final forkPoint = _git(root, ['rev-parse', 'HEAD']).trim();

      File(p.join(root, 'docs', 'guide.md')).deleteSync();
      _write(root, 'docs/renamed.md', 'unchanged content\n');
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'fork']);

      final checkResult = _runTool(toolDir, binPath, [
        '--check',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(checkResult.stdout as String, isNot(contains('unmapped rename')));
    });
  });

  group('symbolic links', () {
    test('a symlink that exists upstream is neither modified nor removed', () {
      final root = Directory.systemTemp
          .createTempSync('apache_notice_test_symlink_')
          .path;
      addTearDown(() => Directory(root).deleteSync(recursive: true));

      _git(root, ['init', '-q', '-b', 'main']);
      _git(root, ['config', 'user.email', 'test@example.com']);
      _git(root, ['config', 'user.name', 'Test']);
      _git(root, ['config', 'core.autocrlf', 'false']);
      _git(root, ['config', 'core.symlinks', 'true']);

      _write(root, '.agents/skills/README.md', 'skills\n');
      try {
        Link(
          p.join(root, '.claude', 'skills'),
        ).createSync('../.agents/skills', recursive: true);
      } on FileSystemException {
        // Creating symlinks needs elevated rights on some Windows setups.
        markTestSkipped('cannot create symbolic links here');
        return;
      }
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'upstream']);
      final forkPoint = _git(root, ['rev-parse', 'HEAD']).trim();

      final checkResult = _runTool(toolDir, binPath, [
        '--fix',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(checkResult.exitCode, 0, reason: checkResult.stdout as String);
      final rootNotice = File(p.join(root, 'NOTICE.md')).readAsStringSync();
      expect(rootNotice, isNot(contains('.claude/skills')));
      expect(rootNotice, contains('## Removed files\n\n(none)'));
    });
  });

  group('stale header', () {
    test('a file identical to upstream apart from its notice line is '
        'reported by --check, stripped by --fix, and left out of NOTICE', () {
      final root = Directory.systemTemp
          .createTempSync('apache_notice_test_stale_')
          .path;
      addTearDown(() => Directory(root).deleteSync(recursive: true));

      _git(root, ['init', '-q', '-b', 'main']);
      _git(root, ['config', 'user.email', 'test@example.com']);
      _git(root, ['config', 'user.name', 'Test']);
      _git(root, ['config', 'core.autocrlf', 'false']);

      // Upstream has since adopted the fork's change: at the (new) fork
      // point the file already has the fork's content.
      _write(root, 'packages/patrol/same.dart', 'void same() { changed(); }\n');
      _write(root, 'packages/patrol/other.dart', 'void other() {}\n');
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'upstream']);
      final forkPoint = _git(root, ['rev-parse', 'HEAD']).trim();

      Directory(p.join(root, 'packages', 'patrol')).deleteSync(recursive: true);
      const header =
          '// Modified by Bdaya-Dev from the original LeanCode Patrol source '
          '(Apache-2.0). See NOTICE.md.\n';
      _write(
        root,
        'packages/patrol_plus/same.dart',
        '${header}void same() { changed(); }\n',
      );
      _write(
        root,
        'packages/patrol_plus/other.dart',
        '${header}void other() { alsoChanged(); }\n',
      );
      _git(root, ['add', '-A']);
      _git(root, ['commit', '-q', '-m', 'fork']);

      final checkResult = _runTool(toolDir, binPath, [
        '--check',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(checkResult.exitCode, 1, reason: checkResult.stderr as String);
      final stdout = checkResult.stdout as String;
      expect(stdout, contains('packages/patrol_plus/same.dart: stale header'));
      expect(stdout, isNot(contains('other.dart: ')));

      final fixResult = _runTool(toolDir, binPath, [
        '--fix',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(fixResult.exitCode, 0, reason: fixResult.stdout as String);

      expect(
        File(p.join(root, 'packages/patrol_plus/same.dart')).readAsStringSync(),
        'void same() { changed(); }\n',
      );
      // A genuinely modified file keeps its notice.
      expect(
        File(
          p.join(root, 'packages/patrol_plus/other.dart'),
        ).readAsStringSync(),
        '${header}void other() { alsoChanged(); }\n',
      );

      final rootNotice = File(p.join(root, 'NOTICE.md')).readAsStringSync();
      expect(rootNotice, isNot(contains('same.dart')));
      expect(
        rootNotice,
        contains('packages/patrol_plus/other.dart (notice in file)'),
      );

      final recheck = _runTool(toolDir, binPath, [
        '--check',
        '--repo',
        root,
        '--fork-point',
        forkPoint,
      ]);
      expect(recheck.exitCode, 0, reason: recheck.stdout as String);
    });
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
