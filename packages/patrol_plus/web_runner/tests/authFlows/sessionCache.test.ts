import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import { hasSessionData, loadCachedSession, restoreCachedSession, saveCachedSession } from "./sessionCache.ts"
import type { CachedSession } from "./sessionCache.ts"

// Minimal fakes implementing only the BrowserContext/Page surface
// sessionCache.ts touches — same style as oidc.test.ts's FakePage.
class FakeContext {
  addCookiesCalls: unknown[][] = []
  storageStateResult: CachedSession = { cookies: [], origins: [] }

  async addCookies(cookies: unknown[]): Promise<void> {
    this.addCookiesCalls.push(cookies)
  }

  async storageState(): Promise<CachedSession> {
    return this.storageStateResult
  }
}

class FakePage {
  context_: FakeContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addInitScriptCalls: { fn: (arg: any) => void; arg: any }[] = []

  constructor(context: FakeContext) {
    this.context_ = context
  }

  context(): FakeContext {
    return this.context_
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async addInitScript(fn: (arg: any) => void, arg?: any): Promise<void> {
    this.addInitScriptCalls.push({ fn, arg })
  }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patrol-session-cache-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---- loadCachedSession -------------------------------------------------------

test("loadCachedSession: returns null when the file doesn't exist", () => {
  const result = loadCachedSession(path.join(tmpDir, "does-not-exist.json"))
  assert.equal(result, null)
})

test("loadCachedSession: returns null for malformed JSON (never throws)", () => {
  const filePath = path.join(tmpDir, "malformed.json")
  fs.writeFileSync(filePath, "{not valid json")

  assert.doesNotThrow(() => loadCachedSession(filePath))
  assert.equal(loadCachedSession(filePath), null)
})

test("loadCachedSession: returns null for structurally invalid shapes (missing cookies/origins arrays)", () => {
  const cases = ["{}", "null", "[]", JSON.stringify({ cookies: "not-an-array", origins: [] })]
  for (const raw of cases) {
    const filePath = path.join(tmpDir, `invalid-${cases.indexOf(raw)}.json`)
    fs.writeFileSync(filePath, raw)
    assert.equal(loadCachedSession(filePath), null, `expected null for: ${raw}`)
  }
})

test("loadCachedSession: returns the parsed session for valid JSON", () => {
  const filePath = path.join(tmpDir, "valid.json")
  const session: CachedSession = {
    cookies: [
      {
        name: "sid",
        value: "abc123",
        domain: "dev-dashboard.invora.app",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [
      {
        origin: "https://dev-dashboard.invora.app",
        localStorage: [{ name: "oidc.tokens", value: "{}" }],
      },
    ],
  }
  fs.writeFileSync(filePath, JSON.stringify(session))

  assert.deepEqual(loadCachedSession(filePath), session)
})

// ---- saveCachedSession --------------------------------------------------------

test("saveCachedSession: captures page.context().storageState() and writes it to disk", async () => {
  const context = new FakeContext()
  context.storageStateResult = {
    cookies: [
      {
        name: "sid",
        value: "abc123",
        domain: "dev-dashboard.invora.app",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [
      {
        origin: "https://dev-dashboard.invora.app",
        localStorage: [{ name: "oidc.tokens", value: "{}" }],
      },
    ],
  }
  const page = new FakePage(context)
  const filePath = path.join(tmpDir, "saved.json")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await saveCachedSession(page as any, filePath)

  const written = JSON.parse(fs.readFileSync(filePath, "utf8")) as CachedSession
  assert.deepEqual(written, context.storageStateResult)
})

test("saveCachedSession: creates the parent directory when it doesn't exist yet", async () => {
  const context = new FakeContext()
  const page = new FakePage(context)
  const filePath = path.join(tmpDir, "nested", "deeper", "saved.json")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await saveCachedSession(page as any, filePath)

  assert.equal(fs.existsSync(filePath), true)
})

// ---- hasSessionData -----------------------------------------------------------

test("hasSessionData: false for an empty session", () => {
  assert.equal(hasSessionData({ cookies: [], origins: [] }), false)
})

test("hasSessionData: true when there is at least one cookie", () => {
  const session: CachedSession = {
    cookies: [
      {
        name: "sid",
        value: "abc123",
        domain: "dev-dashboard.invora.app",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  }
  assert.equal(hasSessionData(session), true)
})

test("hasSessionData: true when there is at least one localStorage entry (no cookies)", () => {
  const session: CachedSession = {
    cookies: [],
    origins: [{ origin: "https://dev-dashboard.invora.app", localStorage: [{ name: "oidc.tokens", value: "{}" }] }],
  }
  assert.equal(hasSessionData(session), true)
})

// ---- restoreCachedSession -----------------------------------------------------

test("restoreCachedSession: forwards captured cookies to context.addCookies", async () => {
  const context = new FakeContext()
  const page = new FakePage(context)
  const session: CachedSession = {
    cookies: [
      {
        name: "sid",
        value: "abc123",
        domain: "dev-dashboard.invora.app",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await restoreCachedSession(page as any, session)

  assert.equal(context.addCookiesCalls.length, 1)
  assert.deepEqual(context.addCookiesCalls[0], session.cookies)
})

test("restoreCachedSession: skips addCookies entirely when there are no cookies", async () => {
  const context = new FakeContext()
  const page = new FakePage(context)
  const session: CachedSession = { cookies: [], origins: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await restoreCachedSession(page as any, session)

  assert.equal(context.addCookiesCalls.length, 0)
})

test(
  "restoreCachedSession: registers an addInitScript callback that sets " +
    "localStorage only for the matching origin",
  async () => {
    const context = new FakeContext()
    const page = new FakePage(context)
    const session: CachedSession = {
      cookies: [],
      origins: [
        {
          origin: "https://dev-dashboard.invora.app",
          localStorage: [
            { name: "oidc.tokens", value: '{"access_token":"redacted"}' },
            { name: "oidc.other", value: "x" },
          ],
        },
        {
          origin: "https://some-other-origin.example",
          localStorage: [{ name: "should.not.leak", value: "y" }],
        },
      ],
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await restoreCachedSession(page as any, session)

    assert.equal(page.addInitScriptCalls.length, 1)
    const { fn, arg } = page.addInitScriptCalls[0]
    assert.deepEqual(arg, session.origins)

    // Simulate the browser environment the registered function will run in
    // (Playwright evaluates it in-page — here we fake just enough of
    // `window` for the callback body to execute against).
    const store = new Map<string, string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {
      location: { origin: "https://dev-dashboard.invora.app" },
      localStorage: {
        setItem: (name: string, value: string) => store.set(name, value),
      },
    }
    try {
      fn(arg)
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    }

    assert.equal(store.get("oidc.tokens"), '{"access_token":"redacted"}')
    assert.equal(store.get("oidc.other"), "x")
    // The non-matching origin's entry must never be set.
    assert.equal(store.get("should.not.leak"), undefined)
    assert.equal(store.size, 2)
  },
)
