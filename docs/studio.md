# BB Studio

BB Studio collects the items owned by its add-ons in one searchable, tagged collection. Pages, Talk, Draw, Artifacts, Tables and Design keep their own data, item views and agent tools. Studio discovers providers through `studio_describe` and reads their items through the shared contract in `packages/bb-studio-kit/src/contract.ts`.

## Provider contract

A provider registers `studio_*` RPCs with `registerStudioProvider`. Studio accepts versions 1 and 2. Version 2 describes each kind's `capabilities` (`create`, `move`, `archive`, `delete`, `rename`, `duplicate`, `export`, `comments`, `versions`, `links`) and `mentionProviderId`. The collection hides actions disabled by capabilities. For version 1, Studio infers the capabilities that the old collection offered and uses no mention provider id. A kind may set `background: true` for items kept only as a safety net, such as Talk's dictations: the collection's All view and Studio Home skip them, while the kind's own pill and search still find them.

A kind can set `hasOwnChat: true` when it owns its conversation UI. Studio Chat then skips automatic chat discovery for that kind, while explicit item mentions remain available. Its header can pass `chatAction` to `ItemHeader` to supply its primary Chat button, or `null` to omit one. Wrap its nav panel with `retainPanel` and render `RetainedPanels` for the same path from an `experimental_appOverlay`, so an editor stays alive when the user navigates away and back.

The shared item header keeps Chat visible in compact panes and gathers secondary controls under **Item actions**. It measures its own pane, so phone screens and narrow splits behave the same way. Closing the disclosure or widening the pane keeps its controls mounted and preserves their state. Related items use a popover that stays within the viewport. Its links are ordinary Studio item and thread links: they open in the main view, or in a split with ⌘/Ctrl-click, and right-click gives the shared item menu.

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

## Shared item services

The Studio hub stores links, item threads, activity, comments, and content versions. Add-ons call it through `studioServices(bb.sdk)` from `@bb-studio/kit/server`; they remain usable when Studio is absent. `RelatedPanel` in the kit shows backlinks, outgoing links, threads, comments, and versions from item headers.

`replaceLinks` replaces one source's outgoing edges for an item. Pages sends mentions and item links. `links` returns outgoing edges and backlinks. `spawnForItem` creates and records a thread; `linkItemThread` records threads created by existing workflows, and `threadItems` lists a thread's linked items. The Pages, Drawings and Tables thread panel tabs use both: they list the thread's items first, and link each item they create to the thread with the `created` role. Studio also links the first accepted composer input's item refs, including multiple selected items, while keeping the composer's model and workspace choices. Studio reconciles thread states at startup and tracks lifecycle events. Pages chats and Studio Chat links are linked the same way.

`recordActivity` accepts a kit `Actor`, verb, item ref, time, and summary. `activity` reads a bounded feed, optionally filtered by item and cursor. Comments use `comments`, `commentCreate`, and `commentResolve`; Pages keeps its Yjs comments and maps them to this interface. Other item comments live in Studio. Versions use `versions`, `versionCreate`, and `versionRead`. Studio deduplicates new drawing blobs by SHA-256. Pages snapshots and artifact versions stay in their owner stores and are read through adapters.

## Search and Home

Studio keeps an SQLite FTS index of every provider's titles and `studio_read` text, updated from the change feed; `bb studio reindex` rebuilds it. `searchAll { query, kinds?, limit }` merges that index with live BB thread search and returns ranked hits with highlighted snippets. Cmd/Ctrl+Shift+K opens it as a quick-open palette; Cmd/Ctrl+K stays BB's thread search.

`home { projectId?, periodDays }` feeds Studio's Activity view and the iOS app's Today view. **Needs you** gathers BB approvals and questions and open comment replies and mentions, ranked by urgency. `homeRespond` answers a BB approval or question. The other sections list running threads, recent items, upcoming automations, and the activity feed.

Templates and bulk export are described in the [Studio README](../packages/bb-studio/README.md#templates-and-export).

## Collection and installation

`CollectionPage` in the kit renders the shared list, grid, filters, selection and action menus. An add-on uses `AddOnCollection` for its standalone panel and hands its collection view to Studio when Studio is available. Item views remain with their owning plugin. Studio can hide add-on sidebar entries while keeping their routes available.

`packages/bb-studio-kit` (`@bb-studio/kit`) is a source package. Each add-on depends on its packed copy, `file:../bb-studio-kit.tgz` (rebuilt by `scripts/refresh-locks.sh`), and `bb plugin build` bundles it. The kit exports `CollectionPage`, `AddOnCollection`, `AddOnPanel`, item headers and menus, directive cards, format helpers and shared UI primitives. Plugins use the kit's `bb.pluginTailwindContent` so its classes are included in their builds.

BB installs a Git plugin by cloning the repository and running `npm install --omit=dev` in the package directory. Each plugin's `package-lock.json` must therefore include the kit link. Use `scripts/refresh-locks.sh <package>` to regenerate locks in a clean clone.

## Setup

Studio's Setup page (`/plugins/studio/studio/setup`) and `bb studio setup` are the one place to set up BB Studio. `src/setup.ts` joins three things: the add-on list, BB's plugin list and the latest plugin health result.

- **Add-ons.** `src/setup-addons.ts` is a copy of `marketplace.json`'s entries, bundled so Studio needs no network call; `setup.test.ts` fails when the two drift. Each add-on is installed, not installed, turned off, needs setup (a degraded health problem) or broken (a broken one), with its health checks.
- **Actions.** Install uses `sdk.plugins.catalog.installPlan` and `catalog.install` for `<id>@bb-studio`, passing the source BB resolved as the confirmation a third-party marketplace needs. Turn on uses `sdk.plugins.enable`. Each action also shows its CLI command (`bb plugin install <id>@bb-studio --yes`, `bb plugin enable <id>`) with a Copy button, for when the call fails.
- **Retired plugins.** `studio-chat`, `studio-navigation`, `float` and `bot-teams` show up when installed, with what's kept, what's deleted and the steps first. Remove uses `sdk.plugins.remove` after a confirm. Studio Chat is blocked until its links are in Studio: the bridge (0.2.0 or later) runs its migration before answering any legacy call, so Studio calls its `viewing` method and treats an answer as a finished migration. Studio Navigation is blocked until Studio Sidebar is installed and on.

The RPCs are `setup.summary`, `setup.install`, `setup.enable` and `setup.remove` (`src/setup-contract.ts`).

Backup and restore (`bb studio backup|restore` and the Setup page) are described in [backup.md](backup.md).
