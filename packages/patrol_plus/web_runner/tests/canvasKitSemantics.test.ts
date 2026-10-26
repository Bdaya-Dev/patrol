import assert from "node:assert/strict"
import { test } from "node:test"
import type { Locator, Page } from "playwright"
import { createCanvasKitSemanticsCache, enableCanvasKitSemanticsCached } from "./canvasKitSemantics.ts"

/**
 * A minimal fake satisfying only what enableCanvasKitSemantics actually
 * calls (`page.locator(...).waitFor(...)` and `.dispatchEvent(...)`).
 * [onProbe] fires each time `.locator()` is asked for the placeholder --
 * that call count is what proves enableCanvasKitSemanticsCached's whole
 * point: skipping the real probe (and its timeout) once a worker already
 * knows the answer.
 */
function fakePage(opts: { hasPlaceholder: boolean; onProbe: () => void }): Page {
  const locator = {
    waitFor: async () => {
      if (!opts.hasPlaceholder) {
        throw new Error("Timeout waiting for flt-semantics-placeholder")
      }
    },
    dispatchEvent: async () => {},
  } as unknown as Locator
  return {
    locator: () => {
      opts.onProbe()
      return locator
    },
  } as unknown as Page
}

test("enableCanvasKitSemanticsCached: HTML renderer (no placeholder) probes once per worker, not once per call", async () => {
  let probeCalls = 0
  const page = fakePage({ hasPlaceholder: false, onProbe: () => probeCalls++ })
  const cache = createCanvasKitSemanticsCache()

  // Use a near-zero timeout -- the real timeout value doesn't matter to
  // this test, only that the underlying probe is attempted or skipped.
  const first = await enableCanvasKitSemanticsCached(page, cache, 1)
  const second = await enableCanvasKitSemanticsCached(page, cache, 1)
  const third = await enableCanvasKitSemanticsCached(page, cache, 1)

  assert.equal(first, false)
  assert.equal(second, false)
  assert.equal(third, false)
  // The regression this guards against: without the cache, every call
  // probes (and on a real page, pays the full timeout) again.
  assert.equal(probeCalls, 1, "expected the underlying probe to run exactly once across the worker")
})

test("enableCanvasKitSemanticsCached: CanvasKit (placeholder present) probes on every call", async () => {
  let probeCalls = 0
  const page = fakePage({ hasPlaceholder: true, onProbe: () => probeCalls++ })
  const cache = createCanvasKitSemanticsCache()

  const first = await enableCanvasKitSemanticsCached(page, cache, 1)
  const second = await enableCanvasKitSemanticsCached(page, cache, 1)

  assert.equal(first, true)
  assert.equal(second, true)
  // Each test gets its own page/navigation, so the click must be
  // re-applied every time -- only the doomed-to-fail (HTML renderer) case
  // is short-circuited.
  assert.equal(probeCalls, 2)
})
