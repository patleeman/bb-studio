# UI redo, surface D: desktop Studio, Pages, Talk, Design and Dashboards

Codex made these changes. This pass keeps their behaviour and their tests, and
redoes only how they look. Two test files needed one-line mock additions for
the kit pieces the new markup uses (`Icon`, `OUTLINE_BUTTON`). Their
assertions are unchanged.

**How the renders were made.** A staged BB ran stable BB 0.47.0 on its own
data directory and ports (`scripts/staged-bb.mjs`, port 49470). For the
"before" renders, Studio was installed from GitHub at `1de68e82`, the tip of
`main` with every Codex change in it. For the "after" renders, Studio was
installed from a copy of this branch with `bb plugin install <path>` into the
same staged BB. [capture.mjs](capture.mjs) forces each failure state in the
capture browser: it answers the one Studio RPC that state depends on with an
error, or holds that RPC to show a slow search. Nothing on the server is
broken. All renders are 2x, at a 1440×1000 window.

```sh
. "$BB_STAGED_DIR/capture.env"
node docs/ui-redo/desktop/capture.mjs before|after [scene,...]
```

## Redone

| Change | SHA | What I changed | Before (dark) | After (dark) | Light |
| --- | --- | --- | --- | --- | --- |
| Content search: slow search and failed search in the Studio collection | c8917f9a, f0982399 | One shared `ContentSearchStatus` row in place of two hand-made `<p>` tags. Codex's rows were text-sm with a 16px inset, so they sat out of line with the 12px, text-xs "Preparing Studio search…" row above them. Its Retry button had no styling, so it read as part of the red sentence. The new row matches the freshness row's size and inset. The spinner appears only when a search takes longer than 400 ms, so it no longer flashes on every keystroke. A failure says that title matches are still shown and has an underlined **Retry search**. The empty state no longer says "Nothing matches." while a content search is still running. The same component is used by the kit's own collection page. | [loading](img/search-loading-before-dark.png) · [error](img/search-error-before-dark.png) | [loading](img/search-loading-after-dark.png) · [error](img/search-error-after-dark.png) | [before](img/search-error-before-light.png) · [after](img/search-error-after-light.png) |
| Page metadata errors: icon picker and page menu | 26bf9d29 | **The icon picker was broken:** its 20 emoji were stacked in one column 900px tall. Kit dropdown menus are portaled to `<body>` without the plugin scope attributes, so plugin-only utilities such as `grid-cols-8` never applied there. Dialogs and tooltips already carry that scope. `DropdownMenuContent` and `DropdownMenuSubContent` now do too, which fixes every Studio menu that uses a plugin-only class. The emoji are now 28px targets with focus rings, a pressed state for the current icon, and dimmed styling while a change runs. The error toast and the disabled menu items while a change runs were already right, and are unchanged. | [picker + toast](img/page-icon-error-before-dark.png) · [menu](img/page-menu-pending-before-dark.png) | [picker + toast](img/page-icon-error-after-dark.png) · [menu](img/page-menu-pending-after-dark.png) | [before](img/page-icon-error-before-light.png) · [after](img/page-icon-error-after-light.png) |
| Whiteboard "Changes weren't saved. Retry save" | 8c90c3a9 | Codex showed two red lines: the raw error ("BB is offline") flush against the frame edge at text-sm, then the notice with an underlined link. They are now one row under a top border, like the whiteboard's toolbar. It has a destructive icon, "Changes weren't saved. BB is offline. Your strokes are kept here." in muted text, and **Retry save** as one of the toolbar's own `ToolButton`s at the right. A load error with no failed save still shows on its own line. | [before](img/whiteboard-save-failed-before-dark.png) | [after](img/whiteboard-save-failed-after-dark.png) | [before](img/whiteboard-save-failed-before-light.png) · [after](img/whiteboard-save-failed-after-light.png) |
| Thread Studio tab: load failure (with the paste-time reference change) | d132d367 | When the thread's items couldn't load, Codex showed a red sentence that ran into an unstyled "Retry loading items", and then "No items yet." under it, which was false. The error now has an icon and a foreground lead ("Couldn't load this thread's items.") with the detail after it, and an outline **Retry loading items** button aligned under the text. The empty state is hidden while nothing has loaded. Pasting a reference has no visual change: the mention pill is the same and is now inserted at once. | [before](img/studio-tab-error-before-dark.png) | [after](img/studio-tab-error-after-dark.png) | [before](img/studio-tab-error-before-light.png) · [after](img/studio-tab-error-after-light.png) |
| Talk Unsent audio: outbox read failure | a778a39d | The box now uses the same layout as the page's own "Discard?" confirmation: an icon, then a bold lead and a muted detail, then "Nothing has been discarded.", with **Retry check** (outline, with an icon) at the right instead of stacked below. Refused audio that was already listed stays listed when a later check fails. Before, the error state hid the list. | [before](img/talk-unsent-error-before-dark.png) | [after](img/talk-unsent-error-after-dark.png) | [before](img/talk-unsent-error-before-light.png) · [after](img/talk-unsent-error-after-light.png) |
| Setup: a restore that failed after the plan | 9a0c1b9c | Codex put the error between the plan table and the buttons, and its lead line ("…Retry or cancel below.") named a Retry button that doesn't exist. The card now turns destructive-tinted. "The restore didn't finish" and the error come first, then one sentence saying that restoring the file again is safe. The long file name now wraps, and the plan and the **Restore** and **Cancel** buttons follow. The other backup states are unchanged. | [before](img/backup-restore-error-before-dark.png) | [after](img/backup-restore-error-after-dark.png) | [before](img/backup-restore-error-before-light.png) · [after](img/backup-restore-error-after-light.png) |
| Design: comment saved but not sent | e46e3d2a | Copy only. The toast now has a short title, "Saved the comment, but couldn't send it to the agent", and the next step in its description: "Open its pin and choose Send to agent to try again." That matches the title-plus-description toasts used elsewhere. Before, it was one long sentence that pointed at a "saved comment" without saying how to retry. Not rendered: the toast needs a design with a conversation and a failed thread delivery. | n/a | n/a | n/a |

