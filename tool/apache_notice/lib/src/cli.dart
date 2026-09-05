import 'dart:io';

import 'package:args/args.dart';

import 'git.dart';
import 'runner.dart';

/// The commit the fork diverged from upstream `master` at. Move this (and
/// only this) after merging an upstream update -- see README.md.
const String defaultForkPoint = '41fe088e6e9c98b536d330ba6c12d4af0bfb1189';

const String defaultAttribution = 'Bdaya-Dev';

ArgParser buildArgParser() {
  return ArgParser()
    ..addFlag(
      'check',
      negatable: false,
      help: 'Check compliance without modifying anything (default).',
    )
    ..addFlag(
      'fix',
      negatable: false,
      help: 'Insert missing headers and (re)write NOTICE.md files.',
    )
    ..addOption(
      'repo',
      help:
          'Path into the repo to operate on (default: cwd, walking up to '
          'the .git root).',
    )
    ..addOption(
      'fork-point',
      defaultsTo: defaultForkPoint,
      help: 'The commit SHA the fork diverged from upstream at.',
    )
    ..addOption(
      'attribution',
      defaultsTo: defaultAttribution,
      help: 'The name to attribute changes to in headers and NOTICE files.',
    )
    ..addFlag('help', abbr: 'h', negatable: false, help: 'Show this usage.');
}

/// Parses [arguments] and runs the tool, writing violations to [out] and
/// usage/git errors to [err]. Returns the process exit code: 0 (compliant),
/// 1 (violations found), or 2 (usage/git error).
int runCli(
  List<String> arguments, {
  required StringSink out,
  required StringSink err,
}) {
  final parser = buildArgParser();
  final ArgResults results;
  try {
    results = parser.parse(arguments);
  } on FormatException catch (e) {
    err
      ..writeln('Usage error: ${e.message}')
      ..writeln(parser.usage);
    return 2;
  }

  if (results['help'] as bool) {
    out.writeln(parser.usage);
    return 0;
  }

  if ((results['check'] as bool) && (results['fix'] as bool)) {
    err.writeln('Usage error: pass only one of --check or --fix.');
    return 2;
  }

  final options = RunOptions(
    repoPath: (results['repo'] as String?) ?? Directory.current.path,
    forkPoint: results['fork-point'] as String,
    attribution: results['attribution'] as String,
    fix: results['fix'] as bool,
  );

  try {
    return runApacheNotice(options, out: out).exitCode;
  } on GitError catch (e) {
    err.writeln(e.toString());
    return 2;
  }
}
