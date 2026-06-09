#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html
# Run `pod lib lint patrol_plus.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'patrol_plus'
  s.version          = '0.0.1'
  s.summary          = 'Adapter for integration tests using Patrol.'
  s.description      = <<-DESC
Runs tests that use flutter_test and patrol APIs as native macOS / iOS integration tests.
                       DESC
  s.homepage         = 'https://github.com/Bdaya-Dev/patrol'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'Bdaya Dev' => 'ahmednfwela@digrum.com' }
  s.source           = { :http => 'https://github.com/Bdaya-Dev/patrol/tree/master/packages/patrol_plus' }
  s.source_files = 'Classes/**/*'
  s.ios.dependency 'Flutter'
  s.osx.dependency 'FlutterMacOS'
  s.ios.deployment_target = '13.0'
  s.osx.deployment_target = '10.14'
  s.weak_framework = 'XCTest'
  s.ios.framework  = 'UIKit'
  s.osx.framework  = 'AppKit'
  s.resource_bundles = {
    'patrol_privacy' => ['Resources/PrivacyInfo.xcprivacy']
  }

  # Include localization resources
  s.resources = [
    'Resources/*.lproj'
  ]

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'

  s.dependency 'CocoaAsyncSocket', '~> 7.6'
end
