import assert from "node:assert/strict"
import { test } from "node:test"
import {
  assertNoViolations,
  attachErrorGate,
  classifyConsole,
  isAllowlisted,
  parseAllowList,
} from "./errorGate.ts"
import type { ErrorGateConfig } from "./errorGate.ts"

// Minimal fake implementing only the Page surface attachErrorGate touches
// (on/off), so the gate's event-wiring and violation-recording logic can be
// unit-tested without a real browser — same style as filterByTags.test.ts.
class FakePage {
  private listeners = new Map<string, Set<(...args: never[]) => void>>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return this
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(listener as any)(...args)
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

const fakeConsoleMessage = (type: string, text: string) => ({ type: () => type, text: () => text })

const fakeRequest = (method: string, url: string, errorText: string | null) => ({
  method: () => method,
  url: () => url,
  failure: () => (errorText === null ? null : { errorText }),
})

const fakeResponse = (status: number, url: string, method = "GET") => ({
  status: () => status,
  url: () => url,
  request: () => ({ method: () => method }),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attach(page: FakePage, config: ErrorGateConfig) {
  return attachErrorGate(page as any, config)
}

// ---- parseAllowList -------------------------------------------------------

test("parseAllowList: trims entries and drops empties", () => {
  assert.deepEqual(parseAllowList(" is unimplemented , UNIMPLEMENTED ,,"), [
    "is unimplemented",
    "UNIMPLEMENTED",
  ])
})

test("parseAllowList: undefined/empty yields an empty list", () => {
  assert.deepEqual(parseAllowList(undefined), [])
  assert.deepEqual(parseAllowList(""), [])
})

// ---- isAllowlisted ---------------------------------------------------------

test("isAllowlisted: matches case-insensitively as a substring", () => {
  assert.ok(isAllowlisted("Service is UNIMPLEMENTED right now", ["is unimplemented"]))
})

test("isAllowlisted: empty allowlist never matches", () => {
  assert.equal(isAllowlisted("anything", []), false)
})

test("isAllowlisted: no entry matches", () => {
  assert.equal(isAllowlisted("network timeout", ["is unimplemented"]), false)
})

// ---- classifyConsole --------------------------------------------------------

test("classifyConsole: a [SEVERE] bracket on a plain log line is an error", () => {
  assert.equal(classifyConsole("log", "[SEVERE][init-service] : boom"), "dart:SEVERE")
})

test("classifyConsole: a [SHOUT] bracket is an error", () => {
  assert.equal(classifyConsole("log", "[SHOUT][x] : boom"), "dart:SHOUT")
})

test("classifyConsole: a [WARNING] bracket is NOT an error", () => {
  assert.equal(classifyConsole("log", "[WARNING][x] : hmm"), null)
})

test("classifyConsole: a real console.error with no level token is an error", () => {
  assert.equal(classifyConsole("error", "Uncaught TypeError: boom"), "console.error")
})

test("classifyConsole: console.error carrying an explicit lower Dart level is NOT an error", () => {
  assert.equal(classifyConsole("error", "[WARNING][x] : hmm"), null)
})

test("classifyConsole: a plain log line with no marker is not an error", () => {
  assert.equal(classifyConsole("log", "just some debug output"), null)
})

// ---- attachErrorGate: disabled ---------------------------------------------

test("attachErrorGate: disabled config attaches no listeners and records nothing", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: false, allowlist: [] })

  assert.equal(page.listenerCount("console"), 0)
  assert.equal(page.listenerCount("pageerror"), 0)
  assert.equal(page.listenerCount("requestfailed"), 0)
  assert.equal(page.listenerCount("response"), 0)

  page.emit("console", fakeConsoleMessage("log", "[SEVERE][x] : boom"))
  page.emit("pageerror", new Error("boom"))

  assert.deepEqual(gate.violations, [])
  gate.dispose() // no-op, must not throw
})

// ---- attachErrorGate: console channel ---------------------------------------

test("attachErrorGate: a [SEVERE] console record is recorded as a violation", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("console", fakeConsoleMessage("log", "[SEVERE][init-service] : An unknown error occurred."))

  assert.equal(gate.violations.length, 1)
  assert.equal(gate.violations[0].kind, "console(dart:SEVERE)")
  assert.match(gate.violations[0].detail, /An unknown error occurred/)
})

test("attachErrorGate: a routine [INFO] console record is not a violation", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("console", fakeConsoleMessage("log", "[INFO][x] : all good"))

  assert.deepEqual(gate.violations, [])
})

// ---- attachErrorGate: pageerror channel --------------------------------------

