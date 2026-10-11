# Studio

> **Studio** is the core of **BB Studio**, a suite of plugins for writing, talking, drawing, and keeping what your agents make. See the [suite overview](../../README.md).

Studio opens on the collection: everything the Studio add-ons make, including pages, Talk
recordings and dictations, drawings, and saved artifacts. Search across all of them, filter by
kind, project and tag, and hand any of them to an agent. Each BB project can have a lead thread
woken by a Heartbeat.

## Workspace

Studio opens on its workspace: items in tabs, without a conversation. The
Studio item list shows only as its new tab page: **+** opens it, and an item
opened from it takes its place, as in a browser. Items opened from the
sidebar or Studio search open as tabs too. Drag tabs or sidebar items to a pane's edge to split; drag onto
a tab bar to move or reorder. A tab's right-click menu offers split and move
commands, and separators resize with the mouse or arrow keys. Closing a tab
keeps the item. The workspace remembers the layout locally across visits and
refreshes. An item always opens as a tab: its own address, from a card in a
chat, **Open in Pages**, a link or a typed URL, opens the tab and leaves the
address for the workspace. Old list addresses, such as a kind's (`/plugins/studio/studio/page`),
open the new tab page on that kind.
Right-click a tab for Close, Close others, Close tabs to the right, Close all in
the pane, splits, moves to another pane, Rename, and Copy link.
Double-click a tab, or press F2 on it, to rename its item. The tab row shows
the item's own tools and status, such as a page saving or a recording paused;
the tab names the item, so its title isn't repeated, and Chat isn't offered.
Each tab row carries the active item's tools, such as Chat, beside its tabs.
With one pane, the tab row takes BB's title bar, so the item sits under a
single bar. Open items live here, not in the sidebar.
Conversation-side item views continue to work independently. At phone widths, a
pane picker shows one pane at a time while preserving the desktop arrangement.

