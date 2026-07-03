import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import {
  buildPackageResolver,
  isSdkSource,
  normalizeAbsoluteSourcePath,
  resolveBundleRelativeSourcePath,
} from "./sourceMapResolver.ts"

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "source-map-resolver-test-"))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

// ---------------------------------------------------------------------------
// isSdkSource — dart2js scheme 1 (issue #28)
// ---------------------------------------------------------------------------

test("isSdkSource: true for org-dartlang-sdk: sources (any path)", () => {
  assert.equal(isSdkSource("org-dartlang-sdk:///dart-sdk/lib/core/print.dart"), true)
  assert.equal(isSdkSource("org-dartlang-sdk:///lib/_internal/js_runtime/lib/interceptors.dart"), true)
})

test("isSdkSource: false for package:, absolute-path, and relative sources", () => {
  assert.equal(isSdkSource("package:invora_flutter/main.dart"), false)
  assert.equal(isSdkSource("/C:/Users/x/Pub/Cache/hosted/pub.dev/asn1lib-1.6.5/lib/asn1lib.dart"), false)
  assert.equal(isSdkSource("../../../lib/features/shell/invora_app_shell.dart"), false)
})

// ---------------------------------------------------------------------------
// normalizeAbsoluteSourcePath — dart2js scheme 2 (issue #28)
// ---------------------------------------------------------------------------

test("normalizeAbsoluteSourcePath: strips the Windows /X:/... leading-slash form", () => {
  assert.equal(
    normalizeAbsoluteSourcePath("/C:/Users/ahmed/AppData/Local/Pub/Cache/hosted/pub.dev/asn1lib-1.6.5/lib/x.dart"),
    "C:/Users/ahmed/AppData/Local/Pub/Cache/hosted/pub.dev/asn1lib-1.6.5/lib/x.dart",
  )
})

test("normalizeAbsoluteSourcePath: passes a POSIX absolute path through unchanged", () => {
  assert.equal(
    normalizeAbsoluteSourcePath("/root/.pub-cache/hosted/pub.dev/asn1lib-1.6.5/lib/src/asn1object.dart"),
    "/root/.pub-cache/hosted/pub.dev/asn1lib-1.6.5/lib/src/asn1object.dart",
  )
})

test("normalizeAbsoluteSourcePath: null for a bundle-relative path", () => {
  assert.equal(normalizeAbsoluteSourcePath("../../../lib/features/shell/invora_app_shell.dart"), null)
  assert.equal(normalizeAbsoluteSourcePath("main.dart"), null)
})

test("normalizeAbsoluteSourcePath: null for a package: URI", () => {
  assert.equal(normalizeAbsoluteSourcePath("package:invora_flutter/main.dart"), null)
})

// ---------------------------------------------------------------------------
// resolveBundleRelativeSourcePath — dart2js scheme 3 (issue #28)
// ---------------------------------------------------------------------------

test("resolveBundleRelativeSourcePath: strips leading ../ climb, joins the rest onto projectRoot", () => {
  const projectRoot = path.join("D:", "invora-flutter")
  assert.equal(
    resolveBundleRelativeSourcePath("../../../lib/features/shell/invora_app_shell.dart", projectRoot),
    path.resolve(projectRoot, "lib/features/shell/invora_app_shell.dart"),
  )
})

test("resolveBundleRelativeSourcePath: a bare filename (no ../) still resolves against projectRoot", () => {
  const projectRoot = path.join("D:", "invora-flutter")
  assert.equal(resolveBundleRelativeSourcePath("main.dart", projectRoot), path.resolve(projectRoot, "main.dart"))
})

test("resolveBundleRelativeSourcePath: differing ../ depths collapse to the same projectRoot-relative file", () => {
  const projectRoot = path.join("D:", "invora-flutter")
  const oneUp = resolveBundleRelativeSourcePath("../lib/gen/protos/service.pb.dart", projectRoot)
  const threeUp = resolveBundleRelativeSourcePath("../../../lib/gen/protos/service.pb.dart", projectRoot)
  assert.equal(oneUp, threeUp)
  assert.equal(oneUp, path.resolve(projectRoot, "lib/gen/protos/service.pb.dart"))
})

