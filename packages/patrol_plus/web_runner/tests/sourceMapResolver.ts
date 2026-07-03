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
 *    dependency sources. Valid on the SAME machine that compiled the
 *    bundle, which for Invora's CI is the same job that later runs this
 *    resolver. Resolved by reading the path directly, after normalizing the
 *    Windows `/X:/...` leading-slash-plus-drive-letter form dart2js emits.
 * 3. Paths relative to the compiled bundle's own directory, for the app's
 *    first-party `lib/**` sources, e.g. `../../../lib/features/shell/
 *    invora_app_shell.dart`. Resolved by stripping the leading `../`
 *    traversal and joining the remainder onto `projectRoot` — every
 *    first-party dart2js source lives under `projectRoot` in exactly this
 *    shape (`lib/...`, `web/...`, `bin/...`), so once the climb back up to
 *    the bundle's directory is discarded, what is left is already a
 *    project-root-relative path. Mirrors how `zeroFillLcov.ts`'s
 *    `appendZeroFillLcov` already resolves package roots out of
 *    `.dart_tool/package_config.json`.
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
 */
export function resolveBundleRelativeSourcePath(uri: string, projectRoot: string): string {
  const stripped = uri.replace(/^(\.\.\/)+/, "")
  return path.resolve(projectRoot, stripped)
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
 *      pub-cache dependency sources).
 *   4. Everything else, treated as bundle-relative (dart2js first-party
 *      `lib/**`/entrypoint sources).
 *
 * Returns a function from source-map `sources` URI to file text, or `null`
 * when the source can't be resolved to a real file (excluded scheme,
 * unknown package, or the file doesn't exist on disk).
 */
export function buildPackageResolver(projectRoot: string) {
  const packages = loadPackageRoots(projectRoot)

  return (uri: string): string | null => {
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

    return readIfExists(resolveBundleRelativeSourcePath(uri, projectRoot))
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveSourceMaps(entries: any[], projectRoot: string | null) {
  const resolve = projectRoot ? buildPackageResolver(projectRoot) : () => null
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
              data.sourcesContent = data.sources.map((s: string) => resolve(s) ?? "")
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
