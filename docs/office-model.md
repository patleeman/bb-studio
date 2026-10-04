# The office model

Source of truth for the BB Studio restructure. Design page: `pg_868e3a6b62fbc24e`
("The office model: one design for BB Studio"). Prototype artifact:
`art_18339e42b10ad91a`. When this doc and code disagree, this doc wins; when this
doc is unclear, ask the coordinator thread instead of guessing.

## The idea

You work with a team of bots, and BB Studio is your office.

- **My work**: what I do hands-on, in threads and artifacts, filed in projects.
- **My team**: bots I delegate to. They work on their own and report back.
- **Talk**: DMs and channels, one concept.
- **Inbox**: requests and reports that need me.
- **Space**: the office that holds all of the above, like a Notion workspace.

## Concepts

| Concept | Definition | Backed by |
|---|---|---|
| Space | Root container: work, team, talk, inbox, settings | Studio `spaces` (promoted from tag) |
| Folder | Top-level grouping in a Space. Always a core BB project, with or without a repo | Core `projects` + `space_projects` |
| Item | My work: threads plus artifacts (page, board, table, drawing, recording, artifact). Author is me or a bot | Core threads + Studio providers |
| Bot | Teammate in exactly one Space: role, memory, model, trust level | Teams `bots` |
| Task | Delegation to a bot, one-off or recurring | Tasks `tasks` with a bot assignee |
| Conversation | Talk. One bot = DM, several = channel | Teams `thread_views`, renamed |
| Event | Request, report or comment, addressed to me | Inbox read model |
| Inbox | Per Space, plus an All spaces view | Studio core |

## Rules

1. Plugins add types, never places. No plugin adds a nav row.
2. A face is someone, a row is something. Bots render only as round faces; chats always have topic titles.
3. A bot's own threads never appear in my sidebar. They live under the bot's task.
4. A bot asks before acting outside its trust level. Those asks become Inbox requests.
5. Delegated work returns to the folder it came from, authored by the bot.

## Packaging: 17 plugins become 6

Separate only if heavy, swappable, or useful without Studio.

| Plugin id | Package | Contents |
|---|---|---|
| `studio` | `packages/bb-studio` | Core. Absorbs `thread-list-plus` (Sidebar), `studio-navigation`, `feed`, `bot-teams`, `studio-tasks`, `artifacts`, `studio-chat`, `studio-tables`, `talk`, `smart-decisions` |
| `pages` | `packages/bb-studio-pages` | Pages, plus Explore folded in as a setting (absorbs `explore`) |
| `excalidraw` | `packages/bb-studio-draw` | Drawings |
| `float` | `packages/bb-studio-float` | Float panel |
| `emoji-react` | `packages/bb-studio-reactions` | Reactions, unchanged |
| `mobile` | `packages/bb-studio-mobile` | Push relay, unchanged |

### Module layout inside core

```
packages/bb-studio/
  server.ts            registers every module's server part, in order
  app.tsx              registers every module's app part
  src/modules/<name>/  one folder per absorbed plugin: server/, app/, migrations, tests
  src/office/          new office model: spaces root, inbox, talk, delegation
  src/ui/office/       new UI (owned by the design thread; do not edit)
```

Each module exports `registerServer(ctx)` and `registerApp(app)`. Modules call each
other through in-process service objects, not plugin RPC.

### Compatibility decision (stable SDK 0.5.29 has no plugin-id aliases)

A plugin gets one CLI namespace, and routes and mention resolution are scoped to
the owning plugin, so core cannot answer for old plugin ids. Decision: **no shim
plugins.** Keep what the SDK allows, migrate what we own, and accept the rest:

- **Kept**: agent tool names and schemas (they are plain strings), message
  directives, all data.
- **Migrated**: every stored ref and href Studio-side code owns is rewritten
  once from the old plugin id to `studio` (`item:artifacts:art_…` →
  `item:studio:art_…`, `/plugins/artifacts/artifacts/…` →
  `/plugins/studio/…`). This covers Studio links, comments, activity, feed
  posts, task links, Teams data, and Pages markdown (the pages plugin runs the
  same rewrite in its own migration). Idempotent, logged, counted.
- **Moved**: CLI commands move under `bb studio <old-id> …` (for example
  `bb studio feed post`). Update every skill, agent instruction string, README
  and doc that names an old command in the same change.
- **Accepted loss**: refs and links inside past BB thread transcripts (core
  data) and external bookmarks stop resolving. Studio's own resolver
  (`parseItemReference`, quick open, search) still accepts old prefixes so a
  pasted old ref works inside Studio.

The rules below apply with these exceptions.

### Compatibility rules (must hold for every merge step)

