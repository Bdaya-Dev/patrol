/// First-party fixture source, deliberately nested a few directories deep
/// under `lib/` so its compiled dart2js source-map entry is a genuine
/// bundle-relative path (e.g. `../../lib/features/shell/greeter.dart`),
/// matching the shape of Invora's real first-party sources
/// (`../../../lib/features/shell/invora_app_shell.dart`) described in
/// invora-flutter#86 R5.
class Greeter {
  final String name;

  Greeter(this.name);

  String greet() {
    if (name.isEmpty) {
      return "Hello, stranger!";
    }
    return "Hello, $name!";
  }
}
