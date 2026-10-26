import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import type { FullConfig } from "@playwright/test"
import globalSetup from "./globalSetup.ts"

const ENV_KEY = "PATROL_WEB_SMOKE_MODE"
let previousValue: string | undefined

beforeEach(() => {
  previousValue = process.env[ENV_KEY]
})

afterEach(() => {
  if (previousValue === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = previousValue
  }
})

// A minimal stand-in; globalSetup never reads any field of it on the
// short-circuit path this test exercises.
const fakeConfig = {} as FullConfig

test("globalSetup: PATROL_WEB_SMOKE_MODE=true short-circuits without importing tests/setup", async () => {
  process.env[ENV_KEY] = "true"

  // The real setup.ts launches a browser and navigates to BASE_URL — if the
  // dispatcher failed to short-circuit, this would hang/throw rather than
  // resolve quickly, since no BASE_URL/browser is set up for this test.
  await assert.doesNotReject(() => globalSetup(fakeConfig))
})

test("globalSetup: any other value (including unset) does not short-circuit", async () => {
  delete process.env[ENV_KEY]

  // Proves delegation actually happened rather than also short-circuiting on
  // an unset/falsy value: the minimal fakeConfig has no `projects`, so the
  // real tests/setup.ts rejects destructuring `config.projects[0].use`
  // (TypeError) the moment it's invoked — a short-circuit would resolve
  // cleanly instead.
  await assert.rejects(() => globalSetup(fakeConfig))
})
