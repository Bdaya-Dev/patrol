import assert from "node:assert/strict"
import { test } from "node:test"
import { DEFAULT_BROWSER_ARGS, resolveBrowserArgs } from "./browserArgs.ts"

test("applies the anti-throttling defaults when PATROL_WEB_BROWSER_ARGS is unset", () => {
  assert.deepEqual(resolveBrowserArgs({}), DEFAULT_BROWSER_ARGS)
})

test("treats an empty PATROL_WEB_BROWSER_ARGS as no user args", () => {
  assert.deepEqual(resolveBrowserArgs({ PATROL_WEB_BROWSER_ARGS: "" }), DEFAULT_BROWSER_ARGS)
})

test("defaults include every Chromium backgrounding/throttling switch", () => {
  for (const flag of [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ]) {
    assert.ok(DEFAULT_BROWSER_ARGS.includes(flag), `missing ${flag}`)
  }
})

test("appends user args after the defaults", () => {
  const args = resolveBrowserArgs({ PATROL_WEB_BROWSER_ARGS: '["--no-sandbox","--disable-gpu"]' })
  assert.deepEqual(args, [...DEFAULT_BROWSER_ARGS, "--no-sandbox", "--disable-gpu"])
})

test("does not duplicate a default the user also passed", () => {
  const args = resolveBrowserArgs({
    PATROL_WEB_BROWSER_ARGS: '["--disable-background-timer-throttling","--no-sandbox"]',
  })
  assert.deepEqual(args, [...DEFAULT_BROWSER_ARGS, "--no-sandbox"])
})

test("rejects PATROL_WEB_BROWSER_ARGS that is not a JSON array of strings", () => {
  assert.throws(() => resolveBrowserArgs({ PATROL_WEB_BROWSER_ARGS: '"--no-sandbox"' }), /JSON array of strings/)
  assert.throws(() => resolveBrowserArgs({ PATROL_WEB_BROWSER_ARGS: "[1]" }), /JSON array of strings/)
})
