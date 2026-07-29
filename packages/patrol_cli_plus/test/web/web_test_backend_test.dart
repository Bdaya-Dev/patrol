import 'package:patrol_cli_plus/src/crossplatform/app_options.dart';
// BuildMode lives here, not in app_options.dart, which only consumes it.
import 'package:patrol_cli_plus/src/ios/ios_test_backend.dart';
import 'package:patrol_cli_plus/src/runner/flutter_command.dart';
import 'package:patrol_cli_plus/src/web/web_test_backend.dart';
import 'package:test/test.dart';

// An RP served over plain http cannot be conformance-tested for the OpenID
// Connect implicit or hybrid flows at all: OpenID Connect Dynamic Client
// Registration 1.0 section 2 says a client whose `application_type` is `web`
// "MUST only register URLs using the https scheme as redirect_uris", and a
// conformance provider enforces it -- refusing the authorization request
// outright rather than redirecting. Flutter's web server can serve TLS
// (`--web-tls-cert-path` / `--web-tls-cert-key-path`), but patrol forwards
// neither, so the flags cannot be reached through `patrol test`.
//
// The URL scan below is the second half of the same feature. Adding the flags
// without it produces a WORSE failure than the one being fixed: Flutter prints
// an `https://` URL, the scan never matches, and the run hangs to the server
// timeout with no error rather than failing.

WebAppOptions _options({String? certPath, String? certKeyPath}) =>
    WebAppOptions(
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
      // Flutter needs both. Sending one produces a server that silently stays
      // on http, which is the failure this feature exists to remove -- so it
      // must be refused here, loudly, rather than half-applied.
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
}
