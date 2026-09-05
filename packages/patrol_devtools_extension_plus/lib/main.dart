// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import 'package:devtools_extensions/devtools_extensions.dart';
import 'package:flutter/widgets.dart';
import 'package:patrol_devtools_extension_plus/patrol_devtools_extension.dart';

void main() {
  runApp(const PatrolPackageDevToolsExtension());
}

class PatrolPackageDevToolsExtension extends StatelessWidget {
  const PatrolPackageDevToolsExtension({super.key});

  @override
  Widget build(BuildContext context) {
    return const DevToolsExtension(child: PatrolDevToolsExtension());
  }
}
