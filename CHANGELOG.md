# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 2026-07-02

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_plus` - `v5.1.2`](#patrol_plus---v512)

---

#### `patrol_plus` - `v5.1.2`

 - **FIX**(patrol_plus): pin web runner browser locale to en-US (Flutter engine parseBrowserLanguages crash). ([bd557671](https://github.com/Bdaya-Dev/patrol/commit/bd557671410178a14dcbb7c2a19b0912c13873db))


## 2026-07-02

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_plus` - `v5.1.1`](#patrol_plus---v511)

---

#### `patrol_plus` - `v5.1.1`

 - **FIX**(patrol_plus): make terminate-suppression wording OS-agnostic. ([7b252556](https://github.com/Bdaya-Dev/patrol/commit/7b2525564cf0fcc351d992f0408594b864af5e9e))


## 2026-07-02

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_plus` - `v5.1.0`](#patrol_plus---v510)

---

#### `patrol_plus` - `v5.1.0`

 - **FEAT**(patrol_plus): web runner filters the discovered test list by `--tags`/`--exclude-tags` (via `PATROL_WEB_GREP`/`PATROL_WEB_GREP_INVERT`) before sharding; an empty match falls through to the existing "no tests assigned" placeholder instead of failing. ([77896d10](https://github.com/Bdaya-Dev/patrol/commit/77896d10a5b77bd54ff562e85a7e47d32b7dc754))


## 2026-07-02

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_cli_plus` - `v5.1.0`](#patrol_cli_plus---v510)

---

#### `patrol_cli_plus` - `v5.1.0`

 - **FEAT**(patrol_cli_plus): forward `--tags`/`--exclude-tags` to the web runner as `PATROL_WEB_GREP`/`PATROL_WEB_GREP_INVERT`, so web test runs can be filtered by tag like native runs already are. ([77896d10](https://github.com/Bdaya-Dev/patrol/commit/77896d10a5b77bd54ff562e85a7e47d32b7dc754))

## 2026-07-01

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_plus` - `v5.0.4`](#patrol_plus---v504)

---

#### `patrol_plus` - `v5.0.4`

 - **FIX**(patrol_plus): make iOS per-test relaunch robust on Xcode-26 / iOS-26 simulator ([#10](https://github.com/Bdaya-Dev/patrol/issues/10)). ([9aab2f34](https://github.com/Bdaya-Dev/patrol/commit/9aab2f34c5de347ee59050a642ebac619b3c067c))
 - **DOCS**(patrol_plus): add commit hash link to 5.0.3 changelog entry (melos format). ([965dfc06](https://github.com/Bdaya-Dev/patrol/commit/965dfc06bdc1eb535673f09ebab4057816d0b31f))


## 2026-06-30

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_cli_plus` - `v5.0.3`](#patrol_cli_plus---v503)

---

#### `patrol_cli_plus` - `v5.0.3`

 - **FIX**(patrol_cli_plus): target iOS simulators by UDID in test-without-building. ([1e565329](https://github.com/Bdaya-Dev/patrol/commit/1e5653298e1628b81e5477aceff5d35edec93572))


## 2026-06-09

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_plus` - `v5.0.1`](#patrol_plus---v501)

---

#### `patrol_plus` - `v5.0.1`

 - **FIX**(patrol_plus): honour --web-init-timeout in web test discovery and fail loudly on 0 tests. ([c9d76e25](https://github.com/Bdaya-Dev/patrol/commit/c9d76e25d6179cafd381dcbbc8d4ecb822bcbd48))


## 2026-06-09

### Changes

---

Packages with breaking changes:

 - There are no breaking changes in this release.

Packages with other changes:

 - [`patrol_cli_plus` - `v5.0.1`](#patrol_cli_plus---v501)

---

#### `patrol_cli_plus` - `v5.0.1`

 - **FIX**(patrol_cli_plus): compatibility checker no longer kills `flutter pub deps` before reading it on large projects. ([64c27d81](https://github.com/Bdaya-Dev/patrol/commit/64c27d8104e09ee60674713041173165a122519a))

