# Office tabs: the Arc-style sidebar

Status: building. Prototype: thread storage `reports/arc-prototype.html` (thr_hzjd32mmb6).

## The model

Everything you can open is a **tab target**, named by a `ref`. A tab is one open
target in the sidebar. The sidebar of a Space has three zones, top to bottom:

| Zone | What it is | Leaves it how |
|---|---|---|
| **Essentials** | Up to 8 big tiles (Inbox, favorite bots, …). Never auto-archive. | Right-click → Remove from Essentials |
| **Pinned** | Tabs and folders of tabs you keep. Never auto-archive. | Right-click → Unpin (goes to Today) |
| **Today** | Everything else you opened. Newest first. | × or Archive, or auto-archive after the Space's `todayArchiveAfter` |

Archived tabs are not deleted. They are searchable from the address bar and
come back to Today when opened again. Archiving a tab never archives or deletes
the thing it points at.

**Opening anything that is not already a tab adds it to the top of Today.** The
web client calls `tabs_open` whenever the route shows a thread or item.

Collections (the Library, a saved view) are tab targets too: a page you browse
like a website. Clicking an item inside navigates; it does not create a second
tab unless the user ⌘-clicks.

## Refs

| Ref | Target | Resolved by |
|---|---|---|
| `thread:<threadId>` | A BB thread (includes bot DMs) | Client, from `experimental_useSidebarThreads` (title, status, unread). Server returns `title: null`. |
| `item:<pluginId>:<itemId>` | A Studio item (page, board, table, drawing, recording, artifact) | Server (title, icon, href, kind) |
| `bot:<botId>` | A bot's desk | Server (name, avatar, providerId, state) |
| `conversation:<id>` | A channel | Server (title, href, needsYou, unread) |
| `office:inbox` | The Inbox | Server (count = requests) |
| `office:home` | Home | Server |
| `library` / `library:<kind>` | The Library collection, optionally filtered (`page`, `board`, …) | Server |

A ref that no longer resolves (deleted item, deleted bot) is dropped from the
response and removed from the store.

## Storage

- `office_tabs(space_id, ref, zone, folder_id NULL, position, opened_at, archived_at NULL)`, primary key `(space_id, ref)`. `zone` is `essential | pinned | today | archived`.
- `office_tab_folders(id, space_id, name, open, position)` for Pinned folders. These are sidebar groupings only; they are not space folders (`folder_create`).
- Space setting `todayArchiveAfter`: `"12h" | "1d" | "3d" | "7d" | "never"`, default `"3d"`.
- Auto-archive runs lazily in `tabs_get`: Today tabs whose `opened_at` is older than the setting move to `archived`.

## RPCs (office contract)

```ts
type TabZone = "essential" | "pinned" | "today" | "archived";
interface Tab {
  ref: string;
  kind: "thread" | "item" | "bot" | "conversation" | "inbox" | "home" | "library";
  title: string | null;      // null for threads; the client fills it in
  icon: string | null;       // item icon / emoji avatar / host icon name
  href: string | null;       // app path to open; null for threads
  zone: TabZone;
  folderId: string | null;   // pinned folder, when zone = pinned
  openedAt: number;
  archivedAt: number | null;
  // kind-specific, optional
  itemKind?: string;         // page, board, table, drawing, recording, artifact
  providerId?: string;       // bots running on an external agent
  botState?: "idle" | "working" | "needs_you";
  badge?: number;            // inbox request count
  needsYou?: boolean;
  unread?: boolean;
}
interface TabFolder { id: string; name: string; open: boolean; position: number }

tabs_get({ spaceId }) → { seeded: boolean; essentials: Tab[]; pinned: Tab[]; folders: TabFolder[]; today: Tab[] }
  // pinned tabs carry folderId; the client groups them. Runs auto-archive first.
tabs_open({ spaceId, ref } | { spaceId, href }) → { tab: Tab | null }
  // href is an app path; the server resolves it. An unknown path returns tab: null.
  // Not a tab yet, or archived → top of Today. Already a tab → only touches opened_at.
tabs_move({ spaceId, ref, zone, folderId?, index? }) → { ok: true }
  // Pin, unpin, add to / remove from Essentials (cap 8), archive, reorder within a zone or folder.
tabs_archived({ spaceId, query?, limit? }) → { tabs: Tab[] }   // newest archived first
tab_folder_create({ spaceId, name }) → { folder: TabFolder }
tab_folder_update({ folderId, name?, open?, position? }) → { folder: TabFolder }
tab_folder_delete({ folderId }) → { ok: true }   // its tabs move to Pinned top level
office_search({ spaceId, query, limit? }) → { results: Tab[] }
  // Items (search-index), bots, channels, library views, archived tabs.
  // Threads are searched by the client. zone is the tab's zone, or "archived" for
  // results that are not tabs at all (the client shows them as "Open").
```

Every mutation emits the Studio realtime change so open sidebars refresh.

## Seeding (first visit to a Space)

- Essentials: `office:inbox`, then up to 3 bots of the Space (by name).
- Pinned: pinned threads (`isPinned`, sent by the client in `tabs_seed`) that belong to the Space. No item favorites exist in v1.
- Today: empty.

`tabs_seed({ spaceId, pinnedThreadIds })` runs the seed once and is a no-op afterwards; the client calls it when `tabs_get` returns `seeded: false`.

## V1 clarifications

- `tabs_get` does not seed. It returns `seeded: false` until `tabs_seed` commits.
  The seed marker lives in `space_settings` as `office.tabsSeeded`. It survives
  archiving or pruning every tab. Concurrent seed calls seed only once.
- Tabs opened before the seed request are preserved; seeding never moves them.
- Threads resolve on the client, so the server keeps their refs and returns
  null title and href. Pinned seed threads are checked for Space ownership.
- Library hrefs are `/plugins/studio/studio` and
  `/plugins/studio/studio/<kind>`. Bot desks use `/plugins/studio/office-team/<id>`;
  Inbox and Home use `/plugins/studio/office-inbox` and `/plugins/studio/office`.
- Space-folder targets (`folder:<id>`) and folder collection routes are deferred.
  Pinned tab folders remain part of v1; they are sidebar groupings only.
- A temporary provider error fails the request without deleting saved refs.
  Confirmed missing refs are pruned. Archived item targets remain resolvable.
- Moving to Today refreshes its opened time. Omitted move index means top of
  the destination zone/folder. Deleting a tab folder puts its tabs first at
  Pinned top level, preserving their order.
