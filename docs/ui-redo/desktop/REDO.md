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
| Page breadcrumb navigation | 5a368687 | Behaviour only (crumbs now open with `openAppPath`). The markup is unchanged and both renders are pixel-identical. See the note on the workspace below. | [before](img/breadcrumb-before-dark.png) · [after](img/breadcrumb-after-dark.png) |
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

## Needs Patrick's decision

- **Page crumbs are invisible in the desktop workspace.** In a workspace tab row, the item header's `<nav>` is `flex-1 min-w-0` inside a `shrink-0` slot, so it collapses to zero width. A nested page's parent crumbs never show (see the breadcrumb render), and probably neither do the other crumb-row extras that 49c2b81b3 meant to keep, such as Pages' saving dot. This predates Codex and I didn't change it. Options: show only the parent crumbs in the tab row, since the tab already names the page, or let the nav size to its content and truncate.
- **Menus now carry the plugin scope.** This is a kit-wide fix, so every Studio dropdown now gets Studio's scoped CSS, as dialogs and tooltips already do. The page menu renders pixel-identically before and after. Menus elsewhere may pick up plugin-only classes that silently didn't apply before. That's the intent, but it is a broader change than the icon picker alone.
