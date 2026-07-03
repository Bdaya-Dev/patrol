import type { CDPSession, Page } from "playwright"
import type { SetLocaleRequest } from "../contracts"
// NOTE: unlike sibling actions (tap.ts, resizeWindow.ts, …), these two
// relative imports carry an explicit `.ts` extension. setLocale.test.ts
// imports this file directly and runs under `node --test
// --experimental-strip-types`, whose ESM resolver — unlike Playwright's own
// TS bundler, which also loads this file via actions.ts — requires fully
// specified relative import paths. Playwright resolves the `.ts` extension
// here fine too (verified via `playwright test --list`), so this is safe for
// both callers.
import { logger } from "../logger.ts"
import { assertNonEmptyLocale } from "../localeValidation.ts"

/**
 * F-D — in-flow `setLocale` native action
 * (patrol-visual-review-overhaul-DESIGN.md §2).
 *
 * Playwright's `BrowserContext.locale` option (consumed via `resolveLocale.ts`
 * in `playwright.config.ts`) only applies at browser-context creation time —
 * there is no Playwright API to change it on an already-open page. Invora's
 * flows work around this today by switching locale through app-internal DI
 * state (`getIt<BdayaAppThemeServiceBase>().locale.$ = …`,
 * `patrol_test/flows/ux_nav_flow_test.dart:167`), which only exercises the
 * app's own locale-plumbing, not what a real user does (change the browser's
 * language) — and isn't reusable by fork-level fixtures that have no such DI
 * container.
 *
 * The Flutter web engine's locale support (flutter/engine#18137, "Implement
 * locale, locales, and onLocaleChanged for the web") listens for the DOM
 * `languagechange` event and, on every firing, recomputes
 * `PlatformDispatcher.locale`/`locales` by reading `navigator.languages`
 * directly (`parseBrowserLanguages()` in `platform_dispatcher.dart`) — which
 * is what drives a `Localizations` rebuild. So the action needs to make TWO
 * things true at once: `navigator.language`/`navigator.languages` report the
 * new locale, and a `languagechange` event fires afterwards.
 *
 * `navigator.language`/`navigator.languages` turn out to be the hard part.
 * The obvious approach — Chromium's `Emulation.setUserAgentOverride`
 * `acceptLanguage` field, which is exactly what Playwright's own
 * `BrowserContext.locale` option uses under the hood
 * (`playwright-core/lib/server/chromium/crPage.js`, `_updateUserAgent()`) —
 * does NOT take effect until the next navigation. Verified empirically
 * (headless Chromium via this package's own `playwright` dependency): after
 * `Emulation.setUserAgentOverride({ acceptLanguage: "ar-SA" })` on an
 * already-loaded page, `navigator.language` still reports the original
 * value — even after manually dispatching `languagechange` — and only
 * updates after a `page.reload()`. Chromium computes `navigator.language`/
 * `navigator.languages` once at document-commit time from that header state
 * and does not live-refresh them from a CDP override; a reload is exactly
 * what "in-flow" (mid-test, no reload) rules out. `Emulation.setLocaleOverride`
 * (https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setLocaleOverride)
 * — what an earlier revision of this action used alone — is a red herring
 * for this specific purpose: also verified empirically, it changes what
 * `Intl.*` (`Intl.DateTimeFormat`, `Intl.NumberFormat`, …) and `Date`
 * formatting report, but it does not touch `navigator.language`/
 * `navigator.languages` at all, at any point. Using only
 * `setLocaleOverride` — as the earlier revision did — therefore left the
 * exact value the Flutter engine reads on `languagechange`
 * (`navigator.languages`) completely unchanged, making the action a silent
 * no-op for actual app locale switching regardless of CDP session lifetime.
 *
 * The fix that actually works in-flow, without a reload: define own
 * accessor properties for `language`/`languages` directly on the live
 * `navigator` object of the current document (`overrideNavigatorLocale`
 * below), which — unlike the CDP-level override — takes effect immediately
 * because it doesn't route through Chromium's cached-at-commit header state
 * at all. This is the same class of technique headless-browser-detection
 * evasion tooling (e.g. puppeteer-extra-plugin-stealth) uses to spoof
 * `navigator.*` properties live. `Emulation.setLocaleOverride` is kept
 * alongside it so `Intl`/`Date` formatting — which regulation/VAT flows
 * also depend on — tracks the same locale.
 *
 * `Emulation.*` CDP overrides are additionally SESSION-scoped: detaching the
 * session that applied one immediately reverts it. This action keeps one CDP
 * session per `Page`, created lazily and detached only when the page itself
 * closes (`getPersistentCDPSession` below), rather than the call-scoped
 * create-then-detach-in-`finally` pattern an earlier revision used — which
 * detached before dispatching `languagechange`, reverting the (Intl-only)
 * override before any listener had a chance to read it.
 *
 * The web runner only ever launches Chromium (`tests/setup.ts`), so the CDP
 * dependency is safe unconditionally.
 */

const cdpSessions = new WeakMap<Page, Promise<CDPSession>>()

function getPersistentCDPSession(page: Page): Promise<CDPSession> {
  const cached = cdpSessions.get(page)
  if (cached) return cached

  const sessionPromise = page.context().newCDPSession(page)
  cdpSessions.set(page, sessionPromise)

  sessionPromise.then(
    client => {
      // Detach when (and only when) the page itself closes, so the override
      // survives for the whole remaining life of the page rather than being
      // torn down after a single `setLocale` call.
      page.once("close", () => {
        cdpSessions.delete(page)
        client.detach().catch(() => {
          // The page is already closed by this point — its CDP session is
          // torn down along with it regardless.
        })
      })
    },
    () => {
      // newCDPSession itself failed — nothing to detach. Drop the cached
      // rejection so a subsequent call retries instead of replaying the same
      // failure for the rest of the page's life.
      cdpSessions.delete(page)
    },
  )

  return sessionPromise
}

/**
 * Runs inside the page (see doc comment above for why). Defines own
 * `language`/`languages` accessors directly on the live `navigator` object —
 * shadowing the prototype accessors Chromium would otherwise serve from its
 * document-commit-time header state — then dispatches `languagechange` so
 * any listener (the Flutter web engine's included) picks the new value up
 * immediately. `configurable: true` so a later `setLocale` call in the same
 * flow can redefine these again rather than throwing.
 */
function overrideNavigatorLocale(locale: string) {
  Object.defineProperty(window.navigator, "language", {
    get: () => locale,
    configurable: true,
  })
  Object.defineProperty(window.navigator, "languages", {
    get: () => [locale],
    configurable: true,
  })
  window.dispatchEvent(new Event("languagechange"))
}

export async function setLocale(page: Page, params: SetLocaleRequest["params"]) {
  const { locale } = params
  assertNonEmptyLocale(locale)

  // Intl/Date/Number formatting — live-effective without a reload (unlike
  // navigator.language/languages, see doc comment above).
  const client = await getPersistentCDPSession(page)
  await client.send("Emulation.setLocaleOverride", { locale })

  // navigator.language/navigator.languages — what the Flutter web engine
  // actually reads on `languagechange`. Also dispatches the event itself,
  // so both effects observably land together from the caller's perspective.
  await page.evaluate(overrideNavigatorLocale, locale)

  logger.info(`Locale set to ${locale}`)
}
