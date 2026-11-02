---
name: draw
description: Use when the user refers to a whiteboard in a BB Studio page, or an older Studio drawing (Excalidraw) — a /plugins/studio/studio/drawings/<id> or /plugins/excalidraw/drawings/<id> link, a `{"kind":"drawing"}` embed, "the diagram", "sketch this" — or asks you to read, add, or change a whiteboard or drawing.
---

# Whiteboards

A whiteboard is an Excalidraw drawing that lives in a Studio page. The page
embeds it as:

````
```embed
{"kind":"drawing","target":"<drawing-id>"}
```
````

The user sketches on it in the page, or opens it in the full Excalidraw
editor (`/plugins/studio/studio/drawings/<drawing-id>`), while you edit the
same scene through tools or the CLI. Writes merge element by element, so your
changes and the user's in-progress sketching both survive; open pages and
editors show your changes live.

There are no standalone drawings any more: make a whiteboard in a page.
Drawings made before whiteboards are in a page called "Drawings" (one per
project). Older `/plugins/excalidraw/drawings/<id>` links still open the
same drawing.

When you add or change a whiteboard, put the page's card on its own line in
your reply, so the user sees the whiteboard where it lives:

```
::page{id="<page-id>"}
```

The create and update tools print the right line for you. Older replies may
carry `::drawing{id="…"}` cards; those still show.

## Agent tools

| Tool | Use it to |
| --- | --- |
| `excalidraw_list_drawings` | List whiteboards with ids, names, element counts and the page each is in. |
| `excalidraw_get_drawing` | Read a whiteboard's current scene before changing it. |
| `excalidraw_create_drawing` | Add an empty whiteboard to a page (`pageId`, `name`, optional `afterBlockId` from `pages_read`). Returns its id and the page's card. |
| `excalidraw_update_drawing` | Upsert elements, delete elements by id, or patch appState. An upsert of an existing id merges: send `id`, `type` and just the properties to change. |

To find a whiteboard in a page you're reading, take the `target` of its
`{"kind":"drawing"}` embed.

## CLI (works in every agent session)

```sh
bb studio drawings list
bb studio drawings create --page <page-id> <name>
bb studio drawings show <id> [--raw]
bb studio drawings rename <id> <name>
bb studio drawings delete <id>
bb studio drawings merge <id> <scene-file.json>      # array of elements or a full scene
bb studio drawings remove-elements <id> <element-id…>
```

In a thread, `merge` reads the scene file from the thread's workspace or thread
storage, on the thread's host.

## Working on a whiteboard

1. Read the latest scene first (`excalidraw_get_drawing` or `show`); the user
   may have changed it since you last looked.
2. Write only the elements you're adding or changing. Give new elements
   fresh ids; to change one, send it with its existing id. Elements you send
   win over the stored copy. The easiest way to get the shape right is to
   copy an existing element and change its id, position and text.
3. Delete with `deletedElementIds` / `remove-elements`, never by leaving
   elements out: omitted elements are kept.
4. Bind a label to a shape with the shape's `boundElements` and the text's
   `containerId`, as Excalidraw does.
5. Put the page's card on its own line in your reply.

## Studio

Whiteboards are built into Studio (they were the Studio Draw add-on, plugin
id `excalidraw`, which items still use as their namespace; the kind id is
`drawing`). Studio's library lists them under Whiteboards, where they can be
moved between projects, archived, searched by the words written on them, and
deleted.
