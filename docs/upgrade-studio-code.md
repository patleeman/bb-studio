# Studio Code workspace compatibility

The Studio Code upgrade is complete. VS Code, its six `code_*` tools and the
`studio-code` skill are part of Studio. This note records the data identities
and old links that remain supported; it is no longer an upgrade procedure.

## Data and links

Workspace item ids keep the `studio-code:<id>` namespace. Mentions and saved
item references still resolve through Studio's `studio-code` provider. Old
workspace links such as `/plugins/studio-code/workspaces/<id>` open the same
workspace in Studio at `/plugins/studio/studio/workspaces/<id>`. Studio keeps
the migrated rows, review comments, theme, extensions and editor recovery data
under its own plugin data directory.

New thread editors open from **+ → VS Code** and use Studio's code-server
runtime. The legacy address and item namespace are compatibility data; they do
not require the old plugin to be installed. The change-bus channel used by
saved workspace data also remains unchanged.

## Leftover bridge installs

If **Studio → Setup** still lists the `studio-code` upgrade bridge, its migration
is complete. Setup explains what data stays in Studio and allows the leftover
plugin to be removed. No migration command is needed. `bb studio setup` shows
the same status from the CLI.

## Verify workspace compatibility

After updating Studio, check that:

1. `bb plugin list` has no failed Studio plugin.
2. An old `/plugins/studio-code/workspaces/<id>` link opens its Studio workspace.
3. A saved `studio-code:<id>` mention or item reference opens the same workspace.
4. The thread's **+ → VS Code** tab and the six `code_*` tools still work.
5. Existing unsaved editor state, extensions and review comments remain.
