import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import { buildCoverageSummary, parseLcovSummary, writeCoverageSummary } from "./coverageSummary.ts"

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coverage-summary-test-"))
}

const lcovFixture = [
  "SF:/abs/lib/a.dart",
  "DA:1,1",
  "DA:2,0",
  "LH:1",
  "LF:2",
  "end_of_record",
  "SF:/abs/lib/b.dart",
  "DA:1,0",
  "LH:0",
  "LF:1",
  "end_of_record",
].join("\n")

// ---------------------------------------------------------------------------
// parseLcovSummary
// ---------------------------------------------------------------------------

test("parseLcovSummary: extracts one SourceCoverage per SF:/LH:/LF: block", () => {
  const sources = parseLcovSummary(lcovFixture)
  assert.deepEqual(sources, [
    { path: "/abs/lib/a.dart", linesCovered: 1, linesTotal: 2 },
    { path: "/abs/lib/b.dart", linesCovered: 0, linesTotal: 1 },
  ])
})

test("parseLcovSummary: ignores unrelated record types (DA:, FN:, BRDA:, …)", () => {
  const lcov = [
    "SF:/abs/lib/c.dart",
    "FN:1,main",
    "FNDA:1,main",
    "DA:1,1",
    "BRDA:1,0,0,1",
    "LH:1",
    "LF:1",
    "end_of_record",
  ].join("\n")
  assert.deepEqual(parseLcovSummary(lcov), [{ path: "/abs/lib/c.dart", linesCovered: 1, linesTotal: 1 }])
})

test("parseLcovSummary: a block missing LH or LF is dropped, not thrown", () => {
  const lcov = ["SF:/abs/lib/partial.dart", "DA:1,1", "LH:1", "end_of_record"].join("\n")
  assert.deepEqual(parseLcovSummary(lcov), [])
})

test("parseLcovSummary: a trailing block with no end_of_record is still flushed", () => {
  const lcov = ["SF:/abs/lib/trailing.dart", "LH:3", "LF:5"].join("\n")
  assert.deepEqual(parseLcovSummary(lcov), [{ path: "/abs/lib/trailing.dart", linesCovered: 3, linesTotal: 5 }])
})

test("parseLcovSummary: empty text yields an empty array", () => {
  assert.deepEqual(parseLcovSummary(""), [])
})

// ---------------------------------------------------------------------------
// buildCoverageSummary
// ---------------------------------------------------------------------------

test("buildCoverageSummary: aggregates totals and computes lineRate", () => {
  const summary = buildCoverageSummary(lcovFixture, () => new Date("2026-07-03T00:00:00.000Z"))
  assert.equal(summary.generatedAt, "2026-07-03T00:00:00.000Z")
  assert.equal(summary.sources.length, 2)
  assert.deepEqual(summary.totals, { linesCovered: 1, linesTotal: 3, lineRate: 1 / 3 })
})

test("buildCoverageSummary: an empty/whole-app-untouched report has lineRate 0, not NaN", () => {
  const summary = buildCoverageSummary("", () => new Date("2026-07-03T00:00:00.000Z"))
  assert.deepEqual(summary.sources, [])
  assert.deepEqual(summary.totals, { linesCovered: 0, linesTotal: 0, lineRate: 0 })
})

test("buildCoverageSummary: a fully-covered report has lineRate 1", () => {
  const lcov = ["SF:/abs/lib/full.dart", "LH:10", "LF:10", "end_of_record"].join("\n")
  const summary = buildCoverageSummary(lcov)
  assert.equal(summary.totals.lineRate, 1)
})

// ---------------------------------------------------------------------------
// writeCoverageSummary
// ---------------------------------------------------------------------------

test("writeCoverageSummary: reads the final lcov.info and writes a matching pretty-printed JSON summary alongside it", () => {
  const dir = makeTmpDir()
  try {
    const lcovPath = path.join(dir, "lcov.info")
    const summaryPath = path.join(dir, "coverage-summary.json")
    fs.writeFileSync(lcovPath, lcovFixture)

    const returned = writeCoverageSummary(lcovPath, summaryPath, () => new Date("2026-07-03T00:00:00.000Z"))

    assert.ok(fs.existsSync(summaryPath))
    const onDisk = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
    assert.deepEqual(onDisk, returned)
    assert.equal(onDisk.totals.linesTotal, 3)
    assert.equal(onDisk.totals.linesCovered, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("writeCoverageSummary: a missing lcov.info produces an empty (not thrown) summary", () => {
  const dir = makeTmpDir()
  try {
    const lcovPath = path.join(dir, "does-not-exist.info")
    const summaryPath = path.join(dir, "coverage-summary.json")

    const summary = writeCoverageSummary(lcovPath, summaryPath)

    assert.deepEqual(summary.sources, [])
    assert.equal(summary.totals.linesTotal, 0)
    assert.ok(fs.existsSync(summaryPath))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
