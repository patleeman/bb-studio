---
name: studio
description: Use when the user refers to BB Studio or "my stuff" across pages, Talk recordings, drawings, artifacts and tables — finding an item they made, "the doc about X", "that recording from Tuesday", "what's in Studio" — or asks how Studio and its add-ons (Studio Pages, Studio Talk, Studio Draw, Studio Artifacts, Studio Tables) fit together.
---

# Studio

BB Studio is a suite of plugins for making things with agents. **Studio** is
the core: one collection that lists every item from every installed add-on.

| Add-on | Plugin id | Items | Open with |
| --- | --- | --- | --- |
| Studio Pages | `pages` | Pages | the `pages` skill and `pages_*` tools |
| Studio Talk | `talk` | Recordings, dictations | the `talk` skill and `bb talk` |
| Studio Draw | `excalidraw` | Drawings | the `draw` skill and `excalidraw_*` tools |
| Studio Artifacts | `artifacts` | Artifacts: saved images, HTML, reports, files | the `artifacts` skill and `artifacts_*` tools |
| Studio Tables | `studio-tables` | Tables with typed columns and views | the `tables_*` tools |

Items belong to a BB project or are global. Every item has a link
(`/plugins/<plugin id>/<panel>/<item id>`); put it in replies as
`[Title](link)` so the user can open it.

## Finding items

- Agent tool `studio_list_items`: newest first, each with its kind and link.
  In a thread that belongs to a space it lists that space's items (the first
  line names the space); otherwise this project's and global items.
  `allProjects: true` looks everywhere. `query` takes filters and words:
  `kind:page project:"Q4 launch" tag:draft -tag:done space:Launch notes`.
  Fields are `kind:`, `project:` (a name, or `global`), `tag:` (a name, or
  `none`), `space:` and `is:archived` / `is:template`; `-` excludes, a repeated
  field matches any of its values, and the remaining words match titles and
  content. A `space:` or `project:` filter replaces the default scope.
  Archived items show only with `is:archived`. Each line shows the item's
  `#tags`; an item that matched on its content has the matching text on a `>`
  line below it (`snippet` in `--json`).
- CLI: `bb studio list [query…] [--all] [--json]`, with the same query, e.g.
  `bb studio list kind:page -tag:done`;
  `bb studio tags` lists the tags and how many items each has, and
  `bb studio spaces` lists the spaces.
- `bb studio providers` shows which add-ons are installed and whether each is
  ready; an add-on that's stopped contributes nothing to the list.

Then read or change the item with its add-on's own tools. Studio doesn't edit
content itself.

## Tags

Tags group items across add-ons, like a "Launch" tag on a page, a drawing and
a table. Studio keeps them; add-ons don't. Use `studio_tag_items` with
`items` (item links, or `<plugin id>:<item id>`), `add` and `remove` (tag
names). Adding a name that doesn't exist yet creates the tag. Tag when the
user asks to group, file or label items; don't invent tags on your own.

## Deleting

`studio_delete_items` with `items` (item links) permanently deletes pages,
recordings, drawings, artifacts, tables and other add-on items.
A page takes its sub-pages with it. There's no undo, so delete only what the user asked
to remove, and confirm first when the request is vague, like "clean up old
stuff". It doesn't delete spaces.

## Spaces

A space gathers whole BB projects, with their Studio items, and threads into
one place, like a "Q4 launch" space with two repos, a few pages and a board. A BB
project is where code lives and threads run; a space is how the user groups
work. A project in a space brings in all of its items and open threads, now
and later. A thread is in a space when it was added to it or its project is.

- `studio_list_spaces` lists the spaces and marks the ones this thread is in.
- `studio_space_items` with `space` (a name), `threads` (thread ids),
  `items` (item links) and `thisThread` (`add` or `remove`) files threads and
  items in a space. A thread is in one space at a time, so filing it moves
  it. Items follow their project, so an item not in the space yet moves to
  the space's own project; items already in it stay put.
- `studio_move_items` with `items` and `project` (a name, an id, or
  `global`) moves items to another project, and so to that project's space.
- In a shell, `bb studio move <link|plugin:id|thread-id>… --space <name>` or
  `--project <name|global>` does the same.
- Only the user makes, renames or deletes spaces. Spaces aren't tags:
  `studio_tag_items` can't touch them. File things in a space when the user
  asks to.
- What a thread in a space makes in the space's projects is in the space by
  itself. Don't file those again.
- A space may have a lead: one of its threads, which the user picks. A
  Heartbeat can wake the lead on a schedule. Nothing else is made for a
  space: no page, no lead thread.

## In the app

Spaces show in the sidebar with their threads and Studio items; the user
makes, edits and deletes them there, and picks a space's lead and Heartbeat
from its ⋯ menu. Each thread's
header shows its space, links back to it, and moves the thread to another.
Each Studio item's ⋯ menu, the collection's row menu and its bulk **Move**
offer **Move to** a space or a project. The Studio panel
is the collection. Search, space, kind, project and tag filters, list or
grid, archive, move to project, delete, **New ▾** for any kind, and
**New thread** to start a conversation that mentions the selected items. With
Studio installed, each add-on's own collection hands over to Studio filtered
to its kind; the add-ons' sidebar rows can be hidden from Studio's ⋯ menu.
Cmd/Ctrl+Shift+K (palette: **Studio: Search everything**) opens Studio search over
any page, matching titles and content; point the user there to find an item
quickly. Cmd/Ctrl+K is BB's thread search, not Studio's.

## Command view

A Space’s Command view opens from its sidebar heading. It shows ordinary threads as panes: one follows whichever thread is working until the owner opens more, which makes a grid; closed panes reopen from the thread list beside the composer. Messages go to the lead or picked threads; @all addresses every top-level thread. The addressed thread roster authorizes coordination for that request with bb thread log and bb thread tell. Scheduling uses Automations.

- Each thread in the Space has a one-letter alias (`a`, `b`, … then `a2`), shown on its pane; the owner types `@b` to address that thread. A thread keeps its alias while it is in the Space, shown or not, and a letter freed by a thread that left isn't reused until the other letters are taken.
- A message that addresses nobody goes to the lead. Its agent-only context lists the Space's threads with their aliases and asks the lead to forward it with `bb thread tell <threadId>` when it is clearly meant for one of them, then say in one line where it went, or else handle it itself. Attached files are copied into every listed thread's project, so the same relative paths work after forwarding. Pasted images can't be forwarded through `bb thread tell`; the lead says so and asks the owner to send them to that thread.

## Item workspace

Studio opens on its Workspace. The item list shows only as its new tab page: **+**
opens it, and an item opened from it replaces it. Sidebar,
collection and search opens use the Workspace tabs for participating add-ons. No thread is required. Drag items or tabs onto a tab bar, or
to an edge to split; the arrangement menu offers split and move actions. Tabs and
pane sizes restore locally. Closing a tab does not delete its saved item. Conversation-side views keep their existing behavior.
