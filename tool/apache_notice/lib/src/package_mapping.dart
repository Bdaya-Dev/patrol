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

/// Maps a path as it existed in the upstream tree at the fork point to the
/// path it corresponds to in the fork's working tree, or `null` if the
/// upstream path has no fork counterpart (only `packages/patrol_mcp/**`,
/// which the fork dropped entirely).
String? mapUpstreamPathToWorkingPath(String upstreamPath) {
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
