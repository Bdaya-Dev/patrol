import assert from "node:assert/strict"
import { test } from "node:test"
import { DEFAULT_SENSITIVE_SELECTORS, parseRedactSelectors } from "./sensitiveRedaction.ts"

test("parseRedactSelectors: returns only the defaults when unset", () => {
  assert.deepEqual(parseRedactSelectors(undefined), DEFAULT_SENSITIVE_SELECTORS)
})

test("parseRedactSelectors: returns only the defaults for an empty string", () => {
  assert.deepEqual(parseRedactSelectors(""), DEFAULT_SENSITIVE_SELECTORS)
})

test("parseRedactSelectors: merges custom selectors after the defaults", () => {
  assert.deepEqual(parseRedactSelectors('["[data-patrol-sensitive]","input[type=\\"tel\\"]"]'), [
    ...DEFAULT_SENSITIVE_SELECTORS,
    "[data-patrol-sensitive]",
    'input[type="tel"]',
  ])
})

test("parseRedactSelectors: deduping a repeated default is a no-op, not a second overlay", () => {
  assert.deepEqual(parseRedactSelectors('["input[type=\\"password\\"]","[data-x]"]'), [
    ...DEFAULT_SENSITIVE_SELECTORS,
    "[data-x]",
  ])
})

test("parseRedactSelectors: throws on malformed JSON rather than silently dropping selectors", () => {
  assert.throws(
    () => parseRedactSelectors("not json"),
    (err: Error) => {
      assert.match(err.message, /PATROL_WEB_REDACT_SELECTORS must be a valid JSON array/)
      return true
    },
  )
})

test("parseRedactSelectors: throws when the JSON is not an array of strings", () => {
  assert.throws(
    () => parseRedactSelectors("[1, 2, 3]"),
    (err: Error) => {
      assert.match(err.message, /PATROL_WEB_REDACT_SELECTORS must be a JSON array of strings/)
      return true
    },
  )
})

test("parseRedactSelectors: throws when the JSON is an object, not an array", () => {
  assert.throws(() => parseRedactSelectors('{"not":"an array"}'))
})
