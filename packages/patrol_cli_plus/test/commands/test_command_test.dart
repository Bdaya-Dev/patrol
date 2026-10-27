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

      test('warns: trace + --web-smoke-flow-module', () {
        // PR #66 review round 2: --web-smoke-flow-module drives a real,
        // often signed-in flow against a deployed URL -- the same
        // plaintext-in-trace risk as the two auth-flow mechanisms above.
        expect(
          shouldWarnTraceAuthFlowCombo(
            trace: 'on',
            authFlow: null,
            authFlowModule: null,
            smokeFlowModule: 'smoke_flow.ts',
          ),
          isTrue,
        );
      });

      test("does not warn: trace == 'off' even with an auth flow set", () {
        // 'off' is itself one of --web-trace's allowed values and means no
        // trace file is produced at all -- there is nothing for a secret to
        // leak into, so this must not warn despite trace being non-null.
        expect(
          shouldWarnTraceAuthFlowCombo(
            trace: 'off',
            authFlow: 'oidc:...',
            authFlowModule: null,
          ),
          isFalse,
        );
      });
    },
  );
}
