import 'package:adb_plus/adb.dart';

void main() async {
  final adb = Adb();
  await adb.init();
  const apk = '/Users/bartek/.config/patrol/server.apk';
  await adb.install(apk);
}
