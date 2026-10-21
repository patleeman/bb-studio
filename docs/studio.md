# BB Studio

BB Studio collects every item in one searchable, tagged collection. Pages, recordings, drawings, designs and artifacts are built into Studio: they implement the shared contract in `packages/bb-studio-kit/src/contract.ts` in-process, keep `pages`, `talk`, `excalidraw`, `design` and `artifacts` as their item namespaces, and open at `/plugins/studio/studio/<segment>/<id>` (`pages`, `recordings`, `drawings`, `designs`, `artifacts`). VS Code also runs inside Studio, with the `studio-code` item namespace and `/plugins/studio/studio/workspaces/<id>` addresses. Its old URLs still resolve. Other plugins reach a built-in kind through Studio's `provider.call` (kit `callProvider`). [merging-add-ons.md](merging-add-ons.md) describes how the kinds moved in. Dashboards (`packages/bb-studio/src/dashboards`) were built in from the start: items are `dashboards:<id>` at `/plugins/studio/studio/dashboards/<id>`, with no older address.

## Provider contract

A provider registers `studio_*` RPCs with `registerStudioProvider`. Studio accepts versions 1 and 2. Version 2 describes each kind's `capabilities` (`create`, `move`, `archive`, `delete`, `rename`, `duplicate`, `export`, `comments`, `versions`, `links`) and `mentionProviderId`. The collection hides actions disabled by capabilities. For version 1, Studio infers the capabilities that the old collection offered and uses no mention provider id. A kind may set `background: true` for items kept only as a safety net, such as Talk's dictations: the collection's All view skips them, while the kind's own pill and search still find them.

A kind can set `hasOwnChat: true` when it owns its conversation UI. Studio Chat then skips automatic chat discovery for that kind, while explicit item mentions remain available. Its header can pass `chatAction` to `ItemHeader` to supply its primary Chat button, or `null` to omit one. Wrap its nav panel with `retainPanel` and render `RetainedPanels` for the same path from an `experimental_appOverlay`, so an editor stays alive when the user navigates away and back.

The shared item header keeps Chat visible in compact panes and gathers secondary controls under **Item actions**. It measures its own pane, so phone screens and narrow splits behave the same way. Closing the disclosure or widening the pane keeps its controls mounted and preserves their state. In a workspace tab row it shows only the view's own tools and status: no Chat and no Open in split, since the workspace splits tabs itself. `BarCrumb`, `BarSeparator` and `BarTitle` render nothing there, because the tab names the item and renames it (double-click, F2 or **Rename**, through the hub's `rename`); tabs refresh their titles and icons when Studio announces changes.

| Method | Input | Output |
|---|---|---|
| `studio_describe` | `null` | Plugin id, contract version, panel, kinds and their capabilities |
| `studio_list` | `null` | All items, including archived ones; optionally `truncated` |
| `studio_get` (v2) | `{ ids }` | Existing items among those ids |
| `studio_read` (v2) | `{ id, format: "markdown" \| "text" }` | Content, or `null` for a missing or unreadable item |
| `studio_search` | `{ query }` | Matching ids and optional snippets |
| `studio_create` | `{ kind, projectId }` | Created item |
| `studio_move`, `studio_archive`, `studio_delete` | Item ids and operation parameters | Per-id results |
| `studio_action` | `{ action, ids }` | Message and optional text |
| `studio_duplicate` (v2) | `{ id, projectId, includeChildren? }` | Copied item |
| `studio_template`, `studio_instantiate` (v2) | Mark an item as a template; create an item from one with `{{name}}` variables | Item |
| `studio_export` (v2) | `{ id, format }` | Files as base64 with names and MIME types |

`StudioItem` includes an opaque id, kind, title, icon, project and parent ids, created and updated times, preview, facts, badge, thumbnail URL, view URL and archive state. Clients must not parse item ids. The provider's `studio_get` retrieves one or more items without listing its collection. `studio_read` is the common content entry point for agents and indexing. Binary artifacts return `null` content.

A provider calls Studio's `studio_changed` with `{ pluginId, ids?, removed? }`. It may still send only `{ pluginId }`; that legacy event asks clients to refetch. Studio publishes the event on `studio-changed` and keeps a bounded, increasing change cursor. Clients call `changes { since }` for `{ cursor, changes, reset }`. A change has `pluginId`, `id`, `kind`, `removed` and `at`. `reset: true` means the client must fetch `overview` again, for example after a legacy notification or when its cursor is too old. The cursor lives for the server process; clients also reset when a saved cursor is ahead of the server's current cursor. For partial changes, clients call `items { pluginId, ids }` and replace only those rows.

Studio's existing `overview`, `search`, tag and bulk RPCs retain their input and output shapes. `itemAt`, tabs and tab visits use individual provider reads where an item id is available. Version 1 providers still use `studio_list` for those reads.

