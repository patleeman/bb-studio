# What's left of standalone Drawings

An audit, 2026-11-01. Nothing has been removed yet. This lists every
standalone-Drawings piece still in Studio and iOS, with a recommendation for
each.

## Status (2026-11-06): one concept, Whiteboards

The user asked for one concept, and approved a follow-up plan that reverses
two of the decisions below:

- Whiteboards have a sidebar row again (after Pages), and New → Whiteboard
  makes a page holding one 640px whiteboard (`drawings.newWhiteboardPage`).
  The kind's own `create` stays `null`, so nothing makes a whiteboard outside
  a page.
- The page's whiteboard is resizable (a `height` on its embed, 160–1200px)
  and opens full size in place, over the page, in a thread's panel or the
  Studio tab.
- The agent tools are `whiteboard_*`; the `excalidraw_*` names stay as
  aliases for two releases. The CLI is `bb studio whiteboards` (`drawings`
  still works). The skill is `whiteboards`. The slash menu has one entry,
  `/whiteboard`.
- Stored data, the kind id `drawing`, the embed kind and the
  `/studio/drawings/<id>` routes are unchanged.

## Status (2026-11-01)

The user approved this list. The REMOVEs and the cheap REPOINTs are done:

- Removed entirely: the composer + → Drawing action and its picker
  (`drawings.pickDrawing`), rather than the whiteboard repoint below.
- The whiteboard kind has no New `create` mode, so no New menu offers it
  (desktop, iOS or the Studio tab). It also has no sidebar row.
- `excalidraw_create_drawing` takes a page id, and the startup migration to a
  "Drawings" page is in `src/draw/server/whiteboards.ts`.
- The `@drawing` mention still resolves older mentions and item chats, but
  offers nothing in the @ menu.

The tables below are the original audit.

## The key finding: a whiteboard is a drawing

Pages' inline whiteboards are not a new storage format. Each one is a row in
Studio's `drawings` table, embedded in the page as an ordinary embed block:

- `/whiteboard` in a page calls `pages.studioCreate` with plugin
  `excalidraw` and kind `drawing` (`src/pages/ui/PageEditor.tsx:57-58`,
  `:305-319`, `src/pages/ui/PagesPanel.tsx:62`). That creates a drawing
  through Drawings' Studio provider, then places
  `{"kind":"drawing","target":"drw_…"}` in the page.
- The page draws it as SVG and saves pen strokes back as Excalidraw elements
  through `pages.whiteboardGet` and `pages.whiteboardSave`
  (`src/pages/embeds.ts:51-67`, `src/pages/whiteboard.ts`,
  `src/pages/ui/whiteboard.tsx`). Those call Drawings in-process
  (`services.drawing` and `services.saveDrawing`, wired in `server.ts:224-225`).
- **Open drawing** on a whiteboard opens the full Excalidraw editor at
  `/plugins/studio/studio/drawings/<id>` (`src/pages/ui/studio-embeds.tsx:130`).

So the store, the tables, the element merge, the provider and the editor are
the whiteboard's back end. They stay. What can go is the standalone **front
door**: picking, listing, creating and attaching drawings as if they were their
own kind of item.

Two more facts follow from this:

- **Old drawings can already be linked into a page.** The slash menu's
  **Drawing** item (the `STUDIO_EMBEDS` loop, `PageEditor.tsx:296-303`) embeds
  an existing drawing by id. It then *is* a whiteboard. No data conversion is
  needed.
- **Migration is cheap and lossless.** To migrate, make one "Drawings" page
  (per project, or one global page) with one `drawing` embed per drawing that
  no page embeds yet. No scene data moves or changes.

## The user's data

I read copies of the databases, and the live DB in read-only mode. I counted
rows and read no content.

