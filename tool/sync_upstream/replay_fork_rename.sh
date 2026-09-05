#!/usr/bin/env bash
#
# Replays the Bdaya-Dev/patrol fork's package rename onto an upstream
# (leancodepl/patrol) checkout so that `git merge` sees matching paths and
# package names, and only genuine content changes conflict.
#
# The fork renamed every published package to a `_plus` variant for pub.dev
# publishing (fork commit dee5f944a "feat!: rename all packages to _plus
# variants for pub.dev publishing" plus the follow-up fix commits 24f52b421,
# 0716b22ce, d6a7b1797, 6240bc78c, dd153b1ac, 7304f1ff5, d732fb8fe, ae388208f,
# a198ce0f9) and dropped `packages/patrol_mcp` (fork commit b9f7b2437: a
# separate Claude plugin replaces it).
#
# This script is idempotent: every substitution refuses to match a name that
# is already followed by an identifier character (so `patrol_plus` is never
# turned into `patrol_plus_plus`), and every `git mv` is skipped when the
# source is missing or the destination already exists.
#
# Usage (from the repo root, on a checkout of the upstream commit):
#   tool/sync_upstream/replay_fork_rename.sh
#   git commit -m "chore: replay fork package rename onto upstream <sha>"
#
# See tool/sync_upstream/README.md for the full sync recipe.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PACKAGES=(adb patrol patrol_cli patrol_devtools_extension patrol_finders patrol_gen patrol_log)

