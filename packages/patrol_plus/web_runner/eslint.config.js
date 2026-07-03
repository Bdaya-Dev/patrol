const { base, imports, a11y } = require("@leancodepl/eslint-config")

module.exports = [
  {
    // Generated dart2js output (fresh on every run of
    // sourceMapResolver.dart2js.browser.test.ts, issue #28 — see
    // tests/fixtures/dart2js_fixture/.gitignore) is not source we own and
    // is never checked in; lint would otherwise choke on a giant minified,
    // compiler-generated bundle if it happens to be present in the working
    // tree (e.g. right after `npm test`).
    ignores: [
      "tests/fixtures/dart2js_fixture/web/main.dart.js",
      "tests/fixtures/dart2js_fixture/web/main.dart.js.map",
      "tests/fixtures/dart2js_fixture/web/main.dart.js.deps",
      "tests/fixtures/dart2js_fixture/.dart_tool/**",
    ],
  },
  ...base,
  ...imports,
  ...a11y,
]
