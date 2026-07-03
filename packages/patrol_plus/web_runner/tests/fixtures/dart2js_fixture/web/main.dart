// Entry point compiled with `dart compile js` to produce a real dart2js
// profile-mode bundle + source map for the sourceMapSchemes fork test
// (issue #28). Deliberately touches:
//   - a dependency-free pub.dev package (asn1lib) -> absolute pub-cache
//     filesystem path source.
//   - a nested first-party lib/ source -> bundle-relative path source.
//   - core Dart control flow (print, exceptions) -> org-dartlang-sdk:
//     source(s) pulled in from the SDK.
import "package:asn1lib/asn1lib.dart";

import "../lib/features/shell/greeter.dart";

void main() {
  final greeter = Greeter("dart2js");
  print(greeter.greet());

  // Touch asn1lib so its source actually gets compiled in (not tree-shaken
  // away as dead code, which would drop it from the source map's `sources`).
  final octet = ASN1OctetString("patrol");
  print(octet.stringValue);
}
