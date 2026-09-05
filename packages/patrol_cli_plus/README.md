<!-- Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md. -->
> **⚠️ Independent fork** — `patrol_cli_plus` is an independent fork of [Patrol](https://github.com/leancodepl/patrol), originally created by LeanCode. It is maintained by [Bdaya-Dev](https://github.com/Bdaya-Dev/patrol) and is **not maintained, supported, or endorsed by LeanCode**. Please report issues at <https://github.com/Bdaya-Dev/patrol/issues>, not to LeanCode. Both the original and this fork are licensed under the Apache License 2.0 (see LICENSE and NOTICE.md).

# patrol_cli_plus

[![patrol_plus on pub.dev][patrol_badge]][patrol_link]
[![patrol_cli_plus on pub.dev][patrol_cli_badge]][patrol_cli_link]
[![patrol_finders_plus on pub.dev][patrol_finders_badge]][patrol_finders_link]

A powerful, multiplatform E2E UI testing framework for Flutter apps that
overcomes the limitations of integration_test by handling native interactions.
Battle-tested and shaped by production-grade experience since 2022.

> **Patrol 4.7.0 adds Swift Package Manager support for iOS and macOS!**
> If you migrate your project to SPM, a few small setup changes are needed — see the [iOS setup][docs_ios_setup_spm] guide for details.

## Patrol CLI

Command-line tool to run and debug tests written with the [`patrol_plus`][patrol_link] framework.

## Installation

### From pub.dev

```console
$ dart pub global activate patrol_cli_plus
```

### From git

1. Make sure that you have Dart >= 2.18 installed.

   ```console
   $ dart --version
   ```

2. Clone the repo.
3. Go to `packages/patrol_cli_plus`.
4. Run `dart pub global activate --source path .`

### Troubleshooting

If you can't run `patrol` from the terminal and the error is something along the
lines of "command not found", make sure that you've added appropriate
directories to PATH:

- on Unix-like systems, add `$HOME/.pub-cache/bin`
- on Windows, add `%USERPROFILE%\AppData\Local\Pub\Cache\bin`

### Analytics

This fork sends **no** usage analytics: the upstream CLI reports command usage to
LeanCode's Google Analytics property, and `patrol_cli_plus` ships without any
measurement ID, so nothing is ever posted. The `PATROL_ANALYTICS_ENABLED`
environment variable is still accepted for compatibility but has no effect.

### Shell completion

Patrol CLI supports shell completion for bash, zsh and fish, thanks to the
[cli_completion package]. It will automatically append code necessary to make
the completion work to your shell's respective config file (e.g. `~/.zshrc`). To
disable this value, set the `PATROL_NO_COMPLETION` environment variable to any
value.

## Usage

Run `patrol --help` to see all available commands, or `patrol test --help`
for options specific to running tests. For the full documentation, see the
[upstream Patrol project][patrol_github_link].

[cli_completion package]: https://pub.dev/packages/cli_completion
[patrol_badge]: https://img.shields.io/pub/v/patrol_plus?label=patrol_plus
[patrol_finders_badge]: https://img.shields.io/pub/v/patrol_finders_plus?label=patrol_finders_plus
[patrol_cli_badge]: https://img.shields.io/pub/v/patrol_cli_plus?label=patrol_cli_plus
[patrol_link]: https://pub.dev/packages/patrol_plus
[patrol_finders_link]: https://pub.dev/packages/patrol_finders_plus
[patrol_cli_link]: https://pub.dev/packages/patrol_cli_plus
[docs_ios_setup_spm]: https://github.com/Bdaya-Dev/patrol/blob/master/docs/documentation/index.mdx
[patrol_github_link]: https://github.com/leancodepl/patrol
