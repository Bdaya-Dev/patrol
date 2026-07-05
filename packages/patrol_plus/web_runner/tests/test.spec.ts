import * as fs from "fs"
import * as path from "path"
import { type BrowserContext, type Page, chromium, test as base } from "@playwright/test"
import { parseAuthFlowSpec, runAuthFlow } from "./authFlows/oidc"
import { hasSessionData, loadCachedSession, restoreCachedSession, saveCachedSession } from "./authFlows/sessionCache"
import { isExcludedCoverageEntry } from "./coverageEntryFilter"
import { writeCoverageSummary } from "./coverageSummary"
import { assertNoViolations, attachErrorGate, parseAllowList } from "./errorGate"
import { filterByTags, parseTagList } from "./filterByTags"
import { initialise } from "./initialise"
import { logger } from "./logger"
import { exposePatrolPlatformHandler } from "./patrolPlatformHandler"
import { resolveSourceMaps } from "./sourceMapResolver"
import { PatrolTestEntry } from "./types"
import { appendZeroFillLcov } from "./zeroFillLcov"

/**
 * Loads the full list of discovered patrol tests.
 *
 * Prefers the file persisted by globalSetup (tests/setup.ts), because it crosses
 * the main->worker process boundary reliably. Playwright forks worker child
 * processes that do NOT observe the `process.env.PATROL_TESTS` mutation made by
 * globalSetup in the main process, so reading the env alone made a worker
 * occasionally see an empty list and run 0 tests. Falls back to PATROL_TESTS for
 * back-compat (e.g. callers that set it directly without a discovery file).
 */
function loadDiscoveredTests(): PatrolTestEntry[] {
  const testsFile = path.resolve(process.cwd(), ".patrol_tests.json")
  try {
    if (fs.existsSync(testsFile)) {
      return JSON.parse(fs.readFileSync(testsFile, "utf8")) as PatrolTestEntry[]
    }
  } catch (err) {
    logger.warn("Failed to read persisted test list from %s: %s", testsFile, String(err))
  }
  return process.env.PATROL_TESTS ? (JSON.parse(process.env.PATROL_TESTS) as PatrolTestEntry[]) : []
}

/**
 * Parses PATROL_WEB_SHARD ("current/total", 1-based) into shard bounds. Returns
 * null when unset or invalid, so the non-sharded path runs every discovered test
 * (identical to the pre-sharding behaviour that patrol-frames relies on).
 */
function parseShard(): { current: number; total: number } | null {
  const raw = process.env.PATROL_WEB_SHARD
  if (!raw) return null
  const [current, total] = raw.split("/").map(Number)
  if (
    !Number.isInteger(current) ||
    !Number.isInteger(total) ||
    total < 1 ||
    current < 1 ||
    current > total
  ) {
    logger.warn("Invalid PATROL_WEB_SHARD '%s' — ignoring and running all discovered tests", raw)
    return null
  }
  return { current, total }
}

const allTests = loadDiscoveredTests()
if (allTests.length === 0) {
  logger.error("No patrol tests discovered (persisted file and PATROL_TESTS env are both empty)")
}

// Tag filter (F-C). --tags / --exclude-tags are forwarded from the CLI as
// PATROL_WEB_GREP / PATROL_WEB_GREP_INVERT and applied to the discovered list
// BEFORE sharding, so each shard partitions the already-filtered set. An empty
// result (e.g. a change-scoped run whose tags match nothing in this build) is
// NOT an error: it falls through to the green "no tests assigned" placeholder
// below, so a no-op scope is fast and passing rather than red.
const includeTags = parseTagList(process.env.PATROL_WEB_GREP)
const excludeTags = parseTagList(process.env.PATROL_WEB_GREP_INVERT)
const selectedTests = filterByTags(allTests, includeTags, excludeTags)
if ((includeTags.length > 0 || excludeTags.length > 0) && selectedTests.length !== allTests.length) {
  logger.info(
    "Tag filter applied (include=%o exclude=%o): %d of %d discovered test(s) selected",
    includeTags,
    excludeTags,
    selectedTests.length,
    allTests.length,
  )
}

