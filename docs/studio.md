# BB Studio

BB Studio collects the items owned by its add-ons in one searchable, tagged collection. Pages, Talk, Draw, Artifacts, Tasks and Teams keep their own data, item views and agent tools. Studio discovers providers through `studio_describe` and reads their items through the shared contract in `packages/bb-studio-kit/src/contract.ts`.

## Provider contract

A provider registers `studio_*` RPCs with `registerStudioProvider`. Studio accepts versions 1 and 2. Version 2 describes each kind's `capabilities` (`create`, `move`, `archive`, `delete`, `rename`, `duplicate`, `export`, `comments`, `versions`, `links`) and `mentionProviderId`. The collection hides actions disabled by capabilities. For version 1, Studio infers the capabilities that the old collection offered and uses no mention provider id.

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

`StudioItem` includes an opaque id, kind, title, icon, project and parent ids, created and updated times, preview, facts, badge, thumbnail URL, view URL and archive state. Clients must not parse item ids. The provider's `studio_get` retrieves one or more items without listing its collection. `studio_read` is the common content entry point for agents and indexing. Binary artifacts return `null` content.

A provider calls Studio's `studio_changed` with `{ pluginId, ids?, removed? }`. It may still send only `{ pluginId }`; that legacy event asks clients to refetch. Studio publishes the event on `studio-changed` and keeps a bounded, increasing change cursor. Clients call `changes { since }` for `{ cursor, changes, reset }`. A change has `pluginId`, `id`, `kind`, `removed` and `at`. `reset: true` means the client must fetch `overview` again, for example after a legacy notification or when its cursor is too old. The cursor lives for the server process; clients also reset when a saved cursor is ahead of the server's current cursor. For partial changes, clients call `items { pluginId, ids }` and replace only those rows.

Studio's existing `overview`, `search`, tag and bulk RPCs retain their input and output shapes. `itemAt`, tabs and tab visits use individual provider reads where an item id is available. Version 1 providers still use `studio_list` for those reads.

Tag schemas live in the kit's `studioTagSchemas`. A kind's `mentionProviderId` identifies the prefix for BB item mentions; consumers should read it from `studio_describe` instead of maintaining plugin maps.

## Collection and installation

`CollectionPage` in the kit renders the shared list, grid, filters, selection and action menus. An add-on uses `AddOnCollection` for its standalone panel and hands its collection view to Studio when Studio is available. Item views remain with their owning plugin. Studio can hide add-on sidebar entries while keeping their routes available.

`packages/bb-studio-kit` (`@bb-studio/kit`) is a source package. Each add-on depends on it as `file:../bb-studio-kit`, and `bb plugin build` bundles it. The kit exports `CollectionPage`, `AddOnCollection`, `AddOnPanel`, item headers and menus, directive cards, format helpers and shared UI primitives. Plugins use the kit's `bb.pluginTailwindContent` so its classes are included in their builds.

BB installs a Git plugin by cloning the repository and running `npm install --omit=dev` in the package directory. Each plugin's `package-lock.json` must therefore include the kit link. Use `scripts/refresh-locks.sh <package>` to regenerate locks in a clean clone.
