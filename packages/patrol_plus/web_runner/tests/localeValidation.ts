/**
 * F-D — pure validation logic for the in-flow `setLocale` native action
 * (patrol-visual-review-overhaul-DESIGN.md §2). Kept dependency-free (no
 * relative imports) so it can be unit-tested directly with `node --test`,
 * the same shape as `resolveLocale.ts` / `filterByTags.ts`. See
 * `actions/setLocale.ts` for how this is used against a real `Page`.
 */

/**
 * Chromium's `Emulation.setLocaleOverride` treats an empty/unset `locale` as
 * "disable the override and restore the default host locale"
 * (https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setLocaleOverride)
 * — the opposite of what a caller passing an accidentally-empty string
 * wants. Reject that case up front with a clear error instead of silently
 * doing nothing.
 */
export function assertNonEmptyLocale(locale: string): void {
  if (!locale || locale.trim().length === 0) {
    throw new Error(
      "setLocale: locale must be a non-empty string (Chromium's Emulation.setLocaleOverride treats an " +
        "empty value as 'restore default locale', not 'no-op' — that is almost certainly not what a caller " +
        "passing an empty string intended).",
    )
  }
}
