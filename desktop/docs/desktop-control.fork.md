# Desktop control (the HUD, pointing and shared control)

BB Studio can work outside its own window: a floating HUD with the current
conversation, pointing at other apps to pin notes, and agents acting on other
apps through Studio-owned `desktop_*` tools. This page is the host side: the
bundled driver, the helper, the overlay, the grant model and how it is built.
The Studio plugin side (HUD window, permissions sheet, tools) lives in the
monorepo under `plugins/packages/bb-studio/src/desktop`.

## Pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Cua Driver | `Contents/Resources/desktop-control/cua-driver` | Reads windows (accessibility tree and screenshot) and acts on them in the background (AX actions and per-window events). Pinned in `apps/desktop/desktop-control.fork.json`. |
| Helper | `Contents/Resources/desktop-control/bb-studio-desktop-helper`, source `apps/desktop/native/fork-desktop-helper/main.swift` | Permission status (Accessibility, Screen Recording, Input Monitoring) and requests, the talk key (a listen-only event tap), and the window, element and URL under a screen point. |
| Controller | `apps/desktop/src/fork-desktop-control.ts` | The state every window sees, the HUD's lifecycle (hides the main window, gives it back), the overlay windows, pins and their screenshots, the cursor grant, pausing on user input, and the agent socket. |
| Overlay | `/fork-window/_bb/desktop-overlay`, drawn by `apps/app/src/components/fork/ForkDesktopOverlay.tsx` | One transparent, click-through window per display while the HUD is up: crosshair and hover highlight while pointing, numbered pins, the ghost cursor with its caption and click ripple, and the mode bar. Excluded from screen captures (`setContentProtection`). |
| Agent socket | `apps/desktop/src/fork-desktop-agent-socket.ts`, server side `apps/server/src/services/fork-desktop-control.ts` | A unix socket in a private temp folder with a per-launch token, passed to the server in `BB_STUDIO_DESKTOP_CONTROL`. The server reads it at import and deletes it from its own environment, so agents do not inherit it. Plugins reach it through `bb.experimental_hooks.experimental_desktopControl`. |

Every window reaches the controller through `window.bbDesktop.experimental_desktopControl`
(`request` and `subscribe`); plugins use `experimental_useDesktopControl()`.

## Permissions

All three macOS permissions attach to BB Studio itself. The driver and the
helper are direct children of the app, so macOS answers their checks with
BB Studio's grants (the driver runs `--embedded`: no prompts of its own, no
relaunch, no `com.trycua.driver` identity). Pointing stays off in the host
until all three are granted. Screen Recording granted after launch sets
`restartAdvised`; the sheet offers Relaunch. Permissions are re-checked when
any BB Studio window gains focus and every two seconds while the sheet is open.

## The grant model (enforced in the host)

- Agents act only for the conversation open in the HUD, and only while it is
  up. Any other thread gets a refusal.
- Background is the default: `delivery_mode` is forced to `background` unless
  the tool asks for `foreground`. `scope: "desktop"`, `session`, capture ids and
  output file paths are never passed to the driver. `bring_to_front`,
  `move_cursor`, clipboard, scripts, recording, browser profiles, updates and
  skills are not exposed at all.
- A foreground action (the real cursor or keyboard) needs a grant. The HUD
  asks: Let it drive this session, Just this once, No. A pending ask expires
  as No after two minutes. Once is used up by one foreground action. Moving the
  mouse revokes any grant (the watcher ignores the cursor while the driver
  moves it during a foreground action).
- The user's input wins: moving the mouse inside the window the agent acts on
  pauses the agent (its next action waits, up to 20 s, then is refused).
  Esc (a global shortcut only while an agent acts or while pointing) or Stop
  halts it until the user resumes or sends a message.
- Password and secure fields are refused: an element token whose role or
  subrole is `AXSecureTextField`, a pixel point over one, and any keyboard
  action while the focused element is secure or Secure Input is on.

## Telemetry and updates are off

