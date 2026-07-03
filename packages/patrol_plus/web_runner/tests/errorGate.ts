import type { ConsoleMessage, Page, Request, Response } from "playwright"

/**
 * F-B — web error gate. Promotes the harness's console/pageerror observation
 * (previously log-only, see setupPage in test.spec.ts) into a hard test
 * assertion, ported from the four channels of the `.mjs` visual-review stack's
 * `flows/error-surfacing.mjs`:
 *
 *   - console  — a Dart `Logger` record at SEVERE/SHOUT rendered to the
 *                browser console, OR a genuine `console.error` call.
 *   - pageerror     — an uncaught JS exception that escaped to `window`.
 *   - requestfailed — a network request that never completed (DNS/conn/abort),
 *                     excluding `ERR_ABORTED` (routine for SPA navigations that
 *                     supersede an in-flight fetch).
 *   - response      — an HTTP response with status >= 400, excluding `.map`
 *                     and `favicon.ico` noise from the static dev server.
 *
 * Unlike the app-specific `.mjs` version, this fork-level port does not
 * hardcode Invora's localized toast text — callers allowlist expected error
 * substrings via [ErrorGateConfig.allowlist] instead (`--web-error-allow` /
 * `PATROL_WEB_ERROR_ALLOW`).
 */

export type ErrorGateConfig = {
  /** Master switch. When false, [attachErrorGate] attaches no listeners. */
  enabled: boolean
  /**
   * Allowlist of substrings (case-insensitive). A detected error whose
   * detail text contains any entry is ignored rather than recorded as a
   * violation.
   */
  allowlist: string[]
}

export type ErrorViolation = {
  /** Which channel produced this violation: console(...), pageerror, requestfailed, response. */
  kind: string
  /** Human-readable detail text, truncated to keep failure messages readable. */
  detail: string
}

export type ErrorGateHandle = {
  /** Violations recorded so far. Mutated in place as events arrive. */
  violations: ErrorViolation[]
  /** Removes all listeners this gate attached to the page. */
  dispose: () => void
}

/**
 * Parses a comma-separated allowlist (the value of --web-error-allow /
 * PATROL_WEB_ERROR_ALLOW) into a normalised array: trimmed, with empties
 * dropped. Case is preserved on the returned entries — matching in
 * [isAllowlisted] is case-insensitive regardless.
 */
export function parseAllowList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
}

/**
 * True when [detail] contains any [allowlist] entry, case-insensitively.
 */
export function isAllowlisted(detail: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false
  const lower = detail.toLowerCase()
  return allowlist.some(entry => lower.includes(entry.toLowerCase()))
}

// Dart `package:logging` level names at or above SEVERE. The bdaya-style
// logging handler used across Bdaya/Invora Flutter apps renders the level as
// `[${record.level.name}]`, so these appear as `[SEVERE]` / `[SHOUT]` in the
// console text. This is a generic Dart-logging convention, not app-specific.
const DART_ERROR_LEVELS = ["SEVERE", "SHOUT"]

// A bracketed Dart log level like `[SEVERE]` / `[WARNING]` anywhere in the line.
const LEVEL_TOKEN = /\[(SHOUT|SEVERE|WARNING|INFO|CONFIG|FINE|FINER|FINEST|ALL)\]/

/**
 * Classifies ONE console record. Returns a short tag explaining why the
 * record is treated as an error, or null when it is not one.
 *
 *   type — the Playwright ConsoleMessage type ('error', 'warning', 'log', …).
 *   text — the rendered console text (joined args).
 */
export function classifyConsole(type: string, text: string): string | null {
  const t = text || ""
  const lvl = t.match(LEVEL_TOKEN)
  if (lvl && DART_ERROR_LEVELS.includes(lvl[1])) return `dart:${lvl[1]}`
  // A genuine console.error is an error, unless it's carrying an explicitly
  // lower Dart level (e.g. a WARNING the engine routed to stderr).
  if (type === "error" && !(lvl && !DART_ERROR_LEVELS.includes(lvl[1]))) return "console.error"
  return null
}

/**
 * Attaches the four error-surfacing channels to [page] and collects
 * violations (after allowlist filtering) into the returned handle. When
 * [config.enabled] is false, no listeners are attached and the returned
 * `violations` array stays empty for the page's lifetime.
 */
export function attachErrorGate(page: Page, config: ErrorGateConfig): ErrorGateHandle {
  const violations: ErrorViolation[] = []

  if (!config.enabled) {
    return { violations, dispose: () => {} }
  }

  const record = (kind: string, rawDetail: string) => {
    const detail = rawDetail.replace(/\s+/g, " ").trim().slice(0, 600)
    if (isAllowlisted(detail, config.allowlist)) return
    violations.push({ kind, detail })
  }

  const onConsole = (message: ConsoleMessage) => {
    const tag = classifyConsole(message.type(), message.text())
    if (tag) record(`console(${tag})`, message.text())
  }

  const onPageError = (error: Error) => {
    record("pageerror", error.stack ?? error.message)
  }

  const onRequestFailed = (request: Request) => {
    const failureText = request.failure()?.errorText ?? "failed"
    // Chromium reports ERR_ABORTED for navigations an SPA supersedes — routine
    // for a Flutter app (route change cancels the prior fetch), not an error.
    if (/ERR_ABORTED/i.test(failureText)) return
    record("requestfailed", `${request.method()} ${request.url()} -> ${failureText}`)
  }

  const onResponse = (response: Response) => {
    const status = response.status()
    if (status < 400) return
    const url = response.url()
    // Source-map and favicon 404s on the static dev server are noise, not app
    // errors — the served bundle strips .map files and may lack a favicon.
    if (/\.map(\?|$)/.test(url) || /favicon\.ico(\?|$)/.test(url)) return
    record("response", `${status} ${response.request().method()} ${url}`)
  }

  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  page.on("requestfailed", onRequestFailed)
  page.on("response", onResponse)

  const dispose = () => {
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
    page.off("requestfailed", onRequestFailed)
    page.off("response", onResponse)
  }

  return { violations, dispose }
}

/**
 * Throws when [violations] is non-empty, with a message listing every
 * recorded violation. Intended to run after a test body completes so the
 * throw fails that test (see the `page` fixture teardown in test.spec.ts).
 */
export function assertNoViolations(violations: ErrorViolation[]): void {
  if (violations.length === 0) return
  const summary = violations.map(v => `  - ${v.kind}: ${v.detail}`).join("\n")
  throw new Error(
    `Web error gate: ${violations.length} unexpected browser error(s) detected:\n${summary}\n` +
      "Allowlist expected errors via --web-error-allow / PATROL_WEB_ERROR_ALLOW.",
  )
}
