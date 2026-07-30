import 'dart:io';

import 'package:patrol_cli_plus/src/web/web_test_backend.dart';
import 'package:test/test.dart';

// Patrol probes the Flutter web server with a Dart HttpClient before handing
// off to Playwright. That client has its OWN trust store, entirely separate
// from the browser's, so neither --web-browser-args nor Chromium's
// --ignore-certificate-errors reaches it.
//
// The consequence, observed live once the TLS flags were actually used:
//
//   Verifying server is ready at: https://rp.oidc.test:22433
//   Server verification failed: HandshakeException: Handshake error in client
//     (OS Error: CERTIFICATE_VERIFY_FAILED: self signed certificate)
//
// The server was up and serving https correctly -- the probe simply refused
// the certificate the caller had just supplied. So when a cert is configured,
// the probe must trust THAT certificate.
//
// Trusting the supplied cert specifically, rather than disabling verification,
// keeps the probe a real check: a server presenting some other certificate
// still fails, which is the property that makes the probe worth running.
void main() {
  final fixtures = Directory('test/web/fixtures');
  final certPath = '${fixtures.path}/localhost.pem';

  group('webProbeSecurityContext', () {
    test('no cert configured means the default trust store', () {
      // Plain http, or https against a publicly-trusted cert: unchanged
      // behaviour, and no SecurityContext to build.
      expect(webProbeSecurityContext(null), isNull);
    });

    test('a configured cert is trusted by the probe', () {
      expect(File(certPath).existsSync(), isTrue, reason: 'fixture missing');
      expect(webProbeSecurityContext(certPath), isA<SecurityContext>());
    });

    test('public roots stay trusted alongside the supplied cert', () {
      // The probe URL is the app under test, but the same client must not
      // become unable to speak to an ordinarily-trusted host; adding a private
      // cert is additive, not a replacement.
      final context = webProbeSecurityContext(certPath);
      expect(context, isNotNull);
      // withTrustedRoots is not readable back off SecurityContext, so this
      // asserts the observable consequence instead: building the context does
      // not throw, and the same call is repeatable within one process.
      expect(() => webProbeSecurityContext(certPath), returnsNormally);
    });

    test('a path that is not a certificate fails loudly', () {
      // A typo'd --web-tls-cert-path must not degrade into "probe cannot
      // connect" minutes later; it is a configuration error and should say so.
      expect(
        () => webProbeSecurityContext('test/web/web_probe_trust_test.dart'),
        throwsA(isA<TlsException>()),
      );
    });

    test('a missing file fails loudly', () {
      expect(
        () => webProbeSecurityContext('test/web/fixtures/does-not-exist.pem'),
        throwsA(anyOf(isA<FileSystemException>(), isA<TlsException>())),
      );
    });
  });
}
