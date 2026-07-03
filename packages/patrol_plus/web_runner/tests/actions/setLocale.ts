import type { Page } from "playwright"
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
 * This action uses the Chromium DevTools Protocol's `Emulation.setLocaleOverride`
 * (https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setLocaleOverride)
 * to override what `navigator.language`/`navigator.languages`/`Intl` report
 * for the live page, then dispatches the DOM `languagechange` event. The
 * Flutter web engine's locale support subscribes to exactly that event to
 * recompute `PlatformDispatcher.locale`/`locales` from `navigator.languages`
 * and invoke `onLocaleChanged` (flutter/engine#18137, "Implement locale,
 * locales, and onLocaleChanged for the web"), which is what drives a
 * `Localizations` rebuild — so an already-booted app picks up the new locale
 * in-flow, without a reload and without any app-internal state dependency.
 *
 * The web runner only ever launches Chromium (`tests/setup.ts`), so the CDP
 * dependency is safe unconditionally.
 */
export async function setLocale(page: Page, params: SetLocaleRequest["params"]) {
  const { locale } = params
  assertNonEmptyLocale(locale)

  const client = await page.context().newCDPSession(page)
  try {
    await client.send("Emulation.setLocaleOverride", { locale })
  } finally {
    await client.detach().catch(() => {
      // The page may already be navigating/closing by the time we detach —
      // the CDP session is torn down with the page regardless.
    })
  }

  await page.evaluate(() => window.dispatchEvent(new Event("languagechange")))

  logger.info(`Locale set to ${locale}`)
}
