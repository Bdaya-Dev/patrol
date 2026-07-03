import assert from "node:assert/strict"
import { test } from "node:test"
import { isExcludedCoverageEntry } from "./coverageEntryFilter.ts"

test("isExcludedCoverageEntry: excludes DDC infrastructure scripts (unchanged from the original regex)", () => {
  // The dart_sdk/ddc_module_loader alternatives require a full slash-delimited
  // PATH SEGMENT (unchanged behaviour, not touched by the canvaskit fix below) —
  // dwds serves the SDK/module-loader JS under a directory of that name.
  assert.equal(isExcludedCoverageEntry("http://localhost:1234/dart_sdk/dart_sdk.js"), true)
  assert.equal(isExcludedCoverageEntry("http://localhost:1234/ddc_module_loader/ddc_module_loader.js"), true)
  assert.equal(isExcludedCoverageEntry("http://localhost:1234/dwds/injected_client.js"), true)
})

test("isExcludedCoverageEntry: excludes the real flutter-canvaskit loader URL (the entryFilter near-miss fix)", () => {
  // Real URL shape from the R5 doc's captured lcov.info: the CanvasKit
  // loader survived the OLD `/canvaskit/` (exact-segment) regex because the
  // actual URL segment is "flutter-canvaskit", not "canvaskit" — a
  // near-miss that let it through as a spurious LH>0 entry.
  assert.equal(
    isExcludedCoverageEntry("https://www.gstatic.com/flutter-canvaskit/1234567890abcdef/canvaskit.js"),
    true,
  )
})

test("isExcludedCoverageEntry: still excludes a bare /canvaskit/ segment (no regression)", () => {
  assert.equal(isExcludedCoverageEntry("https://example.com/canvaskit/canvaskit.js"), true)
})

test("isExcludedCoverageEntry: does not exclude the app's own dart2js bundle or unrelated assets", () => {
  assert.equal(isExcludedCoverageEntry("http://localhost:1234/main.dart.js"), false)
  assert.equal(isExcludedCoverageEntry("http://localhost:1234/assets/fonts/Roboto.ttf"), false)
})

test("isExcludedCoverageEntry: does not over-match an unrelated word merely containing 'dwds' or 'canvaskit' as a substring, not a path segment", () => {
  assert.equal(isExcludedCoverageEntry("http://localhost:1234/mydwdsstuff.js"), false)
  assert.equal(isExcludedCoverageEntry("http://localhost:1234/mycanvaskitthing.js"), false)
})
