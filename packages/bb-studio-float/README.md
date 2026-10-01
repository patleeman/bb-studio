# Float

> **Float** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, tracking tasks, running bot teams, and keeping what your agents make. See the [suite overview](../../README.md).

Windows along the bottom of the screen for anything you'd open from the
sidebar: threads, channels, Studio items and Studio views. Keep several open
while you work somewhere else.

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
- **Several at once.** New windows open at the right. When they don't all fit,
  the oldest go into a menu at the left end of the row; pick one to bring it
  back. Phones and narrow windows show one window at a time.
- **Minimize** a window to its title bar, and click the title to open it again.
  Its ⋯ menu opens it full, or in a split for threads.
- **Mod+Shift+J** hides every window and shows them again. You can rebind it
  in BB's keyboard settings.

The windows are kept per browser window and survive a reload.

## How it works

Float draws the windows, and a thread window is BB's `ThreadChat`. Any other
window shows another plugin's nav panel. BB has no way to put one plugin's
view inside another's, so the plugin that owns the path renders its panel
into the window through a portal. The shared kit's `FloatPanels` does this
(`packages/bb-studio-kit/src/app/float.tsx`). Pages, Draw, Tables, Tasks,
Talk, Artifacts and Studio render it, so their items and views can float.
Other plugins open windows with the kit's `openFloat`.

[Studio Chat](../bb-studio-chat) puts its "Work with this…" bar at the
right end of the row, and adds a "Viewing" chip to thread windows.

More in [docs/float.md](../../docs/float.md).

## Limits

- Links inside a floated item or view open in the main view, not the window.
- A view that can't show in a window says so, with a button to open it.
- An item open both in a window and in the main view runs two editors, each
  saving on its own.

## Develop

```sh
pnpm install
pnpm --filter @bb-studio/float test
pnpm --filter @bb-studio/float typecheck
bb plugin build packages/bb-studio-float
```