const shard = parseShard()
// Deterministic round-robin self-sharding. Native Playwright `shard` has been
// removed from playwright.config.ts: the test list is generated dynamically into
// this single spec file, so we partition it ourselves against the file-backed,
// worker-consistent list. Round-robin (`index % total === current - 1`)
// guarantees the per-shard subsets are DISJOINT, their UNION is exact, sizes
// differ by at most 1, and NO shard is empty while total <= test count — which
// eliminates the race where native test-level sharding handed a worker 0 tests
// and idled to the global timeout ("Total: 0").
const tests: PatrolTestEntry[] = shard
  ? selectedTests.filter((_, index) => index % shard.total === shard.current - 1)
  : selectedTests

const debuggerPort = process.env.PATROL_DEBUGGER_PORT
const collectCoverage = !!process.env.PATROL_WEB_COVERAGE
const coverageDir = process.env.PATROL_WEB_COVERAGE_DIR || "coverage"
// "context" = fresh BrowserContext per test (strongest isolation, default)
// "page" = same context, new page per test (shared cookies/storage)
const isolationMode = process.env.PATROL_WEB_ISOLATION || "context"

// Web error gate (F-B). Disabled unless the CLI passed --web-error-detection
// (PATROL_WEB_ERROR_DETECTION=true). See errorGate.ts for the four channels.
const errorGateConfig = {
  enabled: process.env.PATROL_WEB_ERROR_DETECTION === "true",
  allowlist: parseAllowList(process.env.PATROL_WEB_ERROR_ALLOW),
}

// Cross-origin auth prelude (F-A). Unset for every mocked run (the default —
// FakeAuthService needs no real IdP round-trip); set by --web-auth-flow for
// real-dev runs. Parsed once at module load so a malformed spec fails the
// whole run loudly rather than silently no-opping per test (see oidc.ts).
const authFlowSpec = parseAuthFlowSpec(process.env.PATROL_WEB_AUTH_FLOW)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoverageReporter = { add: (entries: any[]) => Promise<void>; generate: () => Promise<void> }

// buildPackageResolver / resolveSourceMaps moved to ./sourceMapResolver.ts
// (issue #28: DDC-only `package:` resolution didn't recognize dart2js
// --profile's three other source-map schemes — org-dartlang-sdk:, absolute
// pub-cache filesystem paths, bundle-relative first-party paths — so every
// dart2js source lost sourcesContent and got zero real hit attribution; see
// that file's doc comment and invora-flutter#86 R5 for the full writeup).