Tag schemas live in the kit's `studioTagSchemas`. A kind's `mentionProviderId` identifies the prefix for BB item mentions; consumers should read it from `studio_describe` instead of maintaining plugin maps.

## Replacing a built-in kind

Studio's built-in kinds are `page`, `drawing`, `recording` (with dictation),
`artifact` and `design`. A provider kind may add `replaces: "<built-in kind
id>"` to its `studio_describe` entry (optional; the kit's `StudioKind` and
schema have it). The hub discovers it over RPC like any provider.

Setup → Kinds (`src/kinds.ts`, RPCs `kinds.state` and `kinds.update` in
`src/kinds-contract.ts`) stores, in Studio's KV (`kinds:settings`), which
built-in kinds are off and an "Open and create with" choice per kind.

- **Precedence.** The user's choice (`studio` or a ready provider's plugin
  id) wins, then a single ready replacing provider, then the built-in. A
  choice whose provider is gone falls back and is kept.
- **Routing.** `routeProviders` sets `create: null` and
  `capabilities.create: false` on every candidate but the chosen one, so the
  collection's New menu, Quick open's New commands and the kit's thread
  panels offer only it. Other capabilities are unchanged: existing built-in
  items keep opening in Studio. Agents get a "BB Studio kinds" line in
  Studio's instructions naming the plugin to create new ones with.
