const DEFAULT_LOCALE = "en-US"

/**
 * Resolves the locale to apply to the Playwright-launched Chromium context.
 *
 * Chromium launched with no explicit locale reports whatever `navigator.languages`
 * the host environment produces. On CI runners (e.g. GitHub's ubuntu-latest) that
 * can be a non-BCP-47 value derived from an unset/"C" `LANG`, and the Flutter web
 * engine's `parseBrowserLanguages()` feeds each entry straight into `Intl.Locale`
 * (flutter/flutter#172964, lib/web_ui/lib/src/engine/platform_dispatcher.dart —
 * `DomLocale(language)`), which throws `RangeError: Incorrect locale information
 * provided` on anything that isn't a well-formed language tag. That throw crashes
 * the app during boot, before any test can run ("Total: 0").
 *
 * Default to a well-formed locale unless the caller opted into a specific one via
 * --web-locale / PATROL_WEB_LOCALE.
 */
export function resolveLocale(env: NodeJS.ProcessEnv = process.env): string {
  return env.PATROL_WEB_LOCALE || DEFAULT_LOCALE
}