| Where | Drawings | Notes |
|---|---|---|
| Studio `~/.bb/plugins/studio/data.db`, `drawings` | **0** | 0 archived, 0 templates. `drawing_recovery_copies`: 0 rows |
| Pages that embed a drawing (`"kind":"drawing"` or `::drawing`) | **0** | 1 page mentions "excalidraw" only as text, with no embed |
| Old Draw plugin `~/.bb/plugins/excalidraw/data.db` | 0 | |
| Old Draw plugin `data-before-main-2026-10-04.db` (snapshot) | 1 | `drw_40a21f39…`, **0 elements**, untitled, created 2026-10-03, not in Studio today |
| `item_threads` rows for `excalidraw` | 1 | `drw_e5b6b10b…` (role `created`). That drawing no longer exists, so the row is dangling |

**The user has no drawings and no whiteboards that could be lost.** The one
snapshot drawing is empty. Don't delete the snapshot files. For other Studio
installs, which may have drawings, any removal must still keep every drawing
reachable (see "Migration" below).

## Inventory and decisions

Key: **REMOVE**, **REPOINT** (keep the job, aim it at whiteboards in pages),
**KEEP**.

### 1. Composer + → Drawing, and its picker

| Item | Where | Decision | Reason |
|---|---|---|---|
| + menu entry "Drawing" | `src/draw/ui/composer-registration.ts`; registered in `app.tsx:239-247` | REPOINT | Rename it "Whiteboard" and list whiteboards by page, so it attaches something real |
| Attach flow (pick, render PNG, upload) | `src/draw/ui/attach.ts` | KEEP | Rendering a scene to a PNG works the same for a whiteboard |
| Picker "Attach a drawing" / "Sketch something in Drawings first" | `src/draw/ui/excalidraw-picker.tsx`; slot in `app.tsx:250`; `PICKER_ID` in `src/draw/shared.ts` | REPOINT | Group by page title. New empty state: "Add a whiteboard to a page with /whiteboard" |
| RPC `drawings.pickDrawing` | `src/draw/server.ts` (`bb.ui.requestInput`), `src/kit/draw-contract.ts:101` | REPOINT | Its payload becomes whiteboards that pages embed (join on page embeds), not `store.list()` |
| RPC `drawings.attachDrawingImage` | `src/draw/server.ts`, `src/kit/draw-contract.ts:88` | KEEP | The upload doesn't change |
| Test | `src/draw/ui/composer-registration.test.ts` | REPOINT | Follows the label |

Alternative: REMOVE all of section 1. An `@page` mention already gives the
agent the page, and Copy image covers the rest. Choose this if you'd rather
not write the page join. Either way, it removes the misleading empty state.

### 2. Studio nav, sidebar, collection, kinds list and New menus

| Item | Where | Decision | Reason |
|---|---|---|---|
| Kind `drawing` in `KIND_ORDER` (sidebar kind rows) | `src/ui/studio-sidebar-model.ts:20` | REMOVE | Whiteboards live in pages, so a "Drawings" sidebar row invites standalone use |
| New-menu entry "Drawing" (new tab page, sidebar +, Studio tab, tab strip) | Comes from the provider's `create: { mode: "rpc" }` and `capabilities.create` (`src/draw/server/provider.ts:52-60`) through `createEntries` (`src/ui/create-menu.ts:25`) | REMOVE | Needs a "hide from New" flag or a filter in `createEntries`. **Don't** turn off provider `create`, because `/whiteboard` uses it |
| QuickOpen "New drawing" | `src/ui/QuickOpen.tsx:116` | REMOVE | Same reason. Or repoint it to "New page with a whiteboard" |
| Collection URL `/plugins/studio/studio/drawings` (opens the library filtered to Drawing) | `src/builtins.ts:39`, README | KEEP | Old links and bookmarks still resolve |
| Library listing of drawings (thumbnails, search, archive, move, delete, export) | provider `src/draw/server/provider.ts`, `src/ui/StudioPanel.tsx:117,216` | KEEP | This is the read-only way to old and orphan drawings. Label them "Whiteboard" |
| `templates: true`, `duplicate: true` capabilities | `src/draw/server/provider.ts:60` | REMOVE | A duplicate or a template makes an orphan drawing that no page shows |
| Kinds toggle "Drawings" in Setup | `src/kinds.ts:31` (`covers:` text), `src/ui/setup/KindsSection.tsx` | REPOINT | Rename it "Whiteboards". Its `covers` text names "the composer's + → Drawing". See settings cleanup below |
| QueryBar hint "Pages, recordings, drawings…" | `src/ui/QueryBar.tsx:18` | REPOINT | Wording only |
| Add-on description strings | `src/setup-addons.ts:18`, `package.json:19` | REPOINT | Say "whiteboards in pages" |

