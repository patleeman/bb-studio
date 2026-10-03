# Float

> **Float** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, tracking tasks, running bot teams, and keeping what your agents make. See the [suite overview](../../README.md).

Float any thread, channel, Studio item or Studio view into a panel of tabs
that stays on screen while you work somewhere else. It docks at the bottom
right, or drag it anywhere.

## Staged preview

![Live BB screenshot of Float's tab panel dragged over Studio](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): a Studio
page ("Offline mode launch"), the seeded "Draft the ORBIT-42 release notes"
thread and the "Checkout flow" drawing, each floated from its sidebar menu,
as three tabs in one panel. The drawing's tab was dragged to the front,
then the pinned page was selected over the Studio list. The capture also
checks the real Pages editor and an unsent thread draft through tab switches,
folding, hiding, and moving Float, and verifies the pin in saved state.
Before their first Float moves, it records the main Pages editor and drawing
canvas and verifies that both original nodes move into their companions.

![The original main Pages editor after a mobile header move](assets/first-main-transfer-mobile.png)

At 390 by 844 pixels, the live header's Move → Float this action leaves the
main route and carries its existing editor and inserted text into Float.
The capture checks the exact original node, one companion, and panel bounds.

```sh
BB_CAPTURE_MAIN_RETENTION=1 BB_CAPTURE_ONLY=float-main-mobile \
  node scripts/capture-plugin-screenshots.mjs --plugin float
```

![A page opened in Float by a real browser drag](assets/drag-preview.png)

The drag capture cancels a sidebar drag with Escape, then drops the page into
Float and checks that exactly one tab opens and the drop zone disappears.
Drop cleanup runs after the drop handler, even when a child consumes the
event. Escape, window blur, and resumed pointer input also clear interrupted
drags whose source disappeared before it could send `dragend`.

```sh
BB_CAPTURE_FLOAT_DRAG=1 BB_CAPTURE_ONLY=float-drag-cleanup \
  node scripts/capture-plugin-screenshots.mjs --plugin float
```

![Live integration capture of a page beside its workbench conversation](assets/native-workbench-preview.png)

The native-host integration capture runs an optimized local BB build based
on current core `32efd2e3f`, in its own data directory with all 17 suite
plugins installed from GitHub `b241546`, with Pages and Float updated to
`85a73fa`. It records and edits the real main Pages editor before Float opens,
then moves that original editor and SDK composer through Float, workbench, and main while
asserting DOM identity, the unsent draft, its file attachment, and the shared
pin. Its optional CLI check also verifies saved placement, pin-protected
close, and returning to an existing main companion after another main view
opens. This is implementation evidence for the pending BB host capability;
the [core patch and verification](../../docs/host-support/native-companions/README.md)
are saved with the suite.

```sh
BB_CAPTURE_NATIVE_COMPANION=1 BB_CAPTURE_ONLY=float-native \
  BB_CAPTURE_COMPANION_URL=http://127.0.0.1:<frontend-port> \
  node scripts/capture-plugin-screenshots.mjs --plugin float
```

Source the staged server's `capture.env` first. Omit the frontend URL once
the staged BB release includes the native host. The check fails if that
capability is absent; ordinary stable captures keep using `float`.
Set `BB_CAPTURE_COMPANION_REMOTE=1` when the staged CLI also includes
`bb plugin companion` to verify its controls in the same live workflow.

![Two original Pages editors retained in separate main panes](assets/native-split-preview.png)

The refreshed split capture uses that isolated host plus Pages and Float
`a36295c`. It edits two
main pages, pins the first, swaps them twice, and moves the floating page to
a split. Both original editor nodes, inserted drafts, tab identities, and
pins survive. It requires two visible outlets in different real BB panes.

```sh
BB_CAPTURE_COMPANION_SPLIT=1 BB_CAPTURE_ONLY=float-native-split \
  node scripts/capture-plugin-screenshots.mjs --plugin float
```

![Stable BB retaining an ordinary page beside a companion](assets/legacy-transfer-preview.png)

The stable BB 0.45.0 capture installs Pages and Float from `a36295c`. It
records two original main editors, inserts drafts, pins one, and swaps them
twice. It checks the disabled duplicate-Companions split action, then splits
beside a third ordinary page. All three editors retain their original nodes;
the neighboring ordinary page also retains its draft and undo/redo history.
Its two visible panes are distinct. The folded Float tab still owns the other
original editor. No agent runs, and all three fixtures are removed.

```sh
BB_CAPTURE_LEGACY_TRANSFER=1 BB_CAPTURE_ONLY=float-legacy-transfer \
  node scripts/capture-plugin-screenshots.mjs --plugin float
```

![Original main-thread draft and attachment retained in the workbench](assets/native-first-thread-preview.png)

The first-thread capture writes a draft and selects a real file in the main
thread before opening Float. It checks the exact original editor and file
input through undo/redo, navigation away, workbench and main placement, and
closing the companion back into the main thread. It also checks the displayed
model, one live composer, and that the original editor is inside the final
screenshot after the sidebar collapses. No agent runs for this fixture.

These four placement captures were rerun with the connected-view transfer
fix and the ninth native host patch. The [suite transfer matrix](../../docs/workbench-entrypoint-audit.md#cross-plugin-transfer-matrix)
also verifies seven view types on both hosts, including backward selection,
an unsaved bot profile and the original embedded HTML document context.

```sh
BB_CAPTURE_MAIN_THREAD=1 BB_CAPTURE_ONLY=float-native-main-thread \
  node scripts/capture-plugin-screenshots.mjs --plugin float
```

## What you get

- **Float from the sidebar.** **Float** is in the menu of every thread row (with
  [Studio Sidebar](../bb-studio-sidebar)), every channel row (with
  [Studio Teams](../bb-studio-teams)), and every Studio tab (with
  [Studio](../bb-studio)).
- **Move any item in one gesture.** This works on Studio items and threads
  anywhere: a collection row, a mention or embed on a page, a table's item
  chip, a task's link, a Space's rows, Home, a Feed post's item, and any link
  into a plugin view or a thread.
  - **Shift-click** floats it, and **⌘-click** (Ctrl-click) opens it in a
    split.
  - **Right-click** for Open, Float, Open in split, Copy reference (which
    pastes into a page as a pill; a thread has Copy link) and New thread with
    this. On a collection row, right-click opens the row's whole menu.
  - **Drag** a collection row, Space row or link onto the panel, or onto the
    corner when no panel is open, to float it.
  - Shift+right-click keeps the browser's own menu.
- **From the collection.** The ⋯ row menu has Float and Open in split, and a
  selection has **Float N** to float every picked item.
- **From an open item.** The ⧉ button in an item's header has **Float this**,
  which moves the item into the panel and takes the main view back, and
  **Open in split**.
- **From Quick Open.** ⇧↵ floats the result and ⌘↵ opens it in a split.
- **Float this view.** The palette's "Float: float this view" floats the
  Studio item or view on screen, or else the thread.
- **One panel, many tabs.** Everything you float is a tab in one panel, and
  one shows at a time. Drag a tab to reorder it, middle-click or × to close
  it. When the tabs don't fit, the panel labels only the one showing and
  shows the rest as icons; the ⋯ menu lists every tab.
- **Keep it closed.** Closing the last tab or choosing **Close all** keeps
  the panel closed as you switch threads and Studio items, including after
  a reload. An explicit Float action opens it again.
- **Put it anywhere.** The panel docks at the bottom right. Drag it by its
  header to pull it off the bottom and drop it anywhere on screen. Drop it
  near the bottom edge (an outline shows where) to dock it again, or pick
  "Dock at the bottom" from ⋯.
- **Resize it.** Drag an edge or corner. Docked, the top and left edges move;
  free, every edge does. Double-click an edge to go back to the default size.
- **Fold it** to its tab strip with the − button or a double-click on the
  header.
- **Move a tab.** The ⋯ menu has **Move to main view**, **Move to split**,
  and **Swap with main view**, which trades their placements while each keeps
  its original live contents, pin, identity and history on stable BB too.
  The companion-host integration adds **Move to workbench**, placing the
  same live tab beside BB's Browser and Terminal. Its **Float** and **Main
  view** actions move that portal again. The **Companions** page lists open
  tabs and hosts a tab moved to main.
  Focusing a retained main tab returns to its existing main route without
  moving the tab or replacing its history and pin.
- **Pin a companion.** **Pin tab** in ⋯ keeps its conversation or reference
  while you open other items. Links from a pinned tab open another tab.
  Pinned tabs stay through reloads and do not close at the tab limit.
- **Keep work in progress.** Switching tabs, folding the panel, and hiding it
  retain each opened view, including its editor state and unsent chat draft.
- **Links stay in the tab.** A link or item opened from inside a tab opens
  in that tab, as in a browser; ← goes back.
- **Mod+Shift+J** hides the panel and shows it again. You can rebind it in
  BB's keyboard settings.

The tabs, where the panel sits and its size are kept per browser window and
survive a reload.

The native companion host is being implemented in BB as part of the
[full-suite delivery](../../docs/unified-workbench.md). Until that host ships,
stable BB retains the same live view through Float, main placement and swap.
It can split a companion beside an ordinary main view. Stable BB currently
reuses an existing Companions pane when opening another; Move to split is
disabled in that case to preserve the two views. The saved core patch fixes
that routing limitation. Its companion outlet lives in the main area; the native right
workbench still requires the host capability. Plugin SDK pins remain
compatible with stable; the suite detects native hosting when it is present.

## How it works

Float draws the panel, and a thread tab is BB's `ThreadChat`. Any other
tab shows another plugin's nav panel. BB has no way to put one plugin's
view inside another's, so the plugin that owns the path renders its panel
into the panel through a portal. Main routes use Kit's `retainPanel` wrapper;
the app overlay owns the view before its first companion move. The same
editor or player moves into Float, leaving a Show companion action in the
main route. The shared kit's `FloatPanels` does this
(`packages/bb-studio-kit/src/app/float.tsx`). Pages, Draw, Tables, Tasks,
Talk, Artifacts and Studio render it, so their items and views can float.
Other plugins open tabs with the kit's `openFloat`.

[Studio Chat](../bb-studio-chat) provides the shared item-header Chat action
and adds a "Viewing" chip to conversation tabs. Chat prefers the native
workbench when available and otherwise opens Float.

More in [docs/float.md](../../docs/float.md).

## Limits

- Some buttons inside a floated view still open the main view, where the
  view navigates with BB's own router instead of a link.
- Opened tabs stay mounted until closed. Background tabs can keep audio,
  subscriptions, and editors running; tabs you have never shown stay unloaded.
- A view that can't show in the panel says so, with a button to open it.
- Separate main panes of the same item keep independent editors. Moving one
  into a companion carries the most recently focused pane's editor.

## Develop

```sh
pnpm install
pnpm --filter @bb-studio/float test
pnpm --filter @bb-studio/float typecheck
bb plugin build packages/bb-studio-float
```
