# Studio

> **Studio** is the core of **BB Studio**, a suite of plugins for writing, talking, drawing, and keeping what your agents make. See the [suite overview](../../README.md).

Studio opens on the collection: everything the Studio add-ons make, including pages, Talk
recordings and dictations, drawings, and saved artifacts. Search across all of them, filter by
kind, project and tag, and hand any of them to an agent. Spaces gather projects and
threads into one place, each with an optional lead thread.

## Staged preview

![Live BB screenshot of the Studio collection](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): the Studio
collection as a list, with search and compact Space and Kind menus above it.
Project, Tags and Status are available under **More filters**. The rows show
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

![Live BB screenshot of the Studio sidebar plus menu](assets/sidebar-new-menu.png)

The **+** beside Studio opens a menu of the installed add-ons' creation actions.
The staged capture checks keyboard opening, creates a page in the open thread's
project, and checks that the plus stays visible while its menu is open.

![Live BB screenshot of Studio search](assets/search.png)

Studio search (Cmd/Ctrl+Shift+K) over the same staged project, searching
"offline sync": an HTML artifact and two pages match on their title or
content, each showing the matching text with the match in bold.

## What you get

Everything opens in BB's main view, and the Studio sidebar lists what you
open. ⌘/Ctrl-click an item or thread link, or choose **Open in split** from
its menu, to open it in a split instead. Right-click any Studio item or
thread link, anywhere, for **Open**, **Open in split**, **Copy reference**
(**Copy link** for a thread) and **New thread with this**. Item, collection and
Activity headers have an **Open in split** button. An editor you leave stays
open in the background, so it's as you left it when you come back.

