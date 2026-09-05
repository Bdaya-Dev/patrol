# Syncing with upstream (leancodepl/patrol)

This fork renamed every published package to a `_plus` variant
(`packages/patrol` -> `packages/patrol_plus`, `package:patrol_cli/` ->
`package:patrol_cli_plus/`, ...; fork commit `dee5f944a` and follow-ups) and
dropped `packages/patrol_mcp` (`b9f7b2437`). A plain `git merge upstream/master`
therefore fails badly: git's rename detection does not pair the fork's
`packages/<x>_plus` with upstream's `packages/<x>` (hundreds of rename/rename
and rename/delete conflicts, and the old `packages/patrol` tree reappears).

The tools here make an upstream sync a normal three-way merge again.

## How it works

1. `replay_fork_rename.sh` mechanically replays the fork's rename onto any
   upstream checkout: `git mv` of the seven package directories, removal of
   `patrol_mcp`, the SwiftPM/CocoaPods artefacts that carry the package name
   (`darwin/patrol_plus/Package.swift`, product/target/module `patrol_plus`,
   `patrol_plus.podspec`), and the text substitutions (`package:` imports,
   `packages/` paths, pubspec names and dependency keys, CLI messages and
   lookups, badges, native includes). It is idempotent and deterministic.
2. `merge_upstream.sh` builds a *grafted* three-way merge whose base is the
   fork point **with the rename replayed**:

   ```
   B  = replay(fork point)                 tmp/base-renamed
   U' = replay(upstream) on top of B       (synthetic commit)
   O' = current fork tree on top of B      (synthetic commit)
   merge U' into O'                        -> only genuine content conflicts
   ```

   After the conflicts are resolved and committed, `finish` re-parents the
   resulting tree onto the real history: parents = the fork commit you
   started from and `tmp/upstream-renamed` (whose own parent is the upstream
   commit), so `git merge-base master upstream/master` moves forward and the
   next sync starts from the new fork point.

Measured on the 2026-08-31 sync (fork point `41fe088e6`, upstream `4e19760bd`,
571 upstream commits): a direct merge of the replayed upstream branch into
master still produced 389 unmerged paths and 86 files under `packages/patrol`;
the grafted merge produced 61 unmerged paths (37 content, 24 modify/delete)
and no reappearing package.

## Recipe

```bash
git fetch upstream
# from a clean worktree on the fork branch you want to sync (usually master)
tool/sync_upstream/merge_upstream.sh start upstream/master
# ... resolve conflicts on tmp/sync-work, `git add`, `git commit` ...
tool/sync_upstream/merge_upstream.sh finish chore/sync-upstream-YYYY-MM-DD
```

`start` leaves you on `tmp/sync-work` mid-merge. Resolution guidelines that
held for the 2026-08-31 sync:

- Workflows under `.github/workflows` that the fork deleted (upstream's
  per-package CI) come back as modify/delete conflicts: `git rm` them. The
  fork's CI lives in `patrol-test.yml`, `test-e2e.yml`, `publish.yml`,
  `release-prepare.yml`.
- `pubspec.yaml` versions and the constraints on sibling `_plus` packages are
  the fork's (release tooling bumps them); everything else from upstream.
- `CHANGELOG.md`: both histories, fork entries on top, upstream entries below.
- `pubspec.lock` files: take ours, then `melos bootstrap` regenerates.
- Docs/READMEs: upstream's text with the `_plus` names, minus `patrol_mcp`.

`finish` creates the merge commit, points the given branch at it, checks it
out, and deletes the temporary refs (`tmp/base-renamed`, `tmp/sync-work`,
the synthetic commits). `tmp/upstream-renamed` is kept because it is the
merge commit's second parent.

## After the merge

- `dart pub global run melos bootstrap`, `melos run analyze`, `melos run
  format`, `dart test` in `packages/patrol_cli_plus`, `npm ci && npm test &&
  npm run lint` in `packages/patrol_plus/web_runner`.
- Move the Apache-2.0 §4(b) fork point (`tool/apache_notice`) to the upstream
  commit you merged.
