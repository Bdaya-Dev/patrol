import 'dart:async';

import 'package:patrol_cli_plus/src/coverage/vm_connection_details.dart';
import 'package:test/test.dart';

void main() {
  group('closeVmConnectionController', () {
    test('closes a listenerless controller without hanging', () async {
      final controller = StreamController<int>();

      // A direct `await controller.close()` on a single-subscription
      // StreamController with no listener never completes, because the
      // done event has nobody to be delivered to (see patrol#24). The
      // helper must close the controller without awaiting that stuck
      // future.
      await closeVmConnectionController(
        controller,
      ).timeout(const Duration(seconds: 1));

      expect(controller.isClosed, isTrue);
    });

    test('delivers done to an existing listener', () async {
      final controller = StreamController<int>();
      var onDoneCalled = false;
      controller.stream.listen((_) {}, onDone: () => onDoneCalled = true);

      await closeVmConnectionController(
        controller,
      ).timeout(const Duration(seconds: 1));

      expect(onDoneCalled, isTrue);
    });
  });
}
