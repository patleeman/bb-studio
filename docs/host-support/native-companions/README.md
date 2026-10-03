# Native companion host support

[native-companions.patch](native-companions.patch) contains eight verified
BB core commits based on `get-bb/bb` commit `32efd2e3f`:

- `bda6f61ef`: persistent plugin portals, dynamic native workbench tabs, and
  matching main outlets, with session restoration and pin/dismissal policy.
- `24d2201fc`: SDK and CLI controls for existing companions, using validated,
  owner-scoped signals and the current view callbacks.
- `1050e72f3`: leading context actions in an embedded chat target its own
  bottom composer, including when another chat surrounds it.
- `99e2d01ac`: distinct main companions remain visible in unfocused split
  panes; duplicate outlets share their one live view and follow focus.
- `a91ced4bc`: outlet ownership is observed as a React store snapshot so
  the optimized app renders an outlet after its initial registration.
- `f86b430c0`: split opens and drag indicators distinguish plugin items by
  subpath. Reopening an exact item focuses it; normal navigation updates
  the focused panel while preserving the other item.
- `86e090d60`: native thread companions adopt the original main-thread editor
  and file input. Their callbacks/context follow placement; selection,
  focus and undo survive transfers and return after close.
- `c3191cf76`: native panel navigation and empty persisted tab state do not
  dismiss a visible companion. Explicit Hide/Show retain their behavior.

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
| Split routing, navigation, outlet and layout tests | 112 passed |
| Existing split workspace UI tests | 75 passed |
| Main composer adoption, keystrokes and native panel regressions | 107 passed |
| Updated Plugin SDK and BB guide checks | 369 passed |
| Optimized BB runtime build | 50 tasks passed |
| Applying all eight commits to the stated base | Exact verified source tree |

The [live capture](../../../packages/bb-studio-float/assets/native-workbench-preview.png)
runs the normal optimized BB application in its own data directory, with all
17 Studio plugins installed from pushed `b241546`, Pages updated to
`75ad5f5`, and Float to `598ee8b`. UI actions move the real Pages editor and native composer through
floating, workbench and main placement. The capture verifies exact editor and
composer DOM identity, the unsent draft, its file input, and shared pin state.
SDK-to-server tests verify schema validation, unknown plugins, two-client
delivery, and every supported action. Live CLI checks verify both delivery
and the resulting saved placement, retained drafts, pin-protected close,
and returning to a main companion after another main view opens.

The [split/swap capture](../../../packages/bb-studio-float/assets/native-split-preview.png)
edits two real main Pages editors before their first companion moves. It
checks both exact original DOM nodes, inserted drafts, stable tab identities,
and each item's pin through two swaps and Move to split. Both final outlets
must be visible in separate BB panes. This optimized-runtime check caught
the initial outlet subscription failure that unit tests did not reproduce.

The [main-thread capture](../../../packages/bb-studio-float/assets/native-first-thread-preview.png)
starts with a real unsent main-thread draft and selected file. It verifies
the exact original editor/input through the first Float move, undo/redo,
navigation away, docking, main placement, and closing back into a newly
mounted main anchor. It checks the displayed model and final viewport too.
The native panel host honors companion visibility even with no persisted
native tabs; this final-frame check caught a false navigation dismissal.

Run after sourcing the isolated instance's `capture.env`:

```sh
BB_CAPTURE_NATIVE_COMPANION=1 BB_CAPTURE_COMPANION_REMOTE=1 \
BB_CAPTURE_ONLY=float-native \
node scripts/capture-plugin-screenshots.mjs --plugin float

BB_CAPTURE_COMPANION_SPLIT=1 BB_CAPTURE_ONLY=float-native-split \
node scripts/capture-plugin-screenshots.mjs --plugin float

BB_CAPTURE_MAIN_THREAD=1 BB_CAPTURE_ONLY=float-native-main-thread \
node scripts/capture-plugin-screenshots.mjs --plugin float
```

## Release and remaining integration

These host APIs are not in the stable BB release. GitHub reports the current
account's permission on authoritative `get-bb/bb` as `READ`; this agent cannot
publish a BB host release. The patch and live evidence make the required
changes reviewable. Stable BB continues to use the suite's floating fallback.

Initial main plugin-editor transfers, original main-thread composer adoption,
and native split/swap now have live proof. Legacy-host transfers, Talk playback
continuity, and the final suite entry-point audit remain part of the delivery goal.
