import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { resolveSourceMaps } from "./sourceMapResolver.ts"

/**
 * sourceMapResolver — REAL dart2js (`--profile`) fixture browser test
 * (issue #28, https://github.com/Bdaya-Dev/patrol/issues/28;
 * invora-flutter#86 R5, docs/patrol-coverage-r5-source-map-validation.md).
 *
 * F-D lesson applied here (per that fork test's own doc comment: a
 * FakePage/mock-map unit test "cannot catch" a real-artifact-chain bug):
 * `sourceMapResolver.test.ts` covers the resolver's four branches in
 * isolation with hand-built fixtures, which is necessary but NOT
 * sufficient — the ORIGINAL bug (R5) was only ever visible against a REAL
 * dart2js-compiled source map, because it's dart2js's specific choice of
 * URI schemes (not any property a hand-built mock would need to get right)
 * that broke `^package:`-only resolution. So this test:
 *
 *   1. Compiles a REAL, minimal dart2js bundle from
 *      `tests/fixtures/dart2js_fixture/` (fresh on every run — see that
 *      directory's `.gitignore`: the compiled `.js`/`.js.map` are never
 *      checked in stale) — the fixture deliberately imports a
 *      dependency-free pub.dev package (`asn1lib`) alongside its own
 *      nested `lib/features/shell/greeter.dart`, so the compiled source
 *      map's `sources` genuinely contains all three of issue #28's
 *      dart2js schemes: `org-dartlang-sdk:`, an absolute pub-cache
 *      filesystem path, and a bundle-relative first-party path — exactly
 *      the three shapes captured in the R5 doc's evidence.
 *   2. Serves the compiled bundle over a real local HTTP server (required:
 *      `resolveSourceMaps`'s `fetch(mapUrl)` needs an http(s) URL, not
 *      `file://`) and drives a REAL Chromium page against it via
 *      `playwright` (same dependency `tests/setup.ts` already uses) —
 *      collecting REAL V8 JS coverage via `page.coverage.startJSCoverage`/
 *      `stopJSCoverage`, the same API `test.spec.ts` uses in production.
 *   3. Runs the REAL, fixed `resolveSourceMaps` against those real
 *      entries, then feeds them into a REAL `monocart-coverage-reports`
 *      `CoverageReport` (the same package `test.spec.ts` uses) to produce
 *      an actual `lcov.info` — and asserts the first-party
 *      `greeter.dart` source shows a genuine `LH>0` hit, i.e. real
 *      per-Dart-file hit ATTRIBUTION, not merely that `sourcesContent` got
 *      populated. This is exactly Set 2 (§5b) of the P-COV design that R5
 *      blocked: "does a real hit resolve to a real Dart path".
 *
 * Regression proof (documented, not asserted in-test — same convention as
 * `inFlowSafety.browser.test.ts`'s round-1 finding): reverting
 * `sourceMapResolver.ts`'s dart2js branches back to the original
 * `^package:`-only `resolve()` and re-running this test reproduces the R5
 * failure exactly — `greeter.dart`'s `sourcesContent` entry is `""` and its
 * `lcov.info` block (if it appears at all) shows `LH:0`. Verified manually
 * before landing this test; see the PR description for the captured
 * before/after diff.
 */

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "dart2js_fixture",
)
const webDir = path.join(fixtureDir, "web")
const bundleJs = path.join(webDir, "main.dart.js")

// Round-1 review blocker 2: force PUB_CACHE onto the checkout's own drive
// rather than letting `dart pub get` use whatever the ambient/default pub
// cache happens to be. On a machine where the default pub cache and this
// checkout happen to sit on DIFFERENT filesystem drives/roots, dart2js
// emits the asn1lib dependency as an ABSOLUTE path (scheme 2) and the
// same-drive bug (round-1 review blocker 1 — a deep bundle-relative climb
// like `../../../../../../../../Pub/Cache/.../asn1octetstring.dart`) never
// gets exercised at all, silently making this regression test
// non-deterministic across environments. Forcing PUB_CACHE onto the
// checkout's own drive guarantees the bundle-relative shape every time
// (and is a no-op requirement on POSIX, where every path already shares
// the single `/` root) — see `sourceMapResolver.test.ts` for the
// equivalent synthetic unit-test coverage of both shapes.
//
// Deliberately a SIBLING of fixtureDir (`tests/fixtures/`), NOT nested
// inside it: a same-drive pub cache is still a real dependency OUTSIDE
// projectRoot (that's exactly what makes the bug reproduce — the old
// strip-all-`../`-then-rejoin-onto-projectRoot heuristic is only ever
// wrong for a source outside projectRoot; nesting the pub cache inside
// fixtureDir would make even the old, unfixed heuristic accidentally
// resolve it correctly, defeating this test's purpose). Gitignored via
// `web_runner/.gitignore`.
const pubCacheDir = path.join(fixtureDir, "..", "dart2js_fixture_pubcache_test")

