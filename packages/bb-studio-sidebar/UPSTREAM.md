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
| `source/app.tsx` | Mount Studio section anchors above the thread list, name the provider Studio Sidebar, move thread reveal into ProjectList so new automated results do not expand their collapsed groups, and register Studio Navigation. |
| `source/app/list/ProjectList.tsx` | Mount the New project dialog, supply its menu action, filter empty project rows, apply each section's Automated threads choice, render By space with each Space's Studio items, export the grouped-mode helpers By space reuses, and pass By space's group move to the grouped drag and drop. |
| `source/app/list/useSidebarThreadReveal.ts` | Keep ancestor reveal while new automated results leave their collapsed group alone; By space reveals its own sections. |
| `source/app/list/SidebarHeaderControls.tsx` | Add the project action to the creation context, and let a section put its own button, such as Command view, in place of New thread. |
| `source/app/list/SidebarViewItems.tsx` | Insert New project, hidden Studio section, empty project, By space, and per-section Automated threads menu items. |
| `source/app/preferences/atoms.ts` | Expose synced empty project, Automated threads, and collapsed Space preferences. |
| `source/shared/preferences.ts` | Add the `space` organization and `space:` groups, and define synced empty project, Automated threads, and collapsed Space preferences. |
| `source/app/list/SidebarHeaderControls.test.tsx` | Check the empty project menu toggle. |
| `source/app/list/ProjectList.modes.test.tsx`, `ProjectList.sectionCreate.test.tsx`, and `useSidebarThreadReveal.test.tsx` | Leave By space out of the stored-order probe, count the Automated threads divider, and check that an automated thread's group expands only when opened. |
| `source/server.test.ts` | Check the new preference default and parsing. |
| `source/app/list/TopLevelSidebarSection.tsx` | Add a label mark and a clickable label for Space sections, highlight the label of the open Space, and end each section with the hidden automated threads row. |
| `source/app/list/ThreadListVisibility.tsx` | Expose the section key a component renders in. |
| `source/app/list/useSidebarModeSectionOrder.ts` | Leave By space out of the stored section orders; it follows Studio's order. |
| `source/app/model/sidebar-section-id.ts`, `sidebar-section-order.ts`, and `source/app/dnd/useSectionThreadDnd.ts` (group ids) | Accept `space:` section ids. |
| `source/app/dnd/useSectionThreadDnd.ts` (group move) | Let By space move threads dropped on a Space's section, heading or dot into that Space through Studio. |
| `source/app/rows/ThreadActionsMenu.tsx` | Insert Float after Open in split, and Move to Space beside Move. |
| `source/app/rows/ThreadRow.tsx` | Show a Studio app's badge, such as a bot's avatar, and the automated thread mark before the title; in By space, draw the two-line row (status dot, age, latest line) from `studio/SpaceThreadRow.tsx`. |

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
