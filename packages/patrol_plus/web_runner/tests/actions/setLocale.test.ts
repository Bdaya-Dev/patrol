import assert from "node:assert/strict"
import { test } from "node:test"
import { assertNonEmptyLocale } from "../localeValidation.ts"
import { setLocale } from "./setLocale.ts"

// ---- assertNonEmptyLocale ----------------------------------------------------

test("assertNonEmptyLocale: accepts a well-formed BCP-47 locale", () => {
  assert.doesNotThrow(() => assertNonEmptyLocale("en-US"))
})

test("assertNonEmptyLocale: accepts an ICU-style underscore locale", () => {
  assert.doesNotThrow(() => assertNonEmptyLocale("ar_SA"))
})

test("assertNonEmptyLocale: throws on an empty string", () => {
  assert.throws(() => assertNonEmptyLocale(""), /non-empty string/)
})

test("assertNonEmptyLocale: throws on a whitespace-only string", () => {
  assert.throws(() => assertNonEmptyLocale("   "), /non-empty string/)
})

// ---- setLocale: CDP wiring ---------------------------------------------------

// Minimal fakes implementing only the Page/CDPSession surface `setLocale`
// touches, so the CDP-session lifecycle and event dispatch can be verified
// without a real browser — same style as errorGate.test.ts's FakePage.
class FakeCDPSession {
  sent: Array<{ method: string; params: unknown }> = []
  detached = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(method: string, params?: unknown): Promise<any> {
    this.sent.push({ method, params })
    return {}
  }

  async detach(): Promise<void> {
    this.detached = true
  }
}

class FakePage {
  cdpSession = new FakeCDPSession()
  newCDPSessionCalls = 0
  evaluated: string[] = []
  evaluatedArgs: unknown[] = []
  private closeListeners: Array<() => void> = []

  context() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newCDPSession: async (_page: unknown) => {
        this.newCDPSessionCalls++
        return this.cdpSession
      },
    }
  }

  once(event: string, listener: () => void): void {
    if (event === "close") this.closeListeners.push(listener)
  }

  /** Test helper — simulates the Page "close" event Playwright would emit. */
  emitClose(): void {
    for (const listener of this.closeListeners.splice(0)) listener()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluate(fn: (...args: any[]) => any, arg?: unknown): Promise<void> {
    // setLocale only ever calls `overrideNavigatorLocale` (via
    // `page.evaluate(overrideNavigatorLocale, locale)`) — record that it was
    // called (and with what argument) rather than actually executing
    // browser-only globals (`window`, `navigator`, `Event`) in this Node
    // test process.
    this.evaluated.push(fn.toString())
    this.evaluatedArgs.push(arg)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callSetLocale(page: FakePage, locale: string) {
  return setLocale(page as any, { locale })
}

test("setLocale: sends Emulation.setLocaleOverride with the requested locale", async () => {
  const page = new FakePage()
  await callSetLocale(page, "fr-FR")

  assert.equal(page.cdpSession.sent.length, 1)
  assert.equal(page.cdpSession.sent[0].method, "Emulation.setLocaleOverride")
  assert.deepEqual(page.cdpSession.sent[0].params, { locale: "fr-FR" })
})

test("setLocale: dispatches languagechange BEFORE the CDP session could be torn down (regression for a silent no-op)", async () => {
  // The override is session-scoped in Chromium: detaching the session that
  // applied it reverts it immediately. If `setLocale` detached before
  // dispatching `languagechange`, the Flutter engine's own listener would
  // observe the override already reverted. Asserting the session is still
  // attached at the point the event is dispatched is the direct regression
  // guard for that bug.
  const page = new FakePage()
  let detachedWhenEventDispatched: boolean | null = null
  const originalEvaluate = page.evaluate.bind(page)
  page.evaluate = async (fn, arg) => {
    detachedWhenEventDispatched = page.cdpSession.detached
    return originalEvaluate(fn, arg)
  }

  await callSetLocale(page, "ar-SA")

  assert.equal(detachedWhenEventDispatched, false)
})

test("setLocale: does NOT detach the CDP session after a single call — it is kept alive for the page's lifetime", async () => {
  const page = new FakePage()
  await callSetLocale(page, "de-DE")

  assert.equal(page.cdpSession.detached, false)
})

test("setLocale: reuses the same CDP session across multiple calls on the same page (no per-call recreation)", async () => {
  const page = new FakePage()
  await callSetLocale(page, "de-DE")
  await callSetLocale(page, "fr-FR")

  assert.equal(page.newCDPSessionCalls, 1)
  assert.equal(page.cdpSession.sent.length, 2)
})

test("setLocale: detaches the CDP session only when the page closes", async () => {
  const page = new FakePage()
  await callSetLocale(page, "de-DE")
  assert.equal(page.cdpSession.detached, false)

  page.emitClose()
  // The detach() call is fire-and-forget inside the close handler — flush
  // the microtask queue so it has a chance to run.
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(page.cdpSession.detached, true)
})

test("setLocale: dispatches a languagechange event so the Flutter engine picks it up", async () => {
  const page = new FakePage()
  await callSetLocale(page, "ar-SA")

  assert.equal(page.evaluated.length, 1)
  assert.match(page.evaluated[0], /languagechange/)
})

test("setLocale: passes the requested locale into the page as the evaluate() argument", async () => {
  // Regression guard for the deeper bug the browser-level fork test
  // (inFlowSafety.browser.test.ts) caught: Emulation.setLocaleOverride
  // alone changes Intl/Date formatting but never touches
  // navigator.language/navigator.languages, and Emulation.setUserAgentOverride's
  // acceptLanguage only takes effect on the NEXT navigation — neither works
  // in-flow. The fix defines own accessors for navigator.language/languages
  // directly on the page, which requires the locale to actually be passed
  // as page.evaluate's second argument (not just closed over in a function
  // that never touches navigator at all).
  const page = new FakePage()
  await callSetLocale(page, "ar-SA")

  assert.equal(page.evaluatedArgs.length, 1)
  assert.equal(page.evaluatedArgs[0], "ar-SA")
})

test("setLocale: the in-page function overrides navigator.language and navigator.languages (not just Intl/Date via CDP)", async () => {
  // Emulation.setLocaleOverride (the CDP call sent above) only affects
  // Intl/Date formatting — verified empirically against real Chromium (see
  // setLocale.ts's doc comment). The Flutter web engine reads
  // navigator.languages, not Intl, on `languagechange`
  // (parseBrowserLanguages() in the engine's platform_dispatcher.dart), so
  // the in-page function must actually touch navigator.language/languages
  // itself rather than relying on the CDP override to have already done so.
  const page = new FakePage()
  await callSetLocale(page, "ar-SA")

  const fnSource = page.evaluated[0]
  assert.match(fnSource, /navigator\s*,\s*["']language["']/)
  assert.match(fnSource, /navigator\s*,\s*["']languages["']/)
})

test("setLocale: rejects an empty locale before touching the page at all", async () => {
  const page = new FakePage()
  await assert.rejects(() => callSetLocale(page, ""), /non-empty string/)

  assert.equal(page.cdpSession.sent.length, 0)
  assert.equal(page.evaluated.length, 0)
})

test("setLocale: propagates a send() failure and leaves the session attached (no per-call teardown)", async () => {
  const page = new FakePage()
  page.cdpSession.send = async () => {
    throw new Error("boom")
  }

  await assert.rejects(() => callSetLocale(page, "en-US"), /boom/)
  assert.equal(page.cdpSession.detached, false)
})
