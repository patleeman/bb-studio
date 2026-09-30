# Thread List upstream

Compared with BB commit `8595b6ea4b8bfa771f84d57e69124e76bacf9eef`
(`plugins/thread-list`). The runtime source is vendored under `source/`.
Run this from the repository root to check or refresh it:

```sh
node scripts/sync-sidebar.mjs --upstream /path/to/bb --commit 8595b6ea4b8bfa771f84d57e69124e76bacf9eef --check
node scripts/sync-sidebar.mjs --upstream /path/to/bb --commit <new-commit>
```

The script reads tracked files from the selected commit, applies
`scripts/sidebar-patches/studio-hooks.patch` and `tests.patch` in a temporary
directory, and stops before writing if either patch conflicts. Review and
update the patches, tests, and this commit before accepting a newer BB commit.
Studio-only files live in `source/app/studio/`. Test fixtures live in
`source/app/testing/` instead of runtime model code.

## Intentional changes to upstream files

| File | Reason |
| --- | --- |
| `source/app.tsx` | Mount Studio section anchors above the thread list and name the provider Studio Sidebar. |
| `source/app/list/ProjectList.tsx` | Mount the New project dialog and supply its menu action. |
| `source/app/list/SidebarHeaderControls.tsx` | Add the project action to the creation context. |
| `source/app/list/SidebarViewItems.tsx` | Insert New project and hidden Studio section menu items. |
| `source/app/rows/ThreadActionsMenu.tsx` | Insert Float in Studio Chat after Open in split. |

The restored upstream tests have only import path changes for the relocated
fixture and expectations for the Studio menu and presence call. Studio's own
tests are in `source/app/studio/StudioAdditions.test.tsx` and `source/app.test.tsx`.
The top-level `components/ui`, `hooks`, and `lib` copies mirror BB's
`packages/shared-ui`. They remain vendored upstream code; the kit's UI cleanup
does not include this package.