![Studio's new tab page: the item list as a tab in the workspace](assets/workspace-new-tab.png)

![Studio workspace with one pane, its tabs and the page's tools in BB's title bar](assets/workspace-single.png)

![A Studio tab's right-click menu: close, close others, close to the right, split, move, open and copy link](assets/workspace-tab-menu.png)

![Studio workspace with a page and recording in separate panes](assets/workspace.png)

![Studio workspace on a phone, with a pane picker](assets/workspace-mobile.png)

These staged captures check item opening, drag-to-split, layout restoration,
closing and reopening tabs, local editor toolbars, and title sizing after a
viewport change.

## Staged preview

![Live BB screenshot of the Studio collection](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): the Studio
collection as the workspace's new tab, a list with search and compact Project and
Kind menus above it.
Tags and Status are available under **More filters**. The rows show
a paused Talk recording, a drawing and three Orbit pages.

![Live BB screenshot of Studio with active filters](assets/filters.png)

Selected filters appear below search, each with a remove button and an explicit
Include/Exclude menu. Clearing search keeps the filters; **Clear filters** keeps
the search text. **Save view** remembers the query, and **Views** appears once a
view exists. Query syntax such as `kind:page` still completes in search.

![Live BB screenshot of Studio filters on mobile](assets/filters-mobile.png)

The same controls work at phone width. Both captures check menu selection,
a stored plural filter, text search, exclusion, project filtering, and saving
and reopening a view.

![Live BB screenshot of the New menu with a Pages filter](assets/new-menu.png)

The New menu stays open to every available kind with a Pages filter active.
The capture checks that Drawings and Pages filters offer the same menu as the
unfiltered collection.

![Live BB screenshot of Studio search](assets/search.png)

Studio search (Cmd/Ctrl+Shift+K) over the same staged project, searching
"offline sync": an HTML artifact and two pages match on their title or
content, each showing the matching text with the match in bold.

## Artifacts

Artifacts are built into Studio: the images, pages, reports and files your
agents make, kept with every version. They used to be the separate Studio
Artifacts plugin (`artifacts`). Items keep that id as their namespace
(`artifacts:<id>`), so tags, tabs, links and chats carry over. If you
had the plugin, see [its upgrade bridge](../bb-studio-artifacts/README.md) to
copy your artifacts in.

![Live BB screenshot of an artifact open as a Studio tab](assets/artifacts-preview.png)

Captured from a staged BB after the merge: the seeded HTML report "Q3 usage
report", saved twice from a staged thread's workspace, open as a Studio tab
at version 2 (`HTML · 2.1 KB · v2` in the tab row, with Source, Copy,
Download and the ⋯ menu) in its sandboxed frame. Recapture with
`BB_CAPTURE_ONLY=studio-artifacts`, which also checks that the old address
opens it as a tab.

![The compact artifact header](assets/artifacts-compact-header.png)

The same viewer at 390 pixels wide as a Studio tab, with **Item actions**
open. The tab row shows only the viewer's own tools; Chat appears where the
artifact opens outside the workspace, such as beside a thread. Recapture
with `BB_CAPTURE_COMPACT_HEADERS=1 BB_CAPTURE_ONLY=artifacts-compact-header`.

- **In the library.** Artifacts list next to pages, recordings and drawings,
  with type, size and version columns, image thumbnails, projects, archive,
  move and delete. Artifacts have no collection page of their own:
  `/plugins/studio/studio/artifacts` opens the library filtered to the
  Artifact kind. Studio search matches titles, descriptions and the text of
  text files up to 1 MB (HTML by its words). Studio can't create an artifact;
  they come from threads.
- **Viewer** (`/plugins/studio/studio/artifacts/<id>`, loaded the first time
  one opens). Images fit the window, and a click shows actual size. HTML runs
  in a sandboxed frame, PDFs open in the browser's viewer, and audio and video
  play with seeking. Markdown renders as a document. Code and text use BB's
  source viewer (first 2 MB). Other files offer a download. The header has an
  editable title, the artifact's chat, Copy, Download, and a menu with Open
  source thread, Save as page, Versions, Move to and Delete. Select text or
  drag over an image to **Send to thread**.
- **Save from a thread.** **Artifacts** in the thread panel launcher lists the
  files the latest reply created, changed or generated, the thread's storage
  files, and what the thread already saved. Nothing is saved automatically.
- **Agent tools and skill.** `artifacts_save`, `artifacts_list` and
  `artifacts_read`, and the `artifacts` skill. A saved artifact comes back as
  `::artifact{id="art_…"}`, a card with an inline preview that opens the
  viewer beside the chat. `@artifact` mentions give the agent the artifact's
  details and, for text up to 1 MB, its contents.
- **Commands.** `bb studio artifacts save <path> [--title <title>]
  [--description <text>]`, `list [--thread]`, `show <id>`,
  `export <id> [path] [--force]` and `delete <id>`. A plugin registers one CLI
  command, so the old `bb artifacts …` moved under `bb studio`.
- **Limits.** 25 MB per file. A version is keyed on its source thread and
  path; unchanged bytes add no version. Saving reads only from the thread's
  workspace or thread storage.

Files are stored as BLOBs in Studio's SQLite database. Contents come from
`GET /api/v1/plugins/studio/http/artifacts/content`. Every response except a
real PDF carries a `sandbox allow-scripts` CSP, so HTML gets an opaque origin
and can't call BB's API with your session.

## Drawings

Drawings are built into Studio: [Excalidraw](https://excalidraw.com) scenes
you sketch with your agents. They used to be the separate Studio Draw plugin
(`excalidraw`). Items keep that id as their namespace (`excalidraw:<id>`), so
tags, tabs, links and chats carry over. If you had the plugin, see
[its upgrade bridge](../bb-studio-draw/README.md) to copy your drawings in.

![Live BB screenshot of a drawing open as a Studio tab](assets/drawings-preview.png)

The seeded "Checkout flow" drawing open in the Excalidraw editor as a Studio
tab, with sync status, Copy image and the ⋯ menu in the tab row: Cart,
Payment and Confirmation boxes joined by arrows, with a "Retry payment on
failure" note. Recapture with
`BB_CAPTURE_ONLY=excalidraw`, which opens it from its old
`/plugins/excalidraw/drawings/<id>` address and checks that it lands as a
Studio tab.

![The compact drawing header](assets/drawings-compact-header.png)

The same editor at 390 pixels wide as a Studio tab, with **Item actions**
open. Recapture with
`BB_CAPTURE_COMPACT_HEADERS=1 BB_CAPTURE_ONLY=draw-compact-header`.

- **In the library.** Drawings list next to pages, recordings and artifacts:
  thumbnails, projects, search over the words on a drawing, archive, move,
  delete, duplicate, templates and **Copy text**. Drawings have no collection
  page of their own: `/plugins/studio/studio/drawings` opens the library
  filtered to the Drawing kind.
- **Editor** (`/plugins/studio/studio/drawings/<id>`). Excalidraw loads the
  first time a drawing opens, not with Studio. It autosaves as you work. The
  header has an editable name, sync status, the drawing's chat, copy image,
  and a menu with **Download PNG**, Move to and Delete. The editor follows
  BB's active theme.
- **Card in the agent's reply.** When an agent makes or changes a drawing,
  its reply shows a card (`::drawing{id="…"}`) with the picture, name and
  element count. It opens the drawing in the thread's **Drawings** tab beside
  the chat, or in Studio without a workbench.
- **Thread tab.** **Drawings** lists the drawings made or changed in that
  thread, then the project's recent ones. **New** makes one in the thread's
  project and links it to the thread. In the editor, **Attach** adds the
  drawing to the conversation as an image. So does the composer's `+` menu,
  **Drawing**. Neither sends a message.
- **Agent tools and skill.** `excalidraw_list_drawings`,
  `excalidraw_get_drawing` (elements, app state, a text summary, and image
  files without their data; scenes over about 400,000 characters come back
  as element ids), `excalidraw_create_drawing` and `excalidraw_update_drawing`
  (upserts and deletes up to 500 elements by id; only the elements you send
  change), and the `draw` skill. `@drawing` mentions give the agent the scene.
- **Live co-editing.** Keep a drawing open and ask an agent to change it. Your
  editor shows its edits live, and the agent's next read sees yours. Edits
  merge per element; two edits to the same element resolve by Excalidraw's
  `version`, higher wins. Deletions travel as tombstones (pruned after 30 days).
- **Commands.** `bb studio drawings list`, `create <name>`,
  `show <id> [--raw]`, `rename <id> <new-name>`, `delete <id>`,
  `merge <id> <scene-file.json>` (an elements array or a full scene, with its
  image files) and `remove-elements <id> <element-id…>`. A plugin registers
  one CLI command, so the old `bb excalidraw …` moved under `bb studio`.
- **Export.** **Download PNG** in the editor renders in your browser. Studio's
  item menu exports PNG, SVG or the `.excalidraw` JSON, drawn on the server
  with Excalidraw's fonts (resvg's WebAssembly build loads on the first PNG).
  Embedded images are drawn if each is under 1.5 MB and all under 4 MB.

Scenes are stored in Studio's SQLite database in Excalidraw's save-file
format. The editor autosaves after a 1.2 second pause, in order, retries a
failed save up to three times, then shows **Retry save**. Unsaved scenes are
also kept in this browser's IndexedDB: on reopening, **Recover draft** merges
one only if the server copy hasn't changed; otherwise **Save as copy**,
**Download draft** or **Discard draft**. Thumbnails come from
`GET /api/v1/plugins/studio/http/drawings/thumbnail`, an SVG with a CSP that
runs nothing.

## What you get

Everything opens in BB's main view, as a tab in Studio's workspace. ⌘/Ctrl-click an item or thread link, or choose **Open in split** from
its menu, to open it in a split instead. Right-click any Studio item or
thread link, anywhere, for **Open**, **Open in split**, **Copy reference**
(**Copy link** for a thread) and **New thread with this**. Item and collection
headers have an **Open in split** button. An editor you leave stays
open in the background, so it's as you left it when you come back.

- **One collection** (sidebar → Studio): every add-on's items in one list,
  with search over titles and content, filters by kind, project and
  tag, and an Archived view. **Display** groups the list by kind, project
  or tag (collapsible) and
  sorts it by name, kind, project, created or last activity, either way; both
  choices are remembered. The column you group by drops out. Drawings show thumbnails;
  recordings show their length and word count. Background kinds, such as Talk's dictations, stay
  out of All and Home; the Kind menu and search still show them.
- **Search from anywhere.** Cmd/Ctrl+Shift+K (or **Studio: Search everything**
  in the command palette, Cmd/Ctrl+Shift+P) opens a quick-open box over any
  page. Studio indexes titles and text from current add-ons, then searches BB threads live. The palette also has recent items and commands for creating items, opening Studio, handing work to an agent and opening threads. Titles match as you type; each add-on also searches its content —
  page text, transcripts, drawing text, artifact files, table rows — and the row shows the text that matched. With nothing typed
  it lists recently changed items. ↑↓ and ↵ open one.
- **Tags** group items across add-ons: a page, a drawing and a table can all
  be tagged "Launch". Tag from an item's ⋯ menu or the selection bar, filter
  by tag (or Untagged) from the tag menu, and click a chip to filter by it.
  The tag menu also renames and deletes the active tag.
- **Project leads.** A BB project can have a lead thread, which a
  Heartbeat wakes on a schedule; the personal project's lead is the Chief of
  Staff. Set them in Setup under **Project leads**. BB's own sidebar groups
  threads by project. See [`docs/project-leads.md`](../../docs/project-leads.md).
- **Shared actions**: select items (shift-click for a range) to start a
  **New thread** that mentions them, move them to a project, archive, or
  delete. Actions an add-on defines, like Talk's "Copy transcripts" or Draw's
  "Copy text", appear when the selection is all that kind.
- **New ▾** creates any kind an installed add-on offers, in the current
  project. It always opens the full menu, even with a kind filter active.
- **Takes over from the add-ons.** Each add-on's own collection hands over
  to Studio filtered to its kind, and item pages lead back to Studio. Studio's
  ⋯ menu can hide the add-ons' sidebar rows, so Studio is the only entry.
- **The BB Studio theme**: the app icon's colors for all of BB, light and
  dark. Teal-black and pale-teal surfaces, a coral accent, teal file paths.
  Pick **BB Studio** in Settings → Appearance, or run `bb theme set
  plugin:studio:bb-studio`.
- **Automations tab.** In a thread's side panel, **+ → Automations** lists the
  automations that wake that thread: the name, the schedule in words (such as
  "Every 30 min" or "Weekdays 9:00"; other crons show as written), when it
  runs next, and the last run's result or error. A switch pauses or resumes
  one, and **Edit** opens it in Automations. The tab refreshes when it opens
  and every 30 seconds while it's visible. If BB's Automations plugin is off
  or doesn't answer, the tab says Automations are unavailable.
- **Automations badge.** A thread that automations wake shows a clock with
  their count in its header; click it to open the Automations tab. It uses
  BB's experimental thread header slot, so Studio still loads without it.
- **For agents**: the `studio_list_items`,
  `studio_tag_items`, `studio_delete_items` and
  `studio_move_items` tools, the `bb studio` CLI, and a `studio` skill. With
  `studio_workspace`, `studio_open_items` and `studio_close_tabs` an agent sees
  the tabs you have open in the BB window you're using, opens items beside
  them, and closes tabs.

```sh
bb studio list [query…] [--all] [--kind <kind>] [--query <text>] [--tag <tag>] [--json]
bb studio tags
bb studio move <item-link|plugin:id>… --project <name|id|global>
bb studio providers
bb studio health [--json]
bb studio reindex
```

## How it works

- Some kinds are built into Studio (Artifacts so far; see
  [`docs/merging-add-ons.md`](../../docs/merging-add-ons.md)). They implement
  the same provider contract in-process, keep the plugin id they had as add-ons,
  and open under Studio's one panel. Other add-ons reach them through Studio's
  `provider.call`.
- Add-ons implement the Studio provider contract (`studio_describe`,
  `studio_list`, `studio_search`, `studio_create`, `studio_move`,
  `studio_archive`, `studio_delete`, `studio_action`) from
  [`@bb-studio/kit`](../bb-studio-kit), and publish them for RPC discovery.
  Studio finds them with `bb.sdk.plugins.experimental_discoverRpc` and calls
  them with `callRpc`. Any plugin can join the suite this way.
- Studio keeps an FTS5 index of item titles and `studio_read` text. `studio_changed` updates changed items; `bb studio reindex` rebuilds the index. The `searchAll` RPC returns ranked items and thread matches with snippet ranges.
- An add-on tells Studio when its items change (`studio_changed`); Studio
  relays that over realtime and the open collection refetches.
- A stopped or failing add-on shows up as unavailable instead of breaking the
  collection.
- Studio stores tags, open tabs, saved views and project leads itself, keyed by
  `<plugin id>:<item id>` where items are involved, so add-ons don't need to
  know about them. Tags on items an add-on no longer lists are
  dropped. Each add-on owns its data, editors, tools, CLI and mentions.

See [`docs/studio.md`](../../docs/studio.md) for the design.

## Setup

**Studio → Setup** (`/plugins/studio/studio/setup`) is the one place to set up
BB Studio. It lists every add-on from this repository's marketplace with its
one-line description and status: **Installed**, **Not installed**, **Turned
off**, **Needs setup** or **Broken**, with its health checks under it.

- **Install** and **Install all** install missing add-ons from the
  `bb-studio` marketplace, and **Turn on** enables one that's off. Install all
  skips Studio Mobile, which only the iOS app needs. Each action shows the
  same CLI command with a Copy button, for when it fails.
- If BB doesn't know the `bb-studio` marketplace yet, the page shows
  `bb marketplace add git:github.com/patleeman/bb-studio@main` first.
- **Retired plugins** shows `artifacts`, `studio-navigation`, `float`,
  `bot-teams` and `studio-tables` if they're installed: why each is retired, what removing it
  keeps and deletes, and what to do first. **Remove…** asks before it removes
  anything. Studio Artifacts can't be removed until its upgrade bridge has
  copied every artifact into Studio (`bb artifacts migrate`).
- Problems with plugins outside BB Studio are listed at the bottom.

`bb studio setup` prints the same status, the retired plugins and the
commands left to run; `--json` prints the whole summary.

## Backup and restore

`bb studio backup [--out <file|folder>]` saves every Studio item into one
`.zip`. That covers pages, recordings with their audio, drawings, artifacts,
designs, and Studio's tags, project leads, views, links, comments and
versions. `bb studio restore <file>` shows what would change, and `--yes`
restores it. Restore matches each item by its original id, so running it
again changes nothing, and it never overwrites a copy that is newer here.
Projects are matched by path or name; items whose project isn't on the BB
become global items. The Setup page has the same **Back up** and **Restore…**
actions; restoring there shows the dry run and asks before it changes
anything. [docs/backup.md](../../docs/backup.md) describes the file format,
what's left out and how conflicts are handled.

## Plugin health

Studio checks every enabled plugin when it starts and every 3 minutes after
that. It reads two things:

- **BB's own status for every plugin.** A plugin that needs setup, stopped
  with an error, doesn't work with this BB version, or has a background
  service that keeps restarting.
- **Plugins' own checks.** A plugin can publish `studio_health` with
  `registerHealth` from `@bb-studio/kit/health`. It reports problems only the
  plugin can see, like a missing API key. Each problem has a fix link, which
  defaults to the plugin's settings page. Studio Decisions reports a missing
  or failing Jev provider and an unavailable fallback model.

The **Plugin health** item in the sidebar footer lists the problems. It opens
by itself when a problem you haven't seen is found twice in a row, 30 seconds
apart, so a plugin that's only reloading doesn't open it. It closes by itself
once those problems are fixed or hidden, or with its close button. Each problem has three
actions: **Fix** opens the place to fix it, **Turn off plugin** disables the
plugin, and **Hide** hides it until it changes or goes away and comes back.
**Open plugin setup** goes to the Setup page, which also shows hidden
problems and what passed. `bb studio health` prints every plugin's problems
and exits 1 when a problem isn't hidden.

![The Plugin health card open above the sidebar footer on staged stable BB, showing that Studio Decisions has no Jev provider set up, with Add a key, Turn off plugin and Hide](assets/plugin-health.png)

![Studio's Setup page on the same staged BB, listing BB Studio's add-ons with Studio Decisions marked Needs setup because no Jev provider is set up](assets/plugin-setup.png)

## Development

```sh
pnpm typecheck
pnpm test
bb plugin build .
```

`@bb-studio/kit` is a `file:../bb-studio-kit` dependency. Keep
`package-lock.json` current (regenerate it in a clean clone, not the pnpm
workspace), because BB's Git install runs `npm install` from it.

## Templates and export

Pages and drawings can be saved as templates from an item's menu. The New menu lists those templates.

The hub offers `duplicate`, `setTemplate`, `instantiateTemplate`, `templates`, `exportItem`, and `exportBulk` RPCs. `exportBulk` returns a base64 ZIP containing the provider's files. Individual exports use the item's menu. Template fields use `{{name}}` style variables; unknown variables remain visible.

## Item chat

Studio owns each item's **Chat** action, conversation picker, linked thread and
quotes. Everything **Chat** opens goes in a split beside the item, which stays
on screen. **Chat** opens the item's linked thread. Without one, it opens a
new-conversation composer, and sending turns that pane into the new thread.
**Choose conversation…** opens a thread picker in the same split. A new
conversation keeps the item's context, project and draft; a quote goes to its
linked thread, or opens the composer with the quote when there is none. Where
BB doesn't split (a small screen, or splits turned off), these open in the
main view. Pages keeps its page-chat history.

Old draft keys and quote storage are retained.

![Studio item chat: a staged image on the left, and in a split beside it a new-thread composer quoting a cropped area of it, with a note and an attached file](assets/chat-preview.png)