- **Data**: each module keeps its own SQLite file inside core's data dir
  (`<studio data dir>/<module>.db`). On first start, if the old plugin's
  `~/.bb/plugins/<old-id>/data.db` exists and the module file does not, copy it
  (plus `-wal`/`-shm` after a checkpoint) and record the import in a
  `module_imports` table. Never delete the old file; a later cleanup step does.
  Also import the old plugin's settings (`plugin_settings`) and `plugin_kv`.
- **Item refs**: refs like `artifacts:art_…`, `studio-tasks:tsk_…`,
  `bot-teams:bot_…`, `studio-tables:tbl_…`, `talk:rec_…` already exist in pages,
  links, feed posts and chat history. Core must keep resolving every legacy
  `<old-plugin-id>:` prefix. `mentionProviderId` stays the old id per kind.
- **Agent tools**: keep every tool name (`artifacts_save`, `tasks_create`,
  `feed_post`, `tables_*`, `talk_*`, `bots_*`, …) byte-identical, including
  input schemas. Agents and skills depend on them.
- **CLI**: keep every `bb <old-id> …` command working, as an alias if the CLI
  namespace must move.
- **Routes**: old plugin routes (`/plugins/artifacts/artifacts/<id>`,
  `/plugins/feed/…`, `/plugins/bot-teams/…`) must redirect to the core route.
- **Message directives** (`::artifact`, `::task`, `::post`, …) keep rendering.
- **iOS**: regenerate `contracts/` and update `apps/ios` call sites in the same
  change as any RPC move. `pnpm check:contracts` and the native RPC inventory
  must pass.
