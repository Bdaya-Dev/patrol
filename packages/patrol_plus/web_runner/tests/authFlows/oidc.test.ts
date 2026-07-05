import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { parseAuthFlowSpec, runAuthFlow } from "./oidc.ts"
import type { AuthFlowSpec } from "./oidc.ts"

// Minimal fakes implementing only the Page/Locator surface runAuthFlow
// touches (locator/waitForURL), so the auth-flow orchestration logic can be
// unit-tested without a real browser or IdP — same style as
// errorGate.test.ts's FakePage.
type Call =
  | { kind: "click"; selector: string; timeout?: number }
  | { kind: "fill"; selector: string; value: string; timeout?: number }
  | { kind: "waitForURL"; pattern: string; timeout?: number }

class FakeLocator {
  private page: FakePage
  private selector: string

  constructor(page: FakePage, selector: string) {
    this.page = page
    this.selector = selector
  }

  first(): this {
    return this
  }

  async click(opts?: { timeout?: number }): Promise<void> {
    this.page.calls.push({ kind: "click", selector: this.selector, timeout: opts?.timeout })
    const failure = this.page.failingSelectors.get(this.selector)
    if (failure) throw new Error(failure)
  }

  async fill(value: string, opts?: { timeout?: number }): Promise<void> {
    this.page.calls.push({ kind: "fill", selector: this.selector, value, timeout: opts?.timeout })
    const failure = this.page.failingSelectors.get(this.selector)
    if (failure) throw new Error(failure)
  }
}

/**
 * A queue-driven fake: each `waitForURL` call pops the next queued URL
 * (simulating "the browser navigated here") and asserts it against the
 * pattern, exactly like Playwright's real `waitForURL` would time out if the
 * page never reaches a matching URL.
 */
class FakePage {
  calls: Call[] = []
  failingSelectors = new Map<string, string>()
  private navigationQueue: string[]
  private currentUrl: string

  constructor(startUrl: string, navigationQueue: string[] = []) {
    this.currentUrl = startUrl
    this.navigationQueue = [...navigationQueue]
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(this, selector)
  }

  url(): string {
    return this.currentUrl
  }

