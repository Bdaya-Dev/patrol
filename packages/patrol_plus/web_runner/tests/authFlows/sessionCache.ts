import * as fs from "fs"
import * as path from "path"
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
 * Structural validation for a value loaded from disk: only `cookies` and
 * `origins` as arrays are required (mirrors `storageState()`'s actual return
 * shape). Rejects `{}`, `null`, arrays, or anything else that JSON.parse can
 * legally produce but that isn't a usable session — an empty/malformed
 * on-disk file must degrade to "do the real login", never to "restore an
 * empty session and skip login".
 */
function isCachedSession(value: unknown): value is CachedSession {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<CachedSession>
  return Array.isArray(candidate.cookies) && Array.isArray(candidate.origins)
}

/**
 * `true` when [session] actually carries some auth data (at least one cookie
 * or one per-origin localStorage entry). A structurally-valid but empty
 * session (`{ cookies: [], origins: [] }` — e.g. captured before any login
 * happened) must NOT be treated as "already authenticated, skip login": the
 * call site should gate on this, not on `cachedSession` truthiness alone.
 */
export function hasSessionData(session: CachedSession): boolean {
  if (session.cookies.length > 0) return true
  return session.origins.some(origin => origin.localStorage.length > 0)
}

/**
 * Loads a previously-saved [CachedSession] from disk. Returns `null` when
 * the file is absent, unreadable, not valid JSON, or doesn't structurally
 * look like a `storageState()` result (see [isCachedSession]) — this NEVER
 * throws, so a missing/corrupt/malformed cache degrades to "do the real
 * login" rather than blocking the run.
 */
export function loadCachedSession(filePath: string): CachedSession | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed: unknown = JSON.parse(raw)
    return isCachedSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Captures [page]'s current browser-context storage state (cookies +
 * per-origin localStorage — see
 * https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state)
 * and persists it to [filePath] as JSON, for later reuse by
 * [restoreCachedSession] in a different test within the same run. Creates
 * [filePath]'s parent directory if it doesn't already exist (e.g. a nested
 * `.auth/web-state.json` path in a fresh checkout).
 */
export async function saveCachedSession(page: Page, filePath: string): Promise<void> {
  const state = await page.context().storageState()
  const dir = path.dirname(filePath)
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true })
  }
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
