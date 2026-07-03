import type { Page } from "playwright"
import type { ResizeWindowRequest } from "../contracts"
// NOTE: explicit `.ts` extensions — see setLocale.ts's identical note.
// inFlowSafety.browser.test.ts now imports this file directly and runs
// under `node --test --experimental-strip-types`, whose ESM resolver
// requires fully specified relative import paths; Playwright's own TS
// bundler (which also loads this file via actions.ts) resolves the `.ts`
// extension fine too, so this is safe for both callers.
import { logger } from "../logger.ts"
import { resolveResizeSettleTimeoutMs } from "../resizeSettle.ts"

/**
 * F-D — in-flow-safe resize (patrol-visual-review-overhaul-DESIGN.md §2, R2).
 *
 * Before this change, `resizeWindow` was a bare `page.setViewportSize(...)`
 * that returned as soon as Chromium's viewport metrics were updated — before
 * the Flutter web engine had necessarily reacted to the new size. Callers
 * that resize mid-flow (rather than before the app boots) can then race the
 * engine's own resize handling: `page.setViewportSize` triggers a browser
 * `resize` event, which the Flutter web engine's `EnginePlatformDispatcher`
 * consumes to recompute `PlatformDispatcher.onMetricsChanged` (relayout +,
 * if accessibility is active, a fresh semantics-DOM flush). A native binding
 * call that hands control back to the caller before that settles lets a
 * subsequent `$.native.tap(...)` (or other DOM-selector action) run against
 * a still-stale semantics overlay positioned for the old viewport — this is
 * the "CanvasKit mid-test resize semantics error" the design's R2 risk and
 * Invora's `patrol_test/helpers/screen_sizes.dart` (`setInitialScreenSize`/
 * `withScreenSize`) work around today by only ever resizing before boot.
 *
 * This hardens the action to wait for an observable settle instead of firing
 * and forgetting:
 *   1. resize the Playwright viewport;
 *   2. defensively dispatch a DOM `resize` event (belt-and-suspenders in case
 *      the native event lags the CDP-level metrics change on a given CI
 *      runner);
 *   3. wait for the page to actually observe the new `innerWidth`/`innerHeight`;
 *   4. wait two animation frames, so any relayout the metrics change
 *      scheduled has had a chance to run and paint;
 *   5. if the CanvasKit accessibility DOM overlay is already active (i.e. the
 *      flow already triggered the `flt-semantics-placeholder` "Enable
 *      accessibility" gesture — see
 *      https://docs.flutter.dev/ui/accessibility/web-accessibility), wait
 *      until every rendered `flt-semantics` node's box is compatible with the
 *      new viewport bounds, i.e. no longer carries pre-resize geometry
 *      (the exact predicate is specified and unit-tested as
 *      `isSemanticsTreeSettled` in `../resizeSettle.ts`; it is re-implemented
 *      inline below because Playwright serializes `waitForFunction`
 *      callbacks to run inside the page, where they cannot reference this
 *      module's imports). Flows that never activate accessibility (the
 *      common case) skip this step entirely, since there is nothing to
 *      re-sync.
 *
 * Every wait is bounded and best-effort: a timeout logs a warning and lets
 * the action return rather than hanging or failing the test outright, since
 * a small number of legitimate configurations (e.g. a scrollbar-reserving
 * headless profile) can keep `innerWidth`/`innerHeight` from ever matching
 * the requested size exactly.
 */
export async function resizeWindow(page: Page, params: ResizeWindowRequest["params"]) {
  const { width, height } = params
  const settleTimeoutMs = resolveResizeSettleTimeoutMs()

  await page.setViewportSize({ width, height })

  await page.evaluate(() => window.dispatchEvent(new Event("resize"))).catch(() => {
    // Best-effort — the page may be mid-navigation. The waits below are the
    // real gate; a failed synthetic dispatch here is not fatal on its own.
  })

  await page
    .waitForFunction(
      ([w, h]) => window.innerWidth === w && window.innerHeight === h,
      [width, height],
      { timeout: settleTimeoutMs },
    )
    .catch(() => {
      logger.warn(
        `resizeWindow: viewport did not report exactly ${width}x${height} within ${settleTimeoutMs}ms — continuing`,
      )
    })

  // Two animation frames: the first is typically where the browser observes
  // the new metrics and schedules relayout; the second is where that
  // relayout/repaint (and, for Flutter, the semantics DOM update it can
  // trigger) actually lands.
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )

  // Mirrors isSemanticsTreeSettled() in ../resizeSettle.ts — see that
  // module's doc comment for why the logic is duplicated here, and for the
  // known shrink-only limitation of this predicate (it cannot detect stale
  // semantics geometry on a GROW resize).
  await page
    .waitForFunction(
      ([w, h]) => {
        const nodes = Array.from(document.querySelectorAll("flt-semantics"))
        if (nodes.length === 0) return true // accessibility not active — nothing to re-sync
        for (const node of nodes) {
          const rect = (node as HTMLElement).getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) continue
          if (rect.left > w || rect.top > h) return false
        }
        return true
      },
      [width, height],
      { timeout: settleTimeoutMs },
    )
    .catch(() => {
      logger.warn(
        `resizeWindow: semantics DOM overlay did not settle to ${width}x${height} within ${settleTimeoutMs}ms — continuing`,
      )
    })

  logger.info(`Window resized to ${width}x${height}`)
}
