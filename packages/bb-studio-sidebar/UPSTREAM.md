# Thread List upstream

Compared with the BB commit in `upstream/BB_COMMIT`
(`plugins/thread-list`). The runtime source is vendored under `source/`.
Run this from this package directory to check or refresh it; `--commit`
defaults to `upstream/BB_COMMIT`:

```sh
node upstream/sync.mjs --upstream /path/to/bb --check
node upstream/sync.mjs --upstream /path/to/bb --commit <new-commit>
node upstream/sync.mjs --upstream /path/to/bb --write-patches
```

`source/app/studio/upstream-patches.test.ts` runs `--check` with the package tests
whenever a BB checkout is found (`BB_UPSTREAM`, or `bb` beside this
repository), so editing a vendored file without `--write-patches` fails them.

The script reads tracked files from the selected commit, applies
`upstream/studio-hooks.patch` and `tests.patch` in a temporary
directory, and stops before writing if either patch conflicts. Review and
update the patches, tests, and `upstream/BB_COMMIT` before accepting a newer BB commit.
`--check` exits non-zero when any vendored file differs from the patched BB
source. After editing an upstream file under `source/`, run `--write-patches`
to rebuild both patches from `source/` (test files go to `tests.patch`), then
`--check` to confirm 0 files changed, and add the file to the table below.
Studio-only files live in `source/app/studio/`. Test fixtures live in
`source/app/testing/` instead of runtime model code.

## Intentional changes to upstream files

| File | Reason |
| --- | --- |
| `source/app.tsx` | Mount Studio section anchors above the thread list, name the provider Studio Sidebar, move thread reveal into ProjectList, register Studio Navigation, and register the thread Automations tab and header badge. |
| `source/app/list/ProjectList.tsx` | Mount the New project dialog, supply its menu action, filter empty project rows, render By space with each Space's Studio items, export the grouped-mode helpers By space reuses, and pass By space's group move to the grouped drag and drop. |
| `source/app/list/useSidebarThreadReveal.ts` | By space reveals its own sections. |
| `source/app/list/SidebarHeaderControls.tsx` | Add the project action to the creation context, and let a section put its own button, such as Command view, in place of New thread. |
| `source/app/list/SidebarViewItems.tsx` | Insert New project, hidden Studio section, empty project, By space, and Needs me sort menu items. |
| `source/app/preferences/atoms.ts` | Expose synced empty project and collapsed Space preferences. |
| `source/app/model/project-thread-groups.ts`, `thread-activity.ts`, and the `attention` branch of `getSidebarThreadComparator` in `ProjectList.tsx` | Add the Needs me sort: threads waiting on the user first, then working ones, then the rest. A parent or group ranks by its most urgent descendant, so `buildSortedItems` honors a comparator's `compareItems`. |
| `source/app/list/sortComparator.test.ts` | Check the Needs me tiers, direction, and descendant ranking. |
| `source/shared/preferences.ts` | Add the `attention` sort, the `space` organization and `space:` groups, and define synced empty project and collapsed Space preferences. |
| `source/app/list/SidebarHeaderControls.test.tsx` | Check the empty project menu toggle. |
| `source/app/list/ProjectList.modes.test.tsx`, `ProjectList.sectionCreate.test.tsx`, and `useSidebarThreadReveal.test.tsx` | Leave By space out of the stored-order probe, and check that a thread's group expands only when opened. |
| `source/server.test.ts` | Check the new preference default and parsing. |
| `source/app/list/TopLevelSidebarSection.tsx` | Add a label mark and a clickable label for Space sections, and highlight the label of the open Space. |
| `source/app/list/ThreadListVisibility.tsx` | Expose the section key a component renders in, and add Show or Hide hidden threads to a section's menu. |
| `source/app/list/useSidebarModeSectionOrder.ts` | Leave By space out of the stored section orders; it follows Studio's order. |
| `source/app/model/sidebar-section-id.ts`, `sidebar-section-order.ts`, and `source/app/dnd/useSectionThreadDnd.ts` (group ids) | Accept `space:` section ids. |
| `source/app/dnd/useSectionThreadDnd.ts` (group move) | Let By space move threads dropped on a Space's section, heading or dot into that Space through Studio. |
| `source/app/list/ProjectRow.tsx` | An environment's Archive threads leaves a Space lead and its ancestors, archiving the rest one by one. |
| `source/app/rows/ThreadActionsMenu.tsx` | Insert Move to Space beside Move; drop Archive from a Space lead in every organization. |
| `source/app/rows/ThreadRow.tsx` | Show a Studio app's badge before the title; in By space, draw the two-line row (status dot, age, latest line) from `studio/SpaceThreadRow.tsx`. |

The restored upstream tests have import path changes for the relocated
fixture and expectations for Studio menu items, preferences, and presence calls. Studio's own
tests are in `source/app/studio/StudioAdditions.test.tsx` and `source/app.test.tsx`.
The top-level `components/ui`, `hooks`, and `lib` copies mirror BB's
`packages/shared-ui`. They remain vendored upstream code; the kit's UI cleanup
does not include this package.

## Navigation

Navigation now ships in this package under `source/app/navigation/`. It was
vendored from BB `0baa605b32a00619c1d7e3f32be6553ebcf8244a`
(`desktop-v0.44.0`, `plugins/navigation`) with Studio filtering and Space-aware
new-thread handling. Its host behavior tests moved to `source/navigation.test.tsx`;
Studio filtering tests live beside `navigation/studio/studio-items.ts`.
Review this subtree separately when updating the thread-list upstream source.
