<!-- Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md. -->
> **⚠️ Independent fork** — `Bdaya-Dev/patrol` is an independent fork of [Patrol](https://github.com/leancodepl/patrol), originally created by LeanCode. It is maintained by [Bdaya-Dev](https://github.com/Bdaya-Dev/patrol) and is **not maintained, supported, or endorsed by LeanCode**. Please report issues at <https://github.com/Bdaya-Dev/patrol/issues>, not to LeanCode.

# Patrol

[![codecov](https://codecov.io/gh/Bdaya-Dev/patrol/branch/master/graph/badge.svg)](https://codecov.io/gh/Bdaya-Dev/patrol)
[![patrol_plus on pub.dev][patrol_badge]][patrol_link]
[![patrol_cli_plus on pub.dev][patrol_cli_badge]][patrol_cli_link]
[![patrol_finders_plus on pub.dev][patrol_finders_badge]][patrol_finders_link]

A powerful, multiplatform E2E UI testing framework for Flutter apps that overcomes the limitations of integration_test by handling native interactions, battle-tested and shaped by production-grade experience.

## Patrol custom finders

Flutter's finders are powerful, but not very intuitive to use.

We took them and made something awesome.

Thanks to Patrol's custom finders, you'll take your tests from this:

```dart
testWidgets('signs up', (WidgetTester tester) async {
  await tester.pumpWidget(AwesomeApp());
  await tester.pumpAndSettle();

  await tester.enterText(
    find.byKey(Key('emailTextField')),
    'charlie@root.me',
  );
  await tester.pumpAndSettle();

  await tester.enterText(
    find.byKey(Key('nameTextField')),
    'Charlie',
  );
  await tester.pumpAndSettle();

  await tester.enterText(
    find.byKey(Key('passwordTextField')),
    'ny4ncat',
  );
  await tester.pumpAndSettle();

  await tester.tap(find.byKey(Key('termsCheckbox')));
  await tester.pumpAndSettle();

  await tester.tap(find.byKey(Key('signUpButton')));
  await tester.pumpAndSettle();

  expect(find.text('Welcome, Charlie!'), findsOneWidget);
});
```

to this:

```dart
patrolTest('signs up', (PatrolIntegrationTester $) async {
  await $.pumpWidgetAndSettle(AwesomeApp());

  await $(#emailTextField).enterText('charlie@root.me');
  await $(#nameTextField).enterText('Charlie');
  await $(#passwordTextField).enterText('ny4ncat');
  await $(#termsCheckbox).tap();
  await $(#signUpButton).tap();

  await $('Welcome, Charlie!').waitUntilVisible();
});
```

Learn more about custom finders in [packages/patrol_finders_plus][github_patrol_finders]!

Patrol's custom finders are also available standalone in [the patrol_finders
package][patrol_finders_link].

## Patrol native automation

Flutter's default [integration_test] package can't interact with the OS your
Flutter app is running on. This makes it impossible to test many critical
business features, such as:

- granting runtime permissions
- signing into the app which through WebView or Google Services
- tapping on notifications
- much more!

Patrol's native automation feature solves these problems:

```dart
void main() {
  patrolTest('showtime', (PatrolIntegrationTester $) async {
    await $.pumpWidgetAndSettle(AwesomeApp());
    // prepare network conditions
    await $.platform.mobile.enableCellular();
    await $.platform.mobile.disableWifi();

    // toggle system theme
    await $.platform.mobile.enableDarkMode();

    // handle native location permission request dialog
    await $.platform.mobile.selectFineLocation();
    await $.platform.mobile.grantPermissionWhenInUse();

    // tap on the first notification
    await $.platform.mobile.openNotifications();
    await $.platform.mobile.tapOnNotificationByIndex(0);
  });
}

```

## CLI

See [packages/patrol_cli_plus][github_patrol_cli].

The CLI is needed to enable Patrol's native automation feature in integration
tests. It also makes development of integration tests much faster thanks to [Hot
Restart].

To run widget tests, you can continue to use `flutter test`.

## Package

See [packages/patrol_plus][github_patrol].

## CI/CD Workflows

See [.github/WORKFLOWS.md][github_workflows] for detailed documentation about all GitHub Actions workflows, including test schedules, Flutter versions, and deployment pipelines.

## Patrol contracts generator

1. (Optionally) add new request type:

```dart
class OpenAppRequest {
  late String appId;
}
```

2. Add new method to `NativeAutomator`:

```dart
abstract class NativeAutomator<IOSServer, AndroidServer, DartClient> {
  ...
  void openApp(OpenAppRequest request);
  ...
}
```

3. Run `gen_from_schema` script, few files will be updated

## Develop patrol_cli_plus

If you have previously activated patrol_cli_plus run:

```bash
dart pub global deactivate patrol_cli_plus
```

then

```bash
cd packages/patrol_cli_plus
flutter pub global activate -s path .
```

[patrol_badge]: https://img.shields.io/pub/v/patrol_plus?label=patrol_plus
[patrol_finders_badge]: https://img.shields.io/pub/v/patrol_finders_plus?label=patrol_finders_plus
[patrol_cli_badge]: https://img.shields.io/pub/v/patrol_cli_plus?label=patrol_cli_plus
[patrol_link]: https://pub.dev/packages/patrol_plus
[patrol_finders_link]: https://pub.dev/packages/patrol_finders_plus
[patrol_cli_link]: https://pub.dev/packages/patrol_cli_plus
[github_patrol]: https://github.com/Bdaya-Dev/patrol/tree/master/packages/patrol_plus
[github_patrol_cli]: https://github.com/Bdaya-Dev/patrol/tree/master/packages/patrol_cli_plus
[github_patrol_finders]: https://github.com/Bdaya-Dev/patrol/tree/master/packages/patrol_finders_plus
[github_workflows]: https://github.com/Bdaya-Dev/patrol/blob/master/.github/WORKFLOWS.md
[integration_test]: https://github.com/flutter/flutter/tree/master/packages/integration_test
[Hot Restart]: https://docs.flutter.dev/tools/hot-reload
