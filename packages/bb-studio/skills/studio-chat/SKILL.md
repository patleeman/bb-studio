---
name: studio-chat
description: Use when a message says the user has a Studio item open ("Context for @… resolved by plugin studio, or the legacy studio-chat bridge"), when they say "this page", "this drawing" or "here" in a chat started from Studio Chat, or when they ask how Studio Chat works.
---

# Studio Chat

Item chat is part of Studio. It provides the Chat action on BB Studio items: pages,
drawings, recordings, artifacts and tables. Starting a chat from it
adds a pill for the item whose Chat action the user chose, including an item
in a split. The main pane can show another item. When the message is sent, the pill turns
into a short note for you:

- which item it is: kind, title, id, plugin and link;
- which tools read and change it (for example `pages_read` / `pages_edit`,
  or `excalidraw_get_drawing` / `excalidraw_update_drawing`).

The note is a pointer, not the content. Read the item with those tools
before you answer about it, and read it again after the user says they
changed it. If the note says the item can't be found, it was probably
deleted; use `studio_list_items` to look for it by title.

"This", "here" and "the page" mean the item in the latest note. The thread
opens in BB's main view, and the user can move to other items, but later messages don't
say which item is on screen now. If they seem to mean a different item, ask,
or find it with `studio_list_items`.

Chats about pages go through Studio Pages, so they also appear in the page's
Chats menu.

**Chat** opens the item's linked thread in the main view. Without a link, a
compact composer opens in the bottom-right corner, and sending opens the new
thread in the main view. ⌘/Ctrl-click, or **Open in split** in a menu, opens a
thread or item in a split instead. There are no Studio Chat CLI commands or
agent tools.
