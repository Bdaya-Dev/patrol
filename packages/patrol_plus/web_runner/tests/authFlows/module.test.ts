import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import { assertNotBothAuthFlowMechanismsSet, loadAuthFlowModule } from "./module.ts"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patrol-auth-flow-module-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---- loadAuthFlowModule -------------------------------------------------------

test("loadAuthFlowModule: loads a module exporting a named 'runAuthFlow' function", async () => {
  const modulePath = path.join(tmpDir, "named.mjs")
  fs.writeFileSync(
    modulePath,
    "export async function runAuthFlow(ctx) { ctx.log('ran', ctx.timeoutMs) }\n",
  )

  const flow = await loadAuthFlowModule(modulePath)
  const calls: unknown[][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await flow({ page: {} as any, log: (...args) => calls.push(args), timeoutMs: 1234 })

  assert.deepEqual(calls, [["ran", 1234]])
})

test("loadAuthFlowModule: loads a module exporting a 'default' function", async () => {
  const modulePath = path.join(tmpDir, "default.mjs")
  fs.writeFileSync(modulePath, "export default async function (ctx) { ctx.log('default-ran') }\n")

  const flow = await loadAuthFlowModule(modulePath)
  const calls: unknown[][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await flow({ page: {} as any, log: (...args) => calls.push(args), timeoutMs: 1 })

  assert.deepEqual(calls, [["default-ran"]])
})

test("loadAuthFlowModule: prefers the named 'runAuthFlow' export over 'default' when both exist", async () => {
  const modulePath = path.join(tmpDir, "both.mjs")
  fs.writeFileSync(
    modulePath,
    "export async function runAuthFlow(ctx) { ctx.log('named') }\n" +
      "export default async function (ctx) { ctx.log('default') }\n",
  )

  const flow = await loadAuthFlowModule(modulePath)
  const calls: unknown[][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await flow({ page: {} as any, log: (...args) => calls.push(args), timeoutMs: 1 })

  assert.deepEqual(calls, [["named"]])
})

test("loadAuthFlowModule: throws a clear error when the module exports neither 'runAuthFlow' nor 'default'", async () => {
  const modulePath = path.join(tmpDir, "no-export.mjs")
  fs.writeFileSync(modulePath, "export const notAFunction = 42\n")

  await assert.rejects(
    () => loadAuthFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /must export an async function as 'runAuthFlow' or 'default'/)
      return true
    },
  )
})

test("loadAuthFlowModule: throws (does not swallow) when the module fails to load", async () => {
  const modulePath = path.join(tmpDir, "does-not-exist.mjs")

  await assert.rejects(
    () => loadAuthFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /failed to load/)
      return true
    },
  )
})

test("loadAuthFlowModule: throws (does not swallow) when the module itself throws at import time", async () => {
  const modulePath = path.join(tmpDir, "throws-at-import.mjs")
  fs.writeFileSync(modulePath, "throw new Error('boom at import time')\n")

  await assert.rejects(
    () => loadAuthFlowModule(modulePath),
    (err: Error) => {
      assert.match(err.message, /failed to load/)
      assert.match(err.message, /boom at import time/)
      return true
    },
  )
})

// ---- assertNotBothAuthFlowMechanismsSet ---------------------------------------

test("assertNotBothAuthFlowMechanismsSet: no-op when neither is set", () => {
  assert.doesNotThrow(() => assertNotBothAuthFlowMechanismsSet(undefined, undefined))
})

test("assertNotBothAuthFlowMechanismsSet: no-op when only the spec is set", () => {
  assert.doesNotThrow(() => assertNotBothAuthFlowMechanismsSet("{}", undefined))
})

test("assertNotBothAuthFlowMechanismsSet: no-op when only the module path is set", () => {
  assert.doesNotThrow(() => assertNotBothAuthFlowMechanismsSet(undefined, "some/module.ts"))
})

test("assertNotBothAuthFlowMechanismsSet: throws a clear error when both are set", () => {
  assert.throws(
    () => assertNotBothAuthFlowMechanismsSet("{}", "some/module.ts"),
    (err: Error) => {
      assert.match(err.message, /mutually exclusive/)
      return true
    },
  )
})
