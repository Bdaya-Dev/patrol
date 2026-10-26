import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import { loadSmokeFlowModule } from "./smokeFlow.ts"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patrol-smoke-flow-module-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---- loadSmokeFlowModule: single-function 'default' export -------------------

test("loadSmokeFlowModule: wraps a module exporting a single 'default' function into one 'smoke' scenario", async () => {
  const modulePath = path.join(tmpDir, "single.mjs")
  fs.writeFileSync(modulePath, "export default async function (ctx) { ctx.log('ran', ctx.baseUrl) }\n")

  const scenarios = await loadSmokeFlowModule(modulePath)
  assert.equal(scenarios.length, 1)
  assert.equal(scenarios[0]!.name, "smoke")

  const calls: unknown[][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await scenarios[0]!.run({ page: {} as any, log: (...args) => calls.push(args), baseUrl: "https://q.ahkam.ae" })

  assert.deepEqual(calls, [["ran", "https://q.ahkam.ae"]])
})

// ---- loadSmokeFlowModule: 'scenarios' array export ----------------------------

test("loadSmokeFlowModule: loads a module exporting a named 'scenarios' array, preserving order and names", async () => {
  const modulePath = path.join(tmpDir, "scenarios.mjs")
  fs.writeFileSync(
    modulePath,
    "export const scenarios = [\n" +
      "  { name: 'splash loads', run: async ctx => ctx.log('splash') },\n" +
      "  { name: 'queue page loads', run: async ctx => ctx.log('queue') },\n" +
      "]\n",
  )

  const scenarios = await loadSmokeFlowModule(modulePath)
  assert.deepEqual(
    scenarios.map(s => s.name),
    ["splash loads", "queue page loads"],
  )

  const calls: unknown[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const scenario of scenarios) await scenario.run({ page: {} as any, log: msg => calls.push(msg), baseUrl: "" })

  assert.deepEqual(calls, ["splash", "queue"])
})

test("loadSmokeFlowModule: an array export also works as 'default' (not just 'scenarios')", async () => {
  const modulePath = path.join(tmpDir, "default-array.mjs")
  fs.writeFileSync(modulePath, "export default [{ name: 'only', run: async ctx => ctx.log('only-ran') }]\n")

  const scenarios = await loadSmokeFlowModule(modulePath)
  assert.deepEqual(
    scenarios.map(s => s.name),
    ["only"],
  )
})

test("loadSmokeFlowModule: 'scenarios' takes precedence over 'default' when both exist", async () => {
  const modulePath = path.join(tmpDir, "both.mjs")
  fs.writeFileSync(
    modulePath,
    "export const scenarios = [{ name: 'from-scenarios', run: async () => {} }]\n" +
      "export default [{ name: 'from-default', run: async () => {} }]\n",
  )

  const scenarios = await loadSmokeFlowModule(modulePath)
  assert.deepEqual(
    scenarios.map(s => s.name),
    ["from-scenarios"],
  )
})

// ---- loadSmokeFlowModule: validation / error paths ----------------------------

test("loadSmokeFlowModule: throws a clear error when the module exports neither a function nor a scenario array", async () => {
  const modulePath = path.join(tmpDir, "no-export.mjs")
  fs.writeFileSync(modulePath, "export const notUsable = 42\n")

  await assert.rejects(
    () => loadSmokeFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /must export either an async function/)
      return true
    },
  )
})

test("loadSmokeFlowModule: throws a clear error on an empty scenarios array", async () => {
  const modulePath = path.join(tmpDir, "empty-array.mjs")
  fs.writeFileSync(modulePath, "export const scenarios = []\n")

  await assert.rejects(
    () => loadSmokeFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /empty or malformed array/)
      return true
    },
  )
})

test("loadSmokeFlowModule: throws a clear error when an array entry is malformed (missing 'run')", async () => {
  const modulePath = path.join(tmpDir, "malformed-array.mjs")
  fs.writeFileSync(modulePath, "export const scenarios = [{ name: 'oops' }]\n")

  await assert.rejects(
    () => loadSmokeFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /empty or malformed array/)
      return true
    },
  )
})

test("loadSmokeFlowModule: throws (does not swallow) when the module can't be loaded", async () => {
  const modulePath = path.join(tmpDir, "does-not-exist.mjs")

  await assert.rejects(
    () => loadSmokeFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /failed to load/)
      return true
    },
  )
})

test("loadSmokeFlowModule: throws (does not swallow) when the module itself throws at import time", async () => {
  const modulePath = path.join(tmpDir, "throws-at-import.mjs")
  fs.writeFileSync(modulePath, "throw new Error('boom at import time')\n")

  await assert.rejects(
    () => loadSmokeFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /failed to load/)
      assert.match(err.message, /boom at import time/)
      return true
    },
  )
})
