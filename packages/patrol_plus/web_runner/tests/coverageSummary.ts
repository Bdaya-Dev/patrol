import * as fs from "fs"

/**
 * F-E — coverage report emission for scoped runs
 * (patrol-visual-review-overhaul-DESIGN.md §2 "F-E", §5c). Kept dependency-free
 * (no relative imports) so the parsing/aggregation logic can be unit-tested
 * directly with `node --test`, the same shape as `resolveLocale.ts` /
 * `filterByTags.ts` / `resizeSettle.ts`.
 *
 * The fork's zero-fill pass (`appendZeroFillLcov` in `test.spec.ts`) already
 * walks every `.dart` file reachable from `.dart_tool/package_config.json` and
 * appends a zero-hit LCOV stanza for any file V8 never loaded. Crucially, that
 * walk is filtered ONLY by `PATROL_WEB_COVERAGE_FILTER` — never by the
 * test-selection tag filters (`PATROL_WEB_GREP` / `PATROL_WEB_GREP_INVERT`,
 * see `filterByTags.ts`). That decoupling is what makes a change-scoped run (a
 * tag-selected subset of flows) still produce an `lcov.info` denominator
 * against the WHOLE app, not just the sources the scoped flows happened to
 * touch — the invariant this module assumes and never re-derives.
 *
 * This module turns that whole-app, zero-filled `lcov.info` into a small
 * machine-readable per-source summary emitted alongside it, so downstream
 * tooling (the flow<->source manifest gap detector, §5b) can read
 * covered/total line counts per source without re-parsing LCOV itself.
 */

export interface SourceCoverage {
  /** Absolute path as recorded by the source file's `SF:` LCOV record. */
  path: string
  linesCovered: number
  linesTotal: number
}

export interface CoverageSummaryTotals {
  linesCovered: number
  linesTotal: number
  /** `linesCovered / linesTotal`. `0` (never `NaN`/`Infinity`) when linesTotal is `0`. */
  lineRate: number
}

export interface CoverageSummary {
  generatedAt: string
  sources: SourceCoverage[]
  totals: CoverageSummaryTotals
}

/**
 * Parses `SF:`/`LH:`/`LF:` records out of raw LCOV text into one
 * [SourceCoverage] per `end_of_record`-delimited block. Tolerant of the other
 * record types LCOV blocks carry (`DA:`, `FN:`, `BRDA:`, …) — those are
 * simply not among the three fields extracted. A block missing `SF:`, `LH:`,
 * or `LF:` (e.g. a truncated/interrupted write) is dropped rather than
 * throwing, so a best-effort summary can still be produced from a partial
 * file. A final block with no trailing `end_of_record` is still flushed.
 */
export function parseLcovSummary(lcovText: string): SourceCoverage[] {
  const sources: SourceCoverage[] = []
  let currentPath: string | null = null
  let linesCovered: number | null = null
  let linesTotal: number | null = null

  const flush = () => {
    if (currentPath !== null && linesCovered !== null && linesTotal !== null) {
      sources.push({ path: currentPath, linesCovered, linesTotal })
    }
    currentPath = null
    linesCovered = null
    linesTotal = null
  }

  for (const rawLine of lcovText.split("\n")) {
    const line = rawLine.trim()
    if (line.startsWith("SF:")) {
      currentPath = line.slice(3).trim()
    } else if (line.startsWith("LH:")) {
      linesCovered = Number.parseInt(line.slice(3).trim(), 10)
    } else if (line.startsWith("LF:")) {
      linesTotal = Number.parseInt(line.slice(3).trim(), 10)
    } else if (line === "end_of_record") {
      flush()
    }
  }
  // Tolerate a final block that never reached `end_of_record`.
  flush()

  return sources
}

/**
 * Builds the full per-run summary (per-source + whole-app totals) from raw
 * LCOV text. [now] is injectable so [generatedAt] is deterministic in tests.
 */
export function buildCoverageSummary(lcovText: string, now: () => Date = () => new Date()): CoverageSummary {
  const sources = parseLcovSummary(lcovText)
  const totals = sources.reduce(
    (acc, source) => {
      acc.linesCovered += source.linesCovered
      acc.linesTotal += source.linesTotal
      return acc
    },
    { linesCovered: 0, linesTotal: 0 },
  )

  return {
    generatedAt: now().toISOString(),
    sources,
    totals: {
      ...totals,
      lineRate: totals.linesTotal > 0 ? totals.linesCovered / totals.linesTotal : 0,
    },
  }
}

/**
 * Reads [lcovPath] (expected to be the FINAL, zero-filled `lcov.info` —
 * i.e. called after `appendZeroFillLcov` has run), builds the summary, and
 * writes it as pretty-printed JSON to [summaryPath]. Returns the summary for
 * callers that also want to log a headline number.
 *
 * A missing [lcovPath] (e.g. coverage collection was skipped entirely) is not
 * an error here — it produces an empty summary (`sources: []`,
 * `totals.linesTotal: 0`) rather than throwing, since this is only ever
 * invoked from the `coverageReporter` fixture teardown which already gates
 * on `PATROL_WEB_COVERAGE` being enabled.
 */
export function writeCoverageSummary(
  lcovPath: string,
  summaryPath: string,
  now: () => Date = () => new Date(),
): CoverageSummary {
  const lcovText = fs.existsSync(lcovPath) ? fs.readFileSync(lcovPath, "utf8") : ""
  const summary = buildCoverageSummary(lcovText, now)
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n")
  return summary
}
