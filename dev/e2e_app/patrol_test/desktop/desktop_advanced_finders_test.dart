import 'package:flutter/material.dart';

import '../common.dart';

void main() {
  patrol('waitUntilExists vs waitUntilVisible', ($) async {
    await createApp($);

    await $(#counterText).waitUntilExists();
    expect($(#counterText).exists, isTrue);

    await $(#counterText).waitUntilVisible();
    expect($(#counterText).visible, isTrue);
  }, tags: ['desktop']);

  patrol('which() filters widgets by predicate', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final addIcons = $(Icon).which<Icon>((icon) => icon.icon == Icons.add);
    expect(addIcons, findsWidgets);
  }, tags: ['desktop']);

  patrol('longPress gesture', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $(FloatingActionButton).longPress();
    expect($(#counterText), findsOneWidget);
  }, tags: ['desktop']);

  patrol('pumpAndSettle with custom timeout', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $(FloatingActionButton).tap();
    await $.pumpAndSettle(timeout: const Duration(seconds: 5));
    expect($(#counterText).text, '1');
  }, tags: ['desktop']);

  patrol('pump with duration', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $(FloatingActionButton).tap();
    await $.pump(const Duration(milliseconds: 100));
    expect($(#counterText).text, '1');
  }, tags: ['desktop']);

  patrol('nested finder chaining', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    expect($(Scaffold).$(#counterText), findsOneWidget);
    expect($(Scaffold).$(FloatingActionButton), findsOneWidget);
  }, tags: ['desktop']);

  patrol('at() accessor on finder results', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final icons = $(Icon);
    expect(icons.at(0), findsOneWidget);
    expect(icons.first, findsOneWidget);
    expect(icons.last, findsOneWidget);
  }, tags: ['desktop']);

  patrol('exists and visible properties', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    expect($(#counterText).exists, isTrue);
    expect($(#counterText).visible, isTrue);
    expect($(#nonExistentWidget).exists, isFalse);
  }, tags: ['desktop']);

  patrol('text getter reflects state changes', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    expect($(#counterText).text, '0');
    await $(FloatingActionButton).tap();
    expect($(#counterText).text, '1');
    await $(FloatingActionButton).tap();
    await $(FloatingActionButton).tap();
    expect($(#counterText).text, '3');
  }, tags: ['desktop']);
}
