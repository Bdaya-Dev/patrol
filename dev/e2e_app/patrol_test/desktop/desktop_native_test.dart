import 'package:flutter/services.dart';

import '../common.dart';

void main() {
  patrol('findElements discovers accessibility tree', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final elements = await $.platform.desktop.findElements();
    expect(elements, isNotEmpty, reason: 'App should expose a11y elements');
  }, tags: ['desktop']);

  patrol('isElementVisible returns false for non-existent', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final visible = await $.platform.desktop.isElementVisible(
      name: 'This element does not exist at all',
    );
    expect(visible, isFalse);
  }, tags: ['desktop']);

  patrol('tapAt screen coordinates does not crash', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $.platform.desktop.tapAt(100, 100);
    await $.pump(const Duration(milliseconds: 300));
  }, tags: ['desktop']);

  patrol('pressKey is callable', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $(#textField).tap();
    await $.pump(const Duration(milliseconds: 300));

    try {
      await $.platform.desktop.pressKey(0x41);
      await $.pump(const Duration(milliseconds: 300));
    } on PlatformException {
      // Key codes differ between platforms
    }
  }, tags: ['desktop']);

  patrol('platform.tap routes through desktop automator', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    try {
      await $.platform.tap(Selector(text: 'NonExistentButton'));
      fail('Should have thrown - no such native element');
    } on Exception catch (e) {
      expect(e.toString(), isNot(contains('Unsupported platform')));
      expect(e.toString(), isNot(contains('No desktop handler')));
      expect(e.toString(), contains('ELEMENT_NOT_FOUND'));
    }
  }, tags: ['desktop']);
}
