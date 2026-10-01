# Studio Chat

> **Studio Chat** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, tracking tasks, running bot teams, and keeping what your agents make: [Studio](../bb-studio), [Studio Pages](../bb-studio-pages), [Studio Talk](../bb-studio-talk), [Studio Draw](../bb-studio-draw), [Studio Artifacts](../bb-studio-artifacts), [Studio Tasks](../bb-studio-tasks), Studio Chat, and [Studio Teams](../bb-studio-teams).

New in Float and Open in Float on every page, drawing and other Studio item.
New in Float starts a thread that knows which item you're looking at; Open
in Float brings back one you already have. The item's last chat comes back when
you return to it. Threads open as [Float](../bb-studio-float) tabs.

## Staged preview

![Live BB screenshot of Studio Chat on a drawing](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): an Excalidraw
drawing ("Checkout flow") with New in Float and Open in Float in the
bottom-right corner. The seeded "Draft the ORBIT-42 release notes" thread was
picked from Open in Float and shows as a docked Float tab, whose "Viewing:
Checkout flow" chip names the drawing on screen.

## What you get

- **New in Float.** At the bottom right of every Studio item, New in Float
  opens BB's new-thread composer in the item's project. The message starts with a pill
  for the item, and the agent gets a note saying what it is and which tools
  read and change it. The new thread opens as a Float tab, or in BB's own
  view without Float, where the buttons read New thread and Open thread.
  (The item header's own New thread button opens BB's full composer.)
- **Open in Float.** Next to it, Open in Float lists the item's last chat and
  your recent threads; type to search them all. The one you pick opens as a
  Float tab.
- **Chats come back.** Each item remembers the last thread used on it, so
  reopening it brings its chat back as a Float tab behind the one showing.
  Moving on to another item swaps that tab for the next item's chat, unless
  you're looking at it.
- **Viewing chip.** Every Float thread tab shows which Studio item is on
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
- BB doesn't tell plugins the current route. The buttons follow the Navigation
  API and poll every 400ms as a fallback.

More in [docs/studio-chat.md](../../docs/studio-chat.md).

## Develop

```sh
pnpm install
pnpm --filter @bb-studio/studio-chat test
pnpm --filter @bb-studio/studio-chat typecheck
bb plugin build packages/bb-studio-chat
```

Requires [Studio](../bb-studio). Without it, the buttons have no items to
show on.
