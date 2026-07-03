import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import {
  appendZeroFillLcov,
  countExecutableLines,
  parseLcovCoveredPaths,
  readLcovCoveredPaths,
  walkDartFiles,
} from "./zeroFillLcov.ts"

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zero-fill-lcov-test-"))
}

// ---------------------------------------------------------------------------
// countExecutableLines
// ---------------------------------------------------------------------------

test("countExecutableLines: counts non-blank, non-comment lines (1-based); a bare `}` line is skipped but a line that merely ENDS in `{` still counts (only an exactly-`{`/`}` trimmed line is brace-only)", () => {
  const source = ["import 'x.dart';", "", "class Foo {", "  int x = 1;", "}"].join("\n")
  assert.deepEqual(countExecutableLines(source), [1, 3, 4])
})

test("countExecutableLines: skips single-line `//` comments", () => {
  const source = ["// header comment", "final x = 1;", "  // indented comment"].join("\n")
  assert.deepEqual(countExecutableLines(source), [2])
})

test("countExecutableLines: skips multi-line block comments, resuming after the closer", () => {
  const source = ["final a = 1;", "/*", " * still a comment", " */", "final b = 2;"].join("\n")
  assert.deepEqual(countExecutableLines(source), [1, 5])
})

test("countExecutableLines: a block comment opened and closed on one line does not swallow the next line", () => {
  const source = ["/* inline */", "final a = 1;"].join("\n")
  assert.deepEqual(countExecutableLines(source), [2])
})

test("countExecutableLines: a line that is EXACTLY `{` or `}` after trimming is skipped; a line only sharing a brace with real code still counts", () => {
  const source = ["void main() {", "  print(1);", "}", "if (true) { print(2); }"].join("\n")
  assert.deepEqual(countExecutableLines(source), [1, 2, 4])
})

test("countExecutableLines: empty source yields no lines", () => {
  assert.deepEqual(countExecutableLines(""), [])
})

// ---------------------------------------------------------------------------
// parseLcovCoveredPaths / readLcovCoveredPaths
// ---------------------------------------------------------------------------

test("parseLcovCoveredPaths: extracts SF: paths, resolved absolute, ignoring other record types", () => {
  const lcov = [
    "SF:lib/a.dart",
    "DA:1,1",
    "LH:1",
    "LF:1",
    "end_of_record",
    "SF:lib/b.dart",
    "FNF:0",
    "end_of_record",
  ].join("\n")
  const paths = parseLcovCoveredPaths(lcov)
  assert.equal(paths.size, 2)
  assert.ok(paths.has(path.resolve("lib/a.dart")))
  assert.ok(paths.has(path.resolve("lib/b.dart")))
})

test("parseLcovCoveredPaths: empty text yields an empty set", () => {
  assert.deepEqual(parseLcovCoveredPaths(""), new Set())
})

