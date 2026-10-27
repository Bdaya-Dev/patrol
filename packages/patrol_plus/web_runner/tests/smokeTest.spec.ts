// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import { test } from "@playwright/test"
import { enableCanvasKitSemantics, waitForFlutterEngineReady } from "./canvasKitSemantics"
import { assertNoViolations, attachErrorGate, parseAllowList } from "./errorGate"
import { logger } from "./logger"
import { DEFAULT_REDACT_COLOR, installSensitiveRedaction, parseRedactSelectors } from "./sensitiveRedaction"
import { loadSmokeFlowModule, runScenariosReportingAllFailures } from "./smokeFlow"

/**
 * F-URL — deployed-URL smoke mode, selected by `patrol_cli_plus` instead of
 * `test.spec.ts` whenever `--web-base-url` is set (see web_test_backend.dart's
 * `playwrightSpecFileFor`). Unlike every other spec in this runner, there is
 * NO Patrol-instrumented Dart test bundle here: `--web-base-url` points at an
 * already-deployed, ordinary (production or preview) Flutter web build, so
 * the `__patrol__*` JS hooks that `initialise()` / `exposePatrolPlatformHandler`
 * depend on were never compiled in. This spec therefore skips that whole
 * machinery and drives the page directly: it waits for the Flutter engine to
 * mount, auto-enables the CanvasKit semantics/accessibility tree (closing the
 * manual "click flt-semantics-placeholder" workaround — see
 * devops-aggregate's `.claude/rules/00-session-pitfalls.md` #8/#12), applies
 * the SAME F-B browser-error gate the instrumented flow uses, then — if given
 * one — hands the real Playwright `page` to a caller-supplied
 * `--web-smoke-flow-module` (mirrors `--web-auth-flow-module`'s escape hatch).
 *
 * Pass/fail comes entirely from Playwright's own test result (no PATROL_LOG
 * parsing anywhere in this file), so this mode is immune to the
 * harness-vs-summary mismatch tracked in
 * https://github.com/Bdaya-Dev/patrol/issues/61 by construction.
 *
 * Also installs the SAME artifact redaction overlay as `test.spec.ts`
 * (`--web-redact-artifacts`, on by default). This path is a prime target for
 * it specifically: a `--web-smoke-flow-module` on a deployed URL is the
 * canonical way to drive a real, often signed-in flow against production,
 * so a typed password here is exactly the secret that must never land
 * unmasked in a screenshot or video artifact. See `sensitiveRedaction.ts`'s
 * doc comment for what this does and does NOT cover (pixels only, never a
 * `--web-trace`).
 */

const baseUrl = process.env.BASE_URL
if (!baseUrl) {
  throw new Error("smokeTest.spec.ts requires BASE_URL (--web-base-url) to be set")
}

const errorGateConfig = {
  enabled: process.env.PATROL_WEB_ERROR_DETECTION === "true",
  allowlist: parseAllowList(process.env.PATROL_WEB_ERROR_ALLOW),
}

const redactConfig = {
  enabled: process.env.PATROL_WEB_REDACT_ARTIFACTS !== "false",
  selectors: parseRedactSelectors(process.env.PATROL_WEB_REDACT_SELECTORS),
  maskColor: process.env.PATROL_WEB_REDACT_COLOR || DEFAULT_REDACT_COLOR,
}

const smokeFlowModulePath = process.env.PATROL_WEB_SMOKE_FLOW_MODULE

// Reuses the same discovery/init budget as the instrumented flow
// (--web-init-timeout / PATROL_WEB_INIT_TIMEOUT) rather than inventing a
// third timeout knob for "how long to wait for the engine to mount".
const engineReadyTimeoutMs = process.env.PATROL_WEB_INIT_TIMEOUT ? parseInt(process.env.PATROL_WEB_INIT_TIMEOUT) : 60000

test.describe("patrol web smoke (--web-base-url)", () => {
  test("Flutter engine mounts with no un-allowlisted browser error on first load", async ({ page }) => {
    const errorGate = attachErrorGate(page, errorGateConfig)
    try {
      // Registered BEFORE navigation -- addInitScript re-runs on every
      // navigation/reload, but must be registered at least once before the
      // first page.goto below for that first load to be covered too (same
      // reasoning as test.spec.ts's own install site).
      if (redactConfig.enabled) {
        await installSensitiveRedaction(page, {
          selectors: redactConfig.selectors,
          maskColor: redactConfig.maskColor,
        })
      }
      await page.goto("/", { waitUntil: "domcontentloaded" })
      await waitForFlutterEngineReady(page, engineReadyTimeoutMs)
      const semanticsEnabled = await enableCanvasKitSemantics(page)
      logger.info(
        "[patrol smoke] CanvasKit semantics %s",
        semanticsEnabled ? "enabled" : "unavailable (HTML renderer, or no placeholder found)",
      )
    } finally {
      errorGate.dispose()
    }
    // F-B: fail this test if an un-allowlisted browser error surfaced while
    // the app booted — the same gate `test.spec.ts` applies, so a deployed
    // build is held to the identical bar as a locally-served one.
    assertNoViolations(errorGate.violations)
  })

  if (smokeFlowModulePath) {
    test("custom smoke flow(s) from --web-smoke-flow-module", async ({ page }) => {
      const scenarios = await loadSmokeFlowModule(smokeFlowModulePath)
      const errorGate = attachErrorGate(page, errorGateConfig)
      try {
        // Same reasoning as the first test above -- must be registered
        // before this test's own page.goto (if it navigates at all) so the
        // overlay covers the custom flow's typed secrets too.
        if (redactConfig.enabled) {
          await installSensitiveRedaction(page, {
            selectors: redactConfig.selectors,
            maskColor: redactConfig.maskColor,
          })
        }
        if (!page.url() || page.url() === "about:blank") {
          await page.goto("/", { waitUntil: "domcontentloaded" })
          await waitForFlutterEngineReady(page, engineReadyTimeoutMs)
          await enableCanvasKitSemantics(page)
        }

        // See runScenariosReportingAllFailures's doc comment: plain
        // test.step() re-throws on failure, which would abort every
        // scenario listed AFTER the first failing one in
        // --web-smoke-flow-module -- contradicting this file's own stated
        // contract above ("one failing check doesn't hide the others").
        await runScenariosReportingAllFailures(
          scenarios,
          {
            page,
            // pino 9 derives the allowed printf args from the message's
            // literal type; the module contract forwards an opaque
            // (msg, ...args) pair, so the spread is widened here.
            log: (msg, ...args) => logger.info(msg, ...(args as [])),
            baseUrl,
          },
          (name, fn) => test.step(name, fn),
        )
      } finally {
        errorGate.dispose()
      }
      assertNoViolations(errorGate.violations)
    })
  }
})
