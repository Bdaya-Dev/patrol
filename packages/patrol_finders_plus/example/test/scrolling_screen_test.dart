import 'package:flutter_test/flutter_test.dart';
import 'package:patrol_finders_plus/patrol_finders.dart';
import 'package:patrol_finders_plus_example/keys.dart';
import 'package:patrol_finders_plus_example/main.dart';

void main() {
  patrolWidgetTest('drags to a widget', ($) async {
    await $.pumpWidgetAndSettle(ExampleApp());
    await $('Open scrolling screen').scrollTo().tap();

    expect(await $(K.topText).waitUntilVisible(), findsOneWidget);
    expect($(K.bottomText).hitTestable(), findsNothing);

    await $(K.bottomText).scrollTo();

    expect($(K.bottomText).hitTestable(), findsOneWidget);
  });
}
