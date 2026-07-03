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
  evaluated: string[] = []

  context() {
    return {
      newCDPSession: async (_page: unknown) => this.cdpSession,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluate(fn: (...args: any[]) => any): Promise<void> {
    // Only the `() => window.dispatchEvent(new Event("languagechange"))`
    // shape is exercised by setLocale — record that it was called rather
    // than actually executing browser-only globals (`window`, `Event`) in
    // this Node test process.
    this.evaluated.push(fn.toString())
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

test("setLocale: detaches the CDP session after sending the override", async () => {
  const page = new FakePage()
  await callSetLocale(page, "de-DE")

  assert.equal(page.cdpSession.detached, true)
})

test("setLocale: dispatches a languagechange event so the Flutter engine picks it up", async () => {
  const page = new FakePage()
  await callSetLocale(page, "ar-SA")

  assert.equal(page.evaluated.length, 1)
  assert.match(page.evaluated[0], /languagechange/)
})

test("setLocale: rejects an empty locale before touching the page at all", async () => {
  const page = new FakePage()
  await assert.rejects(() => callSetLocale(page, ""), /non-empty string/)

  assert.equal(page.cdpSession.sent.length, 0)
  assert.equal(page.evaluated.length, 0)
})

test("setLocale: detaches the CDP session even if send() throws", async () => {
  const page = new FakePage()
  page.cdpSession.send = async () => {
    throw new Error("boom")
  }

  await assert.rejects(() => callSetLocale(page, "en-US"), /boom/)
  assert.equal(page.cdpSession.detached, true)
})
