// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import type { Page } from "playwright"
import { logger } from "./logger.ts"

/**
 * Flutter's CanvasKit web renderer paints the whole UI onto a single
 * `<canvas>`; there is no real DOM for Playwright (or a screen reader) to
 * query until the engine's accessibility bridge is switched on. Flutter
 * exposes that switch as a nearly-invisible `<flt-semantics-placeholder>`
 * host element: focusing/clicking it tells the engine "a user wants
 * semantics", and only THEN does it start mirroring widgets into real DOM
 * nodes carrying ARIA roles/labels that `page.getByRole()` etc. can see.
 *
 * Every consumer of this fork has had to hand-roll this click (see
 * devops-aggregate's `.claude/rules/00-session-pitfalls.md` #8/#12: "Must
 * JS-click flt-semantics-placeholder to enable accessibility tree.
 * Re-trigger on every navigation."). This makes it a one-line, reusable
 * step instead of a tribal-knowledge workaround repeated per project.
 *
 * Safe to call unconditionally in the sense that it never THROWS: on the
 * HTML renderer (where real DOM already exists and no placeholder is ever
 * inserted) this resolves to `false` instead, so callers never need to
 * branch on renderer choice to stay correct. It is NOT free, though --
 * on the HTML renderer the placeholder never attaches, so this call
 * blocks for the FULL [timeoutMs] every time before giving up. A caller
 * that runs this once per test (as `test.spec.ts` does) and cares about
 * that per-test cost on HTML-renderer apps should use
 * [enableCanvasKitSemanticsCached] instead, which pays the full timeout
 * at most once per worker.
 */
export async function enableCanvasKitSemantics(page: Page, timeoutMs = 15000): Promise<boolean> {
  try {
    const placeholder = page.locator("flt-semantics-placeholder")
    await placeholder.waitFor({ state: "attached", timeout: timeoutMs })
    // The placeholder is intentionally near-invisible and Flutter positions
    // it off-screen on some layouts, so Playwright's default actionability
    // checks (visible, not-obscured, inside the viewport) would never pass
    // on it — `{ force: true }` bypasses visibility/obscured checks but NOT
    // the viewport-bounds one, so it still fails there (confirmed live
    // against a real app, 2026-10-27). dispatchEvent fires the DOM event
    // directly with no actionability checks at all, which is correct here:
    // this element exists ONLY to catch a synthetic "a11y intent" click, not
    // to be a real, user-visible target.
    await placeholder.dispatchEvent("click")
    return true
  } catch (err) {
    logger.warn(
      "[patrol] Could not enable CanvasKit semantics (flt-semantics-placeholder not found/clickable within %dms) — the page may be using the HTML renderer, or is not a Flutter web app: %s",
      timeoutMs,
      String(err),
    )
    return false
  }
}

/**
 * Waits for Flutter's web engine to have mounted its root host element.
 * `flt-glass-pane` is CanvasKit's; `flutter-view` is the newer renderer-
 * agnostic host element name (Flutter 3.29+) — either confirms the engine
 * is up, before any Patrol- or app-specific readiness check runs.
 */
export async function waitForFlutterEngineReady(page: Page, timeoutMs = 60000): Promise<void> {
  await page.waitForSelector("flt-glass-pane, flutter-view", { timeout: timeoutMs })
}

/**
 * Per-worker memo for [enableCanvasKitSemanticsCached]. Create one via
 * [createCanvasKitSemanticsCache] in a `{ scope: "worker" }` fixture and
 * pass the SAME instance to every test in that worker.
 */
export type CanvasKitSemanticsCache = { determined: boolean; supported: boolean }

export function createCanvasKitSemanticsCache(): CanvasKitSemanticsCache {
  return { determined: false, supported: false }
}

/**
 * Same contract as [enableCanvasKitSemantics], but avoids paying the full
 * [timeoutMs] on every test for an app built with the HTML renderer.
 *
 * A single Patrol `test` invocation always serves ONE Flutter web build —
 * `--web-renderer` is a build-time flag, not a per-test choice — so once
 * any test in a worker has established that this build's pages never grow
 * a `<flt-semantics-placeholder>` (i.e. [enableCanvasKitSemantics] returned
 * `false`), every LATER test in that SAME worker can skip the wait
 * entirely instead of re-discovering the same negative result at the same
 * cost. The first call in a worker still pays the real timeout -- there is
 * no way to know the renderer without asking the page at least once.
 */
export async function enableCanvasKitSemanticsCached(
  page: Page,
  cache: CanvasKitSemanticsCache,
  timeoutMs = 15000,
): Promise<boolean> {
  if (cache.determined && !cache.supported) {
    return false
  }
  const enabled = await enableCanvasKitSemantics(page, timeoutMs)
  cache.determined = true
  cache.supported = enabled
  return enabled
}
