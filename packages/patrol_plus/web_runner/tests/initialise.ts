import * as fs from "fs"
import * as path from "path"
import { Page } from "@playwright/test"
import { logger } from "./logger"

// How long to wait for the Flutter/Dart side to call back __patrol__onInitialised.
// Flutter WASM apps can take a long time to fully boot, so this is configurable
// via PATROL_WEB_INIT_TIMEOUT (milliseconds). Defaults to 120 seconds.
const initTimeout = process.env.PATROL_WEB_INIT_TIMEOUT
  ? parseInt(process.env.PATROL_WEB_INIT_TIMEOUT)
  : 120000

// Timeout for detecting DDC mode ($dartRunMain presence). Must be STRICTLY LESS
// than the per-test --web-timeout so that when $dartRunMain never appears
// (profile/release/WASM builds), the catch block fires while the page is still
// alive and we can proceed to the __patrol__onInitialised check.
//
// In DDC mode, all DDC modules load from localhost in ~15-30s, so 60s is
// comfortably sufficient. In profile/release mode, $dartRunMain never appears —
// this cap ensures the wait fails fast rather than consuming the entire test
// budget and leaving the page in a closed state when the catch block runs.
//
// BUG (fixed in 5.0.2): using initTimeout (e.g. 300s) here caused the test-level
// timeout (e.g. 120s) to fire first, which closed the page. The catch block
// swallowed the "Target page, context or browser has been closed" error and then
// the subsequent waitForFunction(__patrol__onInitialised) immediately threw the
// same error on the now-dead page — masking the real failure as "Total: 0".
const ddcDetectTimeout = Math.min(initTimeout, 60000)

// File used to persist the DDC-mode detection result from globalSetup (main process)
// to per-test setup (Playwright worker processes). globalSetup writes it after the
// first initialise() call; per-test calls read it and skip the 60s DDC detect when
// we already know this is a non-DDC build (profile/release/WASM).
//
// Without this, every test burns 60s on the DDC detect wait even though we already
// know from globalSetup that $dartRunMain never appears. With a --web-timeout=120s
// this consumed half the test budget before the test body even started, causing the
// test timeout to fire during the subsequent __patrol__onInitialised wait and
// producing the same "Target page closed / Total: 0" failure that 5.0.2 fixed in
// globalSetup — but now occurring in per-test setup instead.
const BUILD_MODE_FILE = path.resolve(process.cwd(), ".patrol_build_mode.json")

function loadBuildMode(): { isDDC: boolean } | null {
  try {
    const content = fs.readFileSync(BUILD_MODE_FILE, "utf8")
    return JSON.parse(content) as { isDDC: boolean }
  } catch {
    return null
  }
}

function saveBuildMode(isDDC: boolean): void {
  try {
    fs.writeFileSync(BUILD_MODE_FILE, JSON.stringify({ isDDC }))
  } catch (e) {
    logger.warn("Failed to persist build mode to %s: %s", BUILD_MODE_FILE, String(e))
  }
}

export async function initialise(page: Page) {
  // Set the flag on the current JS context as well (belt-and-suspenders with
  // the addInitScript registered by callers before navigation).
  await page.evaluate(() => {
    window.__patrol__isInitialised = true
  })

  // If we already know from a previous initialise() call (globalSetup) that this
  // is a non-DDC build, skip the 60s DDC detect entirely on per-test pages.
  const knownBuildMode = loadBuildMode()
  const skipDdcDetect = knownBuildMode !== null && !knownBuildMode.isDDC

  if (skipDdcDetect) {
    logger.info("Skipping DDC detection (non-DDC build confirmed from globalSetup)")
  } else {
    // In DDC debug mode (Flutter 3.41+ / Dart 3.11+, DWDS 26.x), the bootstrap
    // creates window.$dartRunMain() and waits for DWDS to call it. DWDS only
    // does this for the first browser connection; subsequent page loads (e.g. the
    // test phase after setup closes) never get the "run main" signal.
    //
    // Detect this and call $dartRunMain ourselves if DWDS hasn't.
    let detectedDDC = false
    try {
      logger.info("Waiting for DDC module loading to complete...")
      await page.waitForFunction(
        () => typeof window.$dartRunMain === "function",
        { timeout: ddcDetectTimeout },
      )
      detectedDDC = true

      // Give DWDS 2s to call $dartRunMain itself (avoids double-init race)
      await page.waitForFunction(() => !!window.$dartMainExecuted, { timeout: 2000 }).catch(() => {
        // DWDS didn't call it within 2s — we need to do it manually
      })

      const dartMainAlreadyRan = await page.evaluate(() => !!window.$dartMainExecuted)
      if (!dartMainAlreadyRan) {
        logger.info("DWDS did not call $dartRunMain — invoking it manually")
        await page.evaluate(() => window.$dartRunMain!())
      }
    } catch {
      // $dartRunMain may not exist in release/profile builds or WASM — that's fine,
      // the Dart entrypoint runs automatically in those modes.
      logger.info("No $dartRunMain found (non-DDC build?) — continuing")
    }

    // Persist the detection result so that subsequent per-test initialise() calls
    // (running in Playwright worker processes) can skip this wait.
    saveBuildMode(detectedDDC)
  }

  logger.info("Waiting for Flutter/Dart to set __patrol__onInitialised (timeout: %dms)...", initTimeout)

  // Log periodic progress so the user knows we are still waiting for WASM.
  const start = Date.now()
  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    logger.info("Still waiting for Flutter app to initialise... (%ss elapsed)", elapsed)
  }, 15000)

  try {
    await page.waitForFunction(
      () => {
        if (!window.__patrol__onInitialised) return false

        window.__patrol__onInitialised()

        return true
      },
      { timeout: initTimeout },
    )
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    logger.info("Flutter app initialised successfully (%ss)", elapsed)
  } finally {
    clearInterval(progressInterval)
  }
}
