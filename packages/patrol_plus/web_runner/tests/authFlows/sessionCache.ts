import * as fs from "fs"
import type { BrowserContext, Page } from "playwright"

/**
 * F-A speed follow-up — Playwright's official "authenticate once, reuse
 * everywhere" pattern (https://playwright.dev/docs/auth), adapted to this
 * harness's single dynamically-generated spec file (there is no clean place
 * here to declare a `*.setup.ts` project dependency, so the capture/restore
 * is done manually instead of via Playwright's project-dependency feature).
 *
 * Only the FIRST page in a `PATROL_WEB_AUTH_STATE_FILE`-scoped run has no
 * cache yet, so it is unconditionally the one that performs the full live
 * IdP round-trip (see `runAuthFlow` in ./oidc.ts) and gets it recorded.
 * Every subsequent page in the same run restores a completed session
 * instead — no extra network round-trip to the identity provider, no form
 * interaction.
 *
 * Confirmed (see invora-flutter's F-A research) that this is safe for OIDC
 * apps whose token/PKCE store lives in `localStorage` (the `secureTokens`
 * namespace of `oidc_default_store` on web, which is what Invora's
 * `RealAuthService` uses) — a fresh page load that discovers valid
 * `localStorage` tokens is exactly the same "re-boot authenticated" path the
 * app already relies on after its own post-redirect reload.
 */
export type CachedSession = Awaited<ReturnType<BrowserContext["storageState"]>>

/**
 * Loads a previously-saved [CachedSession] from disk. Returns `null` when
 * the file is absent, unreadable, or not valid JSON — this NEVER throws, so
 * a missing/corrupt cache degrades to "do the real login" rather than
 * blocking the run.
 */
export function loadCachedSession(filePath: string): CachedSession | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw) as CachedSession
  } catch {
    return null
  }
}

/**
 * Captures [page]'s current browser-context storage state (cookies +
 * per-origin localStorage — see
 * https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state)
 * and persists it to [filePath] as JSON, for later reuse by
 * [restoreCachedSession] in a different test within the same run.
 */
export async function saveCachedSession(page: Page, filePath: string): Promise<void> {
  const state = await page.context().storageState()
  fs.writeFileSync(filePath, JSON.stringify(state))
}

/**
 * Restores a previously-captured [session] onto [page]'s browser context.
 * MUST be called before any navigation on [page] (i.e. before `page.goto()`)
 * so the registered init script fires on the very first document load.
 *
 * Mirrors Playwright's documented session-storage restore recipe
 * (https://playwright.dev/docs/auth#session-storage — `addInitScript` to
 * inject storage into pages of an already-created context), generalised
 * from `sessionStorage` to `localStorage` (the namespace that actually
 * matters for OIDC token continuity here — see this module's doc comment).
 *
 * `browserContext.setStorageState()` (Playwright >= 1.59) would collapse
 * this into a single call once available, but the fork is pinned to
 * Playwright 1.56.0 (`web_runner/package.json`), so the always-available
 * `addCookies` + `addInitScript` pair is used instead.
 */
export async function restoreCachedSession(page: Page, session: CachedSession): Promise<void> {
  if (session.cookies.length > 0) {
    await page.context().addCookies(session.cookies)
  }
  await page.addInitScript(origins => {
    for (const { origin, localStorage } of origins) {
      if (window.location.origin !== origin) continue
      for (const { name, value } of localStorage) {
        window.localStorage.setItem(name, value)
      }
    }
  }, session.origins)
}
