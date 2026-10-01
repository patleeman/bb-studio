# Float

> **Float** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, tracking tasks, running bot teams, and keeping what your agents make. See the [suite overview](../../README.md).

Float any thread, channel, Studio item or Studio view into a panel of tabs
that stays on screen while you work somewhere else. It docks at the bottom
right, or drag it anywhere.

## Staged preview

![Live BB screenshot of Float windows along the bottom of the screen](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): the seeded
"Draft the ORBIT-42 release notes" thread, a Studio Teams channel, and a
Studio page each floated from their sidebar menus. They sit side by side along
the bottom of the screen, while the main view shows something else.

## What you get

- **Float from the sidebar.** **Float** is in the menu of every thread row (with
  [Studio Sidebar](../bb-studio-sidebar)), every channel row (with
  [Studio Teams](../bb-studio-teams)), and every Studio tab (with
  [Studio](../bb-studio)).
- **Float this view.** The palette's "Float: float this view" floats the
  Studio item or view on screen, or else the thread.
- **One panel, many tabs.** Everything you float is a tab in one panel, and
  one shows at a time. Drag a tab to reorder it, middle-click or × to close
  it. When the tabs don't fit, the panel labels only the one showing and
  shows the rest as icons; the ⋯ menu lists every tab.
- **Put it anywhere.** The panel docks at the bottom right. Drag it by its
  header to pull it off the bottom and drop it anywhere on screen. Drop it
  near the bottom edge (an outline shows where) to dock it again, or pick
  "Dock at the bottom" from ⋯.
- **Fold it** to its tab strip with the − button or a double-click on the
  header. The ⋯ menu also opens the tab full, or in a split for threads.
- **Mod+Shift+J** hides the panel and shows it again. You can rebind it in
  BB's keyboard settings.

The tabs and where the panel sits are kept per browser window and survive a
reload.

## How it works

Float draws the panel, and a thread tab is BB's `ThreadChat`. Any other
tab shows another plugin's nav panel. BB has no way to put one plugin's
view inside another's, so the plugin that owns the path renders its panel
into the panel through a portal. The shared kit's `FloatPanels` does this
(`packages/bb-studio-kit/src/app/float.tsx`). Pages, Draw, Tables, Tasks,
Talk, Artifacts and Studio render it, so their items and views can float.
Other plugins open tabs with the kit's `openFloat`.

[Studio Chat](../bb-studio-chat) puts its "Work with this…" bar in Float's
bottom-right corner, and adds a "Viewing" chip to thread tabs.

More in [docs/float.md](../../docs/float.md).

## Limits

- Links inside a floated item or view open in the main view, not the panel.
- Switching tabs reloads the tab you switch to; only the one showing runs.
- A view that can't show in the panel says so, with a button to open it.
- An item open both in the panel and in the main view runs two editors, each
  saving on its own.

## Develop

```sh
pnpm install
pnpm --filter @bb-studio/float test
pnpm --filter @bb-studio/float typecheck
bb plugin build packages/bb-studio-float
```
