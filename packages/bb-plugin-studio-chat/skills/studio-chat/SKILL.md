---
name: studio-chat
description: Use when a message says the user has a Studio item open ("Context for @… resolved by plugin studio-chat"), when they say "this page", "this drawing" or "here" in a chat started from Studio Chat, or when they ask how the floating Studio Chat works.
---

# Studio Chat

Studio Chat is the chat card that floats over BB Studio items: pages,
drawings, recordings, artifacts, tasks and bots. Starting a chat from it
adds a pill for the item on screen. When the message is sent, the pill turns
into a short note for you:

- which item it is: kind, title, id, plugin and link;
- which tools read and change it (for example `pages_read` / `pages_edit`,
  or `excalidraw_get_drawing` / `excalidraw_update_drawing`).

The note is a pointer, not the content. Read the item with those tools
before you answer about it, and read it again after the user says they
changed it. If the note says the item can't be found, it was probably
deleted; use `studio_list_items` to look for it by title.

"This", "here" and "the page" mean the item in the latest note. The card
keeps a thread while the user moves to other items, but later messages don't
say which item is on screen now. If they seem to mean a different item, ask,
or find it with `studio_list_items`.

Chats about pages go through Studio Pages, so they also appear in the page's
Chats menu.

The user controls the card: Mod+Shift+J shows or hides it, a thread
header's **Float** button puts that thread in the card, and the card's ⋯ menu
switches threads or opens the current one in full or in a split. There are
no Studio Chat CLI commands or agent tools.
