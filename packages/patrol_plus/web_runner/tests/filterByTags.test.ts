import assert from "node:assert/strict"
import { test } from "node:test"
import { filterByTags, parseTagList } from "./filterByTags.ts"
import type { PatrolTestEntry } from "./types.ts"

const entry = (name: string, tags: string[]): PatrolTestEntry => ({ name, skip: false, tags })

const suite: PatrolTestEntry[] = [
  entry("invoice ksa phase2", ["@ksa-zatca-p2", "@invoicing"]),
  entry("billing plans", ["@billing-plans"]),
  entry("tap checkout", ["@tap-hosted-checkout", "@billing-payment-requests"]),
  entry("untagged smoke", []),
]

test("parseTagList normalises: strips @, trims, lower-cases, drops empties", () => {
  assert.deepEqual(parseTagList("@Billing, tap-hosted-checkout ,,"), ["billing", "tap-hosted-checkout"])
  assert.deepEqual(parseTagList(undefined), [])
  assert.deepEqual(parseTagList(""), [])
})

test("empty include and exclude is the identity (same array reference, order preserved)", () => {
  assert.equal(filterByTags(suite, [], []), suite)
})

test("include keeps tests carrying ANY include tag", () => {
  const got = filterByTags(suite, ["billing-plans"], []).map(t => t.name)
  assert.deepEqual(got, ["billing plans"])
})

test("include matches across a multi-tag test", () => {
  const got = filterByTags(suite, ["invoicing"], []).map(t => t.name)
  assert.deepEqual(got, ["invoice ksa phase2"])
})

test("exclude drops tests carrying ANY exclude tag, even when included", () => {
  const got = filterByTags(suite, ["billing-plans", "tap-hosted-checkout"], ["tap-hosted-checkout"]).map(
    t => t.name,
  )
  assert.deepEqual(got, ["billing plans"])
})

test("normalisation is symmetric — '@KSA-Zatca-P2' matches the entry tag '@ksa-zatca-p2'", () => {
  const got = filterByTags(suite, parseTagList("@KSA-Zatca-P2"), []).map(t => t.name)
  assert.deepEqual(got, ["invoice ksa phase2"])
})

test("include that matches nothing yields an empty set (no throw) — the change-scoped no-op", () => {
  assert.deepEqual(filterByTags(suite, ["does-not-exist"], []), [])
})

test("untagged tests are excluded by any non-empty include filter", () => {
  const names = filterByTags(suite, ["billing-plans"], []).map(t => t.name)
  assert.ok(!names.includes("untagged smoke"))
})
