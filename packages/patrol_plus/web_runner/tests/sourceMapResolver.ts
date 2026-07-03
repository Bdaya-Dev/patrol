import * as fs from "fs"
import * as path from "path"

/**
 * dart2js / DDC source-map resolution (issue #28,
 * https://github.com/Bdaya-Dev/patrol/issues/28).
 *
 * Extracted out of `test.spec.ts` (same "pure, dependency-light, directly
 * testable module" pattern as `filterByTags.ts` / `resizeSettle.ts` /
 * `zeroFillLcov.ts`) so it can be unit-tested without booting the full
 * Playwright harness, and browser-tested against a REAL dart2js fixture
 * bundle (`sourceMapResolver.dart2js.browser.test.ts`).
 *
 * `buildPackageResolver`/`resolveSourceMaps` were originally written and
 * proven only against **DDC** (dartdevc) output, where the dev compiler's
 * own module system natively uses `package:<name>/<path>` source-map URIs.
 * Invora's `patrol-e2e` CI job instead runs `--profile` (dart2js), whose
 * source-map convention is different: dart2js emits three OTHER URI schemes
 * for a source, none of which are `package:`, so the original resolver's
 * `^package:` regex matched none of them and every dart2js source silently
 * lost its `sourcesContent`, producing a real `lcov.info` with 3,979 `SF:`
 * blocks and zero non-CanvasKit `LH>0` hits (see
 * invora-flutter#86 R5, `docs/patrol-coverage-r5-source-map-validation.md`,
 * for the full failure evidence including a real captured `lcov.info`).
 *
 * The three dart2js schemes, and how each is now handled:
 *
 * 1. `org-dartlang-sdk:///dart-sdk/lib/...` — Dart SDK internals. These are
 *    intentionally EXCLUDED (return `null`, same as an unresolved source):
 *    SDK source is not app coverage, and letting it through would pollute
 *    the app's zero-fill denominator and dilute per-file attribution.
 * 2. Absolute build-machine filesystem paths, e.g. (Windows)
 *    `/C:/Users/.../asn1lib-1.6.5/lib/src/asn1exception.dart` or (POSIX)
 *    `/root/.pub-cache/hosted/pub.dev/asn1lib-1.6.5/lib/src/...` — pub-cache
 *    dependency sources, emitted whenever the dependency is on a DIFFERENT
 *    filesystem drive/root than the compiled bundle. Resolved by reading
 *    the path directly, after normalizing the Windows `/X:/...`
 *    leading-slash-plus-drive-letter form dart2js emits.
 * 3. Paths relative to the compiled bundle's own output directory. This is
 *    NOT limited to first-party `lib/**` sources: when a pub-cache
 *    dependency happens to sit on the SAME filesystem drive/root as the
 *    compiled bundle, dart2js emits it as a bundle-relative path too, e.g.
 *    `../../../../../../../../Pub/Cache/hosted/pub.dev/asn1lib-1.6.5/lib/
 *    src/asn1octetstring.dart` (reproduced by forcing `PUB_CACHE` onto the
 *    checkout's own drive — see `sourceMapResolver.test.ts`) alongside the
 *    first-party shape, e.g. `../lib/features/shell/greeter.dart`.
 *
 *    Per the source-map spec, a relative `sources` entry resolves against
 *    the MAP's own location (`sourceRoot` / the directory the `.map` file
 *    itself was served from) — NOT against the project root (round-1
 *    review blocker: the original fix here unconditionally stripped every
 *    leading `../` and rejoined the remainder onto `projectRoot`, which
 *    only happens to be correct for a source that genuinely lives INSIDE
 *    `projectRoot`; for a same-drive pub-cache dependency the remainder is
 *    not `projectRoot`-relative at all, so it silently landed on a
 *    nonexistent path and resolved to `null`).
 *
 *    [resolveBundleRelativeSourceCandidates] fixes this with two
 *    complementary strategies that BOTH first-party and pub-cache-as-
 *    relative sources flow through:
 *
 *      a. [resolveBundleRelativeSourcePath] (tried first) — the original
 *         strip-all-`../`-then-rejoin-onto-`projectRoot` shortcut. This
 *         stays exactly correct for any source that lives inside
 *         `projectRoot` REGARDLESS of how deeply nested the bundle's own
 *         (real or dart2js-conceptual) output directory is: if
 *         `uri === "../".repeat(depth) + rest` — which is exactly what a
 *         relative path from `projectRoot/X` (`depth(X) === depth`) to
 *         `projectRoot/rest` looks like — stripping every leading `../`
 *         always reconstructs `rest` exactly, independent of `depth`. So
 *         first-party `lib/**` attribution keeps working unconditionally,
 *         without needing to know the bundle's true output-directory depth
 *         (which Invora's real evidence and this fork's own dart2js
 *         fixture do NOT agree on — 3 climbs vs. 1 — because dart2js's
 *         notion of the bundle's directory need not correspond to any
 *         single real, guessable filesystem depth).
 *      b. Real candidate bundle-output directories, derived from
 *         `entryUrl`/`mapUrl` (tried next, in order, when (a) doesn't
 *         resolve to a file on disk) — [uri]'s `../` climb is resolved
 *         AS-IS (no stripping) against each of `build/web`, `web`, and
 *         bare `projectRoot`, joined with the URL path segment the bundle
 *         was actually served from. This is what correctly reaches a
 *         same-drive pub-cache dependency OUTSIDE `projectRoot`: strategy
 *         (a) can't, because the remainder after stripping isn't
 *         `projectRoot`-relative, but a genuine (non-stripped) relative
 *         resolution against the REAL bundle directory is — verified
 *         empirically against a real `dart compile js -o web/main.dart.js`
 *         fixture output with `PUB_CACHE` forced onto the checkout's own
 *         drive (see `sourceMapResolver.test.ts` and
 *         `sourceMapResolver.dart2js.browser.test.ts`).
 *
 * A source that resolves to nothing on disk (any scheme) returns `null` —
 * exactly like today's "unresolved" case — rather than throwing, so a
 * partially-stale or unusual build never crashes coverage collection.
 */