async function setupPage(page: Page) {
  page.on("console", message => {
    const text = message.text()
    if (text.startsWith("PATROL_LOG")) {
      // eslint-disable-next-line no-console
      console.log(text)
      return
    }
    // eslint-disable-next-line no-console
    console.log(`Playwright: ${text}`)
  })

  page.on("pageerror", error => {
    if (error.message.includes("initializeEngineServices")) {
      logger.warn("Ignoring cosmetic engine re-init error")
      return
    }
    error.message = `Page error during test: ${error.message}`
    // eslint-disable-next-line no-console
    console.error(error.stack ?? error.message)
  })

  // F-B web error gate — separate listener set from the log-only pair above,
  // so the gate's own bookkeeping (allowlist filtering, violation recording)
  // stays independent of the always-on console/pageerror logging.
  const errorGate = attachErrorGate(page, errorGateConfig)

  // F-A speed follow-up — session-cache reuse (Playwright's documented
  // "authenticate once, reuse everywhere" pattern, see authFlows/sessionCache.ts).
  // Unset PATROL_WEB_AUTH_STATE_FILE (today's default for every existing
  // caller) is a no-op: cachedSession is always null, so behaviour is
  // unchanged beyond the bootTestName fix below. Read fresh on every
  // setupPage call (not hoisted to module scope like authFlowSpec) because
  // the cache file doesn't exist yet for the first page in a run but does
  // for every subsequent one.
  const authStateFile = process.env.PATROL_WEB_AUTH_STATE_FILE
  const loadedSession = authStateFile ? loadCachedSession(authStateFile) : null
  // A structurally-valid but empty session (e.g. a stale/blank cache file)
  // must not be treated as "already authenticated" — only a session that
  // actually carries cookies/localStorage skips the live login below.
  const cachedSession = loadedSession && hasSessionData(loadedSession) ? loadedSession : null

  if (cachedSession) {
    logger.info("Auth flow: restoring cached session from %s (skipping login)", authStateFile)
    await restoreCachedSession(page, cachedSession)
  }

  await page.addInitScript(() => {
    window.__patrol__isInitialised = true
  })

  await exposePatrolPlatformHandler(page)
  await page.goto("/", { waitUntil: "domcontentloaded" })

  await page.evaluate(() => {
    window.__patrol__isInitialised = true
  })

  await initialise(page)

  // F-A cross-origin auth prelude. Runs (still inside setupPage, so still
  // "between setupPage and the __patrol__runTest call") only when
  // --web-auth-flow was passed AND no cached session was restored above.
  // Drives the IdP round-trip on this SAME page/context — the errorGate and
  // console/pageerror listeners above stay attached across the cross-origin
  // navigation and back (Playwright page listeners are not origin-scoped) —
  // then re-runs initialise() because the app reloaded fresh at the
  // post-auth URL and its __patrol__runTest registration (if any survived
  // the navigation) belongs to a destroyed Dart VM. See authFlows/oidc.ts's
  // doc comment for why the re-initialise call lives here rather than
  // inside runAuthFlow itself.
  if (authFlowSpec && !cachedSession) {
    await runAuthFlow(page, authFlowSpec)
    await initialise(page)

    if (authStateFile) {
      await saveCachedSession(page, authStateFile)
      logger.info("Auth flow: cached session to %s for reuse by later tests in this run", authStateFile)
    }
  }

  return errorGate
}

export const patrolTest = base.extend<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {},
  { sharedContext: BrowserContext; coverageReporter: CoverageReporter | null }
