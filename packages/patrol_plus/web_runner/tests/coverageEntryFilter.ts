/**
 * Default V8-coverage-entry exclusion for `monocart-coverage-reports`'
 * `entryFilter` (`test.spec.ts`'s `coverageReporter` fixture). Extracted so
 * it's directly unit-testable (same pattern as `filterByTags.ts` /
 * `sourceMapResolver.ts`).
 *
 * Excludes DDC's dev-only infrastructure scripts (the Dart SDK's own
 * `dart_sdk.js`, the module loader, `dwds`) and the CanvasKit renderer
 * loader — none of these carry attributable Dart coverage.
 *
 * Near-miss fix (noted alongside issue #28, invora-flutter#86 R5 §
 * "Evidence"): the original regex's `canvaskit` alternative required an
 * EXACT slash-delimited segment (`/canvaskit/`), but the real asset URL
 * Flutter web serves is `flutter-canvaskit`
 * (`https://www.gstatic.com/flutter-canvaskit/<version>/canvaskit.js`) — a
 * single segment, not two — so `/canvaskit/` never matched
 * `/flutter-canvaskit/` and the loader slipped through as a spurious
 * `LH>0` entry in the final `lcov.info` (confirmed in the R5 doc's captured
 * artifact: the ONE non-zero block out of 3,980 was this loader). The fixed
 * alternative allows an optional `<word>-` prefix on the `canvaskit`
 * segment so `flutter-canvaskit` (and plain `canvaskit`) both match.
 */
export const DEFAULT_COVERAGE_ENTRY_EXCLUDES = /\/(dart_sdk|(?:[\w]+-)?canvaskit|ddc_module_loader|dwds)\//

/**
 * True when [url] should be EXCLUDED from coverage attribution (DDC
 * infrastructure scripts, the CanvasKit loader) — the inverse of
 * `entryFilter`'s expected return value; callers should `return false` from
 * `entryFilter` when this is `true`.
 */
export function isExcludedCoverageEntry(url: string): boolean {
  return DEFAULT_COVERAGE_ENTRY_EXCLUDES.test(url)
}
