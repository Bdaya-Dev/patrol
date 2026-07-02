import type { PatrolTestEntry } from "./types"

/**
 * Parses a comma-separated tag list (the value of --tags / --exclude-tags,
 * forwarded as PATROL_WEB_GREP / PATROL_WEB_GREP_INVERT) into a normalised
 * array: trimmed, lower-cased, with a leading "@" stripped, and empties
 * dropped. So "@Billing, tap-hosted-checkout ,," → ["billing", "tap-hosted-checkout"].
 */
export function parseTagList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map(tag => tag.trim().replace(/^@/, "").toLowerCase())
    .filter(tag => tag.length > 0)
}

/**
 * Filters the discovered patrol test list by tag. A test is kept when it
 * carries at least one [include] tag (or [include] is empty → no include
 * filter) AND carries none of the [exclude] tags. Tag comparison is normalised
 * on both sides (see [parseTagList]) so "@Foo", "foo", and " FOO " all match.
 *
 * With both lists empty this is the identity function, preserving the exact
 * pre-filter behaviour (and, crucially, the ordering the round-robin shard
 * relies on).
 */
export function filterByTags(
  tests: PatrolTestEntry[],
  include: string[],
  exclude: string[],
): PatrolTestEntry[] {
  if (include.length === 0 && exclude.length === 0) return tests

  return tests.filter(test => {
    const tags = test.tags
      .map(tag => tag.trim().replace(/^@/, "").toLowerCase())
      .filter(tag => tag.length > 0)
    const included = include.length === 0 || include.some(tag => tags.includes(tag))
    const excluded = exclude.some(tag => tags.includes(tag))
    return included && !excluded
  })
}