- **Off.** The hub skips the built-in provider (`builtinOn`): no listing,
  search, `provider.call` or New entries; search drops its hits and indexes
  them again when it's back on. `agents.configure` leaves its tools and
  instructions out, from the next session start or resume (BB doesn't change
  a running session). The frontend reads `kinds.state` once per window load
  (`src/ui/kinds-snapshot.ts`): an off kind registers no thread tab or
  composer entry (recordings: none of Talk's frontend) and its reply cards
  render nothing; a kind routed to another provider drops its composer +
  entry. Those need a window reload, which Setup offers. Nothing needs
  `bb plugin reload studio`. Data, CLI commands and pending interactions stay.

```ts
kinds: [{ id: "notion-page", label: "Notion page", plural: "Notion pages", icon: "FileText", replaces: "page", create: { mode: "rpc" }, /* … */ }]
```

## Shared item services

The Studio hub stores links, item threads, activity, comments, and content versions. Add-ons call it through `studioServices(bb.sdk)` from `@bb-studio/kit/server`; `RelatedPanel` in the kit shows backlinks, outgoing links, threads, comments, and versions from item headers.

`replaceLinks` replaces one source's outgoing edges for an item. Pages sends mentions and item links. `links` returns outgoing edges and backlinks. `spawnForItem` creates and records a thread; `linkItemThread` records threads created by existing workflows, and `threadItems` lists a thread's linked items. The thread panel's Studio tab uses both: it lists the thread's items first, and links each item it creates to the thread with the `created` role. Studio also links the first accepted composer input's item refs, including multiple selected items, while keeping the composer's model and workspace choices. Studio reconciles thread states at startup and tracks lifecycle events. Pages chats and Studio Chat links are linked the same way.

`recordActivity` accepts a kit `Actor`, verb, item ref, time, and summary. `activity` reads a bounded feed, optionally filtered by item and cursor. Comments use `comments`, `commentCreate`, and `commentResolve`; Pages keeps its Yjs comments and maps them to this interface. Other item comments live in Studio. Versions use `versions`, `versionCreate`, and `versionRead`. Studio deduplicates new drawing blobs by SHA-256. Pages snapshots stay in Pages and are read through an adapter; artifact versions are read from Studio's own artifact tables.

## Search

Studio keeps an SQLite FTS index of every provider's titles and `studio_read` text, updated from the change feed; `bb studio reindex` rebuilds it. `searchAll { query, kinds?, limit }` merges that index with live BB thread search and returns ranked hits with highlighted snippets. Cmd/Ctrl+Shift+K opens it as a quick-open palette; Cmd/Ctrl+K stays BB's thread search.

Templates and bulk export are described in the [Studio README](../packages/bb-studio/README.md#templates-and-export).

## Collection and installation

`CollectionPage` in the kit renders the shared list, grid, filters, selection and action menus. VS Code workspace links now open Studio tabs; thread editors are available through the + tab menu. [Code upgrade details](upgrade-studio-code.md) include the process handover and recovery state.

`packages/bb-studio-kit` (`@bb-studio/kit`) is a source package. Each add-on depends on its packed copy, `file:../bb-studio-kit.tgz` (rebuilt by `scripts/refresh-locks.sh`), and `bb plugin build` bundles it. The kit exports `CollectionPage`, item headers and menus, directive cards, format helpers and shared UI primitives. Plugins use the kit's `bb.pluginTailwindContent` so its classes are included in their builds.

BB installs a Git plugin by cloning the repository and running `npm install --omit=dev` in the package directory. Each plugin's `package-lock.json` must therefore include the kit link. Use `scripts/refresh-locks.sh <package>` to regenerate locks in a clean clone.

## Setup

Studio's Setup page (`/plugins/studio/studio/setup`) and `bb studio setup` are the one place to set up BB Studio. `src/setup.ts` joins three things: the add-on list, BB's plugin list and the latest plugin health result.

- **Add-ons.** `src/setup-addons.ts` is a copy of `marketplace.json`'s entries, bundled so Studio needs no network call; `setup.test.ts` fails when the two drift. Each add-on is installed, not installed, turned off, needs setup (a degraded health problem) or broken (a broken one), with its health checks.
- **Actions.** Install uses `sdk.plugins.catalog.installPlan` and `catalog.install` for `<id>@bb-studio`, passing the source BB resolved as the confirmation a third-party marketplace needs. Turn on uses `sdk.plugins.enable`. Each action also shows its CLI command (`bb plugin install <id>@bb-studio --yes`, `bb plugin enable <id>`) with a Copy button, for when the call fails.
- **Retired plugins.** `studio-tables` and `emoji-react` (Studio Reactions, built into Studio as `src/reactions/`) show up when installed, with what's kept and what's deleted. Remove uses `sdk.plugins.remove` after a confirm. `emoji-react` is blocked until Studio has copied its settings (it copies them once on start, and tries again when Setup checks).

The RPCs are `setup.summary`, `setup.install`, `setup.enable` and `setup.remove` (`src/setup-contract.ts`).

Backup and restore (`bb studio backup|restore` and the Setup page) are described in [backup.md](backup.md).

## Independent workspace

Studio opens on its **Workspace** (`/plugins/studio/studio`; the old `/workspace`
address redirects), which keeps items in persistent tabs without a thread. Its new
tab page is the collection, the tab `/plugins/studio/studio/browse`, and the only
place it shows: the plus button opens it, and an item opened from it takes its
place. An empty workspace says so and offers a new tab. Old collection addresses
(`/collection`, a kind's such as `/plugins/studio/studio/page`) redirect to the
workspace and open the new tab page, filtered to the kind. Sidebar,
collection and quick-search item opens use the workspace when the add-on supports it.
Existing thread panel actions continue to open beside their conversation.

Drag a sidebar item or a tab onto a tab bar to add or move it. Drop at a pane's edge
to split left, right, above or below. The tab's right-click menu provides the same
split and move actions without dragging; separators support arrow-key resizing.
Arrow keys, Home and End select tabs, and Delete closes the focused tab. Closing a
view never deletes its item. Layout and tab selection are stored locally in the
client; the server still keeps the shared sidebar item list. Up to eight panes fit
in one workspace. Narrow screens show one pane at a time with a pane picker, keeping the desktop arrangement.

`workspace.ts` in the kit owns a versioned cross-bundle registry of editor providers
and destination elements. Each add-on's `RetainedPanels` renders through its own
React tree into the destination, preserving SDK identity and editor state. Studio
owns only the layout. Missing providers show an unavailable state. The existing
BB tab bars, thread panes and split drop targets are unchanged.

### Agents and the workspace

Each BB window's `WorkspaceBridge` reports its panes and tabs to Studio's
server (`workspaceReport`, kept in memory by `src/workspace-presence.ts`) when
they change and when the window gains or loses focus. `studio_workspace`
formats the report of the focused window, else the last to report.
`studio_open_items` and `studio_close_tabs` publish a command on the
`studio-workspace` realtime channel addressed to that window, which opens or
closes the tabs; other windows ignore it.

### Items always open as tabs

With Studio installed, the bridge watches the main view's address. A plain
item address (`/plugins/<plugin>/<panel>/<id>`) from an add-on that opens in
the workspace becomes a tab, and the address is replaced with the
workspace's, so Back doesn't return to it. A sub-view, such as a page's chat
(`/plugins/studio/studio/pages/<id>/chat/<thread>`, or the old
`/plugins/pages/pages/<id>/chat/<thread>`), keeps its own page. Item cards and
**Open in Pages** call `openAppPath`, which opens the tab directly.

## Decisions in Studio

Studio runs Jev, its fallback model and Smart Queue. Configure Decisions on Studio’s settings page (`decisions_` setting keys), or run `bb studio decisions status`, `check`, `recent`, `classify` and `fallback`. The standalone `smart-queue` plugin still suppresses Studio’s queue.

Existing installs update the `smart-decisions` bridge before Studio, then run `bb smart-decisions migrate`. The bridge copies settings, five secret keys and fallback/recent-decision KV without overwriting Studio choices. Setup permits removal after acknowledgment, but keep it for old CLI scripts. Settings and keys are server configuration and are not included in item backups.