  async waitForURL(pattern: RegExp, opts?: { timeout?: number }): Promise<void> {
    this.calls.push({ kind: "waitForURL", pattern: pattern.source, timeout: opts?.timeout })
    const next = this.navigationQueue.shift()
    if (next === undefined) {
      throw new Error(`waitForURL(/${pattern.source}/): timeout ${opts?.timeout}ms exceeded`)
    }
    this.currentUrl = next
    if (!pattern.test(this.currentUrl)) {
      throw new Error(
        `waitForURL(/${pattern.source}/): timeout ${opts?.timeout}ms exceeded, ` + `page is at ${this.currentUrl}`,
      )
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run(page: FakePage, spec: AuthFlowSpec) {
  return runAuthFlow(page as any, spec)
}

const baseSpec: AuthFlowSpec = {
  loginUrlPattern: "^https://dev-auth\\.invora\\.app/",
  loginNameSelector: 'input[name="loginName"]',
  loginNameEnvVar: "PATROL_TEST_ZITADEL_USERNAME",
  passwordSelector: 'input[type="password"]',
  passwordEnvVar: "PATROL_TEST_ZITADEL_PASSWORD",
  submitSelector: 'button[type="submit"]',
  successUrlPattern: "^https://dev-dashboard\\.invora\\.app/",
}

const ENV_KEYS = ["PATROL_TEST_ZITADEL_USERNAME", "PATROL_TEST_ZITADEL_PASSWORD"] as const

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

// ---- parseAuthFlowSpec -----------------------------------------------------

test("parseAuthFlowSpec: undefined/blank yields null (no prelude runs)", () => {
  assert.equal(parseAuthFlowSpec(undefined), null)
  assert.equal(parseAuthFlowSpec(""), null)
  assert.equal(parseAuthFlowSpec("   "), null)
})

test("parseAuthFlowSpec: invalid JSON throws, naming the flag", () => {
  assert.throws(() => parseAuthFlowSpec("{not json"), /--web-auth-flow.*not valid JSON/)
})

test("parseAuthFlowSpec: a JSON array/primitive (not an object) throws", () => {
  assert.throws(() => parseAuthFlowSpec("[1,2,3]"), /must be a JSON object/)
  assert.throws(() => parseAuthFlowSpec('"just a string"'), /must be a JSON object/)
})

test("parseAuthFlowSpec: missing required fields throws listing them", () => {
  assert.throws(
    () => parseAuthFlowSpec(JSON.stringify({ loginUrlPattern: "^https://idp" })),
    /missing required field\(s\): loginNameSelector, loginNameEnvVar, passwordSelector, passwordEnvVar, submitSelector, successUrlPattern/,
  )
})

test("parseAuthFlowSpec: a complete minimal spec carries required fields, " + "defaults optionals to undefined", () => {
  const spec = parseAuthFlowSpec(JSON.stringify(baseSpec))
  assert.ok(spec)
  assert.equal(spec.loginUrlPattern, baseSpec.loginUrlPattern)
  assert.equal(spec.loginNameSelector, baseSpec.loginNameSelector)
  assert.equal(spec.loginNameEnvVar, baseSpec.loginNameEnvVar)
  assert.equal(spec.passwordSelector, baseSpec.passwordSelector)
  assert.equal(spec.passwordEnvVar, baseSpec.passwordEnvVar)
  assert.equal(spec.submitSelector, baseSpec.submitSelector)
  assert.equal(spec.successUrlPattern, baseSpec.successUrlPattern)
  assert.equal(spec.triggerSelector, undefined)
  assert.equal(spec.timeoutMs, undefined)
})

test("parseAuthFlowSpec: optional triggerSelector/timeoutMs are carried through when present", () => {
  const spec = parseAuthFlowSpec(JSON.stringify({ ...baseSpec, triggerSelector: "text=Sign in", timeoutMs: 45000 }))
  assert.ok(spec)
  assert.equal(spec.triggerSelector, "text=Sign in")
  assert.equal(spec.timeoutMs, 45000)
})

test(
  "parseAuthFlowSpec: loginNameSubmitSelector is undefined by default, " + "carried through when set (two-step IdP)",
  () => {
    const spec = parseAuthFlowSpec(JSON.stringify(baseSpec))
    assert.ok(spec)
    assert.equal(spec.loginNameSubmitSelector, undefined)

    const spec2 = parseAuthFlowSpec(JSON.stringify({ ...baseSpec, loginNameSubmitSelector: "text=Continue" }))
    assert.ok(spec2)
    assert.equal(spec2.loginNameSubmitSelector, "text=Continue")
  },
)

test("parseAuthFlowSpec: enableAccessibility is undefined by default, " + "carried through as false when set", () => {
  const spec = parseAuthFlowSpec(JSON.stringify(baseSpec))
  assert.ok(spec)
  assert.equal(spec.enableAccessibility, undefined)

  const spec2 = parseAuthFlowSpec(JSON.stringify({ ...baseSpec, enableAccessibility: false }))
  assert.ok(spec2)
  assert.equal(spec2.enableAccessibility, false)
})

// ---- runAuthFlow ------------------------------------------------------------

test(
  "runAuthFlow: happy path with no trigger — waits for IdP, fills " + "credentials, submits, waits for return",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/", [
      "https://dev-auth.invora.app/login",
      "https://dev-dashboard.invora.app/home",
    ])

    await run(page, baseSpec)

    assert.deepEqual(
      page.calls.map(c => c.kind),
      ["waitForURL", "fill", "fill", "click", "waitForURL"],
    )
    assert.equal(page.url(), "https://dev-dashboard.invora.app/home")

    const [nameFill, passwordFill] = page.calls.filter((c): c is Extract<Call, { kind: "fill" }> => c.kind === "fill")
    assert.equal(nameFill.selector, baseSpec.loginNameSelector)
    assert.equal(nameFill.value, "autotest@example.com")
    assert.equal(passwordFill.selector, baseSpec.passwordSelector)
    assert.equal(passwordFill.value, "s3cr3t")
  },
)

