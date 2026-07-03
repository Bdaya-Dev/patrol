import * as fs from "fs"
import * as path from "path"
import { logger } from "./logger.ts"

/**
 * Zero-fill LCOV — the deterministic whole-app coverage denominator
 * (patrol-visual-review-overhaul-DESIGN.md §5a "Zero-fill for untouched
 * files"). Extracted out of `test.spec.ts` (F-E,
 * patrol-visual-review-overhaul-DESIGN.md §2 "F-E", §5c) so it is
 * unit-testable directly with `node --test`, the same shape as
 * `filterByTags.ts` / `resizeSettle.ts`.
 *
 * F-E invariant: [appendZeroFillLcov]'s only selectivity knob is
 * [packageFilter] (sourced from `PATROL_WEB_COVERAGE_FILTER` in
 * `test.spec.ts`). It has no parameter for, and is never called with, the
 * test-selection tag filters (`PATROL_WEB_GREP` / `PATROL_WEB_GREP_INVERT`,
 * see `filterByTags.ts`) or the discovered/selected test list. So a
 * change-scoped run — one that tag-filtered its test selection down to a
 * subset of flows — still zero-fills (and therefore reports LF/LH against)
 * every `.dart` file reachable from `package_config.json`, i.e. the WHOLE
 * app, not just the sources the scoped flows happened to touch.
 */

/**
 * Counts the lines in [source] that are likely executable (non-blank,
 * not pure-comment lines). This is a conservative approximation — good
 * enough for LF/LH accuracy without a full Dart parser.
 */
export function countExecutableLines(source: string): number[] {
  const lines = source.split("\n")
  const lineNumbers: number[] = []
  let inBlockComment = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false
      continue
    }
    if (trimmed.startsWith("/*")) {
      inBlockComment = !trimmed.includes("*/")
      continue
    }
    if (trimmed === "" || trimmed.startsWith("//") || trimmed === "{" || trimmed === "}") {
      continue
    }
    lineNumbers.push(i + 1) // 1-based
  }
  return lineNumbers
}

/**
 * Parses the `SF:` lines out of raw LCOV text and returns a Set of the
 * absolute paths already present in the report (resolved against `cwd`, the
 * same as the original inline implementation this was extracted from).
 */
export function parseLcovCoveredPaths(lcovText: string): Set<string> {
  const covered = new Set<string>()
  for (const line of lcovText.split("\n")) {
    if (line.startsWith("SF:")) {
      covered.add(path.resolve(line.slice(3).trim()))
    }
  }
  return covered
}

/**
 * Reads [lcovPath] and returns [parseLcovCoveredPaths] of its contents. An
 * absent file yields an empty set (nothing covered yet).
 */
export function readLcovCoveredPaths(lcovPath: string): Set<string> {
  if (!fs.existsSync(lcovPath)) return new Set()
  return parseLcovCoveredPaths(fs.readFileSync(lcovPath, "utf8"))
}

/**
 * Walks [dir] recursively and yields absolute paths for every `.dart` file.
 */
export function* walkDartFiles(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkDartFiles(full)
    } else if (entry.isFile() && entry.name.endsWith(".dart")) {
      yield full
    }
  }
}

/**
 * Appends zero-fill LCOV stanzas to [lcovPath] for every `.dart` file found
 * under the `lib/` directory of each package in `package_config.json` that:
 *   - is not already present in [lcovPath], and
 *   - matches [packageFilter] when applied to `package:<name>/…` URIs
 *     (when [packageFilter] is null, all packages are included).
 *
 * Files whose absolute path is inside `node_modules` or `.dart_tool` are
 * always skipped. See the module doc for the F-E "whole app regardless of
 * PATROL_WEB_GREP" invariant this function is the mechanism for.
 */
export function appendZeroFillLcov(projectRoot: string, lcovPath: string, packageFilter: RegExp | null): void {
  const configPath = path.join(projectRoot, ".dart_tool", "package_config.json")
  if (!fs.existsSync(configPath)) {
    logger.warn("package_config.json not found at %s — skipping zero-fill", configPath)
    return
  }

  const config: { packages?: Array<{ name: string; rootUri: string; packageUri?: string }> } = JSON.parse(
    fs.readFileSync(configPath, "utf8"),
  )

  const coveredFiles = readLcovCoveredPaths(lcovPath)
  const stanzas: string[] = []

  for (const pkg of config.packages ?? []) {
    // Apply the same coverage filter that entryFilter uses, but against the
    // package URI scheme so the user's regex is meaningful.
    if (packageFilter && !packageFilter.test(`package:${pkg.name}/`)) {
      continue
    }

    const rootUri = (pkg.rootUri as string).replace(/\/$/, "")
    const absRoot = path.resolve(path.dirname(configPath), rootUri)
    const libDir = path.join(absRoot, (pkg.packageUri ?? "lib/").replace(/\/$/, ""))

    for (const dartFile of walkDartFiles(libDir)) {
      // Skip generated files and hidden directories
      if (dartFile.includes("node_modules") || dartFile.includes(".dart_tool")) continue

      const absFile = path.resolve(dartFile)
      if (coveredFiles.has(absFile)) continue

      const source = fs.readFileSync(absFile, "utf8")
      const executableLines = countExecutableLines(source)
      if (executableLines.length === 0) continue

      const daLines = executableLines.map(n => `DA:${n},0`).join("\n")
      stanzas.push(`SF:${absFile}\n${daLines}\nLH:0\nLF:${executableLines.length}\nend_of_record`)
    }
  }

  if (stanzas.length === 0) {
    logger.info("Zero-fill: all Dart files already present in LCOV (or no packages matched filter)")
    return
  }

  fs.appendFileSync(lcovPath, "\n" + stanzas.join("\n") + "\n")
  logger.info("Zero-fill: appended %d uncovered Dart file(s) to %s", stanzas.length, lcovPath)
}
