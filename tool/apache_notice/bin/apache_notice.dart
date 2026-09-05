import 'dart:io';

import 'package:apache_notice/src/cli.dart';

void main(List<String> arguments) {
  final exitCode = runCli(arguments, out: stdout, err: stderr);
  exit(exitCode);
}
