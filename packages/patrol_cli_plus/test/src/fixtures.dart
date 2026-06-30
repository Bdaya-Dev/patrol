import 'package:patrol_cli_plus/src/devices.dart';

const androidDeviceName = 'Pixel 5';
const androidDeviceId = 'emulator-5554';
const androidDevice = Device(
  name: androidDeviceName,
  id: androidDeviceId,
  targetPlatform: TargetPlatform.android,
  real: true,
);

const iosDeviceName = 'iPhone 13';
const iosDeviceId = '00008101-001611D026A0001E';
const iosDevice = Device(
  name: iosDeviceName,
  id: iosDeviceId,
  targetPlatform: TargetPlatform.iOS,
  real: true,
);

const iosSimulatorDeviceName = 'iPhone 15';
const iosSimulatorDeviceId = 'D7E8F9A0-1234-5678-9ABC-DEF012345678';
const iosSimulatorDevice = Device(
  name: iosSimulatorDeviceName,
  id: iosSimulatorDeviceId,
  targetPlatform: TargetPlatform.iOS,
  real: false,
);