- **Install**: after the merge, installing `studio` alone gives the full core.
  Installing an old id from the marketplace must not be possible
  (remove entries from `marketplace.json` and `.bb/plugins.json`). On first
  start, core detects old plugins still installed and shows one notice telling
  the user to uninstall them (core must not double-register their tools while
  they're installed: if an old plugin is still running, skip registering that
  module's tools and log once).

## Data model changes

### Space is the root

- New table `space_projects(project_id TEXT PRIMARY KEY, space_id TEXT NOT NULL, sort_key TEXT, created_at)`.
  Every core project belongs to exactly one Space.
- One Space is the default (`spaces.is_default = 1`), named "Personal". It owns
  `proj_personal` and every project with no row. Create it on migration.
- **A thing's Space is its project's Space.** Items, bots, threads, tasks, feed
  posts and conversations all have a project id; derive the Space from it. Do
  not add `space_id` columns to module tables. Things with no project belong
  to the default Space.
- Migrate tag membership: a `bb-project:<id>` member becomes a
  `space_projects` row (first space wins; log conflicts). Item and thread
  members that don't match their project's Space become a plain tag named
  after the old space, so nothing is lost. Then drop the space-as-tag
  membership path, the `space` Studio kind and `item_space_inheritance`.
- Each Space has a catch-all folder: the default Space uses `proj_personal`;
  a new Space creates a plain-folder project at creation.
- **Folders** are core projects. A plain folder (no repo) is a standard project
  rooted at `~/Spaces/<space-slug>/<folder-slug>` (create the directory).
  Its threads run in that directory, like a project checkout: the folder is
  the shared workspace. No environment provider override is needed. Creating a folder
  = `bb project create` + `space_projects` row in one RPC. Deleting archives.
- Space settings (new `space_settings(space_id, key, value)`): enabled item
  kinds, default trust level, default bot model. Model/provider defaults for
  threads stay on core `project_execution_defaults`.
- RPCs: `spaces_list`, `space_create`, `space_update`, `space_delete`
  (refuses non-empty), `space_move_project`, `space_settings_get/set`,
  `folder_create`, `folder_archive`, `space_tree { spaceId }` (folders with
  their threads and items, bot-authored items carry `authorBotId`).

### Inbox

- One read model over every source, each event carrying `spaceId`:
  core `pending_interactions` (approvals, questions), Teams attention
  (decision/blocker/update), Pages `requests`, Teams `bot_create_requests`,
  feed posts (as reports), tasks in review, comments that mention me or reply
  to me.
- Event shape: `{ key, spaceId, type: "request" | "report" | "comment", source,
  botId?, threadId?, item?, title, body, actions?: {id,label,primary?}[],
  createdAt, readAt?, doneAt? }`. `key` is stable per source record.
- Local state table `inbox_state(key PRIMARY KEY, read_at, done_at)`.
- RPCs: `inbox_list { spaceId | "all", type? , cursor? }`,
  `inbox_counts { }` (per Space: requests, unread reports), `inbox_act { key, actionId, text? }`
  (routes to the owning source: approve/deny an interaction, answer a question,
  resolve attention, accept a request), `inbox_done { keys }`, `inbox_read { keys }`.
- Push: requests notify by default; reports don't unless the post is `urgent`.
  The mobile plugin reads `inbox_counts` and `inbox_list`.
- `feed_post` keeps its name and schema. Posts become `report` events; a
  `story` groups updates into one event that shows the latest update.
- Existing `home`/`needs-you.ts` is replaced by the Inbox model plus a
  `home { spaceId }` RPC returning `{ needsYou, working, reports, recent }`.

### Team and delegation

- Teams `bots`: add `trust` (`read_only` | `ask` | `act`), default `ask`.
  `read_only` → permission mode that blocks writes; `ask` → every write-class
  action outside the bot's home becomes an Inbox request; `act` → current
  behavior. Map onto the existing `permissionMode` where possible.
- A bot belongs to its project's Space. "Global" bots move to the default Space.
- A task with a bot assignee is a delegation. Assigning starts the bot on it
  (existing `task_handoffs` path). The task records `threadId`, status
  (`working` | `waiting` | `review` | `done`), a progress note, and output items.
  When the bot finishes, it posts a report event and links outputs to the
  task's folder.
- Missions become recurring tasks: each bot's `intervalMinutes` + `MISSION.md`
  becomes one recurring task "Standing duty" on that bot with the same schedule.
  Automations that target a bot or channel become recurring tasks backed by the
  automations plugin. Keep the engines; change what the user sees.
- RPCs: `delegate { botId, brief, context?: itemRef[], folderId?, schedule? }`
  → task; `team_list { spaceId }` → bots with `{ state: idle|working|needs_you,
  activeTaskCount }`; `bot_desk { botId }` → profile, tasks, DM conversation id.
- Rename Teams `conversations` (bot↔thread profile links) to `bot_threads`.

### Talk

- Teams `thread_views` become **conversations** (rename tables and code; keep a
  migration). A DM is a conversation whose only bot member is that bot;
  `talk_dm { botId }` returns or creates it.
- Finish `view-migration.ts`, then drop `rooms`, `room_messages`, `room_runs`,
  `delegations`, `channel_attention` (after its rows are in the Inbox model).
- Remove the `view` Studio kind and the `channels` / `former-views` nav rows.

### Removals

- Studio Sidebar's "Background" heuristic: bot- and automation-started threads
  are shown under their task, never in the sidebar.
- The `bot` and `view` and `space` Studio kinds leave the work collection.
- Nav rows contributed by Studio plugins: all removed. The new sidebar is the
  only entry point.
- Studio sidebar tabs (`tabs` table): removed; Favorites replace them.

## UI (owned by the design thread)

The coordinator thread builds all UI in `src/ui/office/` and the iOS SwiftUI
views. Backend workers expose RPCs and keep old UI compiling until the new UI
replaces it; don't redesign screens. The new sidebar contains, in order: Space
switcher (All-spaces Inbox, spaces with request counts, New space, settings),
Home, Inbox, Search, New thread, Team (faces + conversations), Favorites,
Folders (threads and items mixed, sorted by recent).

## iOS

The app follows the same model: tabs **Inbox** (All spaces by default), **Home**
(current Space), **Work** (folders), **Team** (faces, conversations). Backend
workers update the API client, models and contract fixtures; the design thread
builds the screens.

## Build order and ownership

| Stage | Work | Owner |
|---|---|---|
| 1 | Module skeleton in core; fold in tables + chat as the pattern; import + alias mechanisms | Codex: consolidation |
| 2 | Fold in feed, artifacts, tasks, talk, decisions, teams, sidebar, navigation; Explore into Pages; marketplace to 6 | Codex: consolidation |
| 3 | Space root, folders, space settings | Codex: office backend |
| 4 | Inbox model, home RPC, push via mobile plugin | Codex: office backend |
| 5 | Talk rename, DMs, delete rooms | Codex: office backend |
| 6 | Delegation, trust levels, missions to recurring tasks | Codex: office backend |
| 7 | New sidebar, Home, Inbox, bot desk, Talk, delegate dialog, settings | Design thread |
| 8 | iOS client models and API, then screens | Codex: iOS / Design thread |
| 9 | Staged captures, docs, READMEs, cleanup of old data dirs (backup first) | Codex: QA |

## Definition of done

- `pnpm check` passes. `pnpm check:compat` passes against stable BB.
- Staged BB (`node scripts/staged-bb.mjs start`) installs the 6 plugins from a
  pushed commit; existing data from the 17-plugin layout migrates with no loss
  (items, links, comments, bots, channels, tasks, feed posts all present).
- Every legacy ref, tool, CLI command, route and directive in "Compatibility
  rules" works.
- iOS builds, its tests pass, and it shows Inbox (All spaces), Home, Work and
  Team against the staged server.
- READMEs and staged previews updated for the 6 plugins.