### 3. Agent tools, CLI, mention, and their contract

| Item | Where | Decision | Reason |
|---|---|---|---|
| `excalidraw_create_drawing` | `src/draw/server.ts` (tool), `DRAW_TOOLS`, `server.ts:287` | REPOINT | It should take a `pageId` (and an optional `afterBlockId`), create the drawing, embed it in the page, and return a `::page` card. Keep the name so prompts and skills don't break |
| `excalidraw_get_drawing`, `excalidraw_update_drawing` | `src/draw/server.ts` | KEEP | A whiteboard's id is a drawing id, so these already edit whiteboards. Only the descriptions change (say "whiteboard", and say where to find the id: the page's embed) |
| `excalidraw_list_drawings` | `src/draw/server.ts` | REPOINT | List whiteboards with their page. Mark orphans "(not in a page)" |
| Reply card text in tools (`card()` → `::drawing{id}`) | `src/draw/server.ts` | REPOINT | Emit the containing page's `::page` card |
| `CREATE_TOOLS` tag hint | `src/create-tag-hint.ts:5` | KEEP | Still a create tool |
| CLI `bb studio drawings list/create/show/rename/delete/merge/remove-elements` | `src/draw/server.ts` (`cli`), `server.ts:1858,1869,1965` | KEEP; REPOINT `create` | Agents use `show` and `merge` on large scenes. `create` should take `--page` |
| `@drawing` mention provider | `src/draw/server.ts` (`registerMentionProvider`), `src/kit/references.ts:22,28` | REMOVE | An `@page` mention covers it, and the agent reads the whiteboard with `excalidraw_get_drawing` |
| RPCs used by the full editor and iOS: `listDrawings`, `getDrawing`, `getDrawingMeta`, `getDrawingUpdatedAt`, `saveDrawing`, `recoverDrawingCopy`, `renameDrawing`, `deleteDrawing` | `src/kit/draw-contract.ts`, `src/public-contract.ts:8,16`, generated `ios/Shared/Generated/StudioContract.swift` (73 hits) | KEEP | The editor and iOS need them. Run gen-contracts `--check` if the contract changes |
| RPC `createDrawing` | same | KEEP | Seeds and iOS use it. Have it accept an optional page later |

### 4. Routes, deep links, directives, embed kinds

| Item | Where | Decision | Reason |
|---|---|---|---|
| Editor route `/plugins/studio/studio/drawings/<id>` | `app.tsx:95`, `src/draw/ui/route.tsx`, `src/draw/ui/drawing-editor.tsx` | KEEP | It's the whiteboard's **Open drawing** full editor. REPOINT **Back**: it goes to the "Studio" collection today (`openCollection("drawing")`), and should go to the containing page |
| Legacy `/plugins/excalidraw/drawings/<id>` | `src/kit/references.ts:37-39`, `src/builtins.ts:39` (`legacyRoot`) | KEEP | Cheap, and keeps old links working |
| Studio tab view of a drawing | `src/ui/studio-tab/StudioTab.tsx:28,45`, `src/ui/studio-tab/model.ts:35` | KEEP | Opens the editor beside the chat. Only the label changes |
| `::drawing{id}` message directive and card | `app.tsx:248`, `src/draw/ui/drawing-directive.tsx`, `src/draw/ui/drawing-card.tsx` | KEEP (read-only) | Old replies still show it. New replies use `::page` |
| Thumbnail route `GET /drawings/thumbnail` | `src/draw/server.ts`, `src/draw/server/thumbnail.ts` | KEEP | Library cards and iOS use it |
| Embed kind `drawing` | `src/pages/schema-config.ts:52,60`, `src/pages/ui/blocks.tsx:184`, `src/pages/ui/block-menu.tsx:33` | KEEP | This is how a whiteboard is stored in a page |
| Slash item "Drawing" (embed an existing drawing) | `PageEditor.tsx:49,296-303` | REPOINT | Call it "Existing whiteboard". It's the manual way to link old drawings into a page |
| Pages tools' embed help text (`drawing` kind) | `src/pages/tools.ts:27` | KEEP | Still accurate |
| Realtime channel `excalidraw` and `drawing:updated` | `src/draw/shared.ts` | KEEP | Live sync for whiteboard and editor |