// `shell: true` so `dart`/`dart.bat` resolves via PATHEXT on Windows (Flutter
// SDK installs both `dart` (POSIX) and `dart.bat` (Windows); Node's spawn
// without a shell requires the exact extension on win32) while remaining a
// plain PATH lookup on POSIX.
const dartAvailable = spawnSync("dart", ["--version"], { stdio: "ignore", shell: true }).status === 0

before(() => {
  if (!dartAvailable) return
  fs.mkdirSync(pubCacheDir, { recursive: true })
  const env = { ...process.env, PUB_CACHE: pubCacheDir }

  // `dart pub get` then `dart compile js` — real, fresh every run (see the
  // fixture directory's .gitignore doc comment). Both are fast (<2s) for
  // this deliberately tiny fixture.
  const pubGet = spawnSync("dart", ["pub", "get"], { cwd: fixtureDir, encoding: "utf8", shell: true, env })
  assert.equal(pubGet.status, 0, `dart pub get failed:\n${pubGet.stdout}\n${pubGet.stderr}`)

  const compile = spawnSync("dart", ["compile", "js", "-o", "web/main.dart.js", "web/main.dart"], {
    cwd: fixtureDir,
    encoding: "utf8",
    shell: true,
    env,
  })
  assert.equal(compile.status, 0, `dart compile js failed:\n${compile.stdout}\n${compile.stderr}`)
  assert.ok(fs.existsSync(bundleJs), "dart2js did not produce main.dart.js")
  assert.ok(fs.existsSync(`${bundleJs}.map`), "dart2js did not produce main.dart.js.map")
})

