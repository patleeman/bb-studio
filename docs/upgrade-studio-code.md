# Upgrade Studio Code into Studio

Studio owns VS Code, its six `code_*` tools and the `studio-code` skill. RPCs
use `studio` / `code.*`. The `studio-code` 0.2.0 package is an upgrade bridge;
it stays in both plugin indexes so existing installations can update it.
No staged BB was run for this change. The lead runs the checks below after merging.

## Upgrade

Update the old plugin first, then Studio:

```sh
bb plugin update studio-code
bb plugin update studio
bb studio-code migrate
```

The bridge also migrates automatically and retries while Studio is unavailable.
If Studio updated first, update the bridge and reload Studio (`bb plugin reload studio`)
to register the six tool names after the old implementation releases them.
For a pinned Git install, follow the pinned-install procedure in
[merging-add-ons.md](merging-add-ons.md): preserve data when replacing the install.

Studio appends Code's unchanged SQLite migrations. The bridge keeps every
workspace/comment ID, thread/review association, trust/sharing choice and timestamp.
It copies the theme into `code:theme` once. Files move from the old plugin's
data directory into Studio's `code/` subdirectory: workspaces and user-data,
XDG data/config, extensions, downloaded runtime and watchdog. Source data stays.
Existing destination rows, KV and files win; partial copies can retry.

The bridge stops old watchdogs, servers and their descendants and waits for exit.
Studio verifies that fence again before copying. A failed process scan or a server
that stays alive blocks copying and new server starts. Studio starts an editor
only after file, row and final completion acknowledgments. Stop/reopen within
Studio also waits for the previous server to exit.

Files publish atomically after path rebuilding. SQLite editor state copies through
SQLite's backup API, including committed WAL data, then rebuilds paths in its keys
and values. Recovery headers, metadata and workspace-storage/backup identifiers
follow the new absolute path. Executable modes, symlink references and binary bytes
are preserved. Launch passwords and sockets are recreated. Malformed rows, invalid
recovery metadata block completion rather than discard data.

Old `/plugins/studio-code/workspaces/<id>` URLs and saved Studio workspace tabs
map to `/plugins/studio/studio/workspaces/<id>`. Item IDs stay `studio-code:<id>`;
mentions resolve through Studio and the bridge. New thread tabs use `studio/code`.
SDK 0.6.37 cannot alias a plugin-scoped thread action: the bridge keeps a small
`studio-code/code` renderer for already saved tabs, using Studio's server via
forwarded RPCs. It appears as **VS Code (saved tab)** in the + menu while installed.
Open **VS Code** from Studio's + menu before removing the bridge if you want a
persistent replacement for an old scoped tab. Setup permits removal only after
migration acknowledgment. Removing the bridge removes the old scoped tab renderer;
workspace addresses and item references still resolve in Studio.

## Staged path-upgrade checks

Use only `scripts/staged-bb.mjs`; do not launch the installed application or Pi.

1. Start stable staged BB at the pre-merge commit:
   `node scripts/staged-bb.mjs start --ref aabc5749 --plugin studio`.
   Source the generated `capture.env`. Use the staged CLI and ports for all
   following commands, never the working BB.
2. In its seeded local thread, open **+ → VS Code**. Create another workspace
   on a second thread. Record workspace/comment IDs, folders, thread/review IDs,
   timestamps, trust/sharing and theme. Install an extension and change an editor
   setting. Leave one edited file unsaved, another open at a selected range, and
   both a pending review and a submitted/resolved review. Save the old scoped
   thread tab and an old workspace URL, mention and `item:studio-code:<id>` link.
3. Install the bridge and Studio from the lead's pushed merge commit, in that order.
   Preserve their data directories. Run `bb studio-code migrate`; verify
   `migrationStatus` returns `complete: true`. Setup lists the bridge as retired
   and permits removal. Neither log nor RPC output exposes generated passwords.
4. Inspect processes throughout the update (`ps -axo pid=,ppid=,command=`).
   Old-root processes and descendants must exit before Studio copies files;
   at most one code-server may serve each workspace. No old-root process may
   restart. Confirm Studio refuses to open while the copy is incomplete.
5. Reopen the saved old thread tab, then Studio's **+ → VS Code**. Both must
   use the same workspace/server. Verify the unsaved draft recovers byte for byte,
   the selected file/range and extension settings return, all reviews retain IDs
   and status, and comment reply/resolve works. Check state and backup metadata
   point at Studio's `code/` root, with no stale old-root recovery paths.
6. Check all six tools. Open a code file at a line range; close the editor and
   confirm remounting the file tab does not reopen it. Check BB preview fallback
   for Markdown, thread-storage, absent thread, remote host and out-of-workspace
   files. Confirm the removed thread-header VS Code button stays absent.
7. Open the old workspace URL, saved Studio workspace tab, old mention and item
   link. Each resolves to the same migrated ID. Call all 13 legacy RPCs through
   the bridge and compare their results with Studio's `code.*` RPCs.
8. Repeat the upgrade in a disposable fixture with Studio temporarily unavailable,
   and interrupt/restart a file copy. Retry migration twice. No rows, comments,
   files or runtime installs duplicate; destination edits and theme choices stay.
   Keep an old server alive deliberately: completion and Studio starts must block.
9. Replace the old scoped thread tab with Studio's + menu tab, then remove the
   acknowledged bridge in Setup. Reload Studio. Tools, workspace URLs, new tabs,
   item links, mentions and editor state must still work. Stop the staged BB with
   `node scripts/staged-bb.mjs stop`.

Refresh the Code capture after migration:
`BB_CAPTURE_ONLY=studio-code node scripts/capture-plugin-screenshots.mjs --plugin studio`.
Capture the bridge’s acknowledged Setup row with
`node scripts/capture-plugin-screenshots.mjs --plugin studio-code`.
Its live assertions use Studio's RPCs and write `packages/bb-studio/assets/code-preview.png`.
The pre-merge bridge screenshot remains a clearly labelled historical image.
