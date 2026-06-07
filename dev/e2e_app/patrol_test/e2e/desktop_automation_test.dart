import 'dart:io';

import 'package:flutter/services.dart';

import '../common.dart';

void main() {
  if (!Platform.isLinux && !Platform.isWindows) {
    return;
  }

  patrol('findElements discovers accessibility tree', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final elements = await $.platform.desktop.findElements();
    expect(elements, isNotEmpty, reason: 'App should expose a11y elements');
  });

  patrol('isElementVisible returns false for non-existent', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final visible = await $.platform.desktop.isElementVisible(
      name: 'This element does not exist at all',
    );
    expect(visible, isFalse);
  });

  patrol('tapAt screen coordinates', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $.platform.desktop.tapAt(100, 100);
    await $.pump(const Duration(milliseconds: 300));
  });

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
  });

  patrol('doubleTap callable', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    try {
      await $.platform.desktop.doubleTap(name: 'NonExistent');
    } on Exception catch (e) {
      expect(e.toString(), contains('ELEMENT_NOT_FOUND'));
    }
  });

  patrol('platform.tap routes through desktop automator', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    try {
      await $.platform.tap(
        Selector(text: 'NonExistentElement'),
        timeout: const Duration(seconds: 2),
      );
    } on Exception catch (e) {
      expect(e.toString(), isNot(contains('Unsupported')));
      expect(e.toString(), contains('ELEMENT_NOT_FOUND'));
    }
  });
}
