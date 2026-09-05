import 'git.dart';
import 'package_mapping.dart';

/// Whether a rename git detected between the fork point and HEAD slipped
/// past both the generic `packages/<x>` → `packages/<x>_plus` rule and
/// [explicitRenameMap] -- in which case the file would be treated as
/// removed+added instead of modified, and no §4(b) notice would be required.
///
/// A rename is *explained* when:
/// - its content is identical (`R100`): nothing was modified, so no notice
///   is owed whatever the path did;
/// - the mapping resolves the old path to exactly the new path;
/// - the mapping's counterpart for the old path still exists in the tree
///   ([existsInTree]). Git's rename detection is content-based, so a small
///   file that is identical across several packages (an
///   `analysis_options.yaml`, say) gets paired with whichever copy happens
///   to be closest; when the real counterpart is present, that pairing is a
///   detection artefact, not a rename the tool is blind to.
bool isUnexplainedRename(
  RenameEntry rename, {
  required bool Function(String workingPath) existsInTree,
}) {
  if (rename.similarity == 100) return false;
  final mapped = mapUpstreamPathToWorkingPath(rename.oldPath);
  if (mapped == null) return true; // no mapping at all -- nothing explains it.
  if (mapped == rename.newPath) return false;
  if (existsInTree(mapped)) return false;
  return true;
}
