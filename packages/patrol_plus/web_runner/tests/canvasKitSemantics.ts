// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import type { Page } from "playwright"
import { logger } from "./logger"

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
 * Safe to call unconditionally: on the HTML renderer (where real DOM already
 * exists and no placeholder is ever inserted) this resolves to `false`
 * without throwing, so callers never need to branch on renderer choice.
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
