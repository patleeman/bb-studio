# Native companion host support

[native-companions.patch](native-companions.patch) contains three verified
BB core commits based on `get-bb/bb` commit `32efd2e3f`:

- `bda6f61ef`: persistent plugin portals, dynamic native workbench tabs, and
  matching main outlets, with session restoration and pin/dismissal policy.
- `24d2201fc`: SDK and CLI controls for existing companions, using validated,
  owner-scoped signals and the current view callbacks.
- `1050e72f3`: leading context actions in an embedded chat target its own
  bottom composer, including when another chat surrounds it.

The isolated checkout is `/tmp/bb-companion-current`; no unrelated edits from
the shared BB checkout are included. The patch is an ordinary `git am` series.
It introduces experimental APIs without raising any Studio plugin SDK pin.

## Verification

All checks use Turbo against that current BB base:

| Check | Result |
| --- | --- |
| App, server, CLI and Plugin SDK typechecks | Passed |
| Companion and existing native panel tests | 77 passed |
| Embedded chat tests | 19 passed |
| CLI command and discoverable guide tests | 5 passed |
| Real-database server route with SDK transport | 1 passed |
| Core SDK tests | 109 passed |
| Plugin SDK tests | 362 passed |
| Plugin Guide tests | 75 passed |
| Optimized BB runtime build | 50 tasks passed |

The [live capture](../../../packages/bb-studio-float/assets/native-workbench-preview.png)
runs the normal optimized BB application in its own data directory, with all
17 Studio plugins installed from pushed `ba0ae10` and Float updated to
`f962c2c`. UI actions move the real Pages editor and native composer through
floating, workbench and main placement. The capture verifies exact editor and
composer DOM identity, the unsent draft, its file input, and shared pin state.
SDK-to-server tests verify schema validation, unknown plugins, two-client
delivery, and every supported action. Live CLI checks verify both delivery
and the resulting saved placement, retained drafts, pin-protected close,
and returning to a main companion after another main view opens.

Run after sourcing the isolated instance's `capture.env`:

```sh
BB_CAPTURE_NATIVE_COMPANION=1 BB_CAPTURE_COMPANION_REMOTE=1 \
BB_CAPTURE_ONLY=float-native \
node scripts/capture-plugin-screenshots.mjs --plugin float
```

## Release and remaining integration

These host APIs are not in the stable BB release. GitHub reports the current
account's permission on authoritative `get-bb/bb` as `READ`; this agent cannot
publish a BB host release. The patch and live evidence make the required
changes reviewable. Stable BB continues to use the suite's floating fallback.

The native capture starts retention after a companion is realized. Moving an
already-open main editor into its first companion must additionally preserve
that original instance's unsaved state. Split/swap flows and the final suite
entry-point audit remain part of the delivery goal. This patch does not
declare those workflows complete.
