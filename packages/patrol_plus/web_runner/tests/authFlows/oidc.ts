import type { Page } from "playwright"
import { logger } from "../logger.ts"

/**
 * F-A — cross-origin auth prelude (patrol-visual-review-overhaul-DESIGN.md
 * §1c/§2 "F-A. Cross-origin excursion", §12b variant 2 "same-tab excursion").
 *
 * The in-page Dart test body runs inside `page.evaluate(__patrol__runTest)`;
 * a same-tab cross-origin navigation (exactly what Invora's OIDC login does —
 * `real.dart`'s `navigationMode: samePage`) destroys that Dart VM mid-flight.
 * So the auth round-trip can never be driven from inside the Dart body — it
 * must be a Playwright-side routine that runs BEFORE the body, on the SAME
 * page/context (so both legs land in one continuous video, per design §12b).
 *
 * This module drives exactly that round-trip by selector — click the app's
 * login affordance (if any — some apps redirect on boot with no click
 * needed), wait for the identity-provider origin, fill credentials, submit,
 * wait for the redirect back to the app origin. It deliberately stops there:
 * it does NOT re-run `initialise(page)` itself. That is the call site's job
 * (`test.spec.ts`, which already imports `initialise` for the first boot) —
 * keeping "drive the cross-origin redirect" and "re-arm the in-page Dart
 * runner after a fresh top-level navigation" as two separately-testable
 * responsibilities, matching every other action module in this directory
 * (resizeWindow only resizes, filterByTags only filters — none reach into
 * initialise.ts's DDC-detection/build-mode-cache internals). The composed
 * call site is:
 *
 *   if (authFlowSpec) {
 *     await runAuthFlow(page, authFlowSpec)
 *     await initialise(page)
 *   }
 *
 * placed in `setupPage()`, between the first `initialise(page)` (first boot)
 * and the per-test `__patrol__runTest` invocation — exactly where design §2
 * F-A specifies ("Invoked from test.spec.ts between setupPage and the
 * __patrol__runTest call").
 */

export type AuthFlowSpec = {
  /**
   * Optional Playwright selector (any engine-prefixed string the Playwright
   * selector syntax accepts: plain CSS, `text=`, `role=`, etc.) for the
   * control that starts the OIDC redirect on the app's own origin. Omit when
   * the app already redirects unauthenticated visitors on boot (no click
   * needed to reach the IdP).
   */
  triggerSelector?: string
  /** Regex source tested against `page.url()` to detect arrival at the identity-provider origin (e.g. `"^https://dev-auth\\.invora\\.app/"`). */
  loginUrlPattern: string
  /** Playwright selector for the login-name/username field on the IdP page. */
  loginNameSelector: string
  /**
   * Name of the environment variable — NOT the value — holding the login
   * name/email. Read at call time from `process.env`, never embedded in the
   * spec JSON, a CLI arg, or a committed fixture (design §2 F-A
   * "Credentials arrive from CI env ... never in the spec file or the repo").
   */
  loginNameEnvVar: string
  /** Playwright selector for the password field on the IdP page. */
  passwordSelector: string
  /** Name of the environment variable holding the password. Same rules as [loginNameEnvVar]. */
  passwordEnvVar: string
  /** Playwright selector for the IdP form's submit control. */
  submitSelector: string
  /** Regex source tested against `page.url()` confirming the redirect landed back on the app origin. */
  successUrlPattern: string
  /** Per-step timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30000

const REQUIRED_FIELDS: (keyof AuthFlowSpec)[] = [
  "loginUrlPattern",
  "loginNameSelector",
  "loginNameEnvVar",
  "passwordSelector",
  "passwordEnvVar",
  "submitSelector",
  "successUrlPattern",
]

/**
 * Parses `PATROL_WEB_AUTH_FLOW` (the value of `--web-auth-flow`) into an
 * [AuthFlowSpec], or `null` when unset/blank — the default for every mocked
 * run (patrol-e2e/patrol-frames today never set this; `FakeAuthService`
 * needs no real IdP round-trip).
 *
 * Fails fast (throws at parse time, before any page/browser exists) on
 * malformed input rather than silently no-opping: a real-dev run that
 * intended to authenticate but has a broken spec must error loudly instead
 * of leaving every subsequent in-page assertion failing against an
 * unauthenticated app with a confusing, unrelated stack trace.
 */
export function parseAuthFlowSpec(raw: string | undefined): AuthFlowSpec | null {
  if (!raw || raw.trim().length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`--web-auth-flow / PATROL_WEB_AUTH_FLOW is not valid JSON: ${String(err)}`)
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--web-auth-flow / PATROL_WEB_AUTH_FLOW must be a JSON object")
  }

  const spec = parsed as Partial<AuthFlowSpec>
  const missing = REQUIRED_FIELDS.filter(key => !spec[key])
  if (missing.length > 0) {
    throw new Error(`--web-auth-flow / PATROL_WEB_AUTH_FLOW is missing required field(s): ${missing.join(", ")}`)
  }

  return {
    triggerSelector: spec.triggerSelector,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    loginUrlPattern: spec.loginUrlPattern!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    loginNameSelector: spec.loginNameSelector!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    loginNameEnvVar: spec.loginNameEnvVar!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    passwordSelector: spec.passwordSelector!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    passwordEnvVar: spec.passwordEnvVar!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    submitSelector: spec.submitSelector!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    successUrlPattern: spec.successUrlPattern!,
    timeoutMs: spec.timeoutMs,
  }
}

