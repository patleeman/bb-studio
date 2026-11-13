---
name: studio
description: Use when the user refers to BB Studio or "my stuff" across pages, Talk recordings, drawings and artifacts — finding an item they made, "the doc about X", "that recording from Tuesday", "what's in Studio" — or asks how Studio and its add-ons (pages, recordings, drawings, designs and artifacts are built into Studio) fit together. Also load it when your instructions point here, before you write a page format (chart, embed, html block), a mini app, a ::next or ::explore line, and for your conversations, workers, the "Elsewhere" digest and archiving a conversation.
---

# Studio

BB Studio is a suite of plugins for making things with agents. **Studio** is
the core: one collection that lists every item from every installed add-on.

| Add-on | Plugin id | Items | Open with |
| --- | --- | --- | --- |
| VS Code (built into Studio) | `studio-code` | Thread workspaces | the `studio-code` skill and six `code_*` tools |
| Pages (built into Studio) | `pages` | Pages | the `pages` skill, `pages_*` tools and `bb studio pages` |
| Studio Talk | `talk` | Recordings, dictations | the `talk` skill and `bb talk` |
| Whiteboards (built into Studio, live in pages) | `excalidraw` | Whiteboards (kind `drawing`) | the `whiteboards` skill, `whiteboard_*` tools and `bb studio whiteboards` |
| Apps (built into Studio) | `artifacts`, `minis` | Saved apps (artifacts: images, HTML, reports, files) and interactive apps (mini apps) | the `artifacts` and `minis` skills and `apps_*` tools |

Items belong to a BB project or are global. Every item has a link
(`/plugins/<plugin id>/<panel>/<item id>`); put it in replies as
`[Title](link)` so the user can open it. Every Studio and BB entity also has
a `bb://<kind>/<id>` link: `bb://page/pg_…`, `bb://whiteboard/drw_…`,
`bb://design/dsn_…`, `bb://app/mini_…`,
`bb://artifact/art_…`, `bb://recording/rec_…`, `bb://conversation/thr_…`,
`bb://worker/thr_…`, `bb://bot/bot_…`, `bb://board/thr_…`,
`bb://memory/bot_…`, `bb://todos/bot_…`, `bb://archive/bot_…`,
`bb://library`, `bb://automations`, `bb://vscode`, `bb://file/<path>`,
`bb://workflow/wfr_…`. Both forms open the same way in BB: a click opens
the target beside the conversation, ⌘-click in the workbench's second pane,
Shift-click in a window of its own; a link to something deleted opens a
Not found tab.

## Finding items

- Agent tool `studio_list_items`: newest first, each with its kind and link.
  It lists this thread's project's items and global items; a `project:`
  filter or `allProjects: true` widens that. The user's Bot sees every
  project. `query` takes filters and words:
  `kind:page project:"Q4 launch" tag:draft -tag:done notes`.
  `family:page` lists every page type (docs, designs, whiteboards) and
  `family:app` every app (mini apps, artifacts); `type:design`
  lists one type.
- Apps have their own tools: `apps_list`, `apps_read` (any app by id) and
  `apps_create`; `artifacts_list|read|save` and `minis_list|read|create` are
  aliases of them. Pages, designs and whiteboards share `pages_list`,
  `pages_read` and `pages_create`. The older per-type tools still work.
  Fields are `kind:`, `project:` (a name, or `global`), `tag:` (a name, or
  `none`) and `is:archived` / `is:template`; `-` excludes, a repeated
  field matches any of its values, and the remaining words match titles and
  content. A `project:` filter replaces the default scope.
  Archived items show only with `is:archived`. Each line shows the item's
  `#tags`; an item that matched on its content has the matching text on a `>`
  line below it (`snippet` in `--json`).
- CLI: `bb studio list [query…] [--all] [--json]`, with the same query, e.g.
  `bb studio list kind:page -tag:done`;
  `bb studio tags` lists the tags and how many items each has;
  `bb studio starred` lists the user's starred items, newest-starred first
  (`is:starred` filters the list the same way).