/** Dart SDK internals dart2js emits under this scheme. Never app coverage. */
const SDK_SOURCE_PREFIX = "org-dartlang-sdk:"

/**
 * Matches the Windows form dart2js emits for absolute pub-cache paths: a
 * leading POSIX-style `/` immediately followed by a drive letter, e.g.
 * `/C:/Users/ahmed/AppData/Local/Pub/Cache/hosted/pub.dev/asn1lib-1.6.5/
 * lib/src/asn1exception.dart`. `fs` needs the drive-letter form
 * (`C:/Users/...`) to resolve it on Windows.
 */
const WINDOWS_DRIVE_SOURCE = /^\/([A-Za-z]:\/.+)$/

/**
 * True for `org-dartlang-sdk:` sources — Dart SDK internals, deliberately
 * excluded from app-coverage attribution (issue #28, fix item 1).
 */
export function isSdkSource(uri: string): boolean {
  return uri.startsWith(SDK_SOURCE_PREFIX)
}

/**
 * Normalizes a dart2js absolute-filesystem-path source into a path `fs` can
 * read, or `null` if [uri] isn't an absolute path at all (POSIX or the
 * Windows `/X:/...` form). Does not check the path actually exists.
 */
export function normalizeAbsoluteSourcePath(uri: string): string | null {
  const windowsMatch = uri.match(WINDOWS_DRIVE_SOURCE)
  if (windowsMatch) {
    return windowsMatch[1]
  }
  if (path.isAbsolute(uri)) {
    return uri
  }
  return null
}

/**
 * Resolves a dart2js bundle-relative source (e.g.
 * `../../../lib/features/shell/invora_app_shell.dart`, or a bare
 * `main.dart` for the entrypoint itself) against [projectRoot], by
 * discarding the leading `../` climb and joining what's left onto
 * [projectRoot]. Does not check the path actually exists.
 *
 * Exact for any source that lives INSIDE [projectRoot] (first-party
 * `lib/**`), independent of the bundle's true output-directory depth — see
 * this file's top doc comment, strategy (a), for why. NOT correct for a
 * source outside [projectRoot] (e.g. a same-drive pub-cache dependency) —
 * use [resolveBundleRelativeSourceCandidates] for the general case.
 */
export function resolveBundleRelativeSourcePath(uri: string, projectRoot: string): string {
  const stripped = uri.replace(/^(\.\.\/)+/, "")
  return path.resolve(projectRoot, stripped)
}

/**
 * Conventional on-disk locations, relative to [projectRoot], where a Dart
 * web build's compiled JS bundle (and its `.map`) can live — tried in
 * order as the base for a GENUINE (non-stripped) relative resolution of a
 * bundle-relative source, until one lands on a real file:
 *
 *   - `build/web` — `flutter build web`'s standard output directory.
 *   - `web`       — the Dart/Flutter web entrypoint directory itself;
 *                    where `dart compile js -o web/main.dart.js
 *                    web/main.dart` (this fork's own dart2js fixture, and
 *                    Invora's `WebTestBackend`'s `flutter run -d chrome`
 *                    dev-server coverage path) serves the bundle from.
 *   - "" (bare `projectRoot`) — last-resort fallback for unusual layouts.
 */
const BUNDLE_OUTPUT_SUBDIRS = ["build/web", "web", ""]

/**
 * The directory segment of [url]'s path — e.g. `/` for
 * `http://host:1234/main.dart.js`, or `/assets` for
 * `http://host:1234/assets/main.dart.js` — or `null` if [url] isn't a
 * parseable absolute URL (e.g. empty/undefined, as in a caller that hasn't
 * threaded `entryUrl`/`mapUrl` through, such as a direct unit test of
 * [buildPackageResolver]'s `package:` branch).
 */
function urlDirSegment(url: string): string | null {
  try {
    return path.dirname(new URL(url).pathname)
  } catch {
    return null
  }
}

