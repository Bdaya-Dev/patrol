// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import { pathToFileURL } from "url"
import * as path from "path"
import type { Page } from "playwright"

/**
 * F-URL — deployed-URL smoke mode (`--web-base-url`, see smokeTest.spec.ts).
 *
 * `--web-base-url` points Patrol at a site that is ALREADY deployed and
 * ALREADY serving real traffic (a production bundle, or a preview channel) —
 * there is no local `flutter run`/`flutter build` step, and critically, the
 * served bundle was almost certainly never compiled with the Patrol test
 * harness (`patrolTest()`, `PatrolBinding`, the `__patrol__*` JS hooks).
 * Patrol's native finders (`$.tap()`, `$.native...`) depend entirely on that
 * harness and are therefore UNAVAILABLE in this mode.
 *
 * This mirrors `--web-auth-flow-module`'s escape hatch (see
 * `authFlows/module.ts`'s doc comment for the precedent and rationale): a
 * caller-supplied module path exporting real code that receives the actual
 * Playwright `Page` and drives/asserts whatever it needs, with no
 * declarative-spec or Patrol-finder ceiling. App-specific selectors/URLs
 * belong in the CALLER's module, never in this (generic, app-agnostic) fork.
 */

export type SmokeFlowContext = {
  /** The real Playwright page, already navigated to [baseUrl]. Full API access. */
  page: Page
  /** Structured logger — routes through the same logger every other step uses. */
  log: (msg: string, ...args: unknown[]) => void
  /** The `--web-base-url` value, forwarded for the module's own convenience. */
  baseUrl: string
}

export type SmokeFlow = (ctx: SmokeFlowContext) => Promise<void>

/** One named, independently-reported check (e.g. "queue page loads"). */
export type SmokeScenario = {
  name: string
  run: SmokeFlow
}

/**
 * Runs every [scenario] via [runStep] (the caller passes `(name, fn) =>
 * test.step(name, fn)`), collecting any failure instead of letting it abort
 * the remaining scenarios.
 *
 * `test.step()` re-throws on failure -- that's for report granularity, not
 * isolation, so calling it directly inside a bare `for` loop means every
 * scenario listed AFTER a failing one in --web-smoke-flow-module silently
 * never runs. That contradicts this module's own contract (each scenario
 * "reported as its own step, so one failing check doesn't hide the
 * others"). This function is the fix: each scenario still gets its own
 * step (pass or fail, visible in the report), and once every scenario has
 * had a chance to run, a single aggregate error naming ALL failures is
 * thrown so the overall test still fails -- nothing is silently swallowed.
 * Does nothing (resolves) if every scenario passed.
 *
 * [runStep] is injected (rather than importing `@playwright/test`'s `test`
 * directly) so this aggregation logic is a plain, browser-free unit --
 * see `smokeFlow.test.ts` for the proof.
 */
export async function runScenariosReportingAllFailures(
  scenarios: SmokeScenario[],
  ctx: SmokeFlowContext,
  runStep: (name: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const failures: { name: string; error: unknown }[] = []
  for (const scenario of scenarios) {
    // eslint-disable-next-line no-await-in-loop
    try {
      await runStep(scenario.name, () => scenario.run(ctx))
    } catch (err) {
      failures.push({ name: scenario.name, error: err })
    }
  }
  if (failures.length > 0) {
    const summary = failures
      .map(({ name, error }) => `  - ${name}: ${error instanceof Error ? error.message : String(error)}`)
      .join("\n")
    throw new Error(`${failures.length}/${scenarios.length} smoke scenario(s) failed:\n${summary}`)
  }
}

function isScenario(value: unknown): value is SmokeScenario {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SmokeScenario).name === "string" &&
    typeof (value as SmokeScenario).run === "function"
  )
}

/**
 * Dynamically imports [modulePath] and returns its exported smoke
 * scenario(s). The module may export either:
 *   - a single async function (named `default`) taking
 *     `{ page, log, baseUrl }` — wrapped into one `{ name: "smoke", run }`
 *     scenario; or
 *   - an array of `{ name, run }` scenarios (named `scenarios` or `default`)
 *     — each reported as its own step, so one failing check doesn't hide the
 *     others.
 *
 * Resolves a relative path against `process.cwd()` (the invocation
 * directory, i.e. the Flutter/patrol project root) — mirrors
 * `loadAuthFlowModule`'s treatment of `--web-auth-flow-module` for the same
 * reason: this runner's own cwd is `web_runner/`, not the caller's project.
 *
 * Throws (does not swallow) when the module can't be loaded or doesn't
 * export a recognised shape — a broken `--web-smoke-flow-module` must fail
 * the run loudly, before any assertion runs.
 */
export async function loadSmokeFlowModule(modulePath: string): Promise<SmokeScenario[]> {
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.join(process.cwd(), modulePath)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any
  try {
    mod = await import(pathToFileURL(resolved).href)
  } catch (err) {
    throw new Error(`--web-smoke-flow-module (${modulePath}) failed to load from ${resolved}: ${String(err)}`)
  }

  const exported = mod.scenarios ?? mod.default

  if (typeof exported === "function") {
    return [{ name: "smoke", run: exported as SmokeFlow }]
  }

  if (Array.isArray(exported) && exported.length > 0 && exported.every(isScenario)) {
    return exported as SmokeScenario[]
  }

  throw new Error(
    `--web-smoke-flow-module (${modulePath}) must export either an async function as 'default' ` +
      "(taking { page, log, baseUrl }), or a non-empty array of { name, run } scenarios as 'scenarios' " +
      `or 'default' — got ${Array.isArray(exported) ? "an empty or malformed array" : typeof exported}`,
  )
}