The controller starts the driver with `desktopDriverEnv`: `DO_NOT_TRACK=1`,
`CUA_DRIVER_RS_TELEMETRY_ENABLED=0`, `CUA_TELEMETRY_ENABLED=0`,
`CUA_TELEMETRY=off`, `CUA_DRIVER_RS_UPDATE_CHECK=0`, a private `HOME`
(`<userData>/desktop-control/home`, so `~/.cua-driver` is never read or
written), and only `PATH`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG` and
`LC_*` from the app's environment. `apps/desktop/test/fork-desktop-control.test.ts`
asserts this env and that no update or skills command is ever run.

## The switch

Desktop control is off unless the app runs with `BB_STUDIO_DESKTOP_HUD=1`
(exactly `1`), the same switch the Studio plugin reads. Only the HUD test
app's launcher sets it; an app opened from Finder never has it. Off,
`registerDesktopControl` registers one handler that answers
`supported: false` and starts nothing: no controller, no helper or driver
process, no permission probe, no overlay or HUD window, no Esc shortcut and no
agent socket, so the server has no endpoint and `experimental_desktopControl`
answers that it needs the desktop app. `apps/desktop/test/fork-desktop-hud-off.test.ts`
checks it.

## Building

`node scripts/fork/desktop-control.mjs` (macOS) downloads the pinned release
asset, checks its sha256 against the manifest, verifies its sigstore bundle
with `cosign verify-blob` against the release workflow's identity at the pinned
tag (`--no-cosign` only for a local test), builds the helper for arm64 and
x86_64 with `swiftc`, and stages `cua-driver`, the helper, `NOTICE.md` and
`driver.json` in `apps/desktop/release/desktop-control`. When that folder
exists, `applyStudioBuilderConfig` adds it to the mac `extraResources` (outside
the asar). Without it the app builds as before. `release-desktop.mjs` fails a
release whose app has `Contents/Resources/desktop-control`. `release-desktop.mjs` removes `apps/desktop/release` before
electron-builder, so a release must stage after that step. For a dev run
without packaging, `BB_STUDIO_DESKTOP_CONTROL_DIR` points at a staged folder.

Signing: electron-builder signs nested Mach-O files with the app's identity
and hardened runtime. An unsigned dev build is signed ad hoc after packaging
(`codesign -s - --force --options runtime` on both binaries, then the app).

## Before a signed ship: build the driver from source

The small test bundles Cua's attested release binary. A signed BB Studio
release should bundle a driver built from source, pinned to the same commit,
with telemetry and update checks compiled out:

- Source: `https://github.com/trycua/cua` at
  `b168ff39fef15d993ab66facce9b0027ea556dce` (tag `cua-driver-rs-v0.47.24`).
  The workspace is `libs/cua-driver/rust`. `crates/cua-driver` also needs the
  repository's `cua/crates/cua-telemetry` (config reader only, no sender) and
  `cua/crates/cua-agent-setup` (path dependencies `../../../../cua/crates/…`),
  so check out both trees.
- Toolchain: Rust 1.97.1 (`libs/cua-driver/rust/rust-toolchain.toml`, profile
  minimal plus rustfmt) through rustup, and the macOS SDK from Xcode or the
  Command Line Tools. Homebrew's rustc is too old.
- Build: `cargo build --release -p cua-driver --target aarch64-apple-darwin`
  and `--target x86_64-apple-darwin`, then `lipo -create` into one universal
  `cua-driver`.
- The hard-off patch, kept as `scripts/fork/patches/cua-driver-telemetry-off.patch`
  when the source build lands:
  - `crates/cua-driver/src/telemetry.rs`: `effective_enabled()` returns
    `(false, "build")` before reading any environment or config, so no event is
    ever sent and no install id is written.
  - `crates/cua-driver/src/version_check.rs`: `is_enabled()` returns `false`.
  - `crates/cua-driver/src/release_source.rs` and `crates/cua-driver/src/skills.rs`:
    their download functions return an error without opening a connection.
  - Keep the env switches above anyway.
- Check: `nettop` or `lsof -i` on the driver during a session shows no
  connection (the small test checks the release binary the same way).
- Then point `desktop-control.fork.json` at the built artifact's sha256 instead
  of the release asset, and keep `NOTICE.md` (Cua's MIT license and its
  third-party notices) in the bundle.

## Tests

- `apps/desktop/test/fork-desktop-control.test.ts`: permission states, the grant
  state machine (session, once, no, revoked on mouse move, stop, busy), pausing
  on user input, the pin model and its chip, refusal of secure fields, argument
  filtering, the driver env, and the agent socket's token.
- `apps/desktop/test/fork-desktop-hud.test.ts`: HUD show and hide (main window
  hidden and restored, overlay up, Escape held only while pointing), pointing
  kept off without the permissions, a pin from a click, and agents refused
  outside the HUD's conversation.
- `apps/server/test/services/fork-desktop-control.test.ts`: the server's side
  of the socket.