function serveDir(dir: string): Promise<{ server: http.Server; baseUrl: string }> {
  const mime: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".map": "application/json",
  }
  const server = http.createServer((req, res) => {
    const reqPath = (req.url ?? "/").split("?")[0]
    const filePath = path.join(dir, reqPath === "/" ? "/index.html" : reqPath)
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end()
      return
    }
    const ext = path.extname(filePath)
    res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" })
    res.end(fs.readFileSync(filePath))
  })
  return new Promise((resolve, reject) => {
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        reject(new Error("failed to determine server port"))
        return
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` })
    })
  })
}

test(
  "resolveSourceMaps against a REAL dart2js --profile bundle: first-party + pub-cache sources resolve, SDK sources excluded, real hits attribute to greeter.dart",
  { skip: dartAvailable ? false : "dart SDK not found on PATH — skipping real-dart2js fixture test" },
  async t => {
    const { server, baseUrl } = await serveDir(webDir)
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())))

    const browser = await chromium.launch()
    t.after(() => browser.close())
    const page = await browser.newPage()
    t.after(() => page.close())

    const pageErrors: string[] = []
    page.on("pageerror", error => pageErrors.push(error.message))

    await page.coverage.startJSCoverage()
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "load" })

    // Wait for main()'s two print() calls (routed to window.dartPrint by
    // the harness — see fixtures/dart2js_fixture/web/index.html) rather
    // than text-matching console output.
    await page.waitForFunction(
      () => Array.isArray((window as unknown as { __dartPrintLog?: unknown[] }).__dartPrintLog)
        && ((window as unknown as { __dartPrintLog: unknown[] }).__dartPrintLog.length >= 2),
      { timeout: 15000 },
    )

    const dartPrintLog = await page.evaluate(() => (window as unknown as { __dartPrintLog: string[] }).__dartPrintLog)
    assert.deepEqual(dartPrintLog, ["Hello, dart2js!", "patrol"], "fixture main() did not run to completion")
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join("; ")}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries: any[] = await page.coverage.stopJSCoverage()
    const bundleEntry = entries.find(e => e.url.endsWith("main.dart.js"))
    assert.ok(bundleEntry, `no coverage entry for main.dart.js among: ${entries.map(e => e.url).join(", ")}`)

    // ---- the fix under test ---------------------------------------------
    await resolveSourceMaps(entries, fixtureDir)

    assert.ok(bundleEntry.sourceMap, "resolveSourceMaps did not attach a sourceMap (fetch of main.dart.js.map failed)")
    const { sources, sourcesContent } = bundleEntry.sourceMap as { sources: string[]; sourcesContent: string[] }
    assert.ok(sources.length > 0, "compiled source map has no sources — fixture didn't compile as expected")

    const indexOf = (predicate: (s: string) => boolean): number => sources.findIndex(predicate)

    // Scheme 3 — bundle-relative first-party source (the R5 finding).
    const greeterIndex = indexOf(s => s.endsWith("lib/features/shell/greeter.dart"))
    assert.notEqual(greeterIndex, -1, `greeter.dart missing from compiled sources: ${sources.join(", ")}`)
    assert.match(
      sourcesContent[greeterIndex],
      /class Greeter/,
      "greeter.dart source did not resolve to its real file content",
    )

    // Scheme 2 (absolute pub-cache filesystem path, Windows /X:/... or
    // POSIX form — dependency on a DIFFERENT drive/root than the bundle) OR
    // scheme 3-as-dependency (deep bundle-relative climb, e.g.
    // `../../../../../../../../Pub/Cache/.../asn1octetstring.dart` —
    // dependency on the SAME drive/root as the bundle; round-1 review
    // blocker 1). `before()` forces PUB_CACHE onto the checkout's own
    // drive, so THIS test deterministically exercises the harder
    // bundle-relative shape on every machine/CI runner regardless of where
    // that machine's ambient default pub cache happens to live — but the
    // assertions below deliberately do NOT branch on which shape dart2js
    // actually emitted (round-1 review blocker 2): the same regex matches
    // an absolute-path OR a bundle-relative source string, and the content
    // assertion only cares that `sourcesContent` resolved to the real file
    // — so this test would keep passing unchanged if that forcing were
    // ever removed and a cross-drive checkout produced the absolute form
    // instead.
    const asn1Index = indexOf(s => /asn1lib-1\.6\.5[/\\].*asn1octetstring\.dart$/.test(s))
    assert.notEqual(asn1Index, -1, `asn1lib source missing from compiled sources: ${sources.join(", ")}`)
    assert.match(
      sourcesContent[asn1Index],
      /class ASN1OctetString/,
      "asn1lib pub-cache source did not resolve to its real file content",
    )

    // Scheme 1 — org-dartlang-sdk: sources are excluded, not merely
    // unresolved-by-accident: every one of them must be present (dart2js
    // always pulls in SDK internals) AND have empty sourcesContent.
    const sdkIndices = sources
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s.startsWith("org-dartlang-sdk:"))
    assert.ok(sdkIndices.length > 0, "fixture compiled with no org-dartlang-sdk: sources — fixture is not representative")
    for (const [sdkSource, i] of sdkIndices) {
      assert.equal(sourcesContent[i], "", `org-dartlang-sdk: source unexpectedly resolved: ${sdkSource}`)
    }

    // ---- real hit ATTRIBUTION, not just content resolution ---------------
    // This is the part a content-resolution-only assertion can't prove:
    // feed the REAL V8 entries (with their now-populated sourcesContent)
    // into the REAL monocart-coverage-reports pipeline test.spec.ts uses in
    // production, and check the resulting lcov.info shows a genuine LH>0
    // for greeter.dart — i.e. the exact "3,979 blocks, all LH:0" R5 failure
    // is fixed end-to-end, not just patched at the sourcesContent layer.
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-map-resolver-dart2js-mcr-"))
    t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }))

    const mod = await import("monocart-coverage-reports")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reporter: any = new (mod.default as any)({
      outputDir,
      reports: ["lcovonly"],
      name: "sourceMapResolver_dart2js_fixture",
      entryFilter: (entry: { url: string }) => entry.url.endsWith("main.dart.js"),
      logging: "off",
    })
    await reporter.add(entries)
    await reporter.generate()

    const lcovPath = path.join(outputDir, "lcov.info")
    assert.ok(fs.existsSync(lcovPath), "monocart did not produce lcov.info")
    const lcov = fs.readFileSync(lcovPath, "utf8")

    const greeterBlock = extractLcovBlock(lcov, "greeter.dart")
    assert.ok(greeterBlock, `no lcov SF: block for greeter.dart in:\n${lcov}`)
    assert.ok(
      greeterBlock.linesHit > 0,
      `greeter.dart shows LH:${greeterBlock.linesHit} — the R5 all-zero-hit bug is NOT fixed (real execution did not attribute to the resolved source)`,
    )
  },
)

function extractLcovBlock(lcov: string, sourceSuffix: string): { linesHit: number; linesTotal: number } | null {
  const blocks = lcov.split(/\nend_of_record\n?/)
  for (const block of blocks) {
    const sfLine = block.split("\n").find(l => l.startsWith("SF:"))
    if (!sfLine) continue
    const sf = sfLine.slice(3).trim().replace(/\\/g, "/")
    if (!sf.endsWith(sourceSuffix)) continue
    const lh = block.match(/^LH:(\d+)$/m)
    const lf = block.match(/^LF:(\d+)$/m)
    return { linesHit: lh ? Number(lh[1]) : 0, linesTotal: lf ? Number(lf[1]) : 0 }
  }
  return null
}
