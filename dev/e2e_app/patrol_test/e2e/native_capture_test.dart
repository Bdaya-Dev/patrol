import 'dart:io';

import 'package:flutter/material.dart';

import '../common.dart';

// Screen capture is implemented for Android only. This directory is bundled for
// every native platform, so the other ones simply contribute no tests here.
void main() {
  if (!Platform.isAndroid) {
    return;
  }

  patrol('takeScreenshot writes a non-empty PNG to the device', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    final screenshot = await $.platform.android.takeScreenshot(
      path: 'capture/home.png',
    );

    $.log('screenshot ${screenshot.path} (${screenshot.sizeBytes} bytes)');
    expect(screenshot.path, endsWith('/files/capture/home.png'));
    expect(screenshot.sizeBytes, greaterThan(0));
  });

  patrol('screen recording produces a finalized MP4 with real frames', (
    $,
  ) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $.platform.android.startScreenRecording(
      path: 'capture/counter.mp4',
      timeLimit: const Duration(seconds: 60),
      bitRate: 4000000,
    );

    // Drive real UI motion, spread over more than a second. screenrecord is fed
    // by the compositor, so it encodes a frame only when the screen changes: a
    // still screen yields no frames at all, and the duration and frame count
    // asserted below come from the MP4 itself, not from a clock.
    for (var i = 0; i < 8; i++) {
      await $(FloatingActionButton).tap();
      await $.pump(const Duration(milliseconds: 200));
    }
    expect($(#counterText).text, '8');

    final recording = await $.platform.android.stopScreenRecording();

    $.log(
      'recording ${recording.path} (${recording.sizeBytes} bytes, '
      '${recording.durationMillis} ms, ${recording.frameCount} frames)',
    );
    expect(recording.path, endsWith('/files/capture/counter.mp4'));
    expect(recording.sizeBytes, greaterThan(0));
    expect(recording.durationMillis, greaterThan(0));
    // Null only on Android < 9, which cannot report a frame count.
    expect(recording.frameCount, anyOf(isNull, greaterThan(1)));
  });

  patrol('capture reports failure instead of success with no file', ($) async {
    await createApp($);

    // Stopping a recording that was never started must fail, not return a
    // response describing a file that does not exist.
    await expectLater(
      $.platform.android.stopScreenRecording(),
      throwsA(isA<PatrolActionException>()),
    );

    // A destination outside the app's external files directory is refused
    // before anything is written or deleted. Silently producing no file, or an
    // empty one, is the failure mode this whole API guards against: it is
    // indistinguishable from evidence.
    await expectLater(
      $.platform.android.takeScreenshot(path: '/proc/patrol-capture.png'),
      throwsA(isA<PatrolActionException>()),
    );
    await expectLater(
      $.platform.android.startScreenRecording(path: '../../escape.mp4'),
      throwsA(isA<PatrolActionException>()),
    );
  });

  // The next two tests are a pair and must stay in this order.
  //
  // The native automator is a process-wide singleton that outlives every Dart
  // test. Before the recorder lifecycle was fixed, a test that failed between
  // start and stop left `screenrecord` running there, and every later
  // startScreenRecording() threw "already running". This test leaves a
  // recording running on purpose -- exactly what a test that threw would do --
  // and the following one must not be affected.
  patrol('a recording left running by a test is stopped after it', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    await $.platform.android.startScreenRecording(
      path: 'capture/abandoned.mp4',
      timeLimit: const Duration(seconds: 60),
    );
    await $(FloatingActionButton).tap();
    // Deliberately no stopScreenRecording(): patrolTest stops it on the way
    // out, and the native side would also reclaim it at the next test start.
  });

  patrol('startScreenRecording recovers from an abandoned recording', ($) async {
    await createApp($);
    await $.waitUntilVisible($(#counterText));

    // Would have thrown "already running" if the previous test's recorder had
    // leaked.
    await $.platform.android.startScreenRecording(
      path: 'capture/first.mp4',
      timeLimit: const Duration(seconds: 60),
    );
    await $(FloatingActionButton).tap();
    await $.pump(const Duration(milliseconds: 300));

    // Starting again without stopping abandons first.mp4 (it is stopped and
    // logged) and records second.mp4 instead of refusing -- the recording this
    // call wants is the one it names.
    await $.platform.android.startScreenRecording(
      path: 'capture/second.mp4',
      timeLimit: const Duration(seconds: 60),
    );
    for (var i = 0; i < 6; i++) {
      await $(FloatingActionButton).tap();
      await $.pump(const Duration(milliseconds: 200));
    }

    final recording = await $.platform.android.stopScreenRecording();

    $.log(
      'recording ${recording.path} (${recording.sizeBytes} bytes, '
      '${recording.durationMillis} ms, ${recording.frameCount} frames)',
    );
    expect(recording.path, endsWith('/files/capture/second.mp4'));
    expect(recording.durationMillis, greaterThan(0));
    expect(recording.frameCount, anyOf(isNull, greaterThan(1)));
  });
}
