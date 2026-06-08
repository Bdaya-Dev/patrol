import 'package:patrol_gen_plus/src/generators/android/android_config.dart';
import 'package:patrol_gen_plus/src/generators/dart/dart_config.dart';
import 'package:patrol_gen_plus/src/generators/darwin/darwin_config.dart';
import 'package:patrol_gen_plus/src/patrol_gen.dart';
import 'package:patrol_gen_plus/src/utils.dart';

Future<void> main(List<String> args) {
  return PatrolGen().run(
    PatrolGenConfig(
      schemaFilename: normalizePath(args[0]),
      dartConfig: DartConfig(
        outputDirectory: normalizePath(args[1]),
      ),
      darwinConfig: DarwinConfig(
        outputDirectory: normalizePath(args[2]),
      ),
      androidConfig: AndroidConfig(
        outputDirectory: normalizePath(args[3]),
        package: args[4],
      ),
    ),
  );
}
