/**
 * F-D — pure settle-decision logic for the in-flow-safe `resizeWindow` native
 * action (patrol-visual-review-overhaul-DESIGN.md §2, R2). Kept dependency-free
 * (no relative imports) so it can be unit-tested directly with `node --test`,
 * the same shape as `resolveLocale.ts` / `filterByTags.ts`. See
 * `actions/resizeWindow.ts` for how these are used against a real `Page`.
 */

const DEFAULT_RESIZE_SETTLE_TIMEOUT_MS = 5000

/**
 * Resolves how long `resizeWindow` waits for its post-resize settle steps,
 * from `PATROL_WEB_RESIZE_SETTLE_TIMEOUT` (milliseconds). Mirrors the
 * `PATROL_WEB_INIT_TIMEOUT` configurability pattern in `initialise.ts` for
 * slow CI runners. Falls back to the default on unset, empty, or
 * non-positive/non-numeric values.
 */
export function resolveResizeSettleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PATROL_WEB_RESIZE_SETTLE_TIMEOUT
  if (!raw) return DEFAULT_RESIZE_SETTLE_TIMEOUT_MS
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESIZE_SETTLE_TIMEOUT_MS
}

export type SemanticsNodeRect = {
  left: number
  top: number
  width: number
  height: number
}

/**
 * True when [rects] (the bounding boxes of every `flt-semantics` node
 * currently in the DOM — the CanvasKit accessibility overlay,
 * https://docs.flutter.dev/ui/accessibility/web-accessibility) are all
 * compatible with a [width]x[height] viewport, i.e. the semantics overlay
 * does not need to re-sync after a resize.
 *
 * An empty list is trivially settled — either accessibility was never
 * activated (nothing to re-sync; the common case, since in-page `$(...)`
 * finders drive the Dart widget tree directly, not the DOM) or every node
 * has already been removed. A zero-sized rect (`width === 0 && height === 0`)
 * is a hidden/pruned node and is ignored regardless of its position. Any
 * other rect whose left/top edge falls outside the new bounds is evidence
 * Flutter has not yet re-laid-out the semantics DOM for the new size.
 *
 * This is the pure predicate the in-browser `waitForFunction` callback in
 * `resizeWindow` mirrors — Playwright serializes `waitForFunction` callbacks
 * to run inside the page, so they cannot call back into this module. Keeping
 * the logic here as a plain, unit-testable function is how that browser-side
 * predicate's intended behaviour is specified and verified without needing a
 * real browser.
 */
export function isSemanticsTreeSettled(rects: SemanticsNodeRect[], width: number, height: number): boolean {
  for (const rect of rects) {
    if (rect.width === 0 && rect.height === 0) continue
    if (rect.left > width || rect.top > height) return false
  }
  return true
}
