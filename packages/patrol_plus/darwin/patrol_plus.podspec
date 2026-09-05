# Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
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
  # Swift sources live in PatrolImpl; ObjC PatrolPlugin + runner macros in patrol/.
  # CocoaPods compiles them all into a single `patrol` module (DEFINES_MODULE),
  # so `@import patrol` exposes both — unlike SwiftPM, where PatrolImpl is a
  # separate module linked behind the Clang `patrol` interface (see Package.swift).
  s.source_files = 'patrol_plus/Sources/patrol_plus/**/*.{swift,h,m}', 'patrol_plus/Sources/PatrolImpl/**/*.{swift,h,m}', 'patrol_plus/Sources/HTTPParserC/**/*.{c,h}'
  s.public_header_files = 'patrol_plus/Sources/patrol_plus/include/**/*.h', 'patrol_plus/Sources/HTTPParserC/include/**/*.h'
  # SwiftPM-only files must not be picked up by CocoaPods:
  #  - module.modulemap: CocoaPods generates its own.
  #  - patrol.h: SwiftPM umbrella with ObjC stubs for PatrolImpl @objc types.
  #    Under CocoaPods the Swift sources are in the same module, so those stubs
  #    would duplicate the generated interfaces.
  s.exclude_files = 'patrol_plus/Sources/patrol_plus/include/module.modulemap', 'patrol_plus/Sources/patrol_plus/include/patrol_plus.h'
  s.ios.dependency 'Flutter'
  s.osx.dependency 'FlutterMacOS'
  s.ios.deployment_target = '13.0'
  s.osx.deployment_target = '10.14'
  s.weak_framework = 'XCTest'
  s.ios.framework  = 'UIKit'
  s.osx.framework  = 'AppKit'
  s.resource_bundles = {
    'patrol_privacy' => ['patrol_plus/Sources/PatrolImpl/Resources/PrivacyInfo.xcprivacy']
  }

  # Include localization resources
  s.resources = [
    'patrol_plus/Sources/PatrolImpl/Resources/*.lproj'
  ]

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'

  s.dependency 'CocoaAsyncSocket', '~> 7.6'
end
