// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import 'package:patrol_cli_plus/src/commands/test.dart';
import 'package:test/test.dart';

void main() {
  group(
    'shouldWarnTraceAuthFlowCombo decides whether --web-trace + an auth flow '
    'needs the plaintext-secret warning',
    () {
      test('warns: trace + declarative --web-auth-flow', () {
        expect(
          shouldWarnTraceAuthFlowCombo(
            trace: 'on',
            authFlow: 'oidc:...',
            authFlowModule: null,
          ),
          isTrue,
        );
      });

      test('warns: trace + the --web-auth-flow-module escape hatch', () {
        expect(
          shouldWarnTraceAuthFlowCombo(
            trace: 'on',
            authFlow: null,
            authFlowModule: 'auth_flow.ts',
          ),
          isTrue,
        );
      });

      test('does not warn: no trace at all', () {
        expect(
          shouldWarnTraceAuthFlowCombo(
            trace: null,
            authFlow: 'oidc:...',
            authFlowModule: null,
          ),
          isFalse,
        );
      });

      test('does not warn: trace without any auth flow', () {
        expect(
          shouldWarnTraceAuthFlowCombo(
            trace: 'on',
            authFlow: null,
            authFlowModule: null,
          ),
          isFalse,
        );
      });

      test('does not warn: neither trace nor an auth flow', () {
        expect(
          shouldWarnTraceAuthFlowCombo(
            trace: null,
            authFlow: null,
            authFlowModule: null,
          ),
          isFalse,
        );
      });
    },
  );
}