## Checked and left as is

| Change | SHA | Finding | Renders |
| --- | --- | --- | --- |
| Page breadcrumb navigation | 5a368687 | Behaviour only (crumbs now open with `openAppPath`), and its markup is unchanged. Its crumbs never showed in a workspace tab; that is fixed under [Crumbs in workspace tabs](#crumbs-in-workspace-tabs). The "after" render here includes that fix. | [before](img/breadcrumb-before-dark.png) · [after](img/breadcrumb-after-dark.png) |
| Voice draft after a failed send | 6edbc95f | A toast with an "Add to draft" action when the composer already has newer text. It uses the standard sonner toast and action, so there is nothing to restyle. Not rendered, because it needs live dictation. | n/a |
| Dashboards refresh and stale states | 0dca2c6c | Only `use-dashboard.ts` changed: the order in which snapshots are accepted. There is no markup or style change, so nothing to redo. | n/a |

## Review only

| SHA | Visual finding |
| --- | --- |
| 5776591a, 41b9e5be | Talk controller internals. No UI. |
| fb94028a | One line in voice playback deduplication. No visual change. |
| 70987d5d | Removes the Pages-available check from the notes row. "Open notes" now always shows when a notes page exists. No styling change. |
| 010edb11 | Dialog `defaultOpen`. No styling change. |
| 9b653117 | **Flag (Decisions, outside this surface, not edited).** In `src/decisions/ui/register.tsx`, both new Retry buttons sit flush under their text with no gap: line 161, where nothing has loaded, and line 210, after a failed suggestion. Line 73 puts the error and the button in one fragment, so their spacing depends on the parent `Row`. A `flex flex-col items-start gap-2` wrapper would fix all three. |
| e3911c96, e87124c0, 53a32bfc | Removals of retired UI: header chip polling, the unused thread panel, voice Call. Nothing left half-styled. |
| 063e11cb | Removes the legacy initial target from the Studio tab. No visual change. |
| aabc5749, a5b0def7, 27752b3e, c7cae2ae | Structural merges. I compared every `className` removed and added in their `.tsx` and `.css` diffs: they are the same set, only moved, and no stylesheet changed. No visual regression. The dropdown scope gap fixed above was not caused by these: `dropdown-menu.tsx` moved unchanged in 27752b3e. |

## Dropdowns

The lead kept the kit-wide fix in ebde4f05, which gives portaled menus the
plugin scope. To check it, [menus.mjs](menus.mjs) seeds one item of each kind
(pages, a temp note, a drawing, a recording, an artifact with two versions, a
design, a dashboard, a mini app, a Bot) and opens every Studio dropdown in dark
and light. It captures before (`main` at 1de68e82) and after (this branch).
The capture is cropped to the open menus and their trigger. All 104 renders
are in [img/menus](img/menus).

**Result: nothing got worse.** 17 of the 26 menus are byte-identical before
and after. The 9 that differ are either the scope now applying classes that
were silently missing, or live content.

| Menu | Where | Before → after | Verdict |
| --- | --- | --- | --- |
| Studio options ⋯ | Studio collection | [dark](img/menus/studio-options-before-dark.png) → [dark](img/menus/studio-options-after-dark.png) · [light](img/menus/studio-options-before-light.png) → [light](img/menus/studio-options-after-light.png) | Identical |
| New (create) | Studio collection bar | [dark](img/menus/collection-new-before-dark.png) → [dark](img/menus/collection-new-after-dark.png) · [light](img/menus/collection-new-before-light.png) → [light](img/menus/collection-new-after-light.png) | Identical |
| Row Actions ⋯ | Collection row | [dark](img/menus/collection-row-actions-before-dark.png) → [dark](img/menus/collection-row-actions-after-dark.png) · [light](img/menus/collection-row-actions-before-light.png) → [light](img/menus/collection-row-actions-after-light.png) | Identical |
| Row ⋯ › Move to (project picker) | Collection row | [dark](img/menus/collection-row-move-to-before-dark.png) → [dark](img/menus/collection-row-move-to-after-dark.png) · [light](img/menus/collection-row-move-to-before-light.png) → [light](img/menus/collection-row-move-to-after-light.png) | **Better.** The submenu now gets its intended `w-60`; before, it shrank to its longest name. A chevron is added (see below). |
| Row right-click menu | Collection row | [dark](img/menus/collection-row-context-before-dark.png) → [dark](img/menus/collection-row-context-after-dark.png) · [light](img/menus/collection-row-context-before-light.png) → [light](img/menus/collection-row-context-after-light.png) | Identical |
| Selection: Move | Collection, one row selected | [dark](img/menus/collection-bulk-move-before-dark.png) → [dark](img/menus/collection-bulk-move-after-dark.png) · [light](img/menus/collection-bulk-move-before-light.png) → [light](img/menus/collection-bulk-move-after-light.png) | **Better.** It now gets its intended `w-60`. |
| Selection: Tag | Collection, one row selected | [dark](img/menus/collection-bulk-tag-before-dark.png) → [dark](img/menus/collection-bulk-tag-after-dark.png) · [light](img/menus/collection-bulk-tag-before-light.png) → [light](img/menus/collection-bulk-tag-after-light.png) | **Better.** The "New tag" field now fills the menu instead of stopping short. |
| Filter chip options | Studio query bar | [dark](img/menus/query-chip-before-dark.png) → [dark](img/menus/query-chip-after-dark.png) · [light](img/menus/query-chip-before-light.png) → [light](img/menus/query-chip-after-light.png) | Identical |
| Sidebar New | Studio sidebar | [dark](img/menus/sidebar-new-before-dark.png) → [dark](img/menus/sidebar-new-after-dark.png) · [light](img/menus/sidebar-new-before-light.png) → [light](img/menus/sidebar-new-after-light.png) | Identical |
| Item right-click menu | A page mention | [dark](img/menus/item-gesture-before-dark.png) → [dark](img/menus/item-gesture-after-dark.png) · [light](img/menus/item-gesture-before-light.png) → [light](img/menus/item-gesture-after-light.png) | Identical |
| Page actions ⋯ | Page | [dark](img/menus/page-menu-before-dark.png) → [dark](img/menus/page-menu-after-dark.png) · [light](img/menus/page-menu-before-light.png) → [light](img/menus/page-menu-after-light.png) | Identical |
| Page actions › Move to project | Page | [dark](img/menus/page-menu-move-project-before-dark.png) → [dark](img/menus/page-menu-move-project-after-dark.png) · [light](img/menus/page-menu-move-project-before-light.png) → [light](img/menus/page-menu-move-project-after-light.png) | Identical |
| Icon picker | Page | [dark](img/menus/page-icon-picker-before-dark.png) → [dark](img/menus/page-icon-picker-after-dark.png) · [light](img/menus/page-icon-picker-before-light.png) → [light](img/menus/page-icon-picker-after-light.png) | **Fixed.** It's an 8-column grid instead of one 900px column. |
| How to send | Temp note | [dark](img/menus/note-send-before-dark.png) → [dark](img/menus/note-send-after-dark.png) · [light](img/menus/note-send-before-light.png) → [light](img/menus/note-send-after-light.png) | The menu is identical; only the note title's timestamp differs. |
| ⋯ | Drawing (Draw) | [dark](img/menus/drawing-more-before-dark.png) → [dark](img/menus/drawing-more-after-dark.png) · [light](img/menus/drawing-more-before-light.png) → [light](img/menus/drawing-more-after-light.png) | Identical |
| ⋯ | Recording (Talk) | [dark](img/menus/recording-more-before-dark.png) → [dark](img/menus/recording-more-after-dark.png) · [light](img/menus/recording-more-before-light.png) → [light](img/menus/recording-more-after-light.png) | Identical |
| ⋯ › Move to | Recording (Talk) | [dark](img/menus/recording-more-move-to-before-dark.png) → [dark](img/menus/recording-more-move-to-after-dark.png) · [light](img/menus/recording-more-move-to-before-light.png) → [light](img/menus/recording-more-move-to-after-light.png) | **Better.** It gets its intended width, plus the chevron. |
| ⋯ | Artifact | [dark](img/menus/artifact-more-before-dark.png) → [dark](img/menus/artifact-more-after-dark.png) · [light](img/menus/artifact-more-before-light.png) → [light](img/menus/artifact-more-after-light.png) | Identical |
| ⋯ › Versions | Artifact | [dark](img/menus/artifact-more-versions-before-dark.png) → [dark](img/menus/artifact-more-versions-after-dark.png) · [light](img/menus/artifact-more-versions-before-light.png) → [light](img/menus/artifact-more-versions-after-light.png) | **Better.** It gets its intended `w-60`, with "Latest" and the ages right-aligned. |
| Widget ⋯ | Dashboard | [dark](img/menus/dashboard-widget-before-dark.png) → [dark](img/menus/dashboard-widget-after-dark.png) · [light](img/menus/dashboard-widget-before-light.png) → [light](img/menus/dashboard-widget-after-light.png) | Identical |
| Version history | Dashboard | [dark](img/menus/dashboard-versions-before-dark.png) → [dark](img/menus/dashboard-versions-after-dark.png) · [light](img/menus/dashboard-versions-before-light.png) → [light](img/menus/dashboard-versions-after-light.png) | The menu is identical; only the version's timestamp differs. |
| Kit dropdown inside a mini app | Mini app (sandboxed frame) | [dark](img/menus/mini-app-menu-before-dark.png) → [dark](img/menus/mini-app-menu-after-dark.png) · [light](img/menus/mini-app-menu-before-light.png) → [light](img/menus/mini-app-menu-after-light.png) | Identical |
| Bot menu ⋯ (Bot info) | Bot page | [dark](img/menus/bot-menu-before-dark.png) → [dark](img/menus/bot-menu-after-dark.png) · [light](img/menus/bot-menu-before-light.png) → [light](img/menus/bot-menu-after-light.png) | Identical |
| Sort and group threads | Bot sidebar | [dark](img/menus/bot-threads-sort-before-dark.png) → [dark](img/menus/bot-threads-sort-after-dark.png) · [light](img/menus/bot-threads-sort-before-light.png) → [light](img/menus/bot-threads-sort-after-light.png) | Identical |
| Automations New | Bot page | [dark](img/menus/bot-automations-before-dark.png) → [dark](img/menus/bot-automations-after-dark.png) · [light](img/menus/bot-automations-before-light.png) → [light](img/menus/bot-automations-after-light.png) | Identical |
| Prompt cache chip | Bot's thread header | [dark](img/menus/bot-cache-before-dark.png) → [dark](img/menus/bot-cache-after-dark.png) · [light](img/menus/bot-cache-before-light.png) → [light](img/menus/bot-cache-after-light.png) | The menu is identical. The countdown changed, and because the chip got narrower the pointer landed on Bot info, so its tooltip shows. |

**Not rendered, and why:**

- **The collection's own project and tag filter menus and its Display menu**
  (`collection.tsx`). They render only when `CollectionPage` has no `filter`.
  Its one caller, `StudioPanel`, always passes one, so these menus can't be
  reached today.
- **Item header Chat options.** The header shows them only outside the
  workspace, and every desktop item opens as a workspace tab.
- **Page activity.** It needs past agent requests or chats on the page.
- **Bot runner machine picker and Design.** The machine picker is a native
  `<select>`, and Design's tab row has no dropdown of its own. Neither uses the
  kit menu.
- **Context menus, popovers and selects** (`context-menu.tsx`, `popover.tsx`,
  `select.tsx`). These are separate kit components that ebde4f05 didn't touch.

**Fixed along the way:** "Move to" was the only submenu trigger without the
chevron its neighbours ("Tags", "Move to project") have. The shared
`MoveToSubmenu` now has it. The artifact menu's "Versions" trigger also has no
chevron. It lives in `src/artifacts`, outside this surface, so I left it.

**Bot UI (worker C's):** all four Bot menus are identical before and after.
No change is needed there.

**Pre-existing, for later:** in dark mode, BB's `muted-foreground` inside
menus is lightness 0.78 against 0.81 for the item text. Descriptions such as
the temp note's "How to send" lines barely read as secondary. That comes from
BB's own tokens and is the same before and after.

## Crumbs in workspace tabs

Patrick's decision: in desktop workspace tabs, show only the parent crumbs,
because the tab already names the page. Truncate them gracefully, with the
full path in a tooltip.

**Cause.** Two things hid every crumb in a tab row:

1. `BarCrumb` and `BarSeparator` deliberately render nothing there.
2. The item header and its `<nav>` were `flex-1` (basis 0) inside a slot that
   is sized by its content, so the nav got zero width. That also hid what 49c2b81b3
   meant to keep, including Pages' saving dot.

**Change.**

- In a tab row, the header and nav now take their content's width and shrink
  before the tools do.
- The slot may shrink, and the tabs keep at least 40% of the row.
- `PageBreadcrumbs` has a tab-row form, `useInTabRow()`. It shows only the
  parents as buttons, at the tab text's 13px, muted.
- Each parent truncates. The first gives way before the nearest one, and a
  squeezed crumb keeps its icon.
- More than two parents fold the middle ones into "…". The whole path is the
  tooltip.
- A top-level page shows nothing beside its tab.
- Full page views outside the workspace are unchanged.

| State | Before (dark) | After (dark) | Light |
| --- | --- | --- | --- |
| Page two levels deep, wide | [before](img/crumbs-wide-before-dark.png) | [after](img/crumbs-wide-after-dark.png) | [before](img/crumbs-wide-before-light.png) · [after](img/crumbs-wide-after-light.png) |
| While the title saves (saving dot) | [before](img/crumbs-saving-before-dark.png) | [after](img/crumbs-saving-after-dark.png) | [before](img/crumbs-saving-before-light.png) · [after](img/crumbs-saving-after-light.png) |
| Narrow window (900px) | [before](img/crumbs-narrow-before-dark.png) | [after](img/crumbs-narrow-after-dark.png) | [before](img/crumbs-narrow-before-light.png) · [after](img/crumbs-narrow-after-light.png) |

## Needs Patrick's decision

- **Decided:** page crumbs in workspace tabs show only the parents. Done; see [Crumbs in workspace tabs](#crumbs-in-workspace-tabs).
- **Decided:** keep the kit-wide menu scope fix. Every dropdown was checked; see [Dropdowns](#dropdowns).
