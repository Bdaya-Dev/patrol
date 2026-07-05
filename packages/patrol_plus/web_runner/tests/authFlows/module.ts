import { pathToFileURL } from "url"
import * as path from "path"
import type { Page } from "playwright"

/**
 * F-A registration escape hatch (patrol-visual-review-overhaul-DESIGN.md §6
 * amendment, 2026-07-05 PO decision — real-dev auth prelude registers a
 * fresh user through the real UI on every run instead of logging in with a
 * static test account).
 *
 * The declarative {@link ../oidc.ts!AuthFlowSpec} JSON (a flat login triad:
 * trigger click -> loginName -> password -> submit -> success URL) cannot
 * express a multi-page registration flow: N form fields across several
 * pages/steps, an async-committing custom combobox, conditional checkboxes,
 * and an email-verification step whose input isn't typed by the operator at
 * all but fetched from an external HTTP API (Mailpit) using a value known
 * only at spec-construction time. Bolting that onto the JSON schema would
 * mean growing it into a second, parallel scripting language embedded in
 * JSON.
 *
 * This mirrors Playwright's own documented escape hatch for custom auth
 * setups (https://playwright.dev/docs/auth — the `*.setup.ts` project
 * pattern's whole point is "write real code, Playwright just runs it"). This
 * web runner has no multi-project config to hang a `*.setup.ts` dependency
 * off of, but it IS already a Node/TS process that dynamically `import()`s
 * things (`test.spec.ts` conditionally imports `monocart-coverage-reports`),
 * so this adds a sibling dynamic-import escape hatch instead: a caller-
 * supplied module path (`--web-auth-flow-module` /
 * `PATROL_WEB_AUTH_FLOW_MODULE`) exporting an async `runAuthFlow` (or
 * `default`) function that receives the real Playwright `page` and drives
 * whatever flow it needs, in real code, with no declarative-spec ceiling.
 *
 * All Invora-specific selectors/URLs/mailbox logic live in the CALLER's
 * module (e.g. invora-flutter's `patrol_test/ci/real_dev_register_flow.ts`),
 * never in this (generic, plausibly-upstreamable) fork.
 */

export type AuthFlowModuleContext = {
  /** The real Playwright page the module should drive — full API access, no declarative ceiling. */
  page: Page
  /** Structured logger — routes through the same logger every other auth-flow step uses. */
  log: (msg: string, ...args: unknown[]) => void
  /** The `--web-auth-flow` step timeout (or its default), forwarded for the module's own convenience — not enforced by the caller. */
  timeoutMs: number
}

export type AuthFlowModule = (ctx: AuthFlowModuleContext) => Promise<void>

/**
 * Fails fast when both auth-flow mechanisms are configured at once — an
 * ambiguous config (which one should run?) that must error loudly at setup,
 * before any page/browser exists, rather than silently picking one or
 * running both. Mirrors `parseAuthFlowSpec`'s own fail-fast posture for a
 * malformed `--web-auth-flow` spec.
 */
export function assertNotBothAuthFlowMechanismsSet(
  authFlowSpecRaw: string | undefined,
  authFlowModulePath: string | undefined,
): void {
  if (authFlowSpecRaw && authFlowModulePath) {
    throw new Error(
      "Both --web-auth-flow and --web-auth-flow-module were set — these are mutually exclusive auth-flow " +
        "mechanisms. Use --web-auth-flow for a simple declarative login triad, or --web-auth-flow-module for a " +
        "custom flow (e.g. registration) driven by real code.",
    )
  }
}

/**
 * Dynamically imports [modulePath] and returns its exported auth-flow
 * function (`runAuthFlow` named export, falling back to `default`).
 * Resolves a relative path against `process.cwd()` (the invocation
 * directory — i.e. the Flutter/patrol project root), mirroring
 * `_resolveAuthStateFile`'s treatment of `--web-auth-state-file` in
 * `patrol_cli_plus`'s `web_test_backend.dart` for the same reason: a
 * relative path must not be resolved against this runner's OWN cwd.
 *
 * Throws (does not swallow) when the module can't be loaded or doesn't
 * export a callable — a broken `--web-auth-flow-module` must fail the run
 * loudly at setup, before any page/browser work happens, matching
 * `parseAuthFlowSpec`'s existing fail-fast posture for a malformed JSON
 * spec.
 */
export async function loadAuthFlowModule(modulePath: string): Promise<AuthFlowModule> {
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.join(process.cwd(), modulePath)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any
  try {
    mod = await import(pathToFileURL(resolved).href)
  } catch (err) {
    throw new Error(`--web-auth-flow-module (${modulePath}) failed to load from ${resolved}: ${String(err)}`)
  }
  const fn = mod.runAuthFlow ?? mod.default
  if (typeof fn !== "function") {
    throw new Error(
      `--web-auth-flow-module (${modulePath}) must export an async function as 'runAuthFlow' or 'default' ` +
        `(taking { page, log, timeoutMs }) — got ${typeof fn}`,
    )
  }
  return fn as AuthFlowModule
}
