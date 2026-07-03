import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { resizeWindow } from "./resizeWindow.ts"
import { setLocale } from "./setLocale.ts"

/**
 * F-D — browser-level fork test
 * (patrol-visual-review-overhaul-DESIGN.md §2, "Fork test plan: fixture that
 * resizes and switches locale mid-flow; assert no semantics error and that
 * subsequent finders still resolve.").
 *
 * `resizeWindow.test.ts` / `setLocale.test.ts` exercise only pure decision
 * logic (`resizeSettle.ts` / `localeValidation.ts`) plus a `FakePage`/
 * `FakeCDPSession` stand-in for `setLocale`'s CDP wiring. Neither touches a
 * real browser, so neither could have caught (or can regress-guard) either
 * bug fixed alongside this test: (1) `Emulation.*` overrides are
 * session-scoped in real Chromium — a behaviour a FakePage cannot model —
 * and (2) more fundamentally, `Emulation.setLocaleOverride` alone (what an
 * earlier revision of `setLocale.ts` used) never touches
 * `navigator.language`/`navigator.languages` at all — only `Intl`/`Date`
 * formatting — so it was a silent no-op for the exact value the Flutter web
 * engine reads on `languagechange`. This test caught (2) live during
 * development: see `setLocale.ts`'s doc comment for the full empirical
 * writeup and the fix (defining own `navigator.language`/`languages`
 * accessors directly in-page instead of relying on a CDP override).
 *
 * This drives a REAL Chromium page via `playwright` (the same browser
 * dependency `tests/setup.ts` launches for the full harness — nothing new
 * added) against the minimal static fixture at
 * `../fixtures/inFlowFixture.html`, loaded with `page.setContent(...)`. The
 * full `tests/test.spec.ts` harness cannot be reused here: it requires a
 * live, dev-server-served Flutter build via `globalSetup`
 * (`tests/setup.ts` throws if `baseURL` is unset), which this repo cannot
 * provide standalone. The fixture stands in for the two pieces of real app
 * behaviour these actions depend on — see the fixture file's own comment
 * for why a plain FakePage/mock DOM can't substitute for either:
 *   - a `languagechange` listener (stand-in for the Flutter web engine's
 *     `PlatformDispatcher.locale` recompute);
 *   - `<flt-semantics>` elements that lag a resize before repositioning
 *     (stand-in for CanvasKit's real async semantics-DOM re-layout).
 *
 * Run via `node --test --experimental-strip-types` alongside the rest of the
 * suite (wired into `package.json`'s `test` script) — no Playwright Test
 * runner, no `BASE_URL`, no built app required.
 */

const fixtureHtml = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "inFlowFixture.html"),
  "utf8",
)

test("in-flow setLocale + resizeWindow: locale override survives past the action call; resize leaves semantics settled and finders resolving", async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())

  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  t.after(() => page.close())

  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", error => pageErrors.push(error.message))

  await page.setContent(fixtureHtml, { waitUntil: "load" })

  // ---- mid-flow setLocale (regression guard) ---------------------------------
  await setLocale(page, { locale: "ar-SA" })

  // Read AFTER the action has fully returned, not merely inside its own
  // `languagechange` dispatch. This is exactly what a silent no-op would
  // fail on two different fronts: (1) if `setLocale` only sent
  // `Emulation.setLocaleOverride` (an earlier revision's bug), Chromium
  // never updates `navigator.languages` from that call at all, at any
  // point — this assertion would read back the original browser locale
  // regardless of timing; (2) if the CDP session used for `Intl`/`Date`
  // formatting had already been detached by the time `setLocale` returns,
  // that (separate) override would have reverted too.
  const languagesAfterAction = await page.evaluate(() => navigator.languages)
  assert.equal(languagesAfterAction[0], "ar-SA")

  // The fixture's own `languagechange` listener — standing in for the
  // Flutter engine's locale recompute — must have actually observed the
  // override too, confirming the event fired while the override was live.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fixtureObservedLocale = await page.evaluate(() => (window as any).__fixtureLocaleLog.at(-1))
  assert.equal(fixtureObservedLocale, "ar-SA")

  // ---- mid-flow resize (R2 / "CanvasKit mid-test resize semantics error") ---
  // The fixture's <flt-semantics> stand-ins lag the resize by ~100ms before
  // repositioning (see fixture comment) — this only settles within bounds if
  // resizeWindow genuinely waits for it rather than firing-and-forgetting.
  await resizeWindow(page, { width: 400, height: 300 })

  const semanticsRects = await page.evaluate(() =>
    Array.from(document.querySelectorAll("flt-semantics")).map(el => {
      const rect = (el as HTMLElement).getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }),
  )
  assert.ok(semanticsRects.length > 0, "fixture did not render any <flt-semantics> nodes")
  for (const rect of semanticsRects) {
    assert.ok(
      rect.left <= 400 && rect.top <= 300,
      `semantics node not settled to the new 400x300 viewport: ${JSON.stringify(rect)}`,
    )
  }

  // A finder still resolves after the mid-flow resize — the concrete
  // regression the design's R2 risk describes (a native binding call
  // racing ahead of the engine's resize handling, leaving a subsequent
  // `$.native.tap(...)`/finder looking at a stale or inconsistent DOM).
  const targetButton = await page.$("#in-flow-target")
  assert.ok(targetButton, "finder for #in-flow-target did not resolve after the mid-flow resize")
  assert.equal(await targetButton?.isVisible(), true)

  // No semantics/runtime error surfaced anywhere in the flow.
  assert.deepEqual(consoleErrors, [], `unexpected browser console errors: ${consoleErrors.join("; ")}`)
  assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`)
})
