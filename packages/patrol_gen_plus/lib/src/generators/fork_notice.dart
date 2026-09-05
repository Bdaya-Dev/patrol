/// The Apache-2.0 §4(b) "changed file" notice every generated file starts with.
///
/// This fork must mark each file it changed from upstream leancodepl/patrol
/// with a prominent notice, and `tool/apache_notice` enforces that in CI by
/// looking for the marker text `from the original LeanCode Patrol source` in
/// the first lines of the file. Generated files are rewritten from scratch on
/// every run, so the notice has to be emitted by the generator itself or
/// regeneration would strip it. Keep the marker text verbatim.
const forkNoticeLine =
    '// Modified by Bdaya-Dev from the original LeanCode Patrol source '
    '(Apache-2.0). See NOTICE.md.';