- `bb studio auth status [--json]` lists each provider login and Account Pooler
  login and whether it is signed out; `bb studio auth login <provider-or-account>`
  prints the sign-in link and device code for the user and waits until it is
  saved. Never ask for, print or store tokens.
- `bb studio accounts [status] [--source studio|bb|local] [--json]` lists every
  Account Pooler account (BB Studio's own and bb's, labelled by source) and
  local login with status, 5h/7d and per-model quota, reset times and pinned
  threads, then the open warnings. `bb studio accounts warnings`,
  `dismiss <warning-id>`, `use-other <account>` (BB Studio's pool only) and
  `login <account>` (`--bb` is required for a bb account; only when the user
  asks) do the same as the Accounts window. bb's pool is read, never changed.
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
- The user can fork a new conversation from any message (**Fork conversation
  from here** in the message's ··· menu): a conversation of the same Bot at
  the same level, linked back to that message. The source conversation
  doesn't see what's said there. Older side threads (from **Reply in
  thread**) are conversations too. In the Bot's chat,
  `bot_threads_list` lists its threads, newest activity first: the thread id,
  the reply it's on (message id and a short quote), title, reply count and
  last activity. When the user mentions "that thread", list them, then read
  the one meant with the thread tools by its thread id (`bb thread log <id>`).
  In a thread itself the Bot can read about itself but not change itself;
  `bot_threads_list` works there too and lists its chat's threads.

Skill curation follows each Bot's Maintenance setting and its Skills rule.
There is no separate curator Pause control. To change scheduled curation, use
**Bot info → Maintenance**. Pinned skills are exempt from retirement.

## Memory

A Bot's memory is shared by all its conversations and workers:

- **Core profile**: a short page the user edits (who they are, how they
  work, hard rules, people and places, the `## Check-in` list). It is
  already in your instructions, between `<core-profile>` tags. Change it
  with `pages_edit` only when the user asks.
- **Memory records**: facts, decisions and notes, each with a topic, date
  and source. Use `memory_search { query, topic?, limit? }` before you rely
  on what you remember; `memory_add { topic, text, source? }` to save
  something new (the source defaults to this thread; a finished
  conversation's summary passes `{ kind: "conversation", id, title }`);
  `memory_update { id, text, topic? }` to correct a record: it saves a new
  record that replaces the old one, which stays as history. Don't keep facts
  on a page.
- An old Memory page that hasn't been split yet: read it with `pages_read`
  when you need it, and never edit it. Studio splits it once, on its own,
  into the core profile (the check-in list and how the user works) and
  records, and leaves the page untouched.

## Conversations and workers

You are one Bot with many conversations with the user (Main plus the
others, each with its own transcript) and workers (agents you or a
conversation started). `bot_conversations` lists them.

- **Elsewhere**: each turn in a conversation starts with a short digest of
  what your other conversations (active in the last day) and your workers
  (running, or failed or finished in the last 6 hours) are doing, newest
  first, with their thread ids. It is for you; the user doesn't see it.
  `bot_activity_lookup { threadId }` gives one of them in detail: what it is
  doing now, its latest reply, whether it needs the user, the conversation it
  works for or the workers it started, a finished conversation's summary and
  its last tool calls. Bring something from another conversation into this
  one only when it matters here.
- **Archiving a conversation**: when the user archives a conversation (Studio
  then asks you to in that conversation) or asks you to finish it, write its summary for someone who wasn't
  there, in short markdown: **Decisions** (one bullet each), **Left open**,
  **Made** (pages, designs, apps, code); leave out an empty section. Save it
  with `memory_add` (topic: the conversation's title, source `{ kind:
  "conversation", id: <this thread id>, title }`), then call
  `bot_finish_done { summary }`. Studio archives the conversation, keeps it
  findable in Search and the Library, and posts the summary to Main, where
  you answer with the card line it gives you (`::finished{thread="…"}`).
  Main and workers can't be finished. Finished conversations are kept; the
  user can reopen one.
- **Continuing a topic in a new conversation**: when a conversation (Main
  most of all) drifts into a topic of its own, propose it in one line ("Pick
  up the HUD in its own conversation?") and act only when the user agrees or
  asks. Call `conversation_continue_new { title, handoff, workCards?,
  openingMessage? }`. The handoff is short markdown for someone who wasn't
  there: **Decisions**, **Open questions**, the links and cards that matter
  (`bb://page/pg_…`, `@thread:thr_…`). It is not the transcript; no history is
  copied. `workCards` are this conversation's `wc_…` cards for the topic:
  they move to the new conversation and leave this one's In flight list.
  `openingMessage` says what the new conversation does first. Studio starts
  a conversation of the same Bot whose first message is the handoff, linked
  back to the user's last message here. Put the returned `post` text in your
  reply as given: a `::continued{to="thr_…"}` card line and a plain
  `[Continued in …](/threads/thr_…)` link under it (the phone shows
  the link; the desktop shows the card). In the new conversation, post each
  moved card's `::work{id="wc_…"}` line once in your first reply, so its In
  flight row jumps to it. The older **Fork conversation from here** copies
  the whole history; use it only when the user asks for a fork.

### Work cards

Progress on a piece of work (a worker's or lead's job, a release, a todo in
progress) goes on ONE live card, not in new status messages.

- `work_card_create { title, kind, state?, step?, line? }` (kind: worker,
  lead, release, todo, task) returns a `::work{id="wc_…"}` line. Post it once,
  on its own line, in the conversation where the user follows the work. The
  card stays where it was posted and redraws from live state; the
  conversation's In flight list above the composer has a row for it, and a
  click on the row scrolls back to the card.
- `work_card_update { id, state?, step?, line?, needs? }` changes it in place:
  state is running, waiting, needs-you, done or failed; step is short ("3/5
  Tests"); line is the latest one-liner; needs says what the user must do
  (with state needs-you). Don't post a new message for progress; update the
  card. Post a message only for a result or a question the user must read.
- Starting a worker: create its card first (kind worker, `workerThreadId`
  once you know it) and give the worker the card id, so it updates the card
  itself.
- A done or failed card leaves the In flight list a day after it finished.
- The CLI is `bb studio work <create|update|show|list>`.

## In the app

BB's sidebar groups threads by project. Each Studio item's ⋯ menu, the
collection's row menu and its bulk **Move** offer **Move to** Global or a
project. The Studio panel
is the collection. Search, kind, project and tag filters, list or
grid, archive, move to project, delete, **New ▾** for any kind, and
**New thread** to start a conversation that mentions the selected items. With
Studio installed, each add-on's own collection hands over to Studio filtered
to its kind; the add-ons' sidebar rows can be hidden from Studio's ⋯ menu.
Cmd/Ctrl+K (and the rail's Search) opens Studio's omnibar over any page: it
finds conversations and items by title and content, runs BB's and Studio's
commands, toggles Studio's settings, opens a typed URL, and asks the Bot
(Enter in the current conversation, Shift+Enter in a new one). Option+Space
opens the same omnibar from any app. Point the user there to find an item
quickly.

## Themes

Each Bot has a theme: a live shader scene behind frosted glass, or a classic
palette with solid surfaces. The user picks one in Edit space, under Appearance
(with its sliders), or switches quickly: the Theme button in the sidebar footer,
"Theme: <name>", "Next theme" and "Previous theme" in Cmd+K, Ctrl+Option+T
(Shift reverses; rebindable in Settings → Keyboard), or a right-click on a Bot's
icon → Theme.

- `theme_list` lists themes (id, kind, who made it, which Bots use it);
  `theme_list { id }` prints one package as JSON.
- `theme_create { theme }` saves a new package after every check passes:
  contrast on every surface, frame time (a GPU in an open window, else a
  static estimate), backdrop brightness and a reduced-motion still. Write it
  from the user's description, starting from the template in the tool's
  description. A failure saves nothing; fix each failed check and call again.
- `theme_update { id, theme, newId? }` merges a change and re-checks.
  Built-ins can't change; `newId` saves a copy.
- `theme_apply { themeId, bot?, intensity?, glass?, motion?, effects? }`
  puts it on a Bot (default: the Bot this thread works for); null removes it.
- `theme_delete { id }` refuses while a Bot uses the theme.

CLI: `bb studio theme list|show|create --file|update <id> --file [--new-id]|apply <id|none> [--bot]|check --file|delete|template|weather [--city <name> | --clear]` (Forest's place) `|sky [--date <yyyy-mm-dd[Thh:mm]> [--time <hh:mm>] | --clear]` (Tonight's Sky: prints the Moon, planets up, meteor showers and events for the place; `--date` previews that night in the window until `--clear`).

## Presence

A Bot's icon is its presence: a live form (orb, tesseract, knot, swarm, mobius, poly, attractor, klein, or a stored one) that shows idle, thinking, working (one satellite per running worker) and needs you.

- `presence_list { id? }` lists built-in and stored presences; with an id, a stored one's package and code.
- `presence_create { id, name, description?, code }` makes one from the user's description. `code` is plain JavaScript declaring `function draw(ctx, t, state, palette, size)`; the tool's description has the contract and a template. It runs sealed in a sandboxed worker (no network, DOM, timers, eval or classes) and is saved only when every check passes, which needs an open BB Studio window.
- `presence_update { id, name?, description?, code?, newId? }` re-checks and saves; `newId` saves a copy.
- `presence_apply { form?, bot?, color?, motion? }` puts a form on a Bot; `color` is `theme` or `#rrggbb`, `motion` 0–2.
- `presence_delete { id }` refuses while a Bot uses it.

CLI: `bb studio presence list|show <id>|template [--guide]|check --file [--code]|create --file [--code]|update <id> [--file] [--code] [--new-id]|apply <id> [--bot] [--color theme|#rrggbb] [--motion 0-2]|delete <id>`.

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

### This conversation's workbench

The workbench is the panel beside this conversation's chat. These tools act
on it while the conversation is on screen in BB; otherwise they say so and
change nothing.

- `workbench_list` shows its tabs with their keys, the selected one, the
  ones you opened, the layout, and what the user closed or changed.
- `workbench_open { type, id | path | url, line?, endLine?, pane?, index?, focus?, force? }`
  (or `{ link, pane?, … }` with any link instead of `type` and `id`: a
  `bb://<kind>/<id>` link, a BB address such as
  `/plugins/studio/studio/pages/pg_…` or `/threads/thr_…`, a card directive
  such as `::page{id="pg_…"}`, a `file:///…` URL or an http(s) URL)
  opens a conversation, worker, board (thread `id`), a page, whiteboard,
  design, app, artifact or recording (its `id`), a Bot (its `id`),
  Memory, the Library, Automations, Todos, the Archive (a Bot `id`, or none
  for the Bot on screen), one automation (`type: "automation"`, `id`
  `<botId>:<row id>`, or `bb://automation/<botId>:<row id>`), one todo
  (`type: "todo"`, its `loop_…` id, or `bb://todo/loop_…`), one memory
  record (`type: "record"`, its `mem_…` id, or `bb://record/mem_…`), VS Code, a workflow run (its `wfr_…` id), a file or
  a file's diff (`path`, full or
  relative to your working folder) or a URL (desktop app only) as a tab.
  `pane` is 1, 2 or `"new"` (a second pane on the right), or `"window"`
  for a window of its own, out of the workbench; `index` is its place in
  that pane's tab strip. `focus: false` opens it behind the selected tab.
- `workbench_pop_out { key }` opens an open tab in a window of its own; the
  window's Return to workbench puts it back. Pages, whiteboards, designs,
  apps, conversations, other plugin tabs and files pop out; terminals,
  browser tabs, Info, Diff, New Tab and fixed tabs don't. Use a window only
  when the user asks for one.
- `workbench_close { key }` and `workbench_focus { key }` take keys from
  `workbench_list`; keys change when a tab is reopened.
- `workbench_arrange { layout?, widthPercent?, panes?, paneWidths? }`:
  `side by side`, `panel only` or `conversation only`; the panel's width, 20
  to 80 percent; one or two panes; their widths as a ratio, such as `[2, 1]`.
  The workbench has at most two panes, side by side, and the conversation
  stays on the left; `stacked` isn't available.

While the user types in the panel, opens go behind the selected tab (marked
new), and focusing another tab or closing the panel is refused. What the
user closed or moved after you opened it stays closed, and a layout setting
they changed stays theirs. Pass `force: true` only when the user asks you to
override that.


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

## Agent guide

Your instructions carry one-line pointers to these; the full rules are here.

### Pages

BB Pages are collaborative documents the user edits live. Read a page with
`pages_read` before changing it; it returns Markdown with a `<!-- ^id -->`
marker on the line before each block, naming the block below it.

Edit with `pages_edit` using small, targeted operations that reference those
block ids, so you don't overwrite the user's concurrent typing. Use
replace_all only when asked to rewrite a whole page.

Pages Markdown supports GFM plus: ```chart / ```stats / ```embed fenced JSON
blocks, ```mermaid diagrams, ```html blocks, `> [!NOTE]` callouts (NOTE, TIP,
WARNING, CAUTION, IMPORTANT), `<details><summary>Title</summary>` …
`</details>` toggles (a `## ` summary makes a toggle heading), and mentions
like `@[Title](page:pg_id)`, `@[Title](item:plugin:id)`,
`@[2026-10-01](date:2026-10-01)`.

- Chart JSON: `{"type":"bar|line|area|pie","title":"…","x":"label","series":["Revenue"],"unit":"$","data":[{"label":"Q1","Revenue":10}]}`.
- Stats JSON: `[{"label":"ARR","value":"$1.2M","delta":"+8%","trend":"up"}]` (1–6 items).
- Embed JSON: `{"kind":"bookmark|thread|page|drawing|artifact|recording|mini|table|item","target":"https://… or an id","title":"…"}`;
  item targets are `plugin:id` from `studio_list_items`; a table target may
  be `<table id>/view/<view id>`; a drawing (whiteboard) embed may set
  `"height"` in pixels (160–1200).

An ```html block renders its HTML in a sandboxed iframe: scripts run, but
with no same-origin access (no cookies, storage or BB APIs), and don't assume
network access. Keep it self-contained with inline `<style>` and `<script>`,
follow light and dark with `prefers-color-scheme`, and keep it under 200,000
characters (longer ones show as code). Use ```html only for something to
render; show HTML source as code with ```html source (or another language
such as ```xml).

Answer comments with pages_comment_reply in the same thread; start new
threads with `pages_comment` on the text you are discussing.

When you create or change a page, put its card on its own line in your
reply, `::page{id="pg_…"}`, so the user can open it beside the chat.

### Apps

An app is a saved output or an interactive tool with its own data. Studio
shows both as one kind, Apps; each keeps its own id prefix and tools.

- A saved app (an artifact, `art_…`) is a finished file the user keeps: an
  image, an HTML page, a report, a data file. Save one with `apps_create`
  (type `"artifact"`); the `artifacts` skill has the details.
- An interactive app (a mini app, `mini_…`) is React (JSX) with Studio Kit
  components and Tailwind classes; records, state and approved network come
  from `window.playground` (Kit hooks wrap them). The `minis` skill has the
  full reference.

When the user wants something to interact with (a tracker, board,
calculator, form, poll, small tool or a visualization to play with), or data
they'll come back to, make an interactive app with `apps_create` (type
`"mini"`), rather than a playground or a one-off HTML file. Find apps with
`apps_list` and read any one with `apps_read`. Change an interactive app with
`minis_update` (it compiles before saving), its data with `minis_data`, and
drive an open copy with `minis_live`.

Show an app with the card line the tool's result gives, on its own line in
your reply: `::mini{id="mini_…"}` for an interactive app and
`::artifact{id="art_…"}` for a saved one. When your instructions say
`::app{id="…"}` (Studio's App cards setting is on), write that for both.
Embed one in a page with an embed block `{"kind":"mini","target":"mini_…"}`
or `{"kind":"artifact","target":"art_…"}`.

### The Next row

When the Next row is on (your instructions say so, and which attributes),
end a reply with one line that offers the user's likely next steps, when
there are any:

```
::next{reply="👍 Ship it|🧪 Add tests first" btw="🐛 I noticed the new endpoint retries without waiting between tries. If the server is down, it will get hammered." do="📄 Write up the migration plan as a page"}
```

Every attribute is optional; leave out the ones with nothing worth offering,
and leave out the whole line when nothing is. Items are separated by |. Each
is one emoji, a space, and its text. Never put a straight double quote (")
or | inside an item, not even to quote a word: one stray " breaks the whole line and the user sees raw text instead of buttons. Quote with ‘single’ or
“curly” quotes instead.

- `reply`: only when your reply asks the user to decide, choose, approve or
  answer. 2 to 5 quick answers of at most 5 words; each must make sense as
  the user's whole reply. Prefer the quick replies your instructions list
  when they fit; write specific ones when your reply offers distinct
  options. Leave it out when your instructions say quick replies are off.
- `btw`: only when your answer involved reading code, and only when your
  instructions list it. 1 to 3 things you noticed along the way but didn't
  cover, told to the user the way a colleague would mention them in passing.
  Write each in plain English as one or two short sentences: start with "I
  noticed", say what you saw in words someone who hasn't read the code
  understands (no function, file or package names), then what it means for
  them, such as "If you fix a bug in one, the other keeps it." Under 40
  words. Emoji: 🐛 looks broken or risky (these get a Fix this button), 🏗️
  something the work rests on, 🔗 connected code that matters here, 🕐
  changed recently.
- `do`: 1 to 3 concrete actions you could take next for the user, phrased
  as the instruction they'd give you, such as "📄 Write this up as a page",
  "🧵 Start a thread to fix the retry bug" or "📌 Add the decision to the
  Space brief". Clicking one drafts it for the user to send. Offer only what
  you can actually do, and never the step you just asked about in reply.

Put the line last, on its own line, never inside a code block. Don't also write ::reactions or ::explore lines.

### Explore

When Explore is on and the Next row is off: when your answer involved
reading code and you noticed things along the way that are genuinely worth a
closer look, end your message with one line listing them:

```
::explore{items="🐛 Retry backoff disagrees in billing|🏗️ How the job queue works"}
```

Rules: 1 to 4 items separated by |. Each item is one emoji, a space, and a
specific label of at most 8 words that says what the user would find, such
as "Cache keys ignore the tenant id", never "Learn more about caching". Pick
things you saw but didn't cover in your answer: files you read but didn't
cite, suspicious code, the subsystem everything here rests on, or recent
changes. Emoji: 🐛 suspicious or likely buggy, 🏗️ foundational subsystem, 🔗
connected code the answer depends on, 🕐 recently changed. Leave the line out
when nothing is worth it; never pad it. Don't use double quotes or | inside
a label. Put it on its own line, never inside a code block. Make it the last
line. Clicking an item asks you about it in the thread.

### Kinds

The user picks, in Setup → Kinds, which kinds Studio makes and who makes
new ones. Your instructions end with one line when that differs from the
default: a kind that is off (don't offer to make it), or a kind another
plugin makes (create new ones with that plugin's tools, not Studio's; items
of that kind already in Studio still open and edit in Studio).