test("readLcovCoveredPaths: a non-existent file yields an empty set (nothing covered yet)", () => {
  const dir = makeTmpDir()
  try {
    assert.deepEqual(readLcovCoveredPaths(path.join(dir, "does-not-exist.info")), new Set())
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("readLcovCoveredPaths: reads and parses an existing file", () => {
  const dir = makeTmpDir()
  try {
    const lcovPath = path.join(dir, "lcov.info")
    fs.writeFileSync(lcovPath, "SF:lib/a.dart\nLH:1\nLF:1\nend_of_record\n")
    const paths = readLcovCoveredPaths(lcovPath)
    assert.deepEqual(paths, new Set([path.resolve("lib/a.dart")]))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// walkDartFiles
// ---------------------------------------------------------------------------

test("walkDartFiles: a non-existent directory yields nothing", () => {
  const dir = makeTmpDir()
  try {
    assert.deepEqual([...walkDartFiles(path.join(dir, "missing"))], [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("walkDartFiles: recurses into subdirectories and only yields `.dart` files", () => {
  const dir = makeTmpDir()
  try {
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true })
    fs.writeFileSync(path.join(dir, "a.dart"), "final a = 1;\n")
    fs.writeFileSync(path.join(dir, "notes.txt"), "not dart\n")
    fs.writeFileSync(path.join(dir, "sub", "b.dart"), "final b = 2;\n")
    const found = [...walkDartFiles(dir)].map(f => path.relative(dir, f)).sort()
    assert.deepEqual(found, [path.join("sub", "b.dart"), "a.dart"].sort())
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// appendZeroFillLcov
// ---------------------------------------------------------------------------

/**
 * Builds a minimal fake Dart project under a fresh tmp dir:
 *   <root>/.dart_tool/package_config.json
 *   <root>/packages/<pkgName>/lib/<file>.dart   (one per entry in [packages])
 *
 * Mirrors the shape `buildPackageResolver`/`appendZeroFillLcov` expect —
 * `rootUri` relative to the config file's directory, `packageUri` defaulting
 * to `lib/`.
 */
function buildFakeProject(root: string, packages: Record<string, Record<string, string>>): void {
  const dartToolDir = path.join(root, ".dart_tool")
  fs.mkdirSync(dartToolDir, { recursive: true })

  const configPackages = Object.entries(packages).map(([name]) => ({
    name,
    rootUri: `../packages/${name}`,
    packageUri: "lib/",
  }))
  fs.writeFileSync(
    path.join(dartToolDir, "package_config.json"),
    JSON.stringify({ configVersion: 2, packages: configPackages }),
  )

  for (const [name, files] of Object.entries(packages)) {
    const libDir = path.join(root, "packages", name, "lib")
    fs.mkdirSync(libDir, { recursive: true })
    for (const [fileName, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(libDir, fileName)), { recursive: true })
      fs.writeFileSync(path.join(libDir, fileName), content)
    }
  }
}

test("appendZeroFillLcov: with no existing LCOV, zero-fills every executable-line .dart file across every package (packageFilter=null)", () => {
  const root = makeTmpDir()
  try {
    buildFakeProject(root, {
      app: { "main.dart": "void main() {\n  print(1);\n}\n" },
      other_pkg: { "helper.dart": "int helper() => 1;\n" },
    })
    const lcovPath = path.join(root, "lcov.info")

    appendZeroFillLcov(root, lcovPath, null)

    const lcovText = fs.readFileSync(lcovPath, "utf8")
    const covered = parseLcovCoveredPaths(lcovText)
    assert.equal(covered.size, 2, "both packages' files must be present")
    assert.ok(covered.has(path.resolve(root, "packages", "app", "lib", "main.dart")))
    assert.ok(covered.has(path.resolve(root, "packages", "other_pkg", "lib", "helper.dart")))
    // Zero-fill stanzas are zero-hit.
    assert.match(lcovText, /LH:0/)
    assert.doesNotMatch(lcovText, /LH:[1-9]/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test(
  "appendZeroFillLcov: the WHOLE-APP invariant (F-E) — packageFilter is the only selectivity knob; " +
    "there is no tag/test-selection parameter that could narrow the zero-fill walk to a scoped subset",
  () => {
    const root = makeTmpDir()
    try {
      // Three packages standing in for three concept-tagged flow areas. A
      // change-scoped CI run (PATROL_WEB_GREP filtering the executed test
      // list to e.g. only "@billing"-tagged tests) must NOT cause this
      // function to only zero-fill the billing package — appendZeroFillLcov
      // has no way to know which tests ran at all, by design.
      buildFakeProject(root, {
        billing_feature: { "billing.dart": "final billing = 1;\n" },
        invoicing_feature: { "invoicing.dart": "final invoicing = 1;\n" },
        identity_feature: { "identity.dart": "final identity = 1;\n" },
      })
      const lcovPath = path.join(root, "lcov.info")

      // Exactly how test.spec.ts calls this: packageFilter sourced ONLY from
      // PATROL_WEB_COVERAGE_FILTER (here, unset -> null), never from
      // PATROL_WEB_GREP/PATROL_WEB_GREP_INVERT.
      appendZeroFillLcov(root, lcovPath, null)

      const covered = parseLcovCoveredPaths(fs.readFileSync(lcovPath, "utf8"))
      assert.equal(covered.size, 3, "all three packages' sources must be zero-filled, not just one")
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  },
)

test("appendZeroFillLcov: packageFilter (PATROL_WEB_COVERAGE_FILTER) restricts which packages are walked", () => {
  const root = makeTmpDir()
  try {
    buildFakeProject(root, {
      app: { "main.dart": "void main() {\n  print(1);\n}\n" },
      other_pkg: { "helper.dart": "int helper() => 1;\n" },
    })
    const lcovPath = path.join(root, "lcov.info")

    appendZeroFillLcov(root, lcovPath, /^package:app\//)

    const covered = parseLcovCoveredPaths(fs.readFileSync(lcovPath, "utf8"))
    assert.equal(covered.size, 1)
    assert.ok(covered.has(path.resolve(root, "packages", "app", "lib", "main.dart")))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("appendZeroFillLcov: files already present in the LCOV are not duplicated", () => {
  const root = makeTmpDir()
  try {
    buildFakeProject(root, { app: { "main.dart": "void main() {\n  print(1);\n}\n" } })
    const lcovPath = path.join(root, "lcov.info")
    const alreadyCoveredPath = path.resolve(root, "packages", "app", "lib", "main.dart")
    fs.writeFileSync(lcovPath, `SF:${alreadyCoveredPath}\nDA:1,1\nLH:1\nLF:1\nend_of_record\n`)

    appendZeroFillLcov(root, lcovPath, null)

    const lcovText = fs.readFileSync(lcovPath, "utf8")
    const occurrences = lcovText.split(`SF:${alreadyCoveredPath}`).length - 1
    assert.equal(occurrences, 1, "the already-covered file must appear exactly once, not re-appended")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("appendZeroFillLcov: a file with zero executable lines is not zero-filled", () => {
  const root = makeTmpDir()
  try {
    buildFakeProject(root, { app: { "empty.dart": "// just a comment\n\n" } })
    const lcovPath = path.join(root, "lcov.info")

    appendZeroFillLcov(root, lcovPath, null)

    assert.equal(fs.existsSync(lcovPath), false, "no stanzas were appended, so the file is never created")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("appendZeroFillLcov: a missing package_config.json is a no-op, not a throw", () => {
  const root = makeTmpDir()
  try {
    const lcovPath = path.join(root, "lcov.info")
    assert.doesNotThrow(() => appendZeroFillLcov(root, lcovPath, null))
    assert.equal(fs.existsSync(lcovPath), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