>({
  coverageReporter: [async ({}, use) => {
    if (!collectCoverage) {
      await use(null)
      return
    }
    const mod = await import("monocart-coverage-reports")
    const customFilter = process.env.PATROL_WEB_COVERAGE_FILTER
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const reporter: CoverageReporter = new (mod.default as any)({
      outputDir: coverageDir,
      reports: ["v8", "lcovonly"],
      name: "patrol_lcov",
      entryFilter: (entry: { url: string }) => {
        if (isExcludedCoverageEntry(entry.url)) return false
        if (customFilter) return new RegExp(customFilter).test(entry.url)
        return true
      },
    })
    await use(reporter)
    await reporter.generate()
    logger.info("Generated LCOV coverage report in %s", coverageDir)

    // Append zero-fill stanzas for Dart files that V8 never loaded.
    // This gives accurate LF (total lines) and LH (hit lines) counts,
    // matching what `flutter test --coverage` produces via getSourceReport.
    //
    // F-E invariant: [zeroFillFilter] is derived ONLY from
    // PATROL_WEB_COVERAGE_FILTER (customFilter), never from the test-selection
    // tag filters (PATROL_WEB_GREP / PATROL_WEB_GREP_INVERT / includeTags /
    // excludeTags above). So the zero-fill walk — and therefore the LF/LH
    // denominator — covers the FULL app's package_config.json even on a
    // change-scoped (tag-filtered) run that only executed a subset of flows.
    // Do not thread includeTags/excludeTags into this filter.
    const projectRoot = coverageDir ? path.dirname(coverageDir) : process.cwd()
    const lcovFile = path.join(coverageDir, "lcov.info")
    const zeroFillFilter = customFilter ? new RegExp(customFilter) : null
    appendZeroFillLcov(projectRoot, lcovFile, zeroFillFilter)

    // F-E: emit a machine-readable per-run summary (covered/total lines per
    // source) from the final, whole-app zero-filled lcov.info, alongside it.
    // Downstream tooling (the flow<->source manifest gap detector, §5b) reads
    // this instead of re-parsing LCOV.
    const summaryFile = path.join(coverageDir, "coverage-summary.json")
    const summary = writeCoverageSummary(lcovFile, summaryFile)
    logger.info(
      "Coverage summary: %d/%d lines (%s%%) across %d source(s) — %s",
      summary.totals.linesCovered,
      summary.totals.linesTotal,
      (summary.totals.lineRate * 100).toFixed(2),
      summary.sources.length,
      summaryFile,
    )
  }, { scope: "worker" }],

  sharedContext: [async ({ browser }, use) => {
    if (isolationMode === "page") {
      const context = await browser.newContext()
      await use(context)
      await context.close()
    } else {
      await use(null as unknown as BrowserContext)
    }
  }, { scope: "worker" }],

  page: async ({ page: defaultPage, sharedContext, coverageReporter }, use) => {
    let page: Page = defaultPage

    if (debuggerPort) {
      logger.info("Connecting to Flutter Chrome via CDP on port %s", debuggerPort)
      const cdpBrowser = await chromium.connectOverCDP(`http://localhost:${debuggerPort}`)
      const context = cdpBrowser.contexts()[0]
      page = context.pages()[0] ?? await context.newPage()

      await exposePatrolPlatformHandler(page)

      page.on("console", message => {
        const text = message.text()
        if (text.startsWith("PATROL_LOG")) {
          // eslint-disable-next-line no-console
          console.log(text)
          return
        }
        // eslint-disable-next-line no-console
        console.log(`Playwright: ${text}`)
      })

      page.on("pageerror", error => {
        if (error.message.includes("initializeEngineServices")) {
          logger.warn("Ignoring cosmetic engine re-init error")
          return
        }
        error.message = `Page error during test: ${error.message}`
        // eslint-disable-next-line no-console
        console.error(error.stack ?? error.message)
      })

      if (coverageReporter) await page.coverage.startJSCoverage()
      await use(page)
      if (coverageReporter) {
        const entries = await page.coverage.stopJSCoverage()
        await resolveSourceMaps(entries, coverageDir ? path.dirname(coverageDir) : null)
        await coverageReporter.add(entries)
      }
      return
    }

    if (isolationMode === "page" && sharedContext) {
      page = await sharedContext.newPage()
    }

    const errorGate = await setupPage(page)

    if (coverageReporter) await page.coverage.startJSCoverage()
    await use(page)
    if (coverageReporter) {
      const entries = await page.coverage.stopJSCoverage()
      await resolveSourceMaps(entries, coverageDir ? path.dirname(coverageDir) : null)
      await coverageReporter.add(entries)
    }

    // F-B: fail this test if an un-allowlisted browser error surfaced during
    // setup or the test body. Thrown from fixture teardown, which Playwright
    // attributes to the currently running test.
    errorGate.dispose()
    assertNoViolations(errorGate.violations)

    if (isolationMode === "page") {
      await page.close()
    }
  },
})

if (tests.length === 0 && allTests.length > 0) {
  // This shard legitimately has no tests assigned (total > discovered test
  // count). Register a single trivially-passing placeholder so Playwright exits
  // 0 instead of failing with "no tests found" and idling to the global timeout.
  //
  // When NO tests were discovered at all (allTests is empty too) we deliberately
  // register nothing, so Playwright exits non-zero ("no tests found"). That
  // preserves loud failure for a genuinely empty/broken target — globalSetup
  // already throws when discovery finds 0 tests, so reaching here with an empty
  // allTests means a real problem worth surfacing.
  base("patrol: no tests assigned to this shard", () => {
    // Trivially passing — keeps an over-provisioned shard green and fast instead
    // of erroring with "no tests found" and idling to the global timeout.
    logger.info(
      "No patrol tests assigned to shard %s; %d test(s) discovered overall.",
      process.env.PATROL_WEB_SHARD ?? "(none)",
      allTests.length,
    )
  })
} else {
  for (const { name, skip, tags } of tests) {
    patrolTest(name, { tag: tags }, async ({ page }) => {
      patrolTest.skip(skip)

      await page.waitForFunction(() => window.__patrol__runTest, {
        timeout: 300000,
      })

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const result = await page.evaluate(async name => await window.__patrol__runTest!(name), name)
      if (result?.result === "failure") {
        throw new Error(result.details ?? `Test "${name}" failed`)
      }

      if (!collectCoverage) await page.close()
    })
  }
}
