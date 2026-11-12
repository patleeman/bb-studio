---
name: whiteboards
description: Use when the user refers to a whiteboard in a BB Studio page, or an older Studio drawing (Excalidraw) — a /plugins/studio/studio/drawings/<id> or /plugins/excalidraw/drawings/<id> link, a `{"kind":"drawing"}` embed, "the diagram", "sketch this" — or asks you to read, add, resize or change a whiteboard or drawing.
---

# Whiteboards

A whiteboard is an Excalidraw scene that lives in a Studio page. The page
embeds it as:

````
```embed
{"kind":"drawing","target":"<whiteboard-id>","height":480}
```
````

`height` is optional: the whiteboard's height in this page, in pixels, from
160 to 1200 (320 when left out). Change it with `pages_edit` like any other
block. The width is the page's column.

The user sketches on it in the page, or opens it full size over the page,
while you edit the same scene through tools or the CLI. Writes merge element
by element, so your changes and the user's in-progress sketching both
survive; open pages and editors show your changes live.

There are no standalone drawings: every whiteboard is in a page. "Drawing"
is the old name; the kind id (`drawing`), the embed kind and the
`/plugins/studio/studio/drawings/<id>` links keep it. Drawings made before
whiteboards are in a page called "Drawings" or "Whiteboards" (one per
project).

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
| `whiteboard_list` | List whiteboards with ids, names, element counts and the page each is in. |
| `whiteboard_get` | Read a whiteboard's current scene (`whiteboardId`) before changing it. |
| `whiteboard_create` | Add an empty whiteboard to a page (`pageId`, `name`, optional `afterBlockId` from `pages_read`), or, without `pageId`, make a new page holding just the whiteboard. Returns its id and the page's card. |
| `whiteboard_update` | Upsert elements, delete elements by id, or patch appState (`whiteboardId`). An upsert of an existing id merges: send `id`, `type` and just the properties to change. |

The old names (`excalidraw_list_drawings`, `excalidraw_get_drawing`,
`excalidraw_create_drawing`, `excalidraw_update_drawing`, taking `drawingId`)
still work for now, but use the new ones.

To find a whiteboard in a page you're reading, take the `target` of its
`{"kind":"drawing"}` embed.

## CLI (works in every agent session)

```sh
bb studio whiteboards list
bb studio whiteboards create --page <page-id> <name>
bb studio whiteboards show <id> [--raw]
bb studio whiteboards rename <id> <name>
bb studio whiteboards delete <id>
bb studio whiteboards merge <id> <scene-file.json>      # array of elements or a full scene
bb studio whiteboards remove-elements <id> <element-id…>
```

`bb studio drawings …` is the old name and still works. In a thread, `merge`
reads the scene file from the thread's workspace or thread storage, on the
thread's host.

## Working on a whiteboard

1. Read the latest scene first (`whiteboard_get` or `show`); the user may
   have changed it since you last looked.
2. Write only the elements you're adding or changing. Give new elements
   fresh ids; to change one, send it with its existing id. Elements you send
   win over the stored copy. The easiest way to get the shape right is to
   copy an existing element and change its id, position and text.
3. Delete with `deletedElementIds` / `remove-elements`, never by leaving
   elements out: omitted elements are kept.
4. Bind a label to a shape with the shape's `boundElements` and the text's
   `containerId`, as Excalidraw does.
5. If the drawing needs more room in its page, raise the embed's `height`.
6. Put the page's card on its own line in your reply.

## Studio

Whiteboards are built into Studio (they were the Studio Draw add-on, plugin
id `excalidraw`, which items still use as their namespace; the kind id is
`drawing`). Studio's sidebar has a Whiteboards row, and New → Whiteboard
makes a whiteboard page. In the library they can be moved between projects,
archived, searched by the words written on them, and deleted.
