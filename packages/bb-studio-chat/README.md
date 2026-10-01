# Studio Chat

> **Studio Chat** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, tracking tasks, running bot teams, and keeping what your agents make: [Studio](../bb-studio), [Studio Pages](../bb-studio-pages), [Studio Talk](../bb-studio-talk), [Studio Draw](../bb-studio-draw), [Studio Artifacts](../bb-studio-artifacts), [Studio Tasks](../bb-studio-tasks), Studio Chat, and [Studio Teams](../bb-studio-teams).

"Work with this…" on every page, drawing and other Studio item. It starts a
thread that knows which item you're looking at, and brings the item's last
chat back when you return to it. Threads open in [Float](../bb-studio-float)
windows.

## Staged preview

![Live BB screenshot of Studio Chat on a drawing](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): an Excalidraw
drawing ("Checkout flow") with the seeded "Draft the ORBIT-42 release notes"
thread in a Float window. The window's "Viewing: Checkout flow" chip names the
drawing on screen, and the "Work with this drawing…" bar sits at the right end
of Float's row.

## What you get

- **Work with this…** At the bottom right of every Studio item there's a bar:
  "Work with this page…", "…this drawing…", and so on by kind. It opens BB's
  new-thread composer in the item's project. The message starts with a pill
  for the item, and the agent gets a note saying what it is and which tools
  read and change it. The new thread opens in a Float window, or in BB's own
  view without Float.
- **Chats come back.** Each item remembers the last thread used on it, so
  reopening it brings its chat back as a minimized Float window. Moving on to
  another item swaps that window for the next item's chat, unless you opened it.
- **Viewing chip.** Every Float thread window shows which Studio item is on
  screen.
- **Pages hands over.** With Studio Chat installed, Studio Pages drops its own
  "Work with this page…" box. Page chats still start through Pages, so they
  keep showing in the page's Chats menu.

## How it works

- `viewing` asks Studio's `itemAt` which item a path opens, so any add-on
  that joins Studio works without changes.
- `start` spawns the thread. For pages it calls Pages' `work` RPC instead.
  Other items get a mention pill that this plugin's `item` mention provider
  resolves when BB creates the thread.
- The note comes from the item's kind: its `agentHint` in the Studio contract
  (for example `excalidraw_get_drawing` / `excalidraw_update_drawing`), or a
  pointer to `studio_list_items`. It points at the item and doesn't copy it,
  so the agent reads the latest version.
- Links from items to threads live in the plugin's storage
  (`link:<plugin>:<id>`). For pages, Pages' own chat records count too.

## Limits

- The "Viewing" chip can't add the item to a message in a floated thread.
  A plugin's `ThreadChat` doesn't scope `useComposer()` to its thread on BB's
  SDK 0.5.29, so the button stays hidden. Type `@` in the chat to mention a
  Studio item instead. A new chat always carries the item.
- BB doesn't tell plugins the current route. The bar follows the Navigation
  API and polls every 400ms as a fallback.

More in [docs/studio-chat.md](../../docs/studio-chat.md).

## Develop

```sh
pnpm install
pnpm --filter @bb-studio/studio-chat test
pnpm --filter @bb-studio/studio-chat typecheck
bb plugin build packages/bb-studio-chat
```

Requires [Studio](../bb-studio). Without it, the bar has no items to
show on.