test(
  "runAuthFlow: with loginNameSubmitSelector (two-step IdP, e.g. Zitadel), " +
    "submits loginName BEFORE filling password",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/", [
      "https://dev-auth.invora.app/loginname",
      "https://dev-dashboard.invora.app/home",
    ])

    await run(page, { ...baseSpec, loginNameSubmitSelector: "text=Continue" })

    assert.deepEqual(
      page.calls.map(c => c.kind),
      [
        "waitForURL",
        "fill", // loginName
        "click", // loginNameSubmitSelector ("Continue")
        "fill", // password
        "click", // submitSelector
        "waitForURL",
      ],
    )
    const [nameFill, passwordFill] = page.calls.filter((c): c is Extract<Call, { kind: "fill" }> => c.kind === "fill")
    assert.equal(nameFill.selector, baseSpec.loginNameSelector)
    assert.equal(passwordFill.selector, baseSpec.passwordSelector)
    const [loginNameSubmitClick, finalSubmitClick] = page.calls.filter(
      (c): c is Extract<Call, { kind: "click" }> => c.kind === "click",
    )
    assert.equal(loginNameSubmitClick.selector, "text=Continue")
    assert.equal(finalSubmitClick.selector, baseSpec.submitSelector)
  },
)

test(
  "runAuthFlow: without loginNameSubmitSelector, fills both fields " +
    "before the single submit click (single-step IdP, unchanged)",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/", [
      "https://dev-auth.invora.app/login",
      "https://dev-dashboard.invora.app/home",
    ])

    await run(page, baseSpec)

    assert.deepEqual(
      page.calls.map(c => c.kind),
      ["waitForURL", "fill", "fill", "click", "waitForURL"],
    )
  },
)

test(
  "runAuthFlow: with a triggerSelector, best-effort clicks the a11y " +
    "placeholder THEN the trigger, before waiting for the IdP origin",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/landing", [
      "https://dev-auth.invora.app/login",
      "https://dev-dashboard.invora.app/home",
    ])

    await run(page, { ...baseSpec, triggerSelector: "text=Sign in" })

    assert.deepEqual(
      page.calls.map(c => c.kind),
      ["click", "click", "waitForURL", "fill", "fill", "click", "waitForURL"],
    )
    const clicks = page.calls.filter((c): c is Extract<Call, { kind: "click" }> => c.kind === "click")
    assert.equal(clicks[0].selector, "flt-semantics-placeholder")
    assert.equal(clicks[1].selector, "text=Sign in")
  },
)

test("runAuthFlow: without a triggerSelector, never attempts the a11y " + "placeholder click at all", async () => {
  process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
  process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

  const page = new FakePage("https://dev-dashboard.invora.app/", [
    "https://dev-auth.invora.app/login",
    "https://dev-dashboard.invora.app/home",
  ])

  await run(page, baseSpec)

  assert.ok(
    !page.calls.some(
      c => c.kind === "click" && (c as Extract<Call, { kind: "click" }>).selector === "flt-semantics-placeholder",
    ),
  )
})

test(
  "runAuthFlow: enableAccessibility: false skips the a11y placeholder " + "click, going straight to the trigger",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/landing", [
      "https://dev-auth.invora.app/login",
      "https://dev-dashboard.invora.app/home",
    ])

    await run(page, { ...baseSpec, triggerSelector: "text=Sign in", enableAccessibility: false })

    assert.deepEqual(
      page.calls.map(c => c.kind),
      ["click", "waitForURL", "fill", "fill", "click", "waitForURL"],
    )
    assert.equal((page.calls[0] as Extract<Call, { kind: "click" }>).selector, "text=Sign in")
  },
)

test(
  "runAuthFlow: an a11y placeholder click failure is swallowed — the " + "trigger click still proceeds normally",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/landing", [
      "https://dev-auth.invora.app/login",
      "https://dev-dashboard.invora.app/home",
    ])
    // Simulates an HTML-renderer build (or a11y already enabled): the
    // placeholder simply isn't there to click.
    page.failingSelectors.set("flt-semantics-placeholder", "element not found")

    await run(page, { ...baseSpec, triggerSelector: "text=Sign in" })

    assert.deepEqual(
      page.calls.map(c => c.kind),
      ["click", "click", "waitForURL", "fill", "fill", "click", "waitForURL"],
    )
    assert.equal(page.url(), "https://dev-dashboard.invora.app/home")
  },
)

test(
  "runAuthFlow: throws before any navigation when the loginName " +
    "credential env var is unset (fails fast, not mid-navigation)",
  async () => {
    delete process.env.PATROL_TEST_ZITADEL_USERNAME
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/", ["https://dev-auth.invora.app/login"])

    await assert.rejects(run(page, baseSpec), /PATROL_TEST_ZITADEL_USERNAME.*is unset/)
    assert.deepEqual(page.calls, [])
  },
)