/**
 * Reads a credential from the environment by NAME. Throws (naming the env
 * var, never the value) when unset — this is the only place a credential
 * value is read, and it is never logged, thrown in an error message, or
 * otherwise surfaced.
 */
function requireCredential(envVar: string): string {
  const value = process.env[envVar]
  if (!value) {
    throw new Error(
      `Auth flow spec references env var "${envVar}" for a credential, but it is unset. ` +
        "Set it as a masked CI variable (never in the spec JSON or a committed file).",
    )
  }
  return value
}

/**
 * Drives the cross-origin auth round-trip on [page] by selector: optional
 * trigger click -> wait for the IdP origin -> fill loginName/password ->
 * submit -> wait for the redirect back to the app origin. See this module's
 * doc comment for why it deliberately does NOT re-run `initialise(page)`
 * itself (the call site's job) and why every step is unguarded (a failure
 * here must fail the test loudly, not be swallowed).
 *
 * Credentials are resolved from the environment up front (before any
 * navigation), so a missing credential fails immediately rather than leaving
 * the browser mid-navigation.
 */
export async function runAuthFlow(page: Page, spec: AuthFlowSpec): Promise<void> {
  const timeout = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const loginName = requireCredential(spec.loginNameEnvVar)
  const password = requireCredential(spec.passwordEnvVar)

  if (spec.triggerSelector) {
    logger.info("Auth flow: clicking trigger %s", spec.triggerSelector)
    await page.locator(spec.triggerSelector).first().click({ timeout })
  }

  logger.info("Auth flow: waiting to arrive at the IdP origin (pattern: %s)", spec.loginUrlPattern)
  await page.waitForURL(new RegExp(spec.loginUrlPattern), { timeout })

  await page.locator(spec.loginNameSelector).first().fill(loginName, { timeout })
  await page.locator(spec.passwordSelector).first().fill(password, { timeout })
  await page.locator(spec.submitSelector).first().click({ timeout })

  logger.info("Auth flow: waiting to return to the app origin (pattern: %s)", spec.successUrlPattern)
  await page.waitForURL(new RegExp(spec.successUrlPattern), { timeout })

  logger.info("Auth flow: IdP round-trip complete — app origin reloaded, ready for re-initialise")
}
