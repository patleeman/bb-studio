# Native desktop staging

The normal server and browser fixture in `scripts/staged-bb.mjs` does not
exercise Electron-native menus. Native QA needs a separate desktop fixture.
There is no verified native staging runner in this repository yet.

Do not launch the installed app in `/Applications` as that fixture. On
3 October 2026, a launch with a fresh `BB_DATA_DIR`, separate Chromium profile
and isolated ports still activated the shared updater. It replaced the
installed BB 0.44.0 bundle with 0.45.0 before the test opened any menu.
The [incident report](review-evidence/2026-10-02/native-reactions/REPORT.md)
records the installation, signature check and owned-process cleanup. Native
Reactions remains unverified.

## Requirements before another native launch

- Use a separate owned source copy and app bundle, not the installed app or
  another reviewer's running checkout. Keep its data, ports and Electron
  profile separate too.
- Verify that automatic and manual update execution are disabled in that
  exact build before launch. Inspect both the updater and installer target;
  data/profile isolation alone is insufficient.
- Do not assume `BB_DESKTOP_AUTO_UPDATE=0` disables a packaged build. In the
  reviewed core source, `shouldEnableDesktopAutoUpdate` returns
  `isPackaged || env.BB_DESKTOP_AUTO_UPDATE === "1"`. The packaged branch wins.
- Confirm the app connects to the fixture server before opening any UI.
  Create only owned deterministic fixtures and record the actual app version.
- Identify the process tree and cleanup plan before starting. Stopping the
  main app is not proof that a detached installer has stopped. Do not remove
  shared updater services, caches, or unrelated processes as cleanup.

The core `pnpm desktop:worktree` command packages a desktop app in a source
checkout. Its runtime configuration derives data and ports from that checkout's
absolute path and overrides inherited `BB_DATA_DIR` and port values. Its
supported entrypoint is preferable to an improvised installed-app launch, but
it does not by itself establish updater isolation. Review and satisfy the
requirements above before running it from a separate source copy.

Browser-only checks, injected menu bridges, and rendered HTML imitations do
not close a native-menu test. Keep the native check open if a safe fixture
cannot be established.
