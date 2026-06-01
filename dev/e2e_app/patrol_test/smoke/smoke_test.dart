import 'package:flutter/material.dart';

import '../common.dart';

void main() {
  patrol('widget interaction smoke test', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    expect($(#counterText).text, '0');

    await $(FloatingActionButton).tap();

    expect($(#counterText).text, '1');

    await $(#textField).enterText('Hello from patrol!');
    expect($('Hello from patrol!'), findsOneWidget);

    await $('Open scrolling screen').scrollTo().tap();
    await $.waitUntilVisible($(#topText));

    await $.scrollUntilVisible(finder: $(#bottomText));

    await $.tap($(#backButton));
    await $.scrollUntilVisible(
      finder: $(#counterText),
      scrollDirection: AxisDirection.up,
    );
  });

  patrol('platform tap routing works', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    try {
      await $.platform.tap(Selector(text: 'NonExistentButton'));
      fail('Should have thrown - no such native element');
    } on Exception catch (e) {
      expect(e.toString(), isNot(contains('Unsupported platform')));
      expect(e.toString(), isNot(contains('No desktop handler')));
    }
  });
}
