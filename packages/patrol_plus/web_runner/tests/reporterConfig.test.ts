import assert from "node:assert/strict"
import * as path from "node:path"
import { test } from "node:test"
import { machineReportsDirFor, mapReporters } from "./reporterConfig.ts"

const MACHINE_REPORTS_DIR = "./playwright-report-machine-reports"

test("machineReportsDirFor: derives a sibling directory, never nested inside outputFolder", () => {
  const dir = machineReportsDirFor("./playwright-report")

  assert.equal(dir, "./playwright-report-machine-reports")
  // It must not be a path UNDER outputFolder (e.g. "./playwright-report/machine-reports")
  // -- that's exactly what would still be wiped by the html reporter's clear step.
  assert.ok(!dir.startsWith("./playwright-report/"))
})

test("mapReporters: html reporter uses outputFolder directly", () => {
  const reporters = mapReporters('["html"]', "./playwright-report", "./playwright-report-machine-reports")

  assert.deepEqual(reporters, [["html", { outputFolder: "./playwright-report", open: "never" }]])
})

test("mapReporters: json/junit write into machineReportsDir, NOT outputFolder", () => {
  const reporters = mapReporters('["json","junit"]', "./playwright-report", MACHINE_REPORTS_DIR)

  assert.deepEqual(reporters, [
    ["json", { outputFile: path.join(MACHINE_REPORTS_DIR, "results.json") }],
    ["junit", { outputFile: path.join(MACHINE_REPORTS_DIR, "results.xml") }],
  ])

  for (const [, opts] of reporters) {
    // The regression this guards against: a json/junit outputFile path
    // that lands inside outputFolder gets wiped the moment the html
    // reporter's own onEnd() clears/recreates that folder, if html runs
    // after json/junit in reporter registration order.
    assert.ok(!(opts as { outputFile: string }).outputFile.startsWith(path.join("playwright-report", "/")))
  }
})

test("mapReporters: html + json + junit together all resolve to independent, non-colliding paths", () => {
  const reporters = mapReporters('["json","junit","html"]', "./playwright-report", MACHINE_REPORTS_DIR)

  const [jsonEntry, junitEntry, htmlEntry] = reporters
  assert.equal(htmlEntry![1]!.outputFolder, "./playwright-report")
  assert.equal((jsonEntry![1] as { outputFile: string }).outputFile, path.join(MACHINE_REPORTS_DIR, "results.json"))
  assert.equal((junitEntry![1] as { outputFile: string }).outputFile, path.join(MACHINE_REPORTS_DIR, "results.xml"))
})

test("mapReporters: passthrough reporters (list/dot/line/github/null) need no options", () => {
  for (const name of ["list", "dot", "line", "github", "null"]) {
    const reporters = mapReporters(JSON.stringify([name]), "./playwright-report", "./dir")
    assert.deepEqual(reporters, [[name]])
  }
})

test("mapReporters: throws on an unsupported reporter name", () => {
  assert.throws(() => mapReporters('["spec"]', "./playwright-report", "./dir"), /Unsupported reporter: spec/)
})

test("mapReporters: throws when PATROL_WEB_REPORTER isn't a JSON array", () => {
  assert.throws(
    () => mapReporters('"html"', "./playwright-report", "./dir"),
    /PATROL_WEB_REPORTER must be a JSON array/,
  )
})
