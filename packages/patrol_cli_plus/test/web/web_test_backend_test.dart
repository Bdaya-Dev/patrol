import 'package:patrol_cli_plus/src/crossplatform/app_options.dart';
// BuildMode lives here, not in app_options.dart, which only consumes it.
import 'package:patrol_cli_plus/src/ios/ios_test_backend.dart';
import 'package:patrol_cli_plus/src/runner/flutter_command.dart';
import 'package:patrol_cli_plus/src/web/web_test_backend.dart';
import 'package:test/test.dart';

// An RP served at http://localhost cannot be conformance-tested for the
// OpenID Connect implicit or hybrid flows at all. Dynamic Client Registration
// 1.0 section 2: "Web Clients using the OAuth Implicit Grant Type MUST only
// register URLs using the https scheme as redirect_uris; they MUST NOT use
// localhost as the hostname." A conformance provider enforces this by refusing
// the authorization request outright rather than redirecting.
//
// Flutter can satisfy both halves (`--web-tls-cert-path` /
// `--web-tls-cert-key-path` and `--web-hostname`); patrol forwarded none of
// them, so they were unreachable through `patrol test`.
//
// The two URL scans are the other half of the same feature. Forwarding the
// flags without fixing them produces a WORSE failure than the one being fixed:
// Flutter builds its URLs with the https scheme once TLS is on, an http-only
// pattern never matches, and the run hangs to the server timeout with no error
// instead of failing.

WebAppOptions _options({
  String? certPath,
  String? certKeyPath,
  String? hostname,
}) => WebAppOptions(
  flutter: const FlutterAppOptions(
    command: FlutterCommand('flutter'),
    target: 'integration_test/app_test.dart',
    buildMode: BuildMode.debug,
    flavor: null,
    buildName: null,
    buildNumber: null,
    dartDefines: {},
    dartDefineFromFilePaths: [],
  ),
  webPort: 22433,
  webTlsCertPath: certPath,
  webTlsCertKeyPath: certKeyPath,
  webHostname: hostname,
);

