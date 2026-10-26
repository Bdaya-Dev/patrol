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
 *
 * The dynamic `import("./setup.ts")` below uses an EXPLICIT ".ts"
 * extension. A bare `import("./setup")` (no extension) broke the normal
 * flow outright: every web e2e run failed in ~2s with "Total: 0" before
 * any browser work happened. This package has no `"type": "module"` in
 * package.json, and an extension-less dynamic specifier doesn't go
 * through the same resolution Playwright's own loader uses for the
 * static, extension-less imports the rest of this runner's files rely on
 * (confirmed live: adding the extension is the only change needed to get
 * `e2e-web` back to green — see this PR's history for the before/after
 * CI runs). Kept dynamic (not hoisted to a static top-level import) so
 * smoke mode's short-circuit above stays a true no-op: `setup.ts`
 * transitively imports several OTHER extension-less sibling specifiers
 * (`./initialise`, `./pageManager`, ...), and forcing those through
 * static resolution at this file's own load time reintroduces the exact
 * same extension problem one level down, just for all of its imports
 * instead of only this one.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.PATROL_WEB_SMOKE_MODE === "true") {
    return
  }
  const { default: setup } = await import("./setup.ts")
  await setup(config)
}

export default globalSetup
