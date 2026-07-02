import * as fs from "fs"
import * as path from "path"
import { chromium, type FullConfig, type Page } from "@playwright/test"
import { initialise } from "./initialise"
import { exposePatrolPlatformHandler } from "./patrolPlatformHandler"
import { resolveLocale } from "./resolveLocale"
import { DartTestEntry, PatrolTestEntry } from "./types"

async function setup(config: FullConfig) {
  const { baseURL } = config.projects[0].use
  const browserArgs: string[] | undefined = process.env.PATROL_WEB_BROWSER_ARGS
    ? JSON.parse(process.env.PATROL_WEB_BROWSER_ARGS)
    : undefined

  const locale = resolveLocale()

  const browser = await chromium.launch({
    args: browserArgs,
  })

  const page = await browser.newPage({ locale })

  if (!baseURL) {
    throw new Error("baseURL is not set")
  }

  const setupPageErrorPromise = new Promise<never>((_, reject) => {
    page.on("pageerror", error => {
      // Filter out cosmetic Flutter engine re-initialization errors.
      // In debug mode, the engine's initializeEngineServices() throws a StateError
      // inside assert() when called twice. This is harmless — the engine is already
      // initialized and the assert is stripped in release/profile mode.
      if (error.message.includes("initializeEngineServices")) {
        // eslint-disable-next-line no-console
        console.warn(`[patrol] Ignoring cosmetic engine error: ${error.message}`)
        return
      }

      error.message = `Page error during setup: ${error.message}`
      // eslint-disable-next-line no-console
      console.error(error.stack ?? error.message)
      reject(error)
    })
  })

  // Register an init script so __patrol__isInitialised is set before any
  // page script runs, surviving any page reload during WASM bootstrapping.
  await page.addInitScript(() => {
    window.__patrol__isInitialised = true
  })

  // Expose platform handler bindings before navigation to prevent race condition
  // during Flutter booting/initialization logic
  await exposePatrolPlatformHandler(page)

  // We want to initialize the platform handler and things *before* we potentially miss the boat
  // during load.
  await page.goto(baseURL, { waitUntil: "domcontentloaded" })

  // Inject a small script to guarantee the variable is set *right now* in case domcontentloaded
  // already cleared the context or something.
  await page.evaluate(() => {
    window.__patrol__isInitialised = true
  })

  await initialise(page)

  // Discovery budget: how long we wait for the Flutter app to boot and register
  // its tests via window.__patrol__getTests(). Heavy apps (large WASM bundles) on
  // slow CI runners routinely need more than the 120s default, so honour
  // --web-init-timeout (PATROL_WEB_INIT_TIMEOUT) here instead of hardcoding it —
  // otherwise the budget is stuck at 120s and a slow boot spuriously discovers 0
  // tests ("Total: 0").
  const initTimeout = process.env.PATROL_WEB_INIT_TIMEOUT
    ? parseInt(process.env.PATROL_WEB_INIT_TIMEOUT)
    : 120000

  try {
    const testEntriesResponse = await discoverTestTree(page, setupPageErrorPromise, initTimeout)

    const patrolTests = mapEntry(testEntriesResponse.group)
    const serialised = JSON.stringify(patrolTests)

    // Hand the discovered test list off to test.spec.ts via TWO channels:
    //   1. process.env.PATROL_TESTS — back-compat only. This mutation lives in
    //      the MAIN process; Playwright forks worker child processes that do NOT
    //      observe runtime env mutations from globalSetup, so a worker
    //      re-importing test.spec.ts would read an empty list.
    //   2. A deterministic file on disk — crosses the main->worker process
    //      boundary reliably. This is the root fix for the flaky empty-shard
    //      "Total: 0": every process (main + each worker) sees the same list.
    process.env.PATROL_TESTS = serialised
    const testsFile = path.resolve(process.cwd(), ".patrol_tests.json")
    try {
      fs.writeFileSync(testsFile, serialised)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[patrol] Failed to persist discovered tests to ${testsFile}: ${String(err)}`)
    }
  } finally {
    await browser.close()
  }
}

/**
 * Reads the Dart test tree exposed on the page, waiting until at least one test
 * has been registered.
 *
 * `window.__patrol__getTests()` becomes callable as soon as the patrol app
 * service boots, but on a slow/cold WASM boot it can briefly return a
 * truthy-but-empty group (`{ entries: [] }`) while the `patrolTest()`/`group()`
 * declarations are still executing. The previous implementation resolved on the
 * first truthy value, so it occasionally captured that empty snapshot, set
 * `PATROL_TESTS=[]`, and produced 0 Playwright tests — a flaky "no tests found"
 * (exit 1) that poisoned the entire shard. We therefore poll until the tree is
 * non-empty, bounded by [initTimeout] (configurable via --web-init-timeout /
 * PATROL_WEB_INIT_TIMEOUT, default 120s).
 *
 * If the budget elapses with the tree STILL empty, we fail LOUDLY with an
 * actionable message rather than silently setting `PATROL_TESTS=[]` and yielding a
 * confusing `Total: 0` (exit 1). On a real run this is almost always a slow/failed
 * app boot, not a genuinely empty suite — and a genuinely empty target already
 * fails the same way (0 tests), so a clear error strictly improves the outcome.
 */
async function discoverTestTree(
  page: Page,
  setupPageErrorPromise: Promise<never>,
  initTimeout: number,
): Promise<{ group: DartTestEntry }> {
  // Node-context counter, used for the post-timeout fallback check below. The
  // poll predicate re-declares its own copy because it runs in the browser.
  const countTests = (entry: DartTestEntry): number =>
    (entry.type === "test" ? 1 : 0) + entry.entries.reduce((sum, child) => sum + countTests(child), 0)
  try {
    return (await Promise.race([
      page
        .waitForFunction(
          () => {
            const response = window.__patrol__getTests?.()
            if (!response) return false

            // Count registered test leaves; only resolve once at least one exists.
            const count = (entry: DartTestEntry): number =>
              (entry.type === "test" ? 1 : 0) + entry.entries.reduce((sum, child) => sum + count(child), 0)

            return count(response.group) > 0 ? response : false
          },
          { timeout: initTimeout },
        )
        .then(v => v.jsonValue()),
      setupPageErrorPromise,
    ])) as { group: DartTestEntry }
  } catch (error) {
    if (error instanceof Error && /Timeout.*exceeded/i.test(error.message)) {
      // One last direct read in case the tree registered right at the deadline.
      const fallback = (await page.evaluate(() => window.__patrol__getTests?.() ?? null)) as {
        group: DartTestEntry
      } | null
      if (fallback && countTests(fallback.group) > 0) {
        return fallback
      }
      throw new Error(
        `Patrol discovered 0 tests after ${initTimeout} ms: window.__patrol__getTests() never ` +
          `reported a registered test. The app likely failed to boot or was too slow to register ` +
          `its tests on this run. If the suite is non-empty, raise the discovery budget with ` +
          `--web-init-timeout (PATROL_WEB_INIT_TIMEOUT, currently ${initTimeout} ms).`,
      )
    }
    throw error
  }
}

function mapEntry(entry: DartTestEntry, parentName?: string, skip = false, tags = new Set<string>()) {
  const fullEntryName = parentName ? `${parentName} ${entry.name}` : entry.name
  const fullEntrySkip = skip || entry.skip
  const fullEntryTags = new Set([...tags, ...entry.tags.map(tag => `@${tag}`)])

  const tests: PatrolTestEntry[] = []

  if (entry.type === "test") {
    tests.push({
      name: fullEntryName,
      skip: fullEntrySkip,
      tags: [...fullEntryTags],
    })
  }

  tests.push(...entry.entries.flatMap(e => mapEntry(e, fullEntryName, fullEntrySkip, fullEntryTags)))

  return tests
}

export default setup
