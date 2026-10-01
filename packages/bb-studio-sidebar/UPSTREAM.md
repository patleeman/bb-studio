# Thread List upstream

Compared with BB commit `8595b6ea4b8bfa771f84d57e69124e76bacf9eef`
(`plugins/thread-list`). The runtime source is vendored under `source/`.
Run this from this package directory to check or refresh it:

```sh
node upstream/sync.mjs --upstream /path/to/bb --commit 8595b6ea4b8bfa771f84d57e69124e76bacf9eef --check
node upstream/sync.mjs --upstream /path/to/bb --commit <new-commit>
```

The script reads tracked files from the selected commit, applies
`upstream/studio-hooks.patch` and `tests.patch` in a temporary
directory, and stops before writing if either patch conflicts. Review and
update the patches, tests, and this commit before accepting a newer BB commit.
Studio-only files live in `source/app/studio/`. Test fixtures live in
`source/app/testing/` instead of runtime model code.

## Intentional changes to upstream files

| File | Reason |
| --- | --- |
| `source/app.tsx` | Mount Studio section anchors above the thread list and name the provider Studio Sidebar. |
| `source/app/list/ProjectList.tsx` | Mount the New project dialog, supply its menu action, and filter empty project rows through Studio's visibility rule. |
| `source/app/list/SidebarHeaderControls.tsx` | Add the project action to the creation context. |
| `source/app/list/SidebarViewItems.tsx` | Insert New project, hidden Studio section, and empty project filter menu items. |
| `source/app/preferences/atoms.ts` | Expose the synced empty project preference. |
| `source/shared/preferences.ts` | Define the synced empty project preference and default. |
| `source/app/list/SidebarHeaderControls.test.tsx` | Check the empty project menu toggle. |
| `source/server.test.ts` | Check the new preference default and parsing. |
| `source/app/rows/ThreadActionsMenu.tsx` | Insert Float in Studio Chat after Open in split. |

The restored upstream tests have import path changes for the relocated
fixture and expectations for Studio menu items, preferences, and presence calls. Studio's own
tests are in `source/app/studio/StudioAdditions.test.tsx` and `source/app.test.tsx`.
The top-level `components/ui`, `hooks`, and `lib` copies mirror BB's
`packages/shared-ui`. They remain vendored upstream code; the kit's UI cleanup
does not include this package.
