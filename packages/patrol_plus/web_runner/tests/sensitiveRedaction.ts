// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import type { Page } from "playwright"

/**
 * On-by-default artifact secret redaction. A `--web-auth-flow` /
 * `--web-auth-flow-module` run types REAL credentials into a real login
 * page, and that page is captured in the SAME screenshot/video the run
 * produces for debugging — nothing masked it before this.
 *
 * Playwright's own `page.screenshot({ mask })` only covers explicit,
 * one-shot screenshot calls: there is no `mask` for the automatic
 * on-failure screenshot (`use.screenshot`'s object form takes only
 * `mode`/`fullPage`/`omitBackground` — confirmed against the installed
 * `playwright-core` type definitions, 2026-10-27), and none for video.
 * Ordinary CSS styling of the matched element (`color`, `background`, a
 * `::after` overlay) is ALSO not a general solution: Flutter's CanvasKit
 * renderer paints real pixels onto one big `<canvas>`, and the DOM node at
 * that screen position (if any — a semantics node, only present once
 * accessibility is enabled) carries no visual content of its own for CSS to
 * touch. Styling it changes nothing about what the canvas keeps painting
 * underneath.
 *
 * What DOES work regardless of renderer: a SEPARATE, newly-created DOM
 * element, absolutely positioned over the matched element's own
 * `getBoundingClientRect()`, with a solid opaque background and a z-index
 * above everything else. That overlay is real, on-screen, composited
 * content — it appears in every screenshot (automatic or manual) and every
 * video frame, because both capture what the browser actually renders, not
 * what any one element's own CSS says. A `requestAnimationFrame` loop keeps
 * each overlay box's position synced to its target (handles scroll, resize,
 * and re-layout) and prunes boxes for elements that disappear.
 *
 * Deliberately does NOT cover `--web-trace`: Playwright's trace records
 * action arguments (e.g. a `fill()` call's string value) and DOM snapshots
 * verbatim, as structured JSON/HTML in the trace archive, not as rendered
 * pixels — there is no supported way to intercept or redact those from
 * inside the page, which is all this overlay technique has access to. A
 * password typed during `--web-auth-flow(-module)` is masked in every
 * screenshot/video but still appears in a `--web-trace` in plaintext.
 * `test.dart` warns when the two are combined.
 */

export const DEFAULT_SENSITIVE_SELECTORS = ['input[type="password"]']
export const DEFAULT_REDACT_COLOR = "#FF00FF"

/**
 * Merges [customSelectorsJson] (a JSON array of CSS selector strings, or
 * undefined) with [DEFAULT_SENSITIVE_SELECTORS]. Malformed JSON throws —
 * matches this codebase's existing fail-fast posture for malformed
 * `--web-*` JSON options (see `envJson` in playwright.config.ts) rather
 * than silently running with fewer selectors than the caller asked for.
 */
export function parseRedactSelectors(customSelectorsJson: string | undefined): string[] {
  if (!customSelectorsJson) {
    return [...DEFAULT_SENSITIVE_SELECTORS]
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(customSelectorsJson)
  } catch (err) {
    throw new Error(`PATROL_WEB_REDACT_SELECTORS must be a valid JSON array of strings: ${String(err)}`)
  }

  if (!Array.isArray(parsed) || !parsed.every(entry => typeof entry === "string")) {
    throw new Error("PATROL_WEB_REDACT_SELECTORS must be a JSON array of strings")
  }

  // Dedupe while preserving the defaults-first order — a caller-repeated
  // default is a no-op, not a second overlay drawn on the same element.
  return [...new Set([...DEFAULT_SENSITIVE_SELECTORS, ...(parsed as string[])])]
}

/**
 * Validates every entry in [selectors] as real CSS by asking the PAGE to try
 * `querySelectorAll` on each one individually (document.querySelectorAll
 * throws SyntaxError on invalid selector syntax regardless of what's in the
 * DOM — this works even on `about:blank`, before any real navigation).
 *
 * Throws, naming every invalid entry, if any selector is malformed — this is
 * the fail-fast behaviour `test.spec.ts`'s own comment already promises
 * ("a malformed --web-redact-selector must break the run loudly"), which
 * nothing previously enforced: a bad selector used to reach the page and
 * silently disable ALL masking there (see [installSensitiveRedaction]'s own
 * per-selector querying for the second half of that fix).
 */