// ---------------------------------------------------------------------------
// buildPackageResolver — end-to-end resolver, all four schemes
// ---------------------------------------------------------------------------

test("buildPackageResolver: package: scheme still resolves via package_config.json (DDC regression)", () => {
  const projectRoot = makeTmpDir()
  try {
    writeFile(
      path.join(projectRoot, ".dart_tool", "package_config.json"),
      JSON.stringify({
        configVersion: 2,
        packages: [{ name: "some_pkg", rootUri: "../packages/some_pkg", packageUri: "lib/" }],
      }),
    )
    writeFile(path.join(projectRoot, "packages", "some_pkg", "lib", "bar.dart"), "class Bar {}\n")

    const resolve = buildPackageResolver(projectRoot)
    assert.equal(resolve("package:some_pkg/bar.dart"), "class Bar {}\n")
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test("buildPackageResolver: package: scheme returns null for an unknown package (not thrown)", () => {
  const projectRoot = makeTmpDir()
  try {
    writeFile(path.join(projectRoot, ".dart_tool", "package_config.json"), JSON.stringify({ packages: [] }))
    const resolve = buildPackageResolver(projectRoot)
    assert.equal(resolve("package:nonexistent/x.dart"), null)
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test("buildPackageResolver: org-dartlang-sdk: sources are excluded (null), even without package_config.json", () => {
  const projectRoot = makeTmpDir()
  try {
    const resolve = buildPackageResolver(projectRoot)
    assert.equal(resolve("org-dartlang-sdk:///dart-sdk/lib/core/print.dart"), null)
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test("buildPackageResolver: absolute pub-cache path (Windows /X:/... form) resolves by direct read", () => {
  const projectRoot = makeTmpDir()
  const depRoot = makeTmpDir()
  try {
    const depFile = path.join(depRoot, "lib", "src", "thing.dart")
    writeFile(depFile, "class Thing {}\n")
    // Reconstruct the dart2js /X:/... form from the real absolute path so
    // this test is meaningful on both Windows (drive letter) and POSIX
    // (no drive letter — normalizeAbsoluteSourcePath's plain-absolute path).
    const driveMatch = depFile.match(/^([A-Za-z]):[\\/](.+)$/)
    const uri = driveMatch
      ? `/${driveMatch[1]}:/${driveMatch[2].replace(/\\/g, "/")}`
      : depFile.replace(/\\/g, "/")

    const resolve = buildPackageResolver(projectRoot)
    assert.equal(resolve(uri), "class Thing {}\n")
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
    fs.rmSync(depRoot, { recursive: true, force: true })
  }
})

test("buildPackageResolver: absolute path that doesn't exist on disk returns null (skip, not thrown)", () => {
  const projectRoot = makeTmpDir()
  try {
    const resolve = buildPackageResolver(projectRoot)
    const missing = path.join(projectRoot, "does-not-exist.dart").replace(/\\/g, "/")
    assert.equal(resolve(driveify(missing)), null)
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }

  function driveify(p: string): string {
    const m = p.match(/^([A-Za-z]):\/(.+)$/)
    return m ? `/${m[1]}:/${m[2]}` : p
  }
})

test("buildPackageResolver: bundle-relative first-party source resolves against projectRoot (the R5 finding)", () => {
  const projectRoot = makeTmpDir()
  try {
    writeFile(path.join(projectRoot, "lib", "features", "shell", "invora_app_shell.dart"), "class Shell {}\n")
    const resolve = buildPackageResolver(projectRoot)
    assert.equal(
      resolve("../../../lib/features/shell/invora_app_shell.dart"),
      "class Shell {}\n",
    )
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})

test("buildPackageResolver: bundle-relative source that doesn't exist returns null (skip, not thrown)", () => {
  const projectRoot = makeTmpDir()
  try {
    const resolve = buildPackageResolver(projectRoot)
    assert.equal(resolve("../../../lib/does/not/exist.dart"), null)
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})