### 5. Search, migrations, tables, backup

| Item | Where | Decision | Reason |
|---|---|---|---|
| Studio search over drawing text (`studio_search`, `studio_read`, Copy text) | `src/draw/server/provider.ts:70-215` | KEEP | Whiteboard text stays searchable. Later, the result could open the page |
| Migrations creating `drawings` and `drawing_recovery_copies` | `src/migrations.ts:218-233`; frozen copy `DRAWING_TABLES` in `src/draw/server/store.ts` | KEEP | Migrations are append-only, and the tables hold the data |
| `DrawingStore` and the element merge | `src/draw/server/store.ts`, `src/draw/merge.ts` | KEEP | The whiteboard's storage |
| Backup section `excalidraw` | `server.ts:1832`, `src/backup/service.ts:15`, `src/draw/server/backup.ts` | KEEP | Backups must keep holding whiteboards. Old backup files must still restore |
| Draft recovery (`recoverDrawingCopy`, drafts and save queue) | `src/draw/ui/drafts.ts`, `src/draw/ui/save-queue.ts` | KEEP | Protects the full editor's unsaved work. A recovered copy is an orphan, so the migration below should catch it |
| `@excalidraw/excalidraw` dependency | `package.json:62` | KEEP | The editor, PNG export and thumbnail fonts need it |

### 6. Docs, skills, captures

| Item | Where | Decision | Reason |
|---|---|---|---|
| README `## Drawings` (line 560 to 633) | `packages/bb-studio/README.md` | REPOINT | Fold it into the Pages whiteboard section (line ~301). Keep a short "Full editor" part |
| Screenshots `drawings-preview.png`, `drawings-compact-header.png` | `packages/bb-studio/assets/` | REPOINT | Recapture as a whiteboard in a page, then **Open drawing** |
| Capture `excalidraw` | `scripts/capture/captures/bb-studio-draw.mjs` | REPOINT | Seed a page with a whiteboard and open it from the page |
| Capture `draw-compact-header` | `scripts/capture/captures/compact-headers.mjs:5,52` | KEEP | The editor header still exists |
| Capture assertions on the New menu "Drawing", the "Drawings" sidebar row and the kinds toggle | `scripts/capture/captures/bb-studio.mjs:163-172,208-219,261,438-444` | REPOINT | They must change in the same commits as sections 2 and 6. Don't just weaken them |
| `seedDrawing` | `scripts/capture/seed.mjs:53,123-129` | REPOINT | Also seed the page that embeds it |
| Skill `draw` | `skills/draw/SKILL.md` | REPOINT | Rename it to whiteboards: where ids come from, and creating one in a page |
| Skills `studio`, `studio-chat` | `skills/studio/SKILL.md:16`, `skills/studio-chat/SKILL.md:9,16` | REPOINT | Wording |
| History docs | `docs/merging-add-ons.md`, `docs/upgrade-unified-studio.md`, `docs/backup.md` | KEEP | Historical, or still true |
| Settings audit row "Draw" | `docs/settings-audit.md:37` | REPOINT | See below |

