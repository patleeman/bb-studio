# Talk call capture: spike results

This one-day spike checks the open risks in the approved design for call
transcription (Talk records a Zoom, Meet or FaceTime call and transcribes it).
It builds nothing for v1. The throwaway prototype is in
`scratch/talk-tap-spike` (spike branch `bb/talk-call-capture-spike-plugin-helper-electron-l-thr_pzds35748x`, `scratch/talk-tap-spike/README.md`).

Date: 2026-10-27. Mac: macOS 26.6.2 (25G83), Apple Silicon, Swift 6.3.3.
BB versions checked:

| Build | App | Electron | Notes |
|---|---|---|---|
| Stable, staged (`bb-app` from npm) | 0.47.1 | none (plain Node 22.22.3) | used for all install and launch tests |
| Stable, installed `/Applications/bb.app` (read only) | 0.45.0 | 44.3.0 | not yet updated to 0.47.1 |
| Nightly, installed `/Applications/bb Nightly.app` (read only) | 0.47.2-nightly | 44.9.3 | this thread runs under it |

## Answers

| Question | Answer |
|---|---|
| Q1. Can a plugin ship a native helper and start it on stable BB? | **Yes.** Shown in a staged stable BB 0.47.1. Git installs keep the executable bit and add no quarantine, so an ad-hoc-signed helper runs. Notarization isn't needed for git installs. |
| Q2. Can Electron's own loopback give a smaller v1? | **No, not from a plugin.** BB never sets `setDisplayMediaRequestHandler`, never uses `desktopCapturer`, and exposes no capture API. `getDisplayMedia` can't work in BB's window, and a plugin can't reach the main process to fix that. Only the BB team could add it. |
| Q3. Does a process tap work when BB is the responsible app? | **Partly answered.** BB is the responsible app for the helper, and BB's Info.plist already has `NSAudioCaptureUsageDescription`. The capture itself didn't run: permission is "not determined", so starting the tap would show a system prompt on Patrick's screen. The code is built and waits for the lead's go-ahead (see [Q3](#q3-process-tap-with-bb-as-the-responsible-app)). |

**Recommended v1 path: the helper** (`bb-talk-tap`, shipped inside Studio and
started by Studio's server), as the design proposes. Electron loopback can't be
used without a BB release. It would also capture all system audio, need a
broader permission, and show the screen-capture indicator.

## Q1. A native helper in a plugin

### What the SDK and BB allow

- **A plugin's server is full-trust Node.** `bb plugin install` itself says
  so: "Plugins are full-trust code running inside the BB server. They can read
  all local BB data, including other plugins' secrets." Pinned SDK 0.6.37
  types import `node:child_process` (`bb-plugin-sdk-host.d.ts`), and nothing
  limits it.
- **Studio already relies on this on stable.** `src/speech/local.ts` starts
  `uv` and Python (mlx-audio). `src/code/server/runtime.ts` starts
  code-server. `src/decisions/server/key-command.ts` uses `execFile`.
- **Binary files are fine.** BB doesn't filter package contents. A `git:`
  install copies the whole repository at the commit, then builds in place.
  Studio's bundle ends up in
  `…/plugins/cache/git/github.com/patleeman/bb-studio/<sha>/packages/bb-studio/dist/server.js`,
  so a helper can be found with `new URL("../bin/bb-talk-tap", import.meta.url)`.

### How BB installs from git

In BB 0.47.1's `server/dist/start-server.js`, `cloneGitCommit` runs the system
`git clone --quiet <url> <staging>`, then `git checkout --detach <commit>`,
then deletes `.git`. Git restores mode `100755` as an executable file and
never sets `com.apple.quarantine`. Desktop BB runs the same server through its
own binary (`ELECTRON_RUN_AS_NODE=1`, `createBbAppProcessEnv` in `app.asar`).
`bb.app` isn't sandboxed and has no `LSFileQuarantineEnabled`, so files its
server writes aren't quarantined either.

npm installs (`npm install --ignore-scripts`) weren't tested. A helper shipped
that way should get its mode checked (and fixed if needed) at startup.

### Test in a staged stable BB

1. `BB_STAGED_DIR=$TMPDIR/bb-studio-staged-pzds BB_STAGED_PORT=49310 node scripts/staged-bb.mjs start --ref 8f939f57 --plugin studio`
   installed `bb-app@0.47.1`. It also installed Studio from
   `git:github.com/patleeman/bb-studio@8f939f5`.
2. Studio's GitHub install kept its executable scripts (for example
   `scripts/install-all.sh` and `apps/ios/scripts/*.sh`) at mode 755.
   `xattr -lr` over the whole plugins folder found 40,049 files with
   `com.apple.provenance` and **0 with `com.apple.quarantine`**.
3. I built the helper with
   `build.sh` (spike branch `bb/talk-call-capture-spike-plugin-helper-electron-l-thr_pzds35748x`, `scratch/talk-tap-spike/helper/build.sh`): `swiftc` for
   arm64 on macOS 14.2+, with the Info.plist embedded in `__TEXT,__info_plist`,
   then `codesign --force -s -` (ad hoc).
4. I committed the scratch plugin to a local git repository
   (`bin/bb-talk-tap` as `100755`) and installed it with the same code path as
   GitHub installs: `bb plugin install git:/private/var/…/tap-git-src --yes`.
   I couldn't push, and `git:file://…` is rejected; BB accepts `git:` with an
   absolute local path and runs the same `git clone`. The only difference from
   a GitHub install is the transport.
5. `bb talk-tap-spike check` makes the plugin's server run the helper:

```text
"server":  { "execPath": ".../node", "versions": { "node": "22.22.3", "electron": null } }
"helper":  ".../data/plugins/cache/git/local/.../tap-git-src/a606293b…/bin/bb-talk-tap"
"mode":    "755"
"xattr":   "com.apple.provenance: \u0001\u0002"        (no com.apple.quarantine)
"spctl":   exit 3, "rejected"                          (expected: ad hoc, not notarized)
"version": exit 0, "bb-talk-tap 0.0.1-spike"
"whoami":  responsiblePath "/Applications/bb Nightly.app/Contents/MacOS/bb Nightly",
           audioCaptureTCC "not-determined(2)"
```

`spctl` rejects the file, but that's only Gatekeeper's verdict on request.
Gatekeeper enforces it at launch only for quarantined files, so the helper ran.

### Notarization and release

- **Not needed for git or marketplace installs.** Nothing in that path adds
  quarantine. On Apple Silicon a binary only needs a signature to run, and an
  ad-hoc one is enough.
- **Needed if the helper ever arrives quarantined.** That happens with a
  browser download, a zip from GitHub Releases, AirDrop, or BB downloading it
  over an API that adds quarantine. Gatekeeper then blocks an unnotarized
  helper with a "can't be opened" dialog. I didn't trigger this here, because
  the dialog would appear on Patrick's screen.
- **What a release needs:**
  - Build a universal (arm64 + x86_64) helper with `-target …-macos14.2`.
  - Sign it with a Developer ID Application certificate and the hardened
    runtime (`codesign -o runtime --timestamp`). It needs no entitlements for
    taps.
  - Notarize it (`notarytool submit` with a zip). A bare Mach-O can't be
    stapled; Gatekeeper checks notarization online.
  - Commit it to `packages/bb-studio/bin/` (or fetch it at first use with a
    pinned SHA-256), and have the server check its mode and SHA-256 before
    running it.
  - A stable Developer ID identity also keeps the helper's code requirement
    the same across updates. That matters if the helper ever becomes its own
    responsible app (see Q3).
  - Signing credentials stay with the release process. The spike didn't touch
    them.

## Q2. Electron loopback

Read-only checks of `/Applications/bb.app` (0.45.0, Electron 44.3.0) and
`/Applications/bb Nightly.app` (0.47.2-nightly, Electron 44.9.3). I grepped
`Contents/Resources/app.asar` (count of matches in each):

| Search | bb.app | Nightly |
|---|---|---|
| `setDisplayMediaRequestHandler` | 0 | 0 |
| `desktopCapturer` | 0 | 0 |
| `getDisplayMedia` | 0 | 0 |
| `loopback`, `useSystemPicker`, `appendSwitch(` | 0 | 0 |
| `setPermissionRequestHandler` | 2 (in-app browser partition only) | 2 (same) |

- **`getDisplayMedia` with audio:** Electron needs the app to set
  `session.setDisplayMediaRequestHandler`. Without it, the call is rejected.
  BB never sets it on any session, so no plugin UI can get display or
  loopback audio.
- **`desktopCapturer` with audio loopback:** it runs only in the main
  process. BB's windows use `sandbox: true`, `contextIsolation: true` and
  `nodeIntegration: false`. The only bridge, `window.bbDesktop`, offers
  `browser`, `checkForUpdates`, `focusWindow`, `getInfo`, `getWindowState`,
  `installUpdate`, `openExternalUrl`, `setTheme`, `zoom` and a few window
  events. None of them captures audio.
- **Can a plugin reach the handler?** No. Plugin code runs in BB's server
  (Node, no Electron) or in the window's renderer. Neither can call
  `session.*` in the main process.
- **Staged try:** the staged BB is the npm `bb-app` server with the UI in a
  browser, not Electron. So it can't test Electron capture at all. Running the
  installed app as a test subject is off limits, and the code above already
  settles the question.

**What the BB team would have to add:** a `setDisplayMediaRequestHandler`
that grants `{ video: <a source>, audio: 'loopback' }`. On macOS that path
goes through Chromium's ScreenCaptureKit or system-audio-tap capture, which
may need a Chromium feature switch depending on the Electron version. Even
then, Talk would lose:

- **App choice.** It would capture all system audio: music, notifications,
  every browser tab, and the call.
- **The narrow permission.** It needs Screen & System Audio Recording, which
  is broader than "System Audio Recording Only".
- **A quiet indicator.** macOS shows its screen-capture indicator, and a video
  track has to exist even when it's thrown away.
- **Echo handling and separate streams.** Chromium mixes the audio, so we
  can't keep Zoom apart from everything else.

## Q3. Process tap with BB as the responsible app

The helper's `tone-tap` command (in
`main.swift` (spike branch `bb/talk-call-capture-spike-plugin-helper-electron-l-thr_pzds35748x`, `scratch/talk-tap-spike/helper/main.swift`)) does this:

1. It writes a 440 Hz sine WAV to a temp folder and plays it with
   `/usr/bin/afplay -v 0.05`, as the helper's own child process.
2. It gets that child's process object with
   `kAudioHardwarePropertyTranslatePIDToProcessObject`.
3. It creates `CATapDescription(stereoMixdownOfProcesses: [that object])`
   with `muteBehavior = .unmuted` (pass-through) and `isPrivate = true`, then
   `AudioHardwareCreateProcessTap`.
4. It creates a private aggregate device with only that tap, runs an IOProc
   for N seconds, and reports the following: RMS, peak, whether the samples
   are all zero, Goertzel power at 440 Hz against 1 kHz, and whether
   `afplay` is still playing.

It taps only the PID it started. It never taps any other app, system audio,
or the mic.

### Results so far

- **The responsible app is BB.** `whoami` reads
  `responsibility_get_pid_responsible_for_pid`. It reported
  `/Applications/bb Nightly.app` both from this thread's shell and from the
  staged BB's plugin server, which was started from that shell. In a user's
  desktop BB, Studio's server runs as `bb.app` with
  `ELECTRON_RUN_AS_NODE=1`, so the responsible app is `bb.app`.
- **The permission is "not determined"** for the responsible app
  (`TCCAccessPreflight("kTCCServiceAudioCapture")` returned 2). That call
  only reads; it never prompts. So `tone-tap` stopped before creating the tap,
  as designed:
  `"result": "skipped: audio-capture permission is not determined …"`.
- **The usage string comes from the responsible app's Info.plist.** macOS
  attributes the request to BB and uses BB's bundle for the prompt. Both
  `bb.app` and `bb Nightly.app` already have
  `NSAudioCaptureUsageDescription` = "This app needs access to audio capture"
  (Electron's default text). So a tap from a Studio helper should be allowed
  to prompt, but the prompt would show that generic sentence. The helper's
  own embedded key ("Talk records the call you choose…") is ignored while BB
  is responsible.
  - To get Talk's own wording, the BB team would set a better string in BB's
    Info.plist.
  - Or the helper would have to become its own responsible process (start
    itself with responsibility disclaimed), so the prompt names
    `bb-talk-tap`. That makes a stable Developer ID signature necessary.
- **The expected prompt** is macOS's "System Audio Recording Only" request:
  "“bb Nightly” would like to record audio from other apps" (or "“bb”" in
  stable), with Allow and Don't Allow. After that, the app is listed in
  System Settings › Privacy & Security › Screen & System Audio Recording ›
  System Audio Recording Only. The exact wording is inferred, not seen.

### To finish Q3 (needs the lead's go-ahead)

From a shell under the BB to be tested (Nightly here):

```sh
scratch/talk-tap-spike/helper/build.sh
scratch/talk-tap-spike/plugin/bin/bb-talk-tap tone-tap --seconds 3 --allow-prompt --out /tmp/tone.f32
```

Someone at the Mac answers the prompt (Allow), then runs the command again.
Pass means the following:

- `toneStillPlaying: true`, and the tone is heard throughout (pass-through);
- `captured.allZero: false`;
- `power440Hz` is much larger than `power1000Hz`.

If the prompt is denied, or never shown, the tap still runs but
returns silence (`allZero: true`). That pattern tells "no permission" apart
from "tap broken". The grant is stored for BB, so it also covers the real
helper later. Remove it with `tccutil reset AudioCapture dev.bb.desktop.nightly`.

## What's blocked or needs the BB team

- **Q3's capture run** needs one permission prompt answered on Patrick's
  screen (see above).
- **BB team (only to improve things, not needed for v1):**
  - A real `NSAudioCaptureUsageDescription` in BB's Info.plist, instead of
    Electron's default.
  - Optionally, a display-media handler with loopback, if a no-helper option
    is ever wanted. It isn't recommended.
- **Not checked:** whether an `npm:` install keeps the executable bit, and how
  Gatekeeper treats a quarantined helper (that would show a dialog).

## Cleanup

- I stopped the staged BB and deleted its directory
  (`node scripts/staged-bb.mjs stop`).
- No simulators were used, no TCC state changed, and nothing in `~/.bb`, the
  running BB or `/Applications` was modified.
