# Build-only native Electron staging fixture

The fixture is built and has not been launched. Root review is required before any later native QA. No files in bb-studio, the peer checkout, /Applications, shared updater caches, or user settings were edited in this assignment. No commit or push occurred.

## Source and patch

Owned plain clone on `main`: `/var/folders/cv/q6nc4gqx0kddgybjp7s817zr0000gn/T/bb-native-build-yjkg4kuh/core`. Source snapshot: `c3191cf76834845494ec04a251cad6ffdbfaadb5` (the companion core snapshot, not an untouched stable release). It was created with `git clone --no-hardlinks --branch main /tmp/bb-companion-current <owned>/core`. Existing node_modules/dist dependencies were copied using APFS `cp -cR`, without following workspace symlinks or copying ignored .env/credential files. The source peer remained read-only. The proposed source patch is [native-staging.patch](native-staging.patch).

`BB_DESKTOP_STAGING=1` selects an update runtime with type-only imports. Production retains its existing updater/service construction in a separate module. The staging implementation starts no scheduler, fetch, download, or updater; manual checks return unchanged info and installation is a no-op. esbuild selects the staging implementation, validates that no updater runtime enters its input graph, and records that graph in `dist/desktop-build-policy.json`. This is build-time selection, not a runtime environment override.

Packaging checks the built policy and refuses a staging/normal mismatch. Staging overrides final builder identity, disables signing/notarization, strips CSC/APPLE variables from the builder child, forces `--publish never`, and removes the publish provider/feed. The normal release path remains selected when the staging flag is absent. `--build-only` returns after packaging before the launch command. Build-only discovery docs and Turbo cache inputs were updated. Build outputs are ignored.

## Commands and verification

All build/test child environments removed inherited `BB_*`, `CSC*`, and `APPLE_*` variables. Packaging then set only `BB_DESKTOP_STAGING=1`, `CSC_IDENTITY_AUTO_DISCOVERY=false`, and `NODE_ENV=production` for the fixture.

Final supported build-only command:

```sh
node --conditions=source --import tsx packages/scripts/src/commands/run-desktop.ts --worktree --build-only
```

The command completed: **55 Turbo tasks passed**. It derived an isolated instance data path under `.bb-dev`, server **20987**, daemon **28987**, and Electron profile `<derived-data>/desktop`; no runtime was started and that derived data path was not populated. The build's normal afterPack verification executed Electron solely in Node mode for an offline npm smoke test; no Electron desktop app or installer launched.

Checks passed:

- Desktop typecheck via Turbo.
- **28 tests**: staging no-op services/build graph/identity/feed restrictions plus existing auto-update/version-check/provider tests.
- **8 scripts tests**, including worktree build-only option and existing environment isolation cases.
- Formatting of changed code paths and `git diff --check`.

Logs: [build-only](build-only.log), [typecheck](typecheck.log), [desktop tests](test.log), [scripts tests](scripts-test.log). [inspect-bundle.cjs](inspect-bundle.cjs) is a read-only repeatable assertion/digest helper.

## Exact final bundle

`/private/var/folders/cv/q6nc4gqx0kddgybjp7s817zr0000gn/T/bb-native-build-yjkg4kuh/core/apps/desktop/release-staging/mac-arm64/bb Native Staging.app`

Final plist and package metadata: version **0.45.0**, app ID **dev.bb.qa.native-staging**, product/executable **bb Native Staging**, package/cache identity **bb-native-staging**. This differs from stable and Nightly identities. The bundle is intentionally unsigned.

The exact asar input graph contains no electron-updater or production update-runtime input. Its main entry contains no `electron-updater`, `quitAndInstall`, `desktop-latest`, `desktop-nightly`, or stable ShipIt namespace. Resources contain no update YAML/JSON feed. [Bundle inspection](bundle-inspection.json) includes all digests:

- app.asar SHA-256: `f6f0a8d17c9a430832bf150136d41c5c72d23afa26ab950b007644967d7bfe38`
- main.js SHA-256: `ce34e07fe2c2a55cb4254ca418330f6bd149eca6c6a499b5c57f96032fcb55f4`
- executable SHA-256: `588478afc5f2bc73b6433d6e565a214dc830144be39a3d79805723292754ccd8`
- Info.plist SHA-256: `f47fe8d116d9dd7ad7c54e950d649a809ba951d52bc116af7385debc0d945768`

## Remaining limits

The package retains **70 inactive electron-updater entries** as an unused dependency. It is excluded from the compiled executable graph, and no update service constructs it. Ineffective packaging-exclusion workarounds were removed. Electron's own native autoUpdater/Squirrel framework remains part of Electron; the fixture does not invoke it.

This is macOS arm64 build evidence only, not launch or native-menu evidence. No Reactions plugin/thread fixture is seeded. The normal `run-packaged-app.mjs` still resolves regular release paths; future staging launch must use this exact owned bundle with a separately reviewed explicit isolated environment. An unset runtime data/port environment is not safe by default. Root must inspect this artifact and compose the launch/cleanup plan before deciding whether to launch it. Native Reactions QA remains open.