### 7. iOS (ios)

| Item | Where | Decision | Reason |
|---|---|---|---|
| Drawings list screen (`.drawings` route) | `iOS/Tools/DrawingsView.swift` (list part), `iOS/App/RootView.swift:168,182`, `iOS/App/AppModel.swift:14` | REMOVE | A standalone gallery. Studio's library still lists them |
| Drawing viewer and web editor (`.drawing(id)`) | `iOS/Tools/DrawingsView.swift` (viewer, `ExcalidrawCanvas`, `WebView(url: webURL(forDrawing:))`), `RootView.swift:189` | KEEP | Whiteboard embeds in pages open it (`iOS/Pages/PageMarkdown.swift:297,375`) |
| "Drawing" in Studio kinds and its empty-state copy | `iOS/Studio/StudioView.swift:313,980` | REPOINT | Label it "Whiteboard". New follows the server's kinds (`:192`), so it drops once section 2 lands |
| Studio list rows and thumbnails | `Shared/Studio.swift:140-147`, `StudioView.swift:132-138,1343-1377` | KEEP | Read-only access to old drawings |
| `::drawing` reply cards | `iOS/Thread/ItemCard.swift` | KEEP | Old replies |
| Deep links `bbstudio://drawing/<id>` and `bbstudio://drawings` | `AppModel.swift:38,52,198,215`, `iOS/App/BBStudioApp.swift:35` | KEEP `drawing/<id>`; REPOINT `drawings` | The list link opens Studio filtered to whiteboards |
| Spotlight indexing of drawings | `iOS/App/Spotlight.swift:51` | KEEP | Harmless |
| `createDrawing` client | `Shared/BBClient+DrawingEditing.swift` | REMOVE with the list | It's only for the standalone New |
| iOS README rows | `ios/README.md:7,51,57,58,88` | REPOINT | Wording |

## Migration, so no drawing is lost

Recommended: a one-time, idempotent startup task (code, not a SQL migration,
because SQL migrations can't build page markdown):

1. Find drawings that no page embeds.
2. Skip it if there are none. That's true for the user today.
3. Otherwise, per project (or global), create one "Drawings" page with one
   `drawing` embed per orphan, newest first. Record that it ran, so deleting
   the page doesn't bring it back.

Drawings are never deleted or rewritten. The library listing and the editor
route stay as a second way in. Until this task ships, orphans stay visible in
the library, so removing the New-menu entries alone loses nothing.

## Overlap with the SDK 0.6.104 upgrade

These are the SDK APIs that standalone Drawings uses. Removing or repointing
first means less to port. I haven't checked 0.6.104's changes for each one.

- `app.composer.customize` with `plusMenu` (section 1): REPOINT keeps it,
  REMOVE drops it.
- `app.slots.pendingInteraction` and `bb.ui.requestInput` (the picker): the
  same.
- `bb.ui.registerMentionProvider` (`@drawing`): REMOVE drops it.
- `app.slots.messageDirective` (`::drawing`): stays, read-only.
- `bb.agents.registerTool` ×4, `bb.rpc.register`, `bb.http.route`: they stay
  either way, and other add-ons use them too.

Suggested order: land the REMOVEs (mention provider, New entries, QuickOpen,
sidebar row, templates and duplicate, iOS list) before the upgrade. Do the
composer repoint after the upgrade, so it's written once against the new API.

## Overlap with the settings cleanup

- Setup → Kinds "Drawings" toggle (`src/kinds.ts:31`): rename it "Whiteboards"
  and rewrite `covers`. Or fold it into Pages, because a whiteboard can't exist
  without a page. Turning it off today also hides the composer action, the
  card and the tools (`app.tsx:241`, `server.ts:287`).
- `docs/settings-audit.md:37`'s "Draw" row should become "Whiteboards (in
  Pages)".
- The capture `bb-studio.mjs:438-444` asserts the label "Drawings: turn off".
  Update it in the same commit as the rename.
