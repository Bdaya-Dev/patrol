> **⚠️ Independent fork** — `patrol_plus` is an independent fork of [Patrol](https://github.com/leancodepl/patrol), originally created by LeanCode. It is maintained by [Bdaya-Dev](https://github.com/Bdaya-Dev/patrol) and is **not maintained, supported, or endorsed by LeanCode**. Please report issues at <https://github.com/Bdaya-Dev/patrol/issues>, not to LeanCode.

# Patrol

[![patrol_plus on pub.dev][patrol_badge]][patrol_link]
[![patrol_cli_plus on pub.dev][patrol_cli_badge]][patrol_cli_link]
[![patrol_finders_plus on pub.dev][patrol_finders_badge]][patrol_finders_link]

A powerful, multiplatform E2E UI testing framework for Flutter apps that
overcomes the limitations of integration_test by handling native interactions,
battle-tested and shaped by production-grade experience.

## Patrol

`patrol_plus` package builds on top of `flutter_test` and `integration_test`
to make it easy to control the native UI from Dart test code. It must be used
together with [`patrol_cli_plus`][patrol_cli_link].

It also provides a new custom finder system to make Flutter widget tests more
concise and understandable, and writing them – faster and more fun. If you
want to only use custom finders, check out
[`patrol_finders_plus`][patrol_finders_link].

## Installation

```console
$ dart pub add patrol_plus --dev
```

> ⚠️ Additional setup is required to run tests – install
> [`patrol_cli_plus`][patrol_cli_link]. This package's API matches
> [upstream Patrol](https://github.com/leancodepl/patrol); fork-specific
> changes are listed in this package's CHANGELOG.

## Usage

Patrol has 2 main features – native automation and custom finders. This
package's API matches [upstream Patrol](https://github.com/leancodepl/patrol);
see this package's CHANGELOG for fork-specific changes.

### Accessing native platform features

```dart
// example/patrol_test/example_test.dart
import 'package:example/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol_plus/patrol.dart';

void main() {
  patrolTest(
    'counter state is the same after going to home and going back',
    ($) async {
      await $.pumpWidgetAndSettle(const MyApp());

      await $(FloatingActionButton).tap();
      expect($(#counterText).text, '1');

      await $.platform.mobile.pressHome();
      await $.platform.mobile.pressDoubleRecentApps();

      expect($(#counterText).text, '1');
      await $(FloatingActionButton).tap();
      expect($(#counterText).text, '2');

      await $.platform.mobile.openNotifications();
      await $.platform.mobile.pressBack();
    },
  );
}
```

### Custom finders

```dart
import 'package:example/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol_plus/patrol.dart';

void main() {
  patrolTest(
    'logs in successfully',
    ($) async {
      await $.pumpWidgetAndSettle(const MyApp());

      await $(#emailInput).enterText('user@example.com');
      await $(#passwordInput).enterText('ny4ncat');

      // Finds all widgets with text 'Log in' which are descendants of widgets with key
      // box1, which are descendants of a Scaffold widget and tap on the first one.
      await $(Scaffold).$(#box1).$('Log in').tap();

      // Finds all Scrollables which have Text descendant
      $(Scrollable).containing(Text);

      // Finds all Scrollables which have a Button descendant which has a Text descendant
      $(Scrollable).containing($(Button).containing(Text));

      // Finds all Scrollables which have a Button descendant and a Text descendant
      $(Scrollable).containing(Button).containing(Text);
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
