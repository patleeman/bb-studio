# Build-only desktop staging checkpoint

An owned desktop build now excludes the updater from its compiled entry-point
graph and uses a separate bundle/package identity. The [source proposal](native-staging.patch)
and [preparation report](REPORT.md) explain the build-time switch, no-op update
services, packaging restrictions and tests. This patch is based on companion
core snapshot `c3191cf76834845494ec04a251cad6ffdbfaadb5`; it is not a released
host change or an untouched stable application build.

Root reviewed the runtime selection and independently reran the read-only
bundle assertions. The asar digest remains
`f6f0a8d17c9a430832bf150136d41c5c72d23afa26ab950b007644967d7bfe38`.
The exact [inspection](bundle-inspection.json) confirms the distinct identity,
absent active updater/feed and retained inactive dependency files. To repeat
inspection while the owned fixture still exists:

```sh
node docs/host-support/native-staging/inspect-bundle.cjs \
  /var/folders/cv/q6nc4gqx0kddgybjp7s817zr0000gn/T/bb-native-build-yjkg4kuh
```

The helper reads the bundle and writes an inspection report; it does not launch
the app. It expects this fixture's pinned local asar dependency and directory
layout. The patch and build logs preserve the reproducible source proposal
after temporary build files are removed.

No native app launched in this follow-up. The automation inventory still fails
with `Sky Computer Use native pipe startup failed` ([record](automation-blocker.json)).
Consequently, native Reactions menus and the fixture's runtime behavior remain
unverified. A future launch still requires explicit private runtime data,
ports, profile and owned-process cleanup; the regular launcher does not select
the staging bundle. Follow the [staging requirements](../../native-desktop-staging.md)
and inspect any rebuilt artifact again before launch.

The earlier [installed-app updater incident](../../review-evidence/2026-10-02/native-reactions/REPORT.md)
remains separate. Preparing this build did not restore or alter the installed app.
