// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import 'package:example/ui/style/test_style.dart';
import 'package:flutter/widgets.dart';

class LogoHero extends StatelessWidget {
  const LogoHero({super.key});

  @override
  Widget build(BuildContext context) {
    return Hero(
      tag: 'logoHero',
      child: Center(child: Text('patrol_plus example', style: PTTextStyles.h4)),
    );
  }
}
