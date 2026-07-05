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
  /**
   * Name of a Dart test (a `PatrolTestEntry.name`, exactly what
   * `window.__patrol__runTest` addresses) to invoke via
   * `__patrol__runTest` BEFORE [triggerSelector] is awaited.
   *
   * Needed when the test bundle defers ALL widget pumping to the per-test
   * callback (patrol_test's usual `patrolTest(name, ($) async { await
   * startApp($); ... })` shape) — in that architecture nothing (not even the
   * login trigger) exists on screen until some named test's body runs, so a
   * bare `triggerSelector` click times out against an empty page. Its own
   * Dart VM is later destroyed by the cross-origin redirect just like
   * everything else driven from this page — it is disposable "get something
   * on screen" scaffolding, not the test whose pass/fail is asserted by the
   * harness.
   *
   * Omit when the app bundle already pumps a widget tree eagerly at boot
   * (nothing changes for those callers — this field defaults to unset).
   */
  bootTestName?: string
  /**
   * Whether to best-effort click the CanvasKit `flt-semantics-placeholder`
   * element immediately before [triggerSelector], enabling Flutter's
   * accessibility DOM overlay so ordinary DOM selectors (text=, role=, css)
   * can resolve real interactive widgets at all — a bare CanvasKit canvas
   * exposes no DOM otherwise (see the flutter-rules skill: "JS-click
   * flt-semantics-placeholder to enable the a11y tree first"). Defaults to
   * `true`; has no effect when [triggerSelector] is unset, and is a no-op
   * (swallowed) on builds that don't render the placeholder (HTML renderer,
   * or CanvasKit builds where accessibility is already active).
   */
  enableAccessibility?: boolean
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
  /**
   * Optional selector for a submit control to click after filling
   * [loginNameSelector] and BEFORE filling [passwordSelector] — i.e. a
   * two-step IdP where username and password are separate pages/steps
   * (this is how Zitadel's own login-v2 UI works: loginName -> "Continue" ->
   * a fresh page with the password field -> "Continue" again). Omit for a
   * single-step IdP that shows both fields on one page with one submit
   * ([submitSelector] alone). When set, [passwordSelector]'s own `.fill()`
   * call auto-waits for the password step to render (Playwright locator
   * actions auto-wait) — no separate explicit wait is needed.
   */
  loginNameSubmitSelector?: string
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

/** How long to wait for the (optional, best-effort) semantics placeholder. Deliberately short — most builds don't render it and this must never eat into the real per-step [timeoutMs] budget. */
const ACCESSIBILITY_ENABLE_TIMEOUT_MS = 2000

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
    bootTestName: spec.bootTestName,
    enableAccessibility: spec.enableAccessibility,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    loginUrlPattern: spec.loginUrlPattern!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    loginNameSelector: spec.loginNameSelector!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    loginNameEnvVar: spec.loginNameEnvVar!,
    loginNameSubmitSelector: spec.loginNameSubmitSelector,
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
 * Best-effort click of Flutter web's `flt-semantics-placeholder` — the one
 * element CanvasKit always renders as REAL DOM (deliberately, so a screen
 * reader or automation tool can find and click it before anything else is
 * accessible: https://docs.flutter.dev/ui/accessibility/web-accessibility).
 * Clicking it triggers Flutter to render full accessibility DOM for
 * subsequent interactive widgets, which is what lets an ordinary Playwright
 * DOM selector (text=, role=, css) resolve [AuthFlowSpec.triggerSelector] at
 * all on a CanvasKit build. Swallows any failure (short timeout) — HTML
 * renderer builds, or CanvasKit builds where accessibility is already
 * active, simply don't have this element, and that's fine.
 */
async function enableAccessibilityIfPresent(page: Page): Promise<void> {
  await page
    .locator("flt-semantics-placeholder")
    .first()
    .click({ timeout: ACCESSIBILITY_ENABLE_TIMEOUT_MS })
    .then(() => logger.info("Auth flow: enabled Flutter web accessibility DOM (flt-semantics-placeholder)"))
    .catch(() => {
      // Not present / already enabled / not a CanvasKit build — no-op.
    })
}

/**
 * Drives the cross-origin auth round-trip on [page] by selector: optional
 * trigger click (preceded by a best-effort accessibility-enable, see
 * [enableAccessibilityIfPresent]) -> wait for the IdP origin -> fill
 * loginName -> optional intermediate submit for a two-step IdP (see
 * [AuthFlowSpec.loginNameSubmitSelector] — Zitadel's own login-v2 UI is
 * two-step: username page, "Continue", THEN a separate password page) ->
 * fill password -> submit -> wait for the redirect back to the app origin.
 * See this module's doc comment for why it deliberately does NOT re-run
 * `initialise(page)` itself (the call site's job) and why every required
 * step is unguarded (a failure here must fail the test loudly, not be
 * swallowed).
 *
 * Credentials are resolved from the environment up front (before any
 * navigation), so a missing credential fails immediately rather than leaving
 * the browser mid-navigation.
 */
export async function runAuthFlow(page: Page, spec: AuthFlowSpec): Promise<void> {
  const timeout = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const loginName = requireCredential(spec.loginNameEnvVar)
  const password = requireCredential(spec.passwordEnvVar)

  if (spec.bootTestName) {
    logger.info("Auth flow: running boot test %s to render the login screen", spec.bootTestName)
    const bootTestName = spec.bootTestName
    const bootPromise = page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      async name => await window.__patrol__runTest!(name),
      bootTestName,
    )
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Auth flow boot test "${bootTestName}" did not resolve within ${timeout}ms`)),
        timeout,
      )
    })
    const bootResult = await Promise.race([bootPromise, timeoutPromise])
    if (bootResult?.result === "failure") {
      throw new Error(
        `Auth flow boot test "${spec.bootTestName}" failed before the trigger could be clicked: ` +
          `${bootResult.details ?? "no details"}`,
      )
    }
  }

  if (spec.triggerSelector) {
    if (spec.enableAccessibility !== false) {
      await enableAccessibilityIfPresent(page)
    }
    logger.info("Auth flow: clicking trigger %s", spec.triggerSelector)
    await page.locator(spec.triggerSelector).first().click({ timeout })
  }

  logger.info("Auth flow: waiting to arrive at the IdP origin (pattern: %s)", spec.loginUrlPattern)
  await page.waitForURL(new RegExp(spec.loginUrlPattern), { timeout })

  await page.locator(spec.loginNameSelector).first().fill(loginName, { timeout })
  if (spec.loginNameSubmitSelector) {
    logger.info("Auth flow: submitting login name (two-step IdP), selector %s", spec.loginNameSubmitSelector)
    await page.locator(spec.loginNameSubmitSelector).first().click({ timeout })
  }
  // Playwright locator actions auto-wait for the target to appear, so no
  // separate wait is needed here for a two-step IdP's password page to load.
  await page.locator(spec.passwordSelector).first().fill(password, { timeout })
  await page.locator(spec.submitSelector).first().click({ timeout })

  logger.info("Auth flow: waiting to return to the app origin (pattern: %s)", spec.successUrlPattern)
  await page.waitForURL(new RegExp(spec.successUrlPattern), { timeout })

  logger.info("Auth flow: IdP round-trip complete — app origin reloaded, ready for re-initialise")
}
