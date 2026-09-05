<!-- Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md. -->
> **⚠️ Independent fork** — `patrol_finders_plus` is an independent fork of [Patrol](https://github.com/leancodepl/patrol), originally created by LeanCode. It is maintained by [Bdaya-Dev](https://github.com/Bdaya-Dev/patrol) and is **not maintained, supported, or endorsed by LeanCode**. Please report issues at <https://github.com/Bdaya-Dev/patrol/issues>, not to LeanCode. Both the original and this fork are licensed under the Apache License 2.0 (see LICENSE and NOTICE.md).

# patrol_finders_plus

[![patrol_plus on pub.dev][patrol_badge]][patrol_link]
[![patrol_cli_plus on pub.dev][patrol_cli_badge]][patrol_cli_link]
[![patrol_finders_plus on pub.dev][patrol_finders_badge]][patrol_finders_link]

A powerful, multiplatform E2E UI testing framework for Flutter apps that
overcomes the limitations of integration_test by handling native interactions,
battle-tested and shaped by production-grade experience.

## Patrol finders

`patrol_finders_plus` is a streamlined, high-level API on top of
`flutter_test`.

It provides a new custom finder system to make Flutter widget tests more
concise and understandable, and writing them – faster and more fun.

## Installation

```console
$ dart pub add patrol_finders_plus --dev
```

## Documentation

See the [upstream Patrol project](https://github.com/leancodepl/patrol) for
full documentation and usage guides.

### Custom finders

```dart
import 'package:example/main.dart';
import 'package:flutter/material.dart';
import 'package:patrol_finders_plus/patrol_finders_plus.dart';

void main() {
  patrolWidgetTest(
    'logs in successfully',
    ($) async {
      await $.pumpWidgetAndSettle(const ExampleApp());

      /// Finds widget with Key('emailInput') and enters text into it
      ///
      await $(#emailInput).enterText('user@example.com');

      /// Finds widget with Key('passwordInput') and enters text into it
      await $(#passwordInput).enterText('ny4ncat');

      // Finds all widgets with text 'Log in' which are descendants of widgets
      // with Key('box1'), which are descendants of a Scaffold widget, and taps
      // on the first 'Log in' text.
      await $(Scaffold).$(#box1).$('Log in').tap();

      // Finds all Scrollables which have Text descendant, and taps on the first
      // Scrollable
      await $(Scrollable).containing(Text).tap();

      // Finds all Scrollables which have ElevatedButton descendant and Text
      // descendant, and taps on the first Scrollable
      await $(Scrollable).containing(ElevatedButton).containing(Text).tap();

      // Finds all Scrollables which have TextButton descendant which has Text
      // descendant, and taps on the first Scrollabke
      await $(Scrollable).containing($(TextButton).$(Text)).tap();
    },
  );
}

```

[patrol_badge]: https://img.shields.io/pub/v/patrol_plus?label=patrol_plus
[patrol_finders_badge]: https://img.shields.io/pub/v/patrol_finders_plus?label=patrol_finders_plus
[patrol_cli_badge]: https://img.shields.io/pub/v/patrol_cli_plus?label=patrol_cli_plus
[patrol_link]: https://pub.dev/packages/patrol_plus
[patrol_finders_link]: https://pub.dev/packages/patrol_finders_plus
[patrol_cli_link]: https://pub.dev/packages/patrol_cli_plus