void main() {
  group('buildFlutterWebRunArgs forwards the TLS flags', () {
    test('both are passed through when set', () {
      final args = buildFlutterWebRunArgs(
        _options(certPath: '/certs/rp.pem', certKeyPath: '/certs/rp.key'),
        useChrome: false,
        develop: false,
        coverageEnabled: false,
      );

      expect(args, contains('--web-tls-cert-path=/certs/rp.pem'));
      expect(args, contains('--web-tls-cert-key-path=/certs/rp.key'));
      // The existing behaviour must survive the refactor.
      expect(args, contains('--web-port=22433'));
      expect(args, containsAllInOrder(['run', '-d', 'web-server']));
    });

    test('neither appears when unset', () {
      final args = buildFlutterWebRunArgs(
        _options(),
        useChrome: false,
        develop: false,
        coverageEnabled: false,
      );

      expect(args.where((a) => a.contains('tls')), isEmpty);
    });

    test('a cert without its key is not forwarded half-configured', () {
      // Flutter itself rejects a half-pair -- `HttpsConfig.parse`
      // (flutter_tools/lib/src/web/devfs_config.dart) throws an ArgumentError,
      // and `flutter run` routes both flags through it. So this guard is not
      // preventing a silent http fallback; it is failing before a process is
      // spawned, naming patrol's own option names rather than Flutter's, so
      // the message points at the option the caller actually set.
      expect(
        () => buildFlutterWebRunArgs(
          _options(certPath: '/certs/rp.pem'),
          useChrome: false,
          develop: false,
          coverageEnabled: false,
        ),
        throwsA(isA<ArgumentError>()),
      );
    });
  });

  group('buildFlutterWebRunArgs forwards the hostname', () {
    // https alone is only half of the requirement. OpenID Connect Dynamic
    // Client Registration 1.0 section 2: "Web Clients using the OAuth Implicit
    // Grant Type MUST only register URLs using the https scheme as
    // redirect_uris; they MUST NOT use localhost as the hostname." Serving on
    // localhost therefore keeps an implicit/hybrid RP non-conformant even once
    // TLS is on -- a conformance provider is entitled to reject it, and the
    // suite checking only the scheme today does not make the registration
    // legal.
    test('the hostname is passed through when set', () {
      final args = buildFlutterWebRunArgs(
        _options(
          hostname: 'rp.oidc.test',
          certPath: '/certs/rp.pem',
          certKeyPath: '/certs/rp.key',
        ),
        useChrome: false,
        develop: false,
        coverageEnabled: false,
      );

      expect(args, contains('--web-hostname=rp.oidc.test'));
      // The hostname and the TLS pair have to survive together: the cert is
      // issued for this name, and the redirect_uri origin is built from it.
      expect(args, contains('--web-tls-cert-path=/certs/rp.pem'));
      expect(args, contains('--web-port=22433'));
    });

    test('no hostname flag appears when unset', () {
      final args = buildFlutterWebRunArgs(
        _options(),
        useChrome: false,
        develop: false,
        coverageEnabled: false,
      );

      // Flutter defaults to localhost; patrol must not force a hostname on
      // callers that never asked for one.
      expect(args.where((a) => a.startsWith('--web-hostname')), isEmpty);
    });
  });

  group('the develop base-URL scan accepts TLS', () {
    // Same http-only blindness as parseWebServerUrl, in the develop path's
    // "Launching Chromium (url = ...)" line. Under TLS this never matched, so
    // the captured base URL stayed null.
    test('an https launch URL is recognised', () {
      expect(
        parseLaunchingBaseUrl(
          'Launching Chromium (url = https://rp.oidc.test:22433, id = chrome)',
        ),
        'https://rp.oidc.test:22433',
      );
    });

    test('an http launch URL still is', () {
      expect(
        parseLaunchingBaseUrl(
          'Launching Chromium (url = http://localhost:43185, id = chrome)',
        ),
        'http://localhost:43185',
      );
    });

    test('a line with no launch URL yields null', () {
      expect(parseLaunchingBaseUrl('Flutter: some unrelated log line'), isNull);
    });
  });

  group('the web server URL scan accepts TLS', () {
    test('an https server URL is recognised', () {
      expect(
        parseWebServerUrl(
          'lib/main.dart is being served at https://localhost:22433',
        ),
        'https://localhost:22433',
      );
    });

    test('an http server URL still is', () {
      expect(
        parseWebServerUrl(
          'lib/main.dart is being served at http://localhost:22433',
        ),
        'http://localhost:22433',
      );
    });

    test('a line with no server URL yields null', () {
      expect(parseWebServerUrl('Flutter: some unrelated log line'), isNull);
    });

    test('a ws:// devtools line is not mistaken for the server', () {
      // The scan runs over every stdout line, and the DevTools notice arrives
      // on the same stream.
      expect(
        parseWebServerUrl(
          '[CHROME]: DevTools listening on ws://127.0.0.1:38861/devtools/browser/431953d3',
        ),
        isNull,
      );
    });
  });

  group('parsePlaywrightRunResult (#61 ground-truth summary)', () {
    test('parses a well-formed stats block', () {
      final result = parsePlaywrightRunResult(
        '{"stats":{"expected":3,"unexpected":1,"flaky":1,"skipped":2}}',
      );
      expect(result, isNotNull);
      expect(result!.expected, 3);
      expect(result.unexpected, 1);
      expect(result.flaky, 1);
      expect(result.skipped, 2);
      expect(result.total, 7);
      // A flaky test DID pass in the end — counted as successful.
      expect(result.successful, 4);
      expect(result.failed, 1);
      expect(result.hasFailures, isTrue);
      expect(result.ranNoTests, isFalse);
    });

    test('ranNoTests is true when every count is zero', () {
      final result = parsePlaywrightRunResult(
        '{"stats":{"expected":0,"unexpected":0,"flaky":0,"skipped":0}}',
      );
      expect(result!.ranNoTests, isTrue);
      expect(result.hasFailures, isFalse);
    });

    test('missing fields default to 0 rather than throwing', () {
      final result = parsePlaywrightRunResult('{"stats":{}}');
      expect(result, isNotNull);
      expect(result!.total, 0);
    });

    test('returns null when "stats" is missing', () {
      expect(parsePlaywrightRunResult('{"notStats":{}}'), isNull);
    });

    test('returns null on malformed JSON rather than throwing', () {
      expect(parsePlaywrightRunResult('not json at all'), isNull);
    });

    test('returns null when the top level is not an object', () {
      expect(parsePlaywrightRunResult('[1,2,3]'), isNull);
    });

    // #61 repro: a test whose BODY logs a PATROL_LOG success entry, followed
    // by a fixture-teardown throw (e.g. the F-B error gate firing from
    // afterEach), must be flagged as a failure — even though a
    // PATROL_LOG-only reader would have recorded it as "Successful: 1 /
    // Failed: 0". The stats block below is the EXACT output Playwright's own
    // JSON reporter produced for a live repro of that shape (a test that
    // completes its body — logging
    // `PATROL_LOG {"type":"test","name":"example success","status":
    // "success"}` to stdout — then throws from test.afterEach): verified
    // 2026-10-27, Playwright 1.56.0, patrol_plus/web_runner.
    test('issue #61 repro: a harness-level failure after a logged success '
        'is still flagged as a failure', () {
      final result = parsePlaywrightRunResult(
        '{"stats":{"startTime":"2026-10-26T22:47:22.403Z",'
        '"duration":2495.04,"expected":0,"skipped":0,"unexpected":1,'
        '"flaky":0}}',
      );

      expect(result, isNotNull);
      // The ground truth: Playwright itself marked this test failed.
      expect(result!.hasFailures, isTrue);
      expect(result.failed, 1);
      expect(result.successful, 0);
      // Had this gone through PatrolLogReader alone (the pre-fix
      // behaviour), the ONE PATROL_LOG entry on stdout was a success
      // entry, so successfulTests would have read 1 and failedTestsCount
      // would have read 0 — the exact false-green #61 describes.
    });
  });
}
