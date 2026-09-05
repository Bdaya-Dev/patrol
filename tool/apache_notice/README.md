# apache_notice

A standalone Dart tool that enforces Apache License 2.0 §4(b) for this fork
of [leancodepl/patrol](https://github.com/leancodepl/patrol):

> You must cause any modified files to carry prominent notices stating that
> You changed the files [...]

It does two things:

1. **Checks / inserts a one-line "changed file" comment** at the top of
   every working-tree file that differs, byte-for-byte, from its upstream
   counterpart at the fork point.
2. **Generates `NOTICE.md`** at the repo root and inside each of the 7
   renamed fork packages, listing every modified/removed file. Each
   `NOTICE.md` carries the upstream copyright line verbatim from `LICENSE`
   and reads purely as attribution — the "how to regenerate this file"
   instructions sit in an HTML comment (`<!-- ... -->`) at the bottom
   rather than as visible prose, so they don't read as extra fork
   commentary. See `lib/src/notice.dart` for the exact template.

This tool lives at `tool/apache_notice/` — *outside* `packages/` — so
Melos's `packages/**` globs (workspace resolution, versioning, `melos run`
scripts, etc.) never pick it up as a workspace package.

## Usage

From the repo root (or anywhere; `--repo` defaults to the current directory,
walking up to find the `.git` root):

```sh
# Report violations, change nothing. Exit 0 = compliant, 1 = violations.
dart run tool/apache_notice/bin/apache_notice.dart --check

# Insert missing headers and (re)write every NOTICE.md.
dart run tool/apache_notice/bin/apache_notice.dart --fix
```

Full flags:

```
--check                 Check compliance without modifying anything (default).
--fix                   Insert missing headers and (re)write NOTICE.md files.
--repo <path>           Path into the repo to operate on (default: cwd).
--fork-point <sha>      Commit the fork diverged from upstream at.
                        (default: 41fe088e6e9c98b536d330ba6c12d4af0bfb1189)
--attribution <name>    Attribution name for headers/NOTICE text.
                        (default: Bdaya-Dev)
```

Exit codes: `0` compliant, `1` violations found (each printed as
`<path>: <reason>`, one per line), `2` a git or usage error (e.g. bad
`--fork-point`, not run inside a git repo).

Run this from CI on every PR with `--check`; run `--fix` locally (or in a
pre-commit/pre-push hook) to fill in what's missing before pushing.

## What counts as "modified"

A file is in the §4(b) set when **both**:

- it has an upstream counterpart at the fork point commit, and
- its current working-tree bytes (uncommitted changes included — this does
  *not* use `git diff HEAD`) differ from that upstream blob.

The upstream↔fork path mapping accounts for the fork's package renames
(`packages/patrol` ↔ `packages/patrol_plus`, etc. — see
`lib/src/package_mapping.dart` for the full table). `packages/patrol_mcp`
has no fork counterpart and is ignored entirely. A file the fork *added*
(no upstream counterpart) is never in the set. A file that existed upstream
but has since been deleted is "removed" — listed in NOTICE.md under its own
heading, never given a header (it doesn't exist to put one in).

### Renames outside the packages/<x> rule

The generic package-rename rule above only substitutes the package
directory (`packages/patrol/...` → `packages/patrol_plus/...`) — it leaves
the rest of the path, filename included, untouched. That's wrong for the
handful of files the fork also renamed a level below the package directory
(a filename change) or moved outside `packages/` entirely: the tool would
look for the old filename at its new package location, not find it, and
wrongly classify the file as "removed" (with the real new file treated as
an unrelated addition, never checked for a header).

`explicitRenameMap` in `lib/src/package_mapping.dart` is the fix: an
explicit upstream-path → working-path table for exactly these files,
consulted before the generic rule. It currently covers:

- `packages/patrol/darwin/patrol.podspec` →
  `packages/patrol_plus/darwin/patrol_plus.podspec`
- `dev/e2e_app/patrol_test/macos/macos_app_test.dart` →
  `dev/e2e_app/patrol_test/e2e/mobile_automation_test.dart`

Don't add an entry for a rename the generic rule already resolves
correctly (same filename, only the package directory changed) — redirecting
the comparison there would compare the wrong two files and could wrongly
tag an unrelated new file as "modified from upstream".

### Catching the next one: `unmapped rename`

Because it's easy to add a new renamed-outside-the-rule file upstream and
forget to add it here, `--check`/`--fix` also run `git diff -M50%
--name-status --diff-filter=R <fork point> HEAD` and flag any rename with
similarity below 100% whose `(old, new)` pair isn't explained by the
generic rule or by `explicitRenameMap`, as `<old> -> <new>: unmapped
rename`. (A 100%-similarity rename — identical content — is never flagged:
there's nothing to give a header to.) This violation has no safe
auto-fix — there's no way to guess the right mapping — so it's still
reported, and still fails the run, under `--fix`; fixing it means adding
the pair to `explicitRenameMap` by hand and re-running.

## What gets a header, and what doesn't

Most text source files get a one-line comment inserted (idempotently — a
second run is a no-op) using the right syntax for the file type: see
`lib/src/comment_style.dart` for the exact extension → comment-style table.

Some files can't carry a comment at all — JSON, lockfiles, images, binaries,
and similar — plus `LICENSE` files, which this tool never touches under any
circumstances. Those are still part of the modified set; they just get
listed in `NOTICE.md` instead of edited, tagged
`(cannot carry a comment — listed here)`.

## Moving the fork point after merging an upstream update

When you merge (or rebase onto) a newer upstream `master`, the diff base
for "what did the fork change" should move forward too — otherwise every
file upstream touched since the old fork point will look "modified by the
fork" even though it's really just an upstream change you pulled in.

1. Merge/rebase the upstream update as usual.
2. Find the new fork point — the upstream commit your branch now sits on
   top of, e.g.:
   ```sh
   git merge-base HEAD upstream/master
   ```
   (assuming an `upstream` remote pointed at
   `https://github.com/leancodepl/patrol`; otherwise use whatever commit
   SHA you merged/rebased onto).
3. Update the default in `lib/src/cli.dart` (`defaultForkPoint`), and the
   date in `lib/src/notice.dart` (`forkPointDate`) to match that commit's
   date on upstream `master`.
4. Re-run with `--fix` to insert headers into anything upstream's changes
   now make newly "modified" relative to the new fork point, and to
   regenerate every `NOTICE.md` with the new fork point and file lists.
5. Commit the result.

You can also override the fork point per-invocation with `--fork-point
<sha>` without touching the default, e.g. to test a candidate fork point
before committing to it.

## Development

```sh
cd tool/apache_notice
dart pub get
dart test
dart analyze
```

`test/comment_style_test.dart`, `test/header_test.dart`,
`test/package_mapping_test.dart` and `test/notice_test.dart` are pure unit
tests. `test/integration_test.dart` builds a throwaway git repository under
the system temp directory for each test (upstream commit → renamed/modified
"fork" commit) and drives the compiled CLI against it end-to-end, including
scenarios for `explicitRenameMap` and the `unmapped rename` check.
