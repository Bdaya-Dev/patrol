import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:patrol_plus/src/platform/android/android_automator_config.dart';
import 'package:patrol_plus/src/platform/android/android_automator_native.dart';

const _timeout = Duration(seconds: 30);

/// A stand-in for the native automation server that records which RPCs it was
/// asked for and answers each with a canned status -- or, when [stopError] is
/// set, fails the stop request the way a dead app does: with a transport
/// error rather than an HTTP status.
class _FakeServer {
  _FakeServer({this.startStatus = 200, this.stopStatus = 200, this.stopError});

  final int startStatus;
  final int stopStatus;
  final Exception? stopError;
  final calls = <String>[];

  http.Client get client => MockClient((request) async {
    final rpc = request.url.pathSegments.last;
    calls.add(rpc);
    switch (rpc) {
      case 'startScreenRecording':
        return http.Response('', startStatus);
      case 'stopScreenRecording':
        if (stopError case final error?) {
          throw error;
        }
        return http.Response(
          jsonEncode({
            'path': '/files/capture/x.mp4',
            'sizeBytes': 1024,
            'durationMillis': 1500,
            'frameCount': 12,
          }),
          stopStatus,
        );
      default:
        return http.Response('unexpected $rpc', 500);
    }
  });
}

AndroidAutomator _automator(_FakeServer server) => AndroidAutomator(
  config: const AndroidAutomatorConfig(),
  httpClient: server.client,
);

void main() {
  group('stopAbandonedScreenRecording()', () {
    test('stops a recording that was started and never stopped', () async {
      final server = _FakeServer();
      final automator = _automator(server);

      await automator.startScreenRecording(path: 'capture/x.mp4');
      await automator.stopAbandonedScreenRecording();

      expect(server.calls, ['startScreenRecording', 'stopScreenRecording']);
    });

    test('does nothing when no recording was started', () async {
      final server = _FakeServer();
      final automator = _automator(server);

      await automator.stopAbandonedScreenRecording();

      expect(server.calls, isEmpty);
    });

    test('does nothing when the recording was already stopped', () async {
      final server = _FakeServer();
      final automator = _automator(server);

      await automator.startScreenRecording(path: 'capture/x.mp4');
      await automator.stopScreenRecording();
      await automator.stopAbandonedScreenRecording();

      expect(server.calls, ['startScreenRecording', 'stopScreenRecording']);
    });

    test('does nothing when starting the recording failed', () async {
      final server = _FakeServer(startStatus: 500);
      final automator = _automator(server);

      await expectLater(
        automator.startScreenRecording(path: 'capture/x.mp4'),
        throwsA(anything),
      );
      await automator.stopAbandonedScreenRecording();

      expect(server.calls, ['startScreenRecording']);
    });

    test('never throws, and clears the state, when stopping fails', () async {
      final server = _FakeServer(stopStatus: 500);
      final automator = _automator(server);

      await automator.startScreenRecording(path: 'capture/x.mp4');
      // Runs on cleanup paths: a throw here would mask the test's own failure.
      await automator.stopAbandonedScreenRecording();
      await automator.stopAbandonedScreenRecording();

      expect(server.calls, ['startScreenRecording', 'stopScreenRecording']);
    });

    test('a failed explicit stop also leaves nothing to abandon', () async {
      final server = _FakeServer(stopStatus: 500);
      final automator = _automator(server);

      await automator.startScreenRecording(path: 'capture/x.mp4');
      await expectLater(automator.stopScreenRecording(), throwsA(anything));
      await automator.stopAbandonedScreenRecording();

      expect(server.calls, ['startScreenRecording', 'stopScreenRecording']);
    });

    // The app crashing mid-recording -- the very case this cleanup exists
    // for -- does not answer with an HTTP status: the connection drops, or the
    // client times out. wrapRequest converts only HTTP failures, so these are
    // the errors that would escape.
    for (final (name, error) in [
      ('a dropped connection', const SocketException('Connection reset')),
      ('a client timeout', TimeoutException('no response', _timeout)),
      ('an http ClientException', http.ClientException('connection closed')),
    ]) {
      test('never throws when stopping fails with $name', () async {
        final server = _FakeServer(stopError: error);
        final automator = _automator(server);

        await automator.startScreenRecording(path: 'capture/x.mp4');
        await automator.stopAbandonedScreenRecording();
        // And the state is cleared: nothing is retried on the next cleanup.
        await automator.stopAbandonedScreenRecording();

        expect(server.calls, ['startScreenRecording', 'stopScreenRecording']);
      });
    }

    test(
      'a test failure survives the cleanup even when the app is gone',
      () async {
        // The shape patrolTest uses: the body throws, and the cleanup runs in
        // `finally`. If the cleanup threw too, the SocketException would
        // replace the StateError and the report would blame the wrong thing.
        final server = _FakeServer(
          stopError: const SocketException('Connection reset'),
        );
        final automator = _automator(server);

        Future<void> testBody() async {
          await automator.startScreenRecording(path: 'capture/x.mp4');
          throw StateError('the assertion the test actually failed on');
        }

        Future<void> likePatrolTest() async {
          try {
            await testBody();
          } finally {
            await automator.stopAbandonedScreenRecording();
          }
        }

        await expectLater(
          likePatrolTest(),
          throwsA(
            isA<StateError>().having(
              (e) => e.message,
              'message',
              'the assertion the test actually failed on',
            ),
          ),
        );
        expect(server.calls, ['startScreenRecording', 'stopScreenRecording']);
      },
    );
  });

  test('stopScreenRecording() returns the file-derived metadata', () async {
    final server = _FakeServer();
    final automator = _automator(server);

    await automator.startScreenRecording(path: 'capture/x.mp4');
    final recording = await automator.stopScreenRecording();

    expect(recording.path, '/files/capture/x.mp4');
    expect(recording.sizeBytes, 1024);
    expect(recording.durationMillis, 1500);
    expect(recording.frameCount, 12);
  });
}
