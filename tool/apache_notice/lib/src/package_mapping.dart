/// Upstream package name -> fork package name, for the packages the fork
/// renamed. `patrol_mcp` has no fork counterpart and is intentionally
/// omitted: it's ignored entirely, not treated as "removed".
const Map<String, String> upstreamToForkPackage = {
  'adb': 'adb_plus',
  'patrol': 'patrol_plus',
  'patrol_cli': 'patrol_cli_plus',
  'patrol_devtools_extension': 'patrol_devtools_extension_plus',
  'patrol_finders': 'patrol_finders_plus',
  'patrol_gen': 'patrol_gen_plus',
  'patrol_log': 'patrol_log_plus',
};

/// The reverse of [upstreamToForkPackage].
final Map<String, String> forkToUpstreamPackage = {
  for (final entry in upstreamToForkPackage.entries) entry.value: entry.key,
};

/// The 7 fork package names, for iterating per-package NOTICE.md files.
final List<String> forkPackageNames = upstreamToForkPackage.values.toList()
  ..sort();

const String _ignoredUpstreamPackage = 'patrol_mcp';

/// Upstream file path -> working-tree path, for the individual files the
/// fork renamed *outside* the blanket `packages/<x>` -> `packages/<x>_plus`
/// rule above -- a filename change, not just a package-directory change, or
/// a move to a path outside `packages/` entirely.
///
/// Consulted before the generic package-dir substitution in
/// [mapUpstreamPathToWorkingPath], so these files are treated as MODIFIED
/// (in-file header + NOTICE.md entry) rather than as removed+added, which
/// is what the generic rule alone would produce for them (it only
/// substitutes the package directory, leaving the rest of the path,
/// filename included, unchanged).
///
/// The podspec entry was confirmed against
/// `git diff -M50% --name-status --diff-filter=R <fork point> HEAD` (R070 once
/// the notice header is in place).
/// The e2e-test entry is a deliberate over-attribution: git only pairs the
/// two files at `-M20%` (R028), but the fork's file started life as a copy
/// of upstream's macOS test, so it carries the notice anyway -- see the
/// tool's README for how to re-derive this list after a rename. Do NOT
/// add an entry for a file whose rename the generic rule already resolves
/// correctly (same filename, only the package directory changed) -- doing
/// so would redirect the comparison away from the real counterpart and
/// wrongly tag an unrelated new file as "modified from upstream".
const Map<String, String> explicitRenameMap = {
  'packages/patrol/darwin/patrol.podspec':
      'packages/patrol_plus/darwin/patrol_plus.podspec',
  'dev/e2e_app/patrol_test/macos/macos_app_test.dart':
      'dev/e2e_app/patrol_test/e2e/mobile_automation_test.dart',
};

/// Maps a path as it existed in the upstream tree at the fork point to the
/// path it corresponds to in the fork's working tree, or `null` if the
/// upstream path has no fork counterpart (only `packages/patrol_mcp/**`,
/// which the fork dropped entirely).
String? mapUpstreamPathToWorkingPath(String upstreamPath) {
  if (explicitRenameMap.containsKey(upstreamPath)) {
    return explicitRenameMap[upstreamPath];
  }

  const prefix = 'packages/';
  if (!upstreamPath.startsWith(prefix)) {
    return upstreamPath;
  }
  final rest = upstreamPath.substring(prefix.length);
  final slash = rest.indexOf('/');
  final pkgName = slash == -1 ? rest : rest.substring(0, slash);

  if (pkgName == _ignoredUpstreamPackage) {
    return null;
  }

  final forkName = upstreamToForkPackage[pkgName];
  if (forkName == null) {
    // Not one of the renamed packages (and not patrol_mcp) -- keep as-is.
    return upstreamPath;
  }
  final tail = slash == -1 ? '' : rest.substring(slash);
  return '$prefix$forkName$tail';
}