export async function validateSelectorsOrThrow(page: Page, selectors: string[]): Promise<void> {
  const invalid = await page.evaluate(selectors => {
    const bad: string[] = []
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector)
      } catch (err) {
        bad.push(`"${selector}" (${String(err)})`)
      }
    }
    return bad
  }, selectors)

  if (invalid.length > 0) {
    throw new Error(
      `--web-redact-selector contains invalid CSS selector(s): ${invalid.join(", ")}. ` +
        "Fix or remove the invalid entry/entries -- a malformed selector must break the run, " +
        "not silently disable redaction for the valid ones.",
    )
  }
}

/**
 * Installs the redaction overlay on [page]. Registered via
 * `page.addInitScript`, so it re-runs on every navigation/reload — same
 * mechanism `tests/setup.ts` and `tests/test.spec.ts` already use for
 * `window.__patrol__isInitialised`, for the same reason: a one-shot
 * `page.evaluate` would not survive the app's own navigation.
 *
 * A no-op when [selectors] is empty (the whole mechanism switched off via
 * `--no-web-redact-artifacts`) — no init script is registered at all, so
 * there is zero runtime cost on a run that doesn't want it.
 */
export async function installSensitiveRedaction(
  page: Page,
  options: { selectors: string[]; maskColor: string },
): Promise<void> {
  const { selectors, maskColor } = options
  if (selectors.length === 0) {
    return
  }

  await validateSelectorsOrThrow(page, selectors)

  await page.addInitScript(
    ({ selectors, maskColor }) => {
      const HOST_ID = "__patrol_redaction_host__"

      function ensureHost(): HTMLElement {
        let host = document.getElementById(HOST_ID)
        if (!host) {
          host = document.createElement("div")
          host.id = HOST_ID
          // Fixed, full-viewport, non-interactive container for the
          // overlay boxes themselves (each box is still individually
          // `position: fixed`, so this element's own box model doesn't
          // matter beyond hosting them and being easy to find/remove).
          host.style.position = "fixed"
          host.style.top = "0"
          host.style.left = "0"
          host.style.width = "0"
          host.style.height = "0"
          host.style.pointerEvents = "none"
          // Above any reasonable app content, including a single
          // CanvasKit canvas (which does not itself set z-index).
          host.style.zIndex = "2147483647"
          document.documentElement.appendChild(host)
        }
        return host
      }

      function sync() {
        if (selectors.length === 0) {
          requestAnimationFrame(sync)
          return
        }

        const host = ensureHost()
        // Query each selector SEPARATELY, not joined into one
        // `querySelectorAll` call: a single bad entry must never suppress
        // masking for the other, valid selectors -- including the default
        // password selector. validateSelectorsOrThrow already rejects a
        // malformed selector before this init script is ever registered;
        // this is defense-in-depth for that invariant, not the primary
        // enforcement of it.
        const seen = new Set<Element>()
        const matched: Element[] = []
        for (const selector of selectors) {
          try {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              if (!seen.has(el)) {
                seen.add(el)
                matched.push(el)
              }
            }
          } catch {
            // Should not happen (validated upfront) -- never let it crash
            // the app under test or block the other selectors.
          }
        }

        // One overlay box per matched element, reused across frames by
        // index rather than recreated, so this never outpaces the
        // element count even on a page with hundreds of matches.
        matched.forEach((el, index) => {
          const rect = el.getBoundingClientRect()
          let box = host.children[index] as HTMLDivElement | undefined
          if (!box) {
            box = document.createElement("div")
            box.style.position = "fixed"
            box.style.background = maskColor
            host.appendChild(box)
          }
          const visible = rect.width > 0 && rect.height > 0
          box.style.display = visible ? "block" : "none"
          if (visible) {
            box.style.left = `${rect.left}px`
            box.style.top = `${rect.top}px`
            box.style.width = `${rect.width}px`
            box.style.height = `${rect.height}px`
          }
        })

        // Prune stale boxes left over from elements that disappeared
        // (e.g. a dialog closed) since the previous frame.
        while (host.children.length > matched.length) {
          const last = host.lastElementChild
          if (!last) break
          host.removeChild(last)
        }

        requestAnimationFrame(sync)
      }

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(sync))
      } else {
        requestAnimationFrame(sync)
      }
    },
    { selectors, maskColor },
  )
}