/**
 * Ordered candidate absolute paths for a bundle-relative source-map [uri]
 * (dart2js schemes 2-as-relative and 3, issue #28 round-1 review blocker).
 * The caller should `readIfExists` each in order and use the first that
 * resolves to a real file — see this file's top doc comment for the full
 * rationale.
 *
 * [entryUrl] and [mapUrl] are the coverage entry's compiled-JS URL and its
 * resolved source-map URL respectively (`mapUrl` is preferred, since per
 * the source-map spec a relative `sources` entry resolves against the
 * map's own location; `entryUrl` is the fallback when `mapUrl` isn't a
 * parseable URL).
 */
export function resolveBundleRelativeSourceCandidates(
  uri: string,
  projectRoot: string,
  entryUrl: string,
  mapUrl: string,
): string[] {
  const candidates = [resolveBundleRelativeSourcePath(uri, projectRoot)]
  const urlDir = urlDirSegment(mapUrl) ?? urlDirSegment(entryUrl) ?? "/"
  for (const subdir of BUNDLE_OUTPUT_SUBDIRS) {
    // path.join treats a leading "/" in urlDir as just another path
    // segment (not an absolute-path reset) once combined with projectRoot
    // + subdir, so every candidate stays anchored under projectRoot.
    candidates.push(path.resolve(path.join(projectRoot, subdir, urlDir), uri))
  }
  return candidates
}

function readIfExists(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8")
    }
  } catch {
    // Unreadable (permissions, race with a concurrent build, etc.) — treat
    // the same as "not found": skip, don't crash coverage collection.
  }
  return null
}

/**
 * Builds a `package:<name>/<path>` -> absolute lib dir map from
 * `.dart_tool/package_config.json` under [projectRoot], if present. Used
 * only for the DDC-mode `package:` scheme; the other three schemes resolve
 * directly against [projectRoot]/the filesystem and don't need it.
 */
function loadPackageRoots(projectRoot: string): Record<string, string> {
  const configPath = path.join(projectRoot, ".dart_tool", "package_config.json")
  const packages: Record<string, string> = {}
  if (!fs.existsSync(configPath)) {
    return packages
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  for (const pkg of config.packages ?? []) {
    const rootUri = (pkg.rootUri as string).replace(/\/$/, "")
    const absRoot = path.resolve(path.dirname(configPath), rootUri)
    packages[pkg.name] = path.join(absRoot, pkg.packageUri ?? "lib/")
  }
  return packages
}

/**
 * Builds a source-map `sources` entry resolver for a Dart web build rooted
 * at [projectRoot]. Recognizes, in order:
 *
 *   1. `package:<name>/<path>` (DDC) — via `.dart_tool/package_config.json`.
 *   2. `org-dartlang-sdk:` (dart2js) — excluded, always `null`.
 *   3. Absolute filesystem paths, POSIX or Windows `/X:/...` (dart2js
 *      pub-cache dependency sources on a DIFFERENT drive/root than the
 *      bundle).
 *   4. Everything else, treated as bundle-relative — dart2js first-party
 *      `lib/**`/entrypoint sources, AND pub-cache dependency sources on
 *      the SAME drive/root as the bundle (see
 *      [resolveBundleRelativeSourceCandidates]'s doc comment).
 *
 * Returns a function from source-map `sources` URI (plus the coverage
 * entry's `entryUrl`/`mapUrl`, used only by branch 4 above) to file text,
 * or `null` when the source can't be resolved to a real file (excluded
 * scheme, unknown package, or the file doesn't exist on disk under any
 * candidate).
 */
export function buildPackageResolver(projectRoot: string) {
  const packages = loadPackageRoots(projectRoot)

  return (uri: string, entryUrl = "", mapUrl = ""): string | null => {
    const packageMatch = uri.match(/^package:([^/]+)\/(.+)$/)
    if (packageMatch) {
      const [, pkgName, relPath] = packageMatch
      const pkgLibDir = packages[pkgName]
      if (!pkgLibDir) {
        return null
      }
      return readIfExists(path.join(pkgLibDir, relPath))
    }

    if (isSdkSource(uri)) {
      return null
    }

    const absolutePath = normalizeAbsoluteSourcePath(uri)
    if (absolutePath) {
      return readIfExists(absolutePath)
    }

    for (const candidate of resolveBundleRelativeSourceCandidates(uri, projectRoot, entryUrl, mapUrl)) {
      const content = readIfExists(candidate)
      if (content !== null) {
        return content
      }
    }
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveSourceMaps(entries: any[], projectRoot: string | null) {
  const resolve = projectRoot ? buildPackageResolver(projectRoot) : null
  for (const entry of entries) {
    if (entry.source && !entry.sourceMap) {
      const match = entry.source.match(/\/\/[#@]\s*sourceMappingURL=(\S+)/)
      if (match) {
        const mapUrl = new URL(match[1], entry.url).toString()
        try {
          const res = await fetch(mapUrl)
          if (res.ok) {
            const data = await res.json()
            if (data.sources && !data.sourcesContent) {
              data.sourcesContent = data.sources.map((s: string) => (resolve ? resolve(s, entry.url, mapUrl) : null) ?? "")
            }
            entry.sourceMap = data
          }
        } catch {
          // Source map fetch failed — coverage will use JS paths
        }
      }
    }
  }
}
