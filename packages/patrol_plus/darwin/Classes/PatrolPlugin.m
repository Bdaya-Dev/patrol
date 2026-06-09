#import "PatrolPlugin.h"
#if __has_include(<patrol_plus/patrol_plus-Swift.h>)
#import <patrol_plus/patrol_plus-Swift.h>
#else
// Support project import fallback if the generated compatibility header
// is not copied when this plugin is created as a library.
// https://forums.swift.org/t/swift-static-libraries-dont-copy-generated-objective-c-header/19816
#import "patrol_plus-Swift.h"
#endif

@implementation PatrolPlugin
+ (void)registerWithRegistrar:(NSObject<FlutterPluginRegistrar>*)registrar {
  [SwiftPatrolPlugin registerWithRegistrar:registrar];
}
@end