test("attachErrorGate: any uncaught page error is a violation", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("pageerror", new Error("Cannot read properties of null"))

  assert.equal(gate.violations.length, 1)
  assert.equal(gate.violations[0].kind, "pageerror")
  assert.match(gate.violations[0].detail, /Cannot read properties of null/)
})

// ---- attachErrorGate: requestfailed channel ----------------------------------

test("attachErrorGate: ERR_ABORTED request failures are ignored (routine SPA navigation)", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("requestfailed", fakeRequest("GET", "https://app.example/api", "net::ERR_ABORTED"))

  assert.deepEqual(gate.violations, [])
})

test("attachErrorGate: a non-aborted request failure is a violation", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("requestfailed", fakeRequest("POST", "https://app.example/api", "net::ERR_CONNECTION_RESET"))

  assert.equal(gate.violations.length, 1)
  assert.equal(gate.violations[0].kind, "requestfailed")
  assert.match(gate.violations[0].detail, /ERR_CONNECTION_RESET/)
})

// ---- attachErrorGate: response channel ---------------------------------------

test("attachErrorGate: a 2xx/3xx response is not a violation", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("response", fakeResponse(200, "https://app.example/api"))
  page.emit("response", fakeResponse(302, "https://app.example/redirect"))

  assert.deepEqual(gate.violations, [])
})

test("attachErrorGate: a 4xx/5xx response is a violation", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("response", fakeResponse(500, "https://app.example/api/invoices"))

  assert.equal(gate.violations.length, 1)
  assert.equal(gate.violations[0].kind, "response")
  assert.match(gate.violations[0].detail, /500 GET https:\/\/app\.example\/api\/invoices/)
})

test("attachErrorGate: .map and favicon.ico 404s are noise, not violations", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  page.emit("response", fakeResponse(404, "https://app.example/main.dart.js.map"))
  page.emit("response", fakeResponse(404, "https://app.example/favicon.ico"))
  page.emit("response", fakeResponse(404, "https://app.example/favicon.ico?v=2"))

  assert.deepEqual(gate.violations, [])
})

// ---- attachErrorGate: allowlist ------------------------------------------------

test("attachErrorGate: an allowlisted error is dropped instead of recorded", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: ["is unimplemented"] })

  page.emit(
    "console",
    fakeConsoleMessage("log", "[SEVERE][x] : Service is unimplemented right now"),
  )

  assert.deepEqual(gate.violations, [])
})

test("attachErrorGate: allowlist matching is case-insensitive", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: ["UNIMPLEMENTED"] })

  page.emit("console", fakeConsoleMessage("log", "[SEVERE][x] : service is unimplemented"))

  assert.deepEqual(gate.violations, [])
})

test("attachErrorGate: allowlist only suppresses matching errors, not everything", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: ["is unimplemented"] })

  page.emit("console", fakeConsoleMessage("log", "[SEVERE][x] : Service is unimplemented"))
  page.emit("pageerror", new Error("totally unrelated crash"))

  assert.equal(gate.violations.length, 1)
  assert.equal(gate.violations[0].kind, "pageerror")
})

// ---- attachErrorGate: dispose ---------------------------------------------------

test("attachErrorGate: dispose() removes all four listeners", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  assert.equal(page.listenerCount("console"), 1)
  assert.equal(page.listenerCount("pageerror"), 1)
  assert.equal(page.listenerCount("requestfailed"), 1)
  assert.equal(page.listenerCount("response"), 1)

  gate.dispose()

  assert.equal(page.listenerCount("console"), 0)
  assert.equal(page.listenerCount("pageerror"), 0)
  assert.equal(page.listenerCount("requestfailed"), 0)
  assert.equal(page.listenerCount("response"), 0)
})

test("attachErrorGate: events emitted after dispose() are not recorded", () => {
  const page = new FakePage()
  const gate = attach(page, { enabled: true, allowlist: [] })

  gate.dispose()
  page.emit("console", fakeConsoleMessage("log", "[SEVERE][x] : boom"))

  assert.deepEqual(gate.violations, [])
})

// ---- assertNoViolations -----------------------------------------------------

test("assertNoViolations: no-op when there are no violations", () => {
  assert.doesNotThrow(() => assertNoViolations([]))
})

test("assertNoViolations: throws listing every violation when non-empty", () => {
  assert.throws(
    () =>
      assertNoViolations([
        { kind: "pageerror", detail: "boom 1" },
        { kind: "response", detail: "500 GET /api" },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.match(err.message, /2 unexpected browser error/)
      assert.match(err.message, /pageerror: boom 1/)
      assert.match(err.message, /response: 500 GET \/api/)
      return true
    },
  )
})
