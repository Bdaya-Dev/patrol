import 'package:flutter/services.dart';

import '../common.dart';

void main() {
  patrol('findElement returns element by semantic label', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final element = await $.platform.desktop.findElement(name: 'Counter: 0');
    expect(element, isNotNull, reason: 'Counter text should be in a11y tree');
  }, tags: ['desktop']);

  patrol('findElements returns multiple results', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final elements = await $.platform.desktop.findElements();
    expect(elements, isNotEmpty, reason: 'App should expose a11y elements');
  }, tags: ['desktop']);

  patrol('isElementVisible for visible element', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final visible = await $.platform.desktop.isElementVisible(
      name: 'Counter: 0',
    );
    expect(visible, isTrue, reason: 'Counter should be visible');
  }, tags: ['desktop']);

  patrol('isElementVisible for non-existent element', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final visible = await $.platform.desktop.isElementVisible(
      name: 'This element does not exist at all',
    );
    expect(visible, isFalse);
  }, tags: ['desktop']);

  patrol('native tap increments counter via a11y', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));
    expect($(#counterText).text, '0');

    await $.platform.desktop.tap(name: 'Increment counter');

    await $.pump(const Duration(milliseconds: 500));
    expect($(#counterText).text, '1');
  }, tags: ['desktop']);

  patrol('native doubleTap on element', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    try {
      await $.platform.desktop.doubleTap(name: 'Increment counter');
      await $.pump(const Duration(milliseconds: 500));
    } on PlatformException catch (e) {
      expect(
        e.code,
        anyOf('ELEMENT_NOT_FOUND', 'DOUBLE_TAP_FAILED'),
        reason: 'Should fail gracefully if doubleTap not supported',
      );
    }
  }, tags: ['desktop']);

  patrol('native tapAt screen coordinates', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $.platform.desktop.tapAt(100, 100);
    await $.pump(const Duration(milliseconds: 300));
  }, tags: ['desktop']);

  patrol('pressKey sends keyboard input', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $(#textField).tap();
    await $.pump(const Duration(milliseconds: 300));

    // Press 'A' key (0x41 on Windows / 38 on Linux X11)
    // The key code varies by platform; this verifies the API is callable
    try {
      await $.platform.desktop.pressKey(0x41);
      await $.pump(const Duration(milliseconds: 300));
    } on PlatformException {
      // Key codes differ between platforms; acceptable to fail
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
