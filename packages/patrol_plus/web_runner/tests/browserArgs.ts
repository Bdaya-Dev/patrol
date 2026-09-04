/**
 * Chromium switches Patrol always launches with, before any user-supplied args.
 *
 * Chromium throttles timers (to ~1 Hz) and deprioritises rendering for tabs and
 * windows it considers backgrounded or occluded. Patrol defaults to a headed
 * browser (see `headless` in playwright.config.ts), so on a developer machine the
 * test window is routinely covered by a terminal or IDE, and on some CI runners
 * the compositor never reports the window as visible at all. Under that
 * throttling Flutter's frame scheduler, `Future.delayed`-based waits, and
 * Patrol's own polling all slow to a crawl: tests that pass when the window is
 * in the foreground time out when it is not. Disabling backgrounding makes
 * timing independent of window visibility.
 */
export const DEFAULT_BROWSER_ARGS: readonly string[] = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
]

/**
 * Resolves the Chromium launch args: [DEFAULT_BROWSER_ARGS] followed by the
 * args the caller passed via --web-browser-args / PATROL_WEB_BROWSER_ARGS
 * (a JSON array of strings), without repeating a default the caller also listed.
 */
export function resolveBrowserArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const userArgs = parseUserArgs(env.PATROL_WEB_BROWSER_ARGS)
  return [...DEFAULT_BROWSER_ARGS, ...userArgs.filter(arg => !DEFAULT_BROWSER_ARGS.includes(arg))]
}

function parseUserArgs(raw: string | undefined): string[] {
  if (!raw) return []

  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every(arg => typeof arg === "string")) {
    throw new Error("PATROL_WEB_BROWSER_ARGS must be a JSON array of strings")
  }
  return parsed
}
