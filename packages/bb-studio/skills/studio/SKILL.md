---
name: studio
description: Use when the user refers to BB Studio or "my stuff" across pages, Talk recordings, drawings, dashboards and artifacts — finding an item they made, "the doc about X", "that recording from Tuesday", "what's in Studio" — or asks how Studio and its add-ons (pages, recordings, drawings, designs, dashboards and artifacts are built into Studio) fit together.
---

# Studio

BB Studio is a suite of plugins for making things with agents. **Studio** is
the core: one collection that lists every item from every installed add-on.

| Add-on | Plugin id | Items | Open with |
| --- | --- | --- | --- |
| VS Code (built into Studio) | `studio-code` | Thread workspaces | the `studio-code` skill and six `code_*` tools |
| Pages (built into Studio) | `pages` | Pages | the `pages` skill, `pages_*` tools and `bb studio pages` |
| Studio Talk | `talk` | Recordings, dictations | the `talk` skill and `bb talk` |
| Drawings (built into Studio) | `excalidraw` | Drawings | the `draw` skill, `excalidraw_*` tools and `bb studio drawings` |
| Dashboards (built into Studio) | `dashboards` | Dashboards: live stats, charts, tables and feeds | the `dashboards` skill, `dashboard_*` and `widget_*` tools and `bb studio dashboards` |
| Studio Artifacts | `artifacts` | Artifacts: saved images, HTML, reports, files | the `artifacts` skill and `artifacts_*` tools |

Items belong to a BB project or are global. Every item has a link
(`/plugins/<plugin id>/<panel>/<item id>`); put it in replies as
`[Title](link)` so the user can open it.

## Finding items

- Agent tool `studio_list_items`: newest first, each with its kind and link.
  It lists this thread's project's items and global items; a `project:`
  filter or `allProjects: true` widens that. The user's Bot sees every
  project. `query` takes filters and words:
  `kind:page project:"Q4 launch" tag:draft -tag:done notes`.
  Fields are `kind:`, `project:` (a name, or `global`), `tag:` (a name, or
  `none`) and `is:archived` / `is:template`; `-` excludes, a repeated
  field matches any of its values, and the remaining words match titles and
  content. A `project:` filter replaces the default scope.
  Archived items show only with `is:archived`. Each line shows the item's
  `#tags`; an item that matched on its content has the matching text on a `>`
  line below it (`snippet` in `--json`).
- CLI: `bb studio list [query…] [--all] [--json]`, with the same query, e.g.
  `bb studio list kind:page -tag:done`;
  `bb studio tags` lists the tags and how many items each has,.
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
recordings, drawings, artifacts and other add-on items.
A page takes its sub-pages with it. There's no undo, so delete only what the user asked
to remove, and confirm first when the request is vague, like "clean up old
stuff".

## Moving items and project leads

- `studio_move_items` with `items` and `project` (a name, an id, or
  `global`) moves items to another project. In a shell,
  `bb studio move <link|plugin:id>… --project <name|global>` does the same.
- A BB project may have a lead: one thread, which the user picks in Studio's
  Setup page under **Project leads**. A Heartbeat can wake the lead on a
  schedule. A thread leads at most one project. The personal project's lead
  is the user's Bot (it replaced the Chief of Staff). A handoff keeps the
  successor the lead.
- The Bot is the user's always-on agent, with a name and emoji. `bot_get`
  shows it, `bot_activity` lists what needs the user, what's in progress,
  what's scheduled and what finished. `bot_set` renames it; `bot_pause`,
  `bot_resume` and `bot_stop` change its state, only when the user asks.
  Pause and stop work only in the Bot's own chat; elsewhere they're refused
  and the user uses the Bots list in the sidebar.
  Paused or stopped, the Bot starts no new work. Its home is
  `/plugins/studio/studio/bot`. The user can have several bots (New bot on that
  page); the first is the primary. In a bot's own thread these tools act on
  that bot; elsewhere on the primary.

Skill curation follows each Bot's Maintenance setting and its Skills rule.
There is no separate curator Pause control. To change scheduled curation, use
**Bot info → Maintenance**. Pinned skills are exempt from retirement.

## In the app

BB's sidebar groups threads by project. Each Studio item's ⋯ menu, the
collection's row menu and its bulk **Move** offer **Move to** Global or a
project. The Studio panel
is the collection. Search, kind, project and tag filters, list or
grid, archive, move to project, delete, **New ▾** for any kind, and
**New thread** to start a conversation that mentions the selected items. With
Studio installed, each add-on's own collection hands over to Studio filtered
to its kind; the add-ons' sidebar rows can be hidden from Studio's ⋯ menu.
Cmd/Ctrl+Shift+K (palette: **Studio: Search everything**) opens Studio search over
any page, matching titles and content; point the user there to find an item
quickly. Cmd/Ctrl+K is BB's thread search, not Studio's.

## Item workspace

Studio opens on its Workspace. The item list shows only as its new tab page: **+**
opens it, and an item opened from it replaces it. Sidebar,
collection and search opens use the Workspace tabs for participating add-ons. No thread is required. Drag items or tabs onto a tab bar, or
to an edge to split; a tab's right-click menu offers split and move actions. Tabs and
pane sizes restore locally. Closing a tab does not delete its saved item. Conversation-side views keep their existing behavior.

### What the user has open

- `studio_workspace` lists the workspace's panes and tabs in the BB window the
  user is using, marks the tab in front of each pane and the focused pane, and
  says whether they're looking at it. Call it when they say "this", "what I'm
  looking at" or "my tabs" and no item is attached.
- `studio_open_items` opens items (the links `studio_list_items` shows) as
  tabs there and brings the workspace on screen. `placement: "right"` or
  `"down"` splits the focused pane, so a draft can sit beside what they're
  reading; `show: false` only adds the tabs.
- `studio_close_tabs` closes tabs by link. The items stay.

Open only what the user asked to see or what you made for them, and close
only tabs they asked you to close or that you opened.


### Runner machines

`runner_create` and `runner_update` accept `machine`: a host id or unique host
name, resolved and stored as a host id. Omit it (or use null) for the server.
`runner_migrate({ id, machine, confirm? })` moves an existing runner; null moves
it back to the server. Wait until its current run ends. The runner id, Bot,
schedule, automation and reports stay; the new thread receives the last 3
reports, and the old thread is archived after successful retargeting and handoff.

On a remote host Studio uses its installed `personal-workspace` environment
provider if available. Otherwise it requests that host's default working
folder (an unmanaged environment with null path). The Mac's Personal folder
never travels with the runner.

Review returned path and Mac-only-tool warnings, then retry with `confirm: true`
only after accepting them. Confirmation cannot bypass a missing CLI or sign-in.
Use Bot Info → Runners to install the provider CLI on the selected machine.
Patrick signs in directly there using the provider hint; never copy credentials.
An offline machine skips due runs without falling back to the Mac. Studio
reports once per outage, shows machine offline, and resumes when it reconnects.