test("runAuthFlow: throws before any navigation when the password " + "credential env var is unset", async () => {
  process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
  delete process.env.PATROL_TEST_ZITADEL_PASSWORD

  const page = new FakePage("https://dev-dashboard.invora.app/", [])

  await assert.rejects(run(page, baseSpec), /PATROL_TEST_ZITADEL_PASSWORD.*is unset/)
  assert.deepEqual(page.calls, [])
})

test("runAuthFlow: an unset credential's error message names the env var, " + "never a credential VALUE", async () => {
  delete process.env.PATROL_TEST_ZITADEL_USERNAME
  process.env.PATROL_TEST_ZITADEL_PASSWORD = "super-secret-value-should-not-leak"

  const page = new FakePage("https://dev-dashboard.invora.app/", [])

  await assert.rejects(run(page, baseSpec), (err: unknown) => {
    const message = (err as Error).message
    assert.ok(message.includes("PATROL_TEST_ZITADEL_USERNAME"))
    assert.ok(!message.includes("super-secret-value-should-not-leak"))
    return true
  })
})

test(
  "runAuthFlow: a locator-failure error thrown further down the flow " + "does not embed the password value",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "super-secret-value-should-not-leak"

    // Login-name field fill fails (element not found) — the propagated error
    // must not have embedded the password anywhere it could leak, even though
    // the (never-thrown) password fill itself legitimately carries the value.
    const page = new FakePage("https://dev-dashboard.invora.app/", ["https://dev-auth.invora.app/login"])
    page.failingSelectors.set(baseSpec.loginNameSelector, "element not found")

    await assert.rejects(run(page, baseSpec), (err: unknown) => {
      assert.ok(!(err as Error).message.includes("super-secret-value-should-not-leak"))
      return true
    })
  },
)

test("runAuthFlow: propagates (does not swallow) a failure to reach the " + "IdP origin", async () => {
  process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
  process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

  // Navigation queue is empty — waitForURL(loginUrlPattern) "times out".
  const page = new FakePage("https://dev-dashboard.invora.app/", [])

  await assert.rejects(run(page, baseSpec), /timeout/)
})

test(
  "runAuthFlow: propagates a failure when the IdP redirects somewhere " + "that doesn't match successUrlPattern",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/", [
      "https://dev-auth.invora.app/login",
      "https://dev-auth.invora.app/error", // never leaves the IdP origin
    ])

    await assert.rejects(run(page, baseSpec), /timeout.*dev-auth\.invora\.app\/error/)
  },
)

test(
  "runAuthFlow: propagates a locator failure (e.g. submit control never " + "appears) rather than swallowing it",
  async () => {
    process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
    process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

    const page = new FakePage("https://dev-dashboard.invora.app/", ["https://dev-auth.invora.app/login"])
    page.failingSelectors.set(baseSpec.submitSelector, "submit control not found within timeout")

    await assert.rejects(run(page, baseSpec), /submit control not found/)
    // Fields were filled before the submit failure — sequence up to the
    // failure point is preserved, not retried/reordered.
    assert.deepEqual(
      page.calls.map(c => c.kind),
      ["waitForURL", "fill", "fill", "click"],
    )
  },
)

test("runAuthFlow: forwards a custom timeoutMs to every step; defaults to " + "30000ms when omitted", async () => {
  process.env.PATROL_TEST_ZITADEL_USERNAME = "autotest@example.com"
  process.env.PATROL_TEST_ZITADEL_PASSWORD = "s3cr3t"

  const page = new FakePage("https://dev-dashboard.invora.app/", [
    "https://dev-auth.invora.app/login",
    "https://dev-dashboard.invora.app/home",
  ])

  await run(page, { ...baseSpec, timeoutMs: 5000 })
  assert.ok(page.calls.every(c => c.timeout === 5000))

  page.calls.length = 0
  const page2 = new FakePage("https://dev-dashboard.invora.app/", [
    "https://dev-auth.invora.app/login",
    "https://dev-dashboard.invora.app/home",
  ])
  await run(page2, baseSpec)
  assert.ok(page2.calls.every(c => c.timeout === 30000))
})
