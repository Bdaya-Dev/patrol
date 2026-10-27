import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import { loadSmokeFlowModule, runScenariosReportingAllFailures } from "./smokeFlow.ts"

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

// ---- runScenariosReportingAllFailures -----------------------------------------

test("runScenariosReportingAllFailures: runs every scenario even when an earlier one fails", async () => {
  const ran: string[] = []
  const scenarios = [
    {
      name: "first (fails)",
      run: async () => {
        ran.push("first")
        throw new Error("first blew up")
      },
    },
    {
      name: "second (passes)",
      run: async () => {
        ran.push("second")
      },
    },
    {
      name: "third (passes)",
      run: async () => {
        ran.push("third")
      },
    },
  ]

  // A fake `runStep` that reproduces test.step()'s real behaviour: it
  // awaits the step body and re-throws whatever the body throws. Before the
  // fix, calling this directly inside a bare `for` loop is exactly what
  // made "second" and "third" never run once "first" threw.
  const fakeRunStep = async (_name: string, fn: () => Promise<void>) => {
    await fn()
  }

  await assert.rejects(
    () => runScenariosReportingAllFailures(scenarios, fakeCtx(), fakeRunStep),
    (err: Error) => {
      assert.match(err.message, /1\/3 smoke scenario\(s\) failed/)
      assert.match(err.message, /first \(fails\): first blew up/)
      return true
    },
  )

  // The regression this guards against: without it, `ran` would stop at
  // ["first"] because the loop aborted on the first throw.
  assert.deepEqual(ran, ["first", "second", "third"])
})

test("runScenariosReportingAllFailures: aggregates every failing scenario's name and message, not just the first", async () => {
  const scenarios = [
    {
      name: "a",
      run: async () => {
        throw new Error("boom a")
      },
    },
    { name: "b", run: async () => {} },
    {
      name: "c",
      run: async () => {
        throw new Error("boom c")
      },
    },
  ]

  const fakeRunStep = async (_name: string, fn: () => Promise<void>) => fn()

  await assert.rejects(
    () => runScenariosReportingAllFailures(scenarios, fakeCtx(), fakeRunStep),
    (err: Error) => {
      assert.match(err.message, /2\/3 smoke scenario\(s\) failed/)
      assert.match(err.message, /a: boom a/)
      assert.match(err.message, /c: boom c/)
      assert.doesNotMatch(err.message, /b: /)
      return true
    },
  )
})

test("runScenariosReportingAllFailures: resolves cleanly when every scenario passes", async () => {
  const ran: string[] = []
  const scenarios = [
    {
      name: "a",
      run: async () => {
        ran.push("a")
      },
    },
    {
      name: "b",
      run: async () => {
        ran.push("b")
      },
    },
  ]

  const fakeRunStep = async (_name: string, fn: () => Promise<void>) => fn()

  await assert.doesNotReject(() => runScenariosReportingAllFailures(scenarios, fakeCtx(), fakeRunStep))
  assert.deepEqual(ran, ["a", "b"])
})

test("runScenariosReportingAllFailures: each scenario is reported via runStep under its own name, in order", async () => {
  const stepNames: string[] = []
  const scenarios = [
    { name: "first", run: async () => {} },
    { name: "second", run: async () => {} },
  ]

  const recordingRunStep = async (name: string, fn: () => Promise<void>) => {
    stepNames.push(name)
    await fn()
  }

  await runScenariosReportingAllFailures(scenarios, fakeCtx(), recordingRunStep)
  assert.deepEqual(stepNames, ["first", "second"])
})

function fakeCtx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { page: {} as any, log: () => {}, baseUrl: "https://q.ahkam.ae" }
}
