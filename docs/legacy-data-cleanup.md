# Remove legacy plugin data after migration

Studio exposes `modules_cleanup_legacy` for an explicit user action in Space
settings. It applies to the server's legacy plugin directories across all Spaces.
It does not run at startup and does not accept paths from the client.

Call it with `{ "dryRun": true }` first. The response contains `archivePath`
(null for a preview) and `entries`: `pluginId`, `path`, `status`, `reason`,
`files`, and `bytes`. A `ready` entry can be archived and removed. A `retained`
entry explains what still needs attention. Preview makes no filesystem changes.

Call with `{ "dryRun": false }` to execute. Studio copies every eligible
legacy directory into a timestamped directory under
`plugins/studio/legacy-archives/` in this server's data directory. The archive
contains the original databases, any WAL files, secrets, audio, imported
settings/KV snapshots, and a SHA-256 manifest. Archive directories are private
(mode 0700); files are mode 0600. Studio verifies and flushes the archive before
removing a source. It checks again for changed files or a reinstalled plugin.
The response reports `removed` only after removal succeeds.

A legacy plugin must be uninstalled first. Before uninstalling, disable it and
reload Studio (Pages for Explore), then verify that its data and settings were
imported. Cleanup requires the matching import receipt and an intact destination
database. It retains sources changed since import, unimported secrets/audio,
unknown files, and symbolic links. It never deletes an imported module database
or modifies BB's host database.

Bot homes can still live under `plugins/bot-teams/homes`. That legacy directory
is retained while it contains homes or other live files. Do not manually remove
it merely because its database was imported.

To restore an archived directory, stop its writers, copy its directory from the
archive back to the original plugin path, and keep the archive. The separate
`<plugin-id>-settings.json` records the imported non-secret settings and KV;
secrets remain in the archived `secrets` directory. Restoring an old directory
does not roll back current Studio data or automatically re-enable a plugin.
