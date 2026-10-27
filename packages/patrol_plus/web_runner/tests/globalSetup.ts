// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import type { FullConfig } from "@playwright/test"
import setup from "./setup"

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
 * `setup` IS a static top-level import, same as every other Playwright-
 * loaded file in this runner (test.spec.ts, setup.ts itself, etc. all
 * import siblings extension-less and statically). It was previously a
 * runtime `await import("./setup")` so smoke mode's short-circuit above
 * could skip loading it — that broke the normal flow outright: Playwright
 * pre-transforms the files it discovers via STATIC analysis (its own
 * esbuild-based loader), but a runtime dynamic `import()` call is
 * evaluated by Node's own bare module loader instead, which has no idea
 * ".ts" needs stripping and tries to parse setup.ts as plain CommonJS —
 * hence every web e2e run failing in ~1-2s with
 * `SyntaxError: Cannot use import statement outside a module` at
 * setup.ts's own `import` statements (confirmed by reproducing locally
 * with `npx playwright test` directly, bypassing patrol_cli_plus's log
 * capture, which had been swallowing that error and showing only a
 * misleading ES-module warning + "Total: 0"). An explicit ".ts"
 * extension on the dynamic specifier does NOT fix this — verified by
 * reproducing the identical SyntaxError with `import("./setup.ts")` too;
 * the dynamic-vs-static split, not the extension, is what Playwright's
 * loader cares about. `setup.ts` has no top-level side effects (only
 * imports + a function declaration), so loading it unconditionally even
 * in smoke mode is free.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.PATROL_WEB_SMOKE_MODE === "true") {
    return
  }
  await setup(config)
}

export default globalSetup
