import 'package:flutter/material.dart';

import 'common.dart';

void main() {
  patrol(
    'takeScreenshot writes a non-empty PNG to the device',
    ($) async {
      await createApp($);

      final screenshot = await $.platform.android.takeScreenshot(
        path: 'capture/home.png',
      );

      $.log('screenshot ${screenshot.path} (${screenshot.sizeBytes} bytes)');
      expect(screenshot.path, endsWith('capture/home.png'));
      expect(screenshot.sizeBytes, greaterThan(0));
    },
    tags: ['android', 'emulator'],
  );

  patrol(
    'startScreenRecording and stopScreenRecording write a playable MP4',
    ($) async {
      await createApp($);

      await $.platform.android.startScreenRecording(
        path: 'capture/counter.mp4',
        timeLimit: const Duration(seconds: 60),
        bitRate: 4000000,
      );

      // Drive real UI motion. A screen recorder is fed by the compositor, so a
      // completely static screen yields a structurally valid MP4 carrying zero
      // frames — which looks like a successful capture until someone plays it.
      for (var i = 0; i < 8; i++) {
        await $(FloatingActionButton).tap();
      }

      final recording = await $.platform.android.stopScreenRecording();

      $.log(
        'recording ${recording.path} '
        '(${recording.sizeBytes} bytes, ${recording.durationMillis} ms)',
      );
      expect(recording.path, endsWith('capture/counter.mp4'));
      expect(recording.sizeBytes, greaterThan(0));
      expect(recording.durationMillis, greaterThan(0));
    },
    tags: ['android', 'emulator'],
  );

  patrol(
    'capture reports failure instead of reporting success with no file',
    ($) async {
      await createApp($);

      // Stopping a recording that was never started must fail, not return a
      // response describing a file that does not exist.
      await expectLater(
        $.platform.android.stopScreenRecording(),
        throwsA(isA<PatrolActionException>()),
      );

      // A destination the app cannot write to must fail. Silently producing no
      // file, or an empty one, is the failure mode this whole API guards
      // against: it is indistinguishable from evidence.
      await expectLater(
        $.platform.android.takeScreenshot(path: '/proc/patrol-capture.png'),
        throwsA(isA<PatrolActionException>()),
      );

      // A second start while one is already running must be refused, so the
      // first recording cannot be silently orphaned.
      await $.platform.android.startScreenRecording(
        path: 'capture/guard.mp4',
        timeLimit: const Duration(seconds: 30),
      );
      await expectLater(
        $.platform.android.startScreenRecording(path: 'capture/guard2.mp4'),
        throwsA(isA<PatrolActionException>()),
      );
      await $.platform.android.stopScreenRecording();
    },
    tags: ['android', 'emulator'],
  );
}
