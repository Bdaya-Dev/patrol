import assert from "node:assert/strict"
import * as path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium, type Page } from "playwright"
import { installSensitiveRedaction } from "./sensitiveRedaction.ts"

/**
 * Drives a REAL Chromium page (same `playwright` dependency `tests/setup.ts`
 * launches for the full harness — nothing new added) against the minimal
 * static fixture at `../fixtures/sensitiveRedactionFixture.html`.
 *
 * Loaded via `page.goto(file://...)`, NOT `page.setContent(...)` like
 * `inFlowSafety.browser.test.ts` uses for its own fixture — confirmed live,
 * 2026-10-27: `page.addInitScript` (what `installSensitiveRedaction` and the
 * real `tests/setup.ts`/`tests/test.spec.ts` both rely on for
 * `window.__patrol__isInitialised`) never fires for `setContent`-loaded
 * content at all, only for a real navigation. The real web_runner always
 * reaches the app via `page.goto(baseURL)`, so `goto` is also the only
 * faithful way to exercise this code path in a test.
 *
 * Proves "an obscured field never appears unmasked in a captured artifact"
 * the only way that claim can actually be checked: by reading the PIXELS a
 * real screenshot produced (the same pixels a video frame or a trace's
 * visual DOM-snapshot reconstruction would show — all three render the same
 * composited page), not by inspecting DOM text or trusting that a CSS rule
 * was applied. Every region is checked BOTH with redaction off (the
 * control — proves the fixture's secret is genuinely visible/non-uniform
 * absent this feature, so a passing "is masked" assertion isn't vacuous)
 * and on (the fix).
 */

const fixtureUrl = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sensitiveRedactionFixture.html"),
).href

const MASK_COLOR = "#FF00FF"
const MASK_RGB: [number, number, number] = [0xff, 0x00, 0xff]

/**
 * Screenshots the element at [selector], decodes the PNG using the
 * BROWSER's own (real, not reimplemented) PNG decoder via `<img>`/canvas —
 * no Node-side image-parsing dependency needed — and returns every pixel as
 * `[r, g, b, a]`.
 */
async function pixelsOf(page: Page, selector: string): Promise<Array<[number, number, number, number]>> {
  const box = await page.locator(selector).boundingBox()
  if (!box) {
    throw new Error(`${selector}: no bounding box (not visible?)`)
  }
  const buffer = await page.screenshot({ clip: box })
  const base64 = buffer.toString("base64")

  const flat = await page.evaluate(async b64 => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
  }, base64)

  const pixels: Array<[number, number, number, number]> = []
  for (let i = 0; i < flat.length; i += 4) {
    pixels.push([flat[i]!, flat[i + 1]!, flat[i + 2]!, flat[i + 3]!])
  }
  return pixels
}

function isUniformMaskColor(pixels: Array<[number, number, number, number]>): boolean {
  return pixels.every(([r, g, b, a]) => r === MASK_RGB[0] && g === MASK_RGB[1] && b === MASK_RGB[2] && a === 255)
}

test(
  "installSensitiveRedaction: a password input, a displayed-text secret, and a " +
    "CANVAS-PAINTED secret (standing in for Flutter CanvasKit, which paints real " +
    "pixels onto a <canvas> with no visually-styleable DOM node at that position) " +
    "are all fully covered by a solid mask colour in a real screenshot",
  async t => {
    const browser = await chromium.launch()
    t.after(() => browser.close())

    // ---- control: redaction OFF — the fixture's secrets are genuinely
    // visible (not already uniform for some unrelated reason), so a later
    // "is masked" pass isn't trivially true. -------------------------------
    const controlPage = await browser.newPage({ viewport: { width: 400, height: 300 } })
    t.after(() => controlPage.close())
    await controlPage.goto(fixtureUrl, { waitUntil: "load" })

    for (const selector of ["#pw-echo", "#displayed-secret", "#canvas-secret"]) {
      const pixels = await pixelsOf(controlPage, selector)
      assert.ok(!isUniformMaskColor(pixels), `${selector}: control run should NOT already be a uniform mask colour`)
    }

    // ---- fix: redaction ON — every region is now a solid, fully opaque
    // mask-colour box, pixel for pixel. ------------------------------------
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
    t.after(() => page.close())
    await installSensitiveRedaction(page, {
      selectors: ['input[type="password"]', "[data-patrol-sensitive]"],
      maskColor: MASK_COLOR,
    })
    await page.goto(fixtureUrl, { waitUntil: "load" })
    // The overlay is driven by requestAnimationFrame; give it a couple of
    // frames to run before the first screenshot.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

    // The password INPUT itself: default selector, matched directly.
    assert.ok(isUniformMaskColor(await pixelsOf(page, "#pw")), "#pw should be fully masked")

    // The plain displayed-secret div: matched via the custom
    // [data-patrol-sensitive] selector, not the default list.
    assert.ok(isUniformMaskColor(await pixelsOf(page, "#displayed-secret")), "#displayed-secret should be fully masked")

    // The canvas-painted secret: masked via #canvas-proxy, a separate,
    // normally-invisible element positioned exactly over the canvas'
    // painted region — proving the overlay technique works even when the
    // real pixels come from a canvas the matched element has no visual
    // connection to (the CanvasKit case).
    assert.ok(
      isUniformMaskColor(await pixelsOf(page, "#canvas-secret")),
      "#canvas-secret (painted on a <canvas>, masked via the #canvas-proxy sibling) should be fully masked",
    )
  },
)

test("installSensitiveRedaction: selectors=[] is a true no-op (no overlay host is ever created)", async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  t.after(() => page.close())

  await installSensitiveRedaction(page, { selectors: [], maskColor: MASK_COLOR })
  await page.goto(fixtureUrl, { waitUntil: "load" })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const hostExists = await page.evaluate(() => document.getElementById("__patrol_redaction_host__") !== null)
  assert.equal(hostExists, false)
})
