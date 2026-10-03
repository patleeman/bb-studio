# Native Reactions QA — stopped during staging

No native Reactions test passed or failed. This lane stopped before installing the plugin, seeding a thread, reading the UI, or opening a context menu. No browser simulation counts as native evidence.

## Staging and version boundary

On 3 October 2026, the installed packaged Electron BB was **0.44.0**, verified by reading `package.json` from `/Applications/BB.app/Contents/Resources/app.asar`. The normal application binary launched as PID **78371**, with inherited `BB_*` variables removed, an explicit fresh `BB_DATA_DIR`, and `--user-data-dir` under `/var/folders/cv/q6nc4gqx0kddgybjp7s817zr0000gn/T/bb-native-reactions-z_p6mr17`.

The isolated ports were server **19969**, host daemon **27969**, and Electron CDP **49592**. `/health` returned `ok: true` and launch ID `2a14a98d-7871-4cf3-a0c7-311aca48fe43`. CDP listed the Electron renderer at `http://127.0.0.1:19969/`. This proved a real packaged app and isolated server/profile connection, but did not prove isolation of the updater.

No fixture thread, user message, assistant message, reaction draft, or provider turn was created. The supported copied-checkout `pnpm desktop:worktree` recipe arrived after this launch; it was not attempted.

## Unintended installed-app update

Fresh data and Chromium profile directories did **not** isolate the packaged app's updater. It downloaded 0.45.0 to the shared updater cache. ShipIt then replaced `/Applications/bb.app` while PID 78371 was still running, before cleanup began.

The shared ShipIt log records these local times:

- **02:10:05.053:** PID **79093** detected an install request.
- **02:10:05.068:** installation began.
- **02:10:11.609–02:10:11.610:** the old bundle moved from `/Applications/bb.app`, then the new bundle moved into that path.
- **02:10:13.690:** installation completed successfully.
- **02:10:13.691:** ShipIt quit.

The recorded target was `file:///Applications/bb.app/`; its update source was `file:///Users/patrick/Library/Caches/dev.bb.desktop.ShipIt/update.AzNGX4a/bb.app/`. The installed package now reports **0.45.0**. This was an unintended change caused by the staging launch. The worker did not restore the old app, delete shared cache data, or alter app settings.

The installed 0.45.0 bundle passed `codesign --verify --deep --strict --verbose=2`. Its signature identifies `dev.bb.desktop`, Developer ID Application Sawyer Hood, team `9QCU24SXK5`, and a stapled notarization ticket. This verifies the signature on disk; the worker did not launch the updated bundle or claim runtime health. The old bundle path recorded by ShipIt, `/var/folders/cv/q6nc4gqx0kddgybjp7s817zr0000gn/T/dev.bb.desktop.ShipIt.EosXzujD/bb.app`, no longer existed when checked.

## Cleanup and limits

The worker suspended PID 78371 while investigating updater ownership. Before termination, process inspection found no running stable ShipIt helper. The only running ShipIt was unrelated Nightly PID **73262**, which remained untouched.

The worker sent SIGKILL only to the staged root and positively identified descendants: **78371, 78450, 78451, 78453, 78454, 78483, 78484, 78573, 78574, 78577, 79081, 79667**. All were absent after cleanup. Ports **19969, 27969, 49592** were closed. The worker removed only its fresh temporary directory and state file, after copying evidence here.

The stable `dev.bb.desktop.ShipIt` launchd service remained registered as shared on-demand infrastructure, with last exit status 0 and no PID. It was not removed because exclusive ownership was not established. No owned staged process remained to send further updater callbacks. This does not prove that shared updater state cannot affect a later user launch.

No user production process was explicitly controlled or terminated. The worker did not inspect production thread data or the production UI. Production data integrity and effects on already running production processes were not verified. The installed application bundle changed as documented above.

Native user-message, assistant-message, selected-text, editable-selection, settings-state, and correct-composer draft behavior remain **unverified**. No production source files were edited. No commit, push, package build, or capture helper was created.

## Evidence

- [Staged launcher log](staged-launcher.log)
- [ShipIt run excerpt](shipit-run-excerpt.txt)
- [ShipIt target](shipit-target.json)
- [Process tree before cleanup](processes-before-cleanup.txt)
- [Cleanup results](cleanup.json)
- [Installed app after update](installed-app-after.json)
- [Read-only incident checks](read-only-incident-checks.json)
