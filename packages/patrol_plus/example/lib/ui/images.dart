// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

abstract class PTImages {
  static final flutterconLogo = SvgPicture.asset(
    'assets/image/fluttercon_logo.svg',
    placeholderBuilder: (_) => const SizedBox(height: 26, width: 166),
  );
  static final confetti = SvgPicture.asset(
    'assets/image/confetti.svg',
    fit: BoxFit.cover,
  );
}
