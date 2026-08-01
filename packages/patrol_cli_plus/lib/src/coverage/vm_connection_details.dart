import 'dart:async';

/// Closes [controller] without hanging when it has no listener.
///
/// [StreamController] (single-subscription, the default) only completes
/// the [Future] returned by [StreamController.close] once its `done` event
/// has actually been delivered to a listener. If nothing ever subscribed to
/// the controller's `stream`, that `done` event has nowhere to go, so the
/// close future never resolves and an `await`ed close hangs forever.
///
/// This mirrors what each `*_test_backend.dart` does with
/// `_vmConnectionController`: it's only ever listened to by
/// `CoverageTool.run`, which is skipped when `--coverage` is not passed. In
/// that case, closing must not be awaited. When a listener *is* attached,
/// awaiting is safe and lets the done event flush normally.
///
/// See https://github.com/Bdaya-Dev/patrol/issues/24.
Future<void> closeVmConnectionController<T>(StreamController<T> controller) {
  if (!controller.hasListener) {
    unawaited(controller.close());
    return Future<void>.value();
  }
  return controller.close();
}

class VMConnectionDetails {
  const VMConnectionDetails({required this.port, required this.auth});

  final int port;
  final String auth;

  Uri get uri => Uri.parse('http://127.0.0.1:$port/$auth');
  Uri get webSocketUri {
    final pathSegments = uri.pathSegments.where((c) => c.isNotEmpty).toList()
      ..add('ws');
    return uri.replace(scheme: 'ws', pathSegments: pathSegments);
  }

  static VMConnectionDetails? tryExtractFromLogs(String logsLine) {
    final vmLink = RegExp(
      'listening on (http.+)',
    ).firstMatch(logsLine)?.group(1);

    if (vmLink == null) {
      return null;
    }

    final uri = Uri.parse(vmLink);

    return VMConnectionDetails(
      port: uri.port,
      auth: uri.pathSegments.lastWhere((segment) => segment.isNotEmpty),
    );
  }
}
