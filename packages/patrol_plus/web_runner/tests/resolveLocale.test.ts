import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveLocale } from "./resolveLocale.ts"

test("defaults to en-US when PATROL_WEB_LOCALE is unset", () => {
  assert.equal(resolveLocale({}), "en-US")
})

test("defaults to en-US when PATROL_WEB_LOCALE is empty", () => {
  assert.equal(resolveLocale({ PATROL_WEB_LOCALE: "" }), "en-US")
})

test("honours an explicit PATROL_WEB_LOCALE", () => {
  assert.equal(resolveLocale({ PATROL_WEB_LOCALE: "pl-PL" }), "pl-PL")
})
