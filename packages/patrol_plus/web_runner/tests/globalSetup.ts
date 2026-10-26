// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import type { FullConfig } from "@playwright/test"

/**
 * Dispatches Playwright's single, config-level `globalSetup` hook (it runs
 * once before ANY test file in the project, regardless of which spec was
 * targeted on the CLI — there is no per-spec-file equivalent) between the
 * two fundamentally different things this runner can do:
 *
 * - the normal, Patrol-instrumented flow (`tests/test.spec.ts`) needs
 *   `tests/setup.ts`'s bootstrap: it navigates to the page, waits for the
 *   `__patrol__onInitialised` JS hook, and discovers the Dart test tree via
 *   `window.__patrol__getTests()`.
 * - F-URL deployed-URL smoke mode (`tests/smokeTest.spec.ts`,
 *   `--web-base-url`) drives an ordinary, uninstrumented page directly —
 *   there is no `__patrol__` hook and no Dart test tree, so running
 *   `setup.ts` against it does not fail fast, it HANGS: `initialise()`
 *   polls `window.__patrol__onInitialised` for the full `--web-init-timeout`
 *   budget (120s default) and then throws, aborting the whole Playwright run
 *   (0 tests executed) before `smokeTest.spec.ts` ever gets a chance to run.
 *
 * `PATROL_WEB_SMOKE_MODE` is set by `web_test_backend.dart` only on the
 * `--web-base-url` path, so every other run (the env var absent) is
 * byte-for-byte the same as calling `setup.ts` directly — zero behaviour
 * change for the existing, Patrol-instrumented flow.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.PATROL_WEB_SMOKE_MODE === "true") {
    return
  }
  const { default: setup } = await import("./setup")
  await setup(config)
}

export default globalSetup
