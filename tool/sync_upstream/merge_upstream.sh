#!/usr/bin/env bash
#
# Grafted three-way merge of an upstream (leancodepl/patrol) commit into this
# fork. See tool/sync_upstream/README.md for the rationale.
#
#   merge_upstream.sh start <upstream-ref> [<fork-point>]
#       Replays the fork's package rename onto <fork-point> (default: the merge
#       base of HEAD and <upstream-ref>) and onto <upstream-ref>, then starts a
#       merge on branch tmp/sync-work whose merge base is the renamed fork
#       point. Resolve conflicts, `git add`, `git commit` on tmp/sync-work.
#
#   merge_upstream.sh finish <branch>
#       Turns the committed tmp/sync-work tree into a real merge commit with
#       parents (<the fork commit start ran from>, tmp/upstream-renamed),
#       points <branch> at it, checks it out and removes the temporary refs.
#
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$(git rev-parse --show-toplevel)"

STATE_OURS=refs/sync-upstream/ours
STATE_THEIRS=refs/sync-upstream/theirs
MERGE_OPTS=(-c merge.renameLimit=100000 -c diff.renameLimit=100000)

die() { echo "error: $*" >&2; exit 1; }

require_clean() {
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree is not clean"
}

replay_onto() {
  # $1 = commit to replay onto, $2 = branch name to create, $3 = commit subject
  local commit="$1" branch="$2" subject="$3"
  git checkout -q -B "$branch" "$commit"
  # Checking out upstream removes tool/sync_upstream from the working tree,
  # so run the copy taken before the checkout.
  bash "$REPLAY" >/dev/null
  if git diff --cached --quiet; then
    echo "$branch: nothing to replay (already renamed?)"
  else
    git commit -q -m "$subject"
  fi
  echo "$branch = $(git rev-parse --short "$branch") ($subject)"
}

cmd_start() {
  local upstream="${1:?upstream ref required}"
  local ours upstream_sha fork_point
  ours="$(git rev-parse HEAD)"
  upstream_sha="$(git rev-parse --verify "$upstream^{commit}")"
  fork_point="${2:-$(git merge-base "$ours" "$upstream_sha")}"
  require_clean
  echo "ours       = $(git rev-parse --short "$ours") ($(git rev-parse --abbrev-ref HEAD))"
  echo "upstream   = $(git rev-parse --short "$upstream_sha") ($upstream)"
  echo "fork point = $(git rev-parse --short "$fork_point")"

  git update-ref "$STATE_OURS" "$ours"
  git update-ref "$STATE_THEIRS" "$upstream_sha"

  REPLAY="$(mktemp -d)/replay_fork_rename.sh"
  cp "$here/replay_fork_rename.sh" "$REPLAY"

  replay_onto "$fork_point" tmp/base-renamed \
    "chore: replay fork package rename onto fork point $(git rev-parse --short "$fork_point")"
  replay_onto "$upstream_sha" tmp/upstream-renamed \
    "chore: replay fork package rename onto upstream $(git rev-parse --short "$upstream_sha")"

  local synth_theirs synth_ours
  synth_theirs="$(git commit-tree "tmp/upstream-renamed^{tree}" -p tmp/base-renamed \
    -m "synthetic: upstream-renamed on top of base-renamed")"
  synth_ours="$(git commit-tree "$ours^{tree}" -p tmp/base-renamed \
    -m "synthetic: fork tree on top of base-renamed")"
  git update-ref refs/sync-upstream/synth-theirs "$synth_theirs"

  git checkout -q -B tmp/sync-work "$synth_ours"
  echo
  echo "Merging renamed upstream into the fork tree (base = renamed fork point)..."
  if git "${MERGE_OPTS[@]}" merge --no-commit --no-ff "$synth_theirs"; then
    echo "Merged without conflicts. Review, then: git commit"
  else
    echo
    echo "$(git diff --name-only --diff-filter=U | wc -l) path(s) need manual resolution:"
    git diff --name-only --diff-filter=U
  fi
  echo
  echo "When done: git commit on tmp/sync-work, then"
  echo "  tool/sync_upstream/merge_upstream.sh finish <branch>"
}

cmd_finish() {
  local branch="${1:?branch name required}"
  local ours theirs tree msg
  ours="$(git rev-parse --verify "$STATE_OURS")" || die "no sync in progress (run start first)"
  theirs="$(git rev-parse --verify "$STATE_THEIRS")"
  require_clean
  [ "$(git rev-parse --abbrev-ref HEAD)" = "tmp/sync-work" ] || die "check out tmp/sync-work first"
  git rev-parse -q --verify MERGE_HEAD >/dev/null && die "merge not committed yet"

  tree="$(git rev-parse "HEAD^{tree}")"
  msg="$(printf 'chore: sync upstream leancodepl/patrol to %s (%s)\n\nMerge of upstream/master %s (via tmp/upstream-renamed, the same commit with\nthe fork'"'"'s _plus package rename replayed by tool/sync_upstream).\n' \
    "$(git rev-parse --short "$theirs")" "$(git show -s --format=%cs "$theirs")" "$(git rev-parse "$theirs")")"
  local merge
  merge="$(git commit-tree "$tree" -p "$ours" -p tmp/upstream-renamed -m "$msg")"
  git branch -f "$branch" "$merge"
  git checkout -q "$branch"
  git branch -q -D tmp/sync-work tmp/base-renamed
  git update-ref -d "$STATE_OURS"
  git update-ref -d "$STATE_THEIRS"
  git update-ref -d refs/sync-upstream/synth-theirs
  echo "$branch = $(git rev-parse --short "$merge") (parents: $(git rev-parse --short "$ours") $(git rev-parse --short tmp/upstream-renamed))"
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  finish) shift; cmd_finish "$@" ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