mv_if() {
  local src="$1" dst="$2"
  if [ -e "$src" ] && [ ! -e "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    git mv "$src" "$dst"
    echo "moved  $src -> $dst"
  fi
}

# 1. Package directories.
for p in "${PACKAGES[@]}"; do
  mv_if "packages/$p" "packages/${p}_plus"
done

# 2. patrol_mcp: intentionally dropped by the fork (b9f7b2437).
if [ -e packages/patrol_mcp ]; then
  git rm -r -q packages/patrol_mcp
  echo "removed packages/patrol_mcp"
fi
for f in .github/workflows/patrol_mcp-*.yaml; do
  [ -e "$f" ] && git rm -q "$f" && echo "removed $f"
done

# 3. Native plugin artefacts whose *names* carry the package name.
#    Flutter resolves a plugin's SwiftPM package at darwin/<package_name>/Package.swift
#    and imports its Clang module as <package_name>, so the SPM package dir, the
#    public target dir, the umbrella header and the podspec all follow the rename.
mv_if packages/patrol_plus/darwin/patrol.podspec packages/patrol_plus/darwin/patrol_plus.podspec
mv_if packages/patrol_plus/ios/patrol.podspec packages/patrol_plus/ios/patrol_plus.podspec
mv_if packages/patrol_plus/macos/patrol.podspec packages/patrol_plus/macos/patrol_plus.podspec
mv_if packages/patrol_plus/darwin/patrol packages/patrol_plus/darwin/patrol_plus
mv_if packages/patrol_plus/darwin/patrol_plus/Sources/patrol packages/patrol_plus/darwin/patrol_plus/Sources/patrol_plus
mv_if packages/patrol_plus/darwin/patrol_plus/Sources/patrol_plus/include/patrol.h packages/patrol_plus/darwin/patrol_plus/Sources/patrol_plus/include/patrol_plus.h
mv_if packages/patrol_plus/linux/include/patrol packages/patrol_plus/linux/include/patrol_plus
mv_if packages/patrol_plus/windows/include/patrol packages/patrol_plus/windows/include/patrol_plus

# 4. Text substitutions over every tracked text file.
#    CHANGELOGs are left untouched: the fork never rewrote historical entries.
git ls-files -z \
  | grep -z -v -E '(^|/)CHANGELOG\.md$' \
  | grep -z -v -E '\.(png|jpg|jpeg|gif|ico|icns|webp|svg|pdf|jar|zip|gz|ttf|otf|woff2?|mp4|mov|bin|dylib|so|a|framework)$' \
  | xargs -0 perl -e '
    my @pk = qw(patrol_devtools_extension patrol_finders patrol_gen patrol_log patrol_cli patrol adb);
    my $nx = q{(?![A-Za-z0-9_])};
    while (my $file = shift @ARGV) {
      open(my $fh, "<:raw", $file) or die "$file: $!";
      local $/; my $c = <$fh>; close $fh;
      next if index($c, "\0") >= 0;                     # binary
      my $o = $c;

      for my $p (@pk) {
        $c =~ s{package:\Q$p\E/}{package:${p}_plus/}g;                # Dart imports / exports
        $c =~ s{packages/\Q$p\E$nx}{packages/${p}_plus}g;             # repo paths, pub.dev URLs
        $c =~ s{(\.\./)\Q$p\E$nx}{$1${p}_plus}g;                      # relative path dependencies
        $c =~ s{pub/v/\Q$p\E$nx}{pub/v/${p}_plus}g;                   # shields.io badges
        $c =~ s{label=\Q$p\E$nx}{label=${p}_plus}g;
        $c =~ s{pub (global activate|global deactivate|add) \Q$p\E$nx}{pub $1 ${p}_plus}g;
      }
      # Multi-part package names are unambiguous words: rename them in prose and
      # string literals too (fork: compatibility checker, CLI messages, READMEs).
      for my $p (qw(patrol_devtools_extension patrol_finders patrol_gen patrol_log patrol_cli)) {
        $c =~ s{(?<![A-Za-z0-9_])\Q$p\E(?![A-Za-z0-9_]|\.dart|\.run|-)}{${p}_plus}g;
      }
      $c =~ s{\bpatrol_finders_example\b}{patrol_finders_plus_example}g;

      if ($file =~ m{(^|/)pubspec\.yaml$}) {
        for my $p (@pk) {
          $c =~ s{^name: \Q$p\E(?=\r?$)}{name: ${p}_plus}mg;
          $c =~ s{^(\s+)\Q$p\E:(?=\s|$)}{$1${p}_plus:}mg;             # dependency keys, executables
        }
        $c =~ s{^patrol:(?=\s*\r?$)}{patrol_plus:}mg;                  # top-level patrol config section
        $c =~ s{github\.com/leancodepl/patrol}{github.com/Bdaya-Dev/patrol}g;
        for my $p (@pk) { $c =~ s{(package%3A\+?)\Q$p\E$nx}{$1${p}_plus}g; }   # issue_tracker label query
      }
      if ($file =~ m{(^|/)pubspec\.lock$}) {
        for my $p (@pk) {
          $c =~ s{^  \Q$p\E:(?=\r?$)}{  ${p}_plus:}mg;
          $c =~ s{^(\s+)name: \Q$p\E(?=\r?$)}{$1name: ${p}_plus}mg;
        }
      }
      if ($file eq "melos.yaml") {
        $c =~ s{^name: patrol(?=\r?$)}{name: patrol_plus}m;
        $c =~ s{github\.com/leancodepl/patrol}{github.com/Bdaya-Dev/patrol}g;
      }

      # Bare `patrol` only where it names the plugin/module/pod, never the product.
      $c =~ s{\@import patrol;}{\@import patrol_plus;}g;                      # ObjC
      $c =~ s{^import patrol(?=\r?$)}{import patrol_plus}mg;                  # Swift
      $c =~ s{<patrol/}{<patrol_plus/}g;                                      # <patrol/PatrolPlugin.h>, <patrol/patrol_plugin.h>
      $c =~ s{patrol_plus/patrol-Swift\.h}{patrol_plus/patrol_plus-Swift.h}g;
      $c =~ s{"patrol-Swift\.h"}{"patrol_plus-Swift.h"}g;
      $c =~ s{\bpatrol_registrar\b}{patrol_plus_registrar}g;                  # generated desktop registrants
      $c =~ s{include/patrol$nx}{include/patrol_plus}g;                       # linux/windows include dir, SPM umbrella header
      $c =~ s{darwin/patrol$nx}{darwin/patrol_plus}g;                         # SPM package dir
      $c =~ s{Sources/patrol$nx}{Sources/patrol_plus}g;                       # SPM Clang target dir
      $c =~ s{set\(PROJECT_NAME "patrol"\)}{set(PROJECT_NAME "patrol_plus")}g; # CMake plugin targets
      if ($file =~ m{\.swift$}) {
        $c =~ s{\bpatrol\.(?=[A-Z])}{patrol_plus.}g;                          # module-qualified types
      }
      if ($file =~ m{/Package\.swift$}) {
        $c =~ s{name: "patrol"}{name: "patrol_plus"}g;                        # package, product and target
        $c =~ s{targets: \["patrol"\]}{targets: ["patrol_plus"]}g;
      }
      if ($file =~ m{\.podspec$}) {
        $c =~ s{s\.name(\s*)=(\s*)\x27patrol\x27}{s.name$1=$2\x27patrol_plus\x27};
        $c =~ s{pod lib lint patrol\.podspec}{pod lib lint patrol_plus.podspec};
        $c =~ s{\x27patrol/Sources/}{\x27patrol_plus/Sources/}g;
        $c =~ s{https://leancode\.pl\x27}{https://github.com/Bdaya-Dev/patrol\x27};
        $c =~ s{\{ \x27Bartek Pacia\x27 => \x27bartek\.pacia\@leancode\.pl\x27 \}}{{ \x27Bdaya Dev\x27 => \x27ahmednfwela\@digrum.com\x27 }};
        $c =~ s{github\.com/leancodepl/patrol}{github.com/Bdaya-Dev/patrol}g;
      }
      if ($file =~ m{/module\.modulemap$}) {
        $c =~ s/^module patrol \{/module patrol_plus {/m;
        $c =~ s{umbrella header "patrol\.h"}{umbrella header "patrol_plus.h"};
      }
      if ($file =~ m{\.pbxproj$}) {
        $c =~ s{XCLocalSwiftPackageReference "patrol"}{XCLocalSwiftPackageReference "patrol_plus"}g;
        $c =~ s{/\* patrol \*/}{/* patrol_plus */}g;
        $c =~ s{/\* patrol in Frameworks \*/}{/* patrol_plus in Frameworks */}g;
        $c =~ s{productName = patrol;}{productName = patrol_plus;}g;
      }
      if ($file =~ m{\.dart$}) {
        $c =~ s{\[\x27patrol\x27\]}{[\x27patrol_plus\x27]}g;                 # packageConfig/packages/yaml lookups
        $c =~ s{\x27- patrol \x27}{\x27- patrol_plus \x27}g;                 # `flutter pub deps` line prefix
        $c =~ s{"patrol"}{"patrol_plus"}g;                                    # user-facing messages
        $c =~ s{^(\s+)\x27patrol\x27,(?=\r?$)}{$1\x27patrol_plus\x27,}mg;    # executable name in process argv lists
        $c =~ s{ensure patrol is added}{ensure patrol_plus is added}g;
        $c =~ s{\x27patrol package not}{\x27patrol_plus package not}g;
        $c =~ s{Make sure you have patrol }{Make sure you have patrol_plus }g;
        $c =~ s{when patrol package}{when patrol_plus package}g;
        # pubspec.yaml fixtures embedded in test strings
        $c =~ s{^(\s*)patrol:(?=\s|$)}{$1patrol_plus:}mg;
        for my $p (@pk) { $c =~ s{^(\s+)name: \Q$p\E(?=\r?$)}{$1name: ${p}_plus}mg; }
        # The rename changes the alphabetical order of package imports; keep
        # `directives_ordering` satisfied by sorting each run of single-line
        # package imports by URI (the same order `dart fix` would produce).
        $c =~ s{((?:^import \x27package:[^\x27\n]+\x27[^;\n]*;\r?\n)+)}{
          join("", sort { ($a =~ /\x27([^\x27]+)\x27/)[0] cmp ($b =~ /\x27([^\x27]+)\x27/)[0] } split(/(?<=\n)/, $1))
        }mge;
      }

      if ($c ne $o) {
        open(my $out, ">:raw", $file) or die "$file: $!";
        print $out $c; close $out;
        print "edited $file\n";
      }
    }
  '

# The script itself lives on the fork side; never fold it into the replay commit.
git add -A -- . ':!tool/sync_upstream'
echo "done: $(git diff --cached --name-status | wc -l) index entries changed"