- **Activity** (Studio's **…** menu) shows measured thread turns, duration and
  failures and recent Studio changes.
  Choose 1, 7 or 30 days. The `home` RPC returns this data, plus what needs
  you (pending approvals and questions, and unresolved comment replies or
  mentions), active threads, recent items and today's automations,
  for other clients such as the iOS app's Today view.
- **One collection** (sidebar → Studio): every add-on's items in one list,
  with search over titles and content, filters by kind, project, space and
  tag, and an Archived view. **Display** groups the list by kind, project,
  space or tag (collapsible, and an item in two spaces shows in both) and
  sorts it by name, kind, project, created or last activity, either way; both
  choices are remembered. The column you group by drops out, and a Spaces
  column appears once items belong to spaces. Drawings show thumbnails;
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
- **Spaces are meta-projects.** Each BB project belongs to one space, and
  items and threads follow their project; projects nobody filed, and items
  with no project, are in the default space, Personal. A new space gets its
  own catch-all project under `~/Spaces`, where its new threads and items go.
  A thread can also be added to a space by itself, which moves it there.
  A space can have a lead: one of its threads, which a Heartbeat wakes on a
  schedule (see [`docs/spaces.md`](../../docs/spaces.md)). Nothing is made
  for a space but its folder. Deleting a space hands its projects and threads
  back to Personal.
- **Shared actions**: select items (shift-click for a range) to start a
  **New thread** that mentions them, move them to a project, archive, or
  delete. Actions an add-on defines, like Talk's "Copy transcripts" or Draw's
  "Copy text", appear when the selection is all that kind.
- **Tabs in the sidebar.** With [Studio Sidebar](../bb-studio-sidebar)
  as the thread list, each Studio item you open gets a tab in a Studio section
  above your threads. × or middle-click closes a tab; closing the one on
  screen opens the next. The section's ⋯ menu groups tabs by app, sorts them,
  and closes other or all tabs. Studio keeps the tabs, so every window shows
  the same ones, and closes tabs of deleted items.
- **New ▾** creates any kind an installed add-on offers, in the current
  project. It always opens the full menu, even with a kind filter active.
- **Takes over from the add-ons.** With Studio installed, each add-on's own
  collection hands over to Studio filtered to its kind, and item pages lead
  back to Studio. Studio's ⋯ menu can hide the add-ons' sidebar rows, so
  Studio is the only entry. Without Studio, each add-on works on its own.
- **The BB Studio theme**: the app icon's colors for all of BB, light and
  dark. Teal-black and pale-teal surfaces, a coral accent, teal file paths.
  Pick **BB Studio** in Settings → Appearance, or run `bb theme set
  plugin:studio:bb-studio`.
- **Short thread titles.** BB titles a thread once, from the start of its
  first message. Studio renames new threads in 2–5 words after their first
  turn, such as "Invoice PDF pagination bug", and again as the conversation
  moves on (after 2, 4 and 8 requests, then every 8). The model sees the
  first request, the latest ones and the agent's latest reply, and keeps the
  current title while it still fits. A title you set, or one a thread was
  spawned with, is never changed. Older threads keep their titles until you
  run `bb studio retitle`. Turn it off with **Short thread titles** in
  Studio's settings. Titles come from the fallback model in Studio Decisions.
- **For agents**: the `studio_list_items`, `studio_list_spaces`,
  `studio_tag_items`, `studio_delete_items`, `studio_space_items` and
  `studio_move_items` tools, the `bb studio` CLI, and a `studio` skill.

```sh
bb studio list [query…] [--all] [--kind <kind>] [--query <text>] [--tag <tag>] [--space <name>] [--json]
bb studio tags
bb studio spaces
bb studio move <item-link|plugin:id|thread-id>… (--space <name|id> | --project <name|id|global>)
bb studio providers
bb studio health [--json]
bb studio reindex
bb studio retitle (<thread-id>… | --self | --recent <count>)
```

## How it works

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
- Studio stores tags, open tabs, saved views and spaces itself, keyed by
  `<plugin id>:<item id>` where items are involved, so add-ons don't need to
  know about them. Tags on items an add-on no longer lists are
  dropped. Each add-on owns its data, editors, tools, CLI and mentions.

See [`docs/studio.md`](../../docs/studio.md) for the design.

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
**Open plugin setup** goes to the full list at `/plugins/studio/studio/setup`,
which includes hidden problems, plugins whose check didn't answer, and what
passed. `bb studio health` prints the same list and exits 1 when a problem
isn't hidden.

![The Plugin health card open above the sidebar footer on staged stable BB, showing that Studio Decisions has no Jev provider set up, with Add a key, Turn off plugin and Hide](assets/plugin-health.png)

![Studio's Plugin setup page on the same staged BB, listing the Studio Decisions problem and when Studio last checked](assets/plugin-setup.png)

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

## Space Command view

Open **Command view** from a Space’s sidebar heading. It shows the Space’s ordinary threads as native transcripts. With nothing opened, one pane follows whichever thread is working. Open another thread from the list beside the composer, where a check marks each open thread, and it joins as a pane, so the view becomes a grid you can rearrange. Closing a pane only hides it: open it again from the list, or choose **Follow work** (⚡ in the bar) to go back to one following pane. Panes open on the newest message and keep up as the thread streams. Working panes glow blue with a moving bar, idle ones dim, and a thread with something new since you last read it gets a pulsing orange ring and a **New** badge until you click into its pane. Press **⌘N** or **+** to start a thread right in the grid: a New thread pane opens with BB’s composer and the Space’s project picked, and once you send, the thread joins the Space and takes the pane’s place. Each thread has a one-letter alias, shown on its pane and in the list: type **@b** to address thread B, or @mention threads by title, or use @all. A thread keeps its letter as long as it’s in the Space, even when it isn’t shown, and a letter left by a thread that moved out isn’t handed to another thread until the rest of the alphabet is taken. “To” follows whoever the draft addresses, including a draft restored when the view opens. With nobody addressed, a message goes to the lead, or to the thread you picked with its ↩ or whose message you acted on, such as a suggested reaction. Clicking into a pane to read it doesn't change “To”. The lead forwards it if it’s clearly meant for another thread. Attached files and images reach every recipient, whatever its project; files sent to the lead are also copied to every thread it may forward to, but pasted images can’t be forwarded, so the lead asks you to send those to the thread yourself. If a send reaches some threads but not others, the draft stays and “To” becomes **Retry to** the ones it missed, so sending again doesn’t repeat it to the rest. Files, drafts, permissions and send modes use BB’s composer.

![One pane following the Space's working thread, with the thread list beside the composer](assets/command-follow.png)

Captured in staged stable BB with the Launch work Space, ordinary Atlas and Scribe threads, and deterministic ORBIT-42 replies. Live assertions check thread membership, recipient selection, the breadcrumb, typed mention searches, draft retention, reactions, following a working thread, opening, closing and rearranging panes, starting a thread in a pane through to joining the Space, unread threads and reading them, the thread list beside the composer, and desktop and phone layouts. The fixture puts its standing instructions in agent-only context, so native transcripts show the conversation.

![Three threads open side by side](assets/command-grid.png)

![One thread on a phone, with the thread chips above the composer](assets/command-follow-mobile.png)

The same run checks [the overview](assets/command.png), [rearranging panes](assets/command-grid-arrange.png), [closing and reopening a pane](assets/command-close.png), [starting a thread in a pane](assets/command-new-thread.png), [sending an image by alias](assets/command-attach.png), and [the grid on a phone](assets/command-grid-mobile.png).

## Item chat

Studio owns each item's **Chat** action, conversation picker, linked thread and
quotes. **Chat** opens the item's linked thread in the main view. Without one,
a compact new-conversation composer opens in the bottom-right corner, and
sending opens the new thread in the main view. A new conversation keeps the
item's context, project and draft; a quote goes to its linked thread, or opens
the corner composer with the quote when there is none. Pages keeps its
page-chat history; standalone Pages still provides its own chat when Studio is
absent.

Existing Studio Chat installs must [migrate their links](../bb-studio-chat/README.md)
before removing the old plugin. Old draft keys and quote storage are retained.

![Studio item chat with a staged drawing and its draft](assets/chat-preview.png)
