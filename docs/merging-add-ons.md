# Merging an add-on into Studio

Studio is one plugin with one rail icon (`studio/studio`). Its content kinds
moved into it one at a time: Artifacts first (`packages/bb-studio/src/artifacts`),
then Draw (`packages/bb-studio/src/draw`), then Design
(`packages/bb-studio/src/design`), then Talk (`packages/bb-studio/src/talk`),
and last Pages (`packages/bb-studio/src/pages`, with Explore in
`packages/bb-studio/src/explore`). This is the checklist, with what each
taught.

**Content-kind status: complete.** Every kind is built in. The five content
bridges were removed after their release cycle, followed by the Decisions and
Code bridges after their migrations were complete. Their import RPCs and iOS
fallbacks are gone. See [upgrade-unified-studio.md](upgrade-unified-studio.md)
for the content moves. The bridge steps below (4, and the bridge parts of 3
and 5) are historical; those packages are gone. Old-address mappings and item
ids remain for data compatibility.

## Rules

- **Keep the old plugin id as the item namespace.** Items stay
  `<old id>:<item id>` (`artifacts:art_…`). Studio's tables (tags, tabs, item
  links, threads, activity, comments, versions, search index) are keyed by it
  and need no rewrite. The built-in answers to its old provider id.
- **No collection page of its own.** A kind's collection is Studio's library
  filtered to that kind. `/plugins/studio/studio/<segment>` opens the library
  with the Kind filter; every item opens as a Studio tab at
  `/plugins/studio/studio/<segment>/<id>`. Drop `AddOnPanel`,
  `AddOnCollection` and `handOver` for the kind.
- **Keep names users and agents already know.** Agent tools, skill name,
  mention provider id, message directive id, thread panel action and composer
  entries keep their names. The CLI can't: BB allows one CLI command per
  plugin (`cli command is already registered`), so current commands use
  `bb studio <segment> …`. A bridge's migration command existed only while
  that bridge was supported.
- **Old addresses keep working.** Map `/plugins/<old>/<panel>/<id>` to the
  Studio address everywhere a path comes in.

## Checklist

### 1. Move the code

- Move server code to `packages/bb-studio/src/<segment>/server/` and UI to
  `src/<segment>/ui/` with `git mv`, so history follows.
- Write `src/<segment>/server.ts` exporting `register<Kind>(bb, db)`. It
  registers the kind's RPC, HTTP routes, agent tools and mention provider on
  Studio, and returns `{ store, provider, backup, cli, dispose }`. Studio's
  `server.ts` calls it after `bb.storage.migrate`.
- Turn the `registerStudio`/`createStoreProvider` call into a function that
  returns `StudioProviderHandlers` (see `artifactProvider`). Set
  `panel: null` in `studio_describe`. Point `href`s at the Studio address.
- Prefix the kind's RPC methods: `<segment>.<method>` (`artifacts.get`).
  Keep the contract in Studio's `src/kit` sources and add it to
  `src/public-contract.ts` so iOS gets generated names. A separately installed
  bridge needed its own copy only during its upgrade window.
- HTTP routes move under `/<segment>/…`, so content URLs become
  `/api/v1/plugins/studio/http/<segment>/…`.
- Icons: copy the SVGs into `packages/bb-studio/icons/` and add them to
  Studio's `experimental_icons`. Icon names are namespaced by plugin id, so
  `artifacts/image` becomes `studio/artifact-image`.
- Move the skill directory to `packages/bb-studio/skills/` and update its
  CLI and link examples.
- Tests: plugin-level tests use a fake host with `pluginId: "studio"` (see
  `src/artifacts/test/host.ts`). Update URLs, RPC names and CLI calls.

### 2. Wire the built-in into Studio

- `src/builtins.ts`: add a `BUILTIN_ROUTES` entry (`pluginId`, `segment`,
  `kind`, `legacyRoot`). `builtinItemAt` and `canonicalPath` then cover
  `itemAt`, `visitTab`, saved workspace tabs (`workspace-state.ts`) and the
  workspace's route-to-tab effect.
- Kit `contract.ts`: add the id to `STUDIO_BUILTINS`. `builtins.test.ts`
  fails when it and `BUILTIN_ROUTES` disagree. Kit `references.ts`: add the
  mention provider to `STUDIO_BUILTIN_MENTIONS`, and the Studio route next
  to the old one in `STUDIO_REFERENCE_ROUTES`.
- `server.ts`: add `{ pluginId, name, handlers }` to the `StudioHub`
  built-ins. The hub calls them in-process with the same input and output
  parsing as RPC. It doesn't discover an installed plugin with the same id
  (the old copy or its bridge), so items never list twice.
- Other add-ons that called the old plugin's `studio_*` methods use the kit's
  `callProvider`, which routes built-ins through Studio's `provider.call`.
  `studioIndex` already does. Kind-specific calls (Pages called
  `artifacts.get`) go to Studio's prefixed methods.
- `app.tsx`: add the lazy item view to `BUILTIN_VIEWS`, and register the
  kind's thread panel actions, message directives and composer entries.
  `BuiltinRoutes` registers the Studio and old roots with the workspace.
  BB's app bundle is one file, so `lazy` defers evaluation, not download.
- Heavy dependencies (Draw's Excalidraw, resvg-wasm) must stay out of
  app.tsx's static import graph: split what Studio registers at startup (the
  reply card, the composer picker) from what needs the library (the editor),
  `lazy` the item view and the thread tab, and `import()` the library inside
  callbacks (the composer's PNG render). On the server, `import()` a wasm
  module on first use. `frontend-imports.test.ts` fails if `@excalidraw/` is
  reachable from app.tsx, or `@resvg/` from server.ts; add any new heavy
  package there. Move the package to Studio's `dependencies` (the server
  resolves files inside it at runtime, like Excalidraw's fonts).
- Kit pieces that call a kind's `studio_*` methods need an injected call for a
  built-in kind: Studio has no such RPC, only `provider.call`. Built-in
  providers use `ProviderCall`; `ItemMenu` takes `onMove`, which goes through
  `provider.call` with `studio_move`.
- Version history (`provider-history.ts`) and backup (`BackupService`
  `builtins`) read the kind in-process. The backup section keeps the old
  plugin id, so old backups restore into Studio.

### 3. Copy the data

BB scopes SQLite, KV, settings and files per plugin id, so Studio can't read
the old plugin's data. Copy it.

- Studio migration: export the old plugin's `CREATE` statement unchanged
  (`ARTIFACT_TABLES`) and append it to Studio's `MIGRATIONS`. Never edit a
  recorded statement. Tests that slice `MIGRATIONS` from the end break;
  find the statement by content instead (`project-lead.test.ts`).
- Import RPCs on Studio: `<segment>.missingBlobs`, `<segment>.importBlob`
  (hash-checked, one per call: a blob can be 25 MB), and
  `<segment>.importRows` (batches of 100). Draw has no blobs, but a scene
  holds its images as data URLs, so its batches are also capped at 8 MB of
  scene (a larger row goes alone) and the bridge reads rows a batch at a
  time. Import keeps ids and times. A
  row Studio already has is left alone, so reruns are no-ops. A conflicting
  row (same source file saved again after the update) is skipped with a
  reason.
- Check the old plugin for data outside SQLite: KV, settings, files under
  its data dir, thread storage. Artifacts kept everything in SQLite blobs.
  Copy side tables that make retries idempotent too: Draw's
  `drawing_recovery_copies` keys go along with each drawing, so a browser
  draft recovered after the update doesn't make a second copy. Browser
  storage (Draw's IndexedDB drafts) is per origin, so it carries over.

### 4. Turn the old package into a bridge release

Precedent: the studio-chat bridge (`git show d3df3ceb^:packages/bb-studio-chat/server.ts`)
and `packages/bb-studio-artifacts`.

- Bump the version (`0.2.0`), drop `app`, `skills` and experimental icons,
  and describe it as the upgrade bridge in `package.json` and
  `marketplace.json`. Keep the old `MIGRATIONS` statement byte for byte.
- `src/migrate.ts`: blobs first (only the ones Studio lacks), then rows in
  batches. Write a `migrated:<id>` KV marker per row Studio has. Validate
  each row with the kit's import schema; list malformed rows with the
  reason and keep them. The bridge never writes rows, so once every row has
  a marker or is skipped, the copy is complete.
- `server.ts`: run the copy on start, retrying with backoff while Studio is
  down. Expose `migrationStatus` and `bb <old> migrate` (prints "Migration
  complete"). Forward the old client RPCs and HTTP routes to Studio, waiting
  for a complete copy first. Keep the old mention provider id, forwarding
  `resolve` to Studio, because old pills name the old plugin.
- Register no agent tools, skill or UI. BB rejects a tool name a second
  plugin registers: the first registration wins and the other plugin shows
  `tool "…" is already registered by plugin "…" — not registered` as its
  status detail, without failing. While the pre-bridge plugin is still
  installed next to the new Studio, load order decides which tools work and
  Studio doesn't list the old plugin's items. Updating both together (Setup
  says so) ends that window, and the bridge copies anything written in it.
  Mention providers are scoped per plugin, so both can register the same id.
  An old HTTP route whose content Studio serves at a new path (Draw's
  `/thumbnail`) is answered through a bridge RPC on Studio
  (`drawings.thumbnail`); a forwarded call that waits on the user (Draw's
  `pickDrawing`, up to five minutes) needs a longer timeout.
- Studio `setup.ts`: add a `RETIRED` entry whose blocker checks the bridge
  version, enabled state and `migrationStatus` while copying is in progress.
  Once migration is complete, remove that bridge check and explain that its
  copied data stays in Studio.
  Remove the id from `ADDONS` in `setup-addons.ts`. Its test skips retired
  ids when comparing with `marketplace.json`.
- Marketplace: keep the bridge listed in `marketplace.json` and
  `.bb/plugins.json` with the bridge description, so `bb plugin update <old>`
  resolves for existing installs. Unlist it when the bridge package is
  deleted (as studio-chat was), keeping its `RETIRED` entry.

### 5. Clients, docs and captures

- iOS (`apps/ios`): call Studio's `<segment>.*` first and fall back to the
  old plugin only on a missing method (`viaStudio` in
  `Shared/Artifacts.swift`), for one release. Parse the Studio address in
  `Route(href:)`. `scripts/gen-contracts.mjs` generates the old namespace
  from the bridge's `legacyContract`, so the fallback's method names stay
  checked. Run `pnpm gen:contracts`. Write each call with literal generated
  names (`Studio.Method.drawings_getDrawing`, `Draw.Method.getDrawing`):
  the native RPC inventory can't check an interpolated method name and
  fails. Keep a per-kind "answered by Studio" flag (Draw's
  `drawingsInStudio`) for URLs that differ, like thumbnails.
  `swiftc -typecheck -enable-bare-slash-regex Shared/*.swift Shared/Generated/*.swift`
  checks the shared code. With Xcode installed, `xcodegen generate` and
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test
  -scheme BBStudio -only-testing:BBStudioTests` builds the app too (it caught
  a main-actor capture `swiftc` didn't); don't commit the `.xcodeproj`.
- Captures: move the kind's capture to `packageDir: "bb-studio"` with a
  `fileName`, open it from the old address, and assert it lands as a Studio
  tab. The bridge's README shows Studio's Setup page after
  `bb <old> migrate`. `staged-bb.mjs --plugin studio` seeds the workspace
  thread the artifact seeder needs.
- Docs: Studio README section for the kind, bridge README with the upgrade
  commands, root README table and install list, `docs/studio.md`,
  `docs/backup.md`.
- When package dependencies change, update lockfiles only for packages that
  still use them. The temporary bridge kit and tarball are gone.

### 6. Verify

```sh
pnpm -r typecheck && pnpm -r test
pnpm check:compat && pnpm check:contracts && pnpm check:native-payloads
node scripts/check-marketplace.mjs && node scripts/check-docs.mjs && node scripts/check-icons.mjs
git diff --check
```

End to end in a staged BB: start at the commit before the merge
(`node scripts/staged-bb.mjs start --ref <old> --plugin studio`), seed
items with the old plugin, install Studio and the bridge from the new pushed
commit, run `bb <old> migrate`, and check the items in Studio
(`bb studio list kind:<kind>`).

## Notes for the next merges

- **Chat on built-in items.** The merge didn't take Chat away in the
  workspace: since `ba50c598` a workspace tab row shows only the item's own
  tools, for every kind. Outside the workspace (a split beside a thread) the
  header read the item from its address's 3rd and 5th parts, so a built-in
  at `/plugins/studio/studio/drawings/<id>` chatted about `studio:drawings`.
  `ItemHeader` now resolves the address with `parseStudioItemHref` first,
  so add each built-in's Studio route to `STUDIO_REFERENCE_ROUTES`. The
  compact-header capture asserts Chat outside the workspace and its absence
  in the tab row (it also still clicked the removed Related button).

- **Design** (done) needed no `handOver={false}` inside Studio: its items
  open as Studio tabs like the others. What it added to the pattern:
  - An old plugin with several migration statements (Design's `ALTER`s)
    appends all of them, in order, unchanged (`...DESIGN_MIGRATIONS`).
  - Side tables that aren't items (saved styles) get their own import RPC
    (`designs.importStyles`) and their own markers (`migrated-style:<id>`);
    `migrationStatus` counts them in `total`. A style whose name Studio
    already uses is skipped with a reason rather than duplicated.
  - Old content URLs that Studio serves at a new path with the same query
    (`/http/screen`, `/http/print`) redirect (302) after the copy completes;
    no bridge RPC needed.
  - Keep contract schemas plain (`z.string()`, not `z.custom`): the generated
    Swift type follows the schema, and iOS reads the field as it is.
  - Realtime: Studio now publishes the kind's channel, so iOS listens for
    `pluginSignal("studio", "<channel>")` as well as the old plugin id.
  - Split what app.tsx registers at startup (the reply card, the question
    form) from the item view and thread tab, which are `lazy`;
    `frontend-imports.test.ts` checks the canvas stays out.
  - Design had no CLI; Studio adds `bb studio designs …`, and the bridge
    registers only `bb design migrate`.
- **Talk** (done) brought files, settings, commands and a recorder that
  runs in the browser. What it added to the pattern:
  - **Files outside SQLite.** Segment audio lived beside the plugin's
    database (`<dataDir>/plugins/talk/audio/<rec>/<seg>`). Studio keeps its
    own copy beside its database (`<dataDir>/plugins/studio/talk/audio/`,
    same relative paths, so rows import unchanged) and serves it at
    `/http/recordings/audio`. The bridge copies files first, through
    `recordings.missingAudio` (which files Studio lacks, how much of each a
    stopped copy already wrote, and the free space) and
    `recordings.importAudio` (4 MB pieces at an offset, read from disk a piece
    at a time; Studio fsyncs each piece into `<file>.part` and renames it into
    place only when the size and SHA-256 match). A rerun resumes from the
    `.part` size and never resends a file Studio has. The copy checks free
    space for everything left plus a 256 MB reserve before sending anything.
    `recordings.importRows` refuses (throws, so the bridge retries) a row whose
    copied audio isn't in place yet. The originals stay until the bridge is
    removed. Files the old plugin had lost, or deleted on purpose (expired
    dictation audio), go as `audio: false`.
  - **Rows the old plugin was still working on.** A segment left pending
    stays pending and Studio's transcriber picks it up (`importRows` wakes
    it); a recording left `recording` is marked interrupted by Studio's
    watchdog. Nothing is "settled" the way a restored backup is.
  - **Settings.** BB takes one `bb.settings.define` per plugin, so Studio's
    settings are Talk's (kit `TALK_SETTINGS`; merge any later kind's into the
    same call). The bridge defines them again only to read the user's values
    (labelled "moved to Studio") and sends them with its KV model choices to
    `recordings.importSettings`, which applies each one the user hasn't
    changed in Studio, once (a KV marker). Studio's KV keys are namespaced
    (`talk:model:<purpose>`).
  - **Commands.** Command ids are scoped by plugin, so `talk` commands become
    `studio` commands with the same ids and titles. A user's custom shortcut
    on the old command doesn't carry over; Setup and the READMEs say to set
    it again. `data-bb-plugin="talk"` selectors in a content script's CSS
    become `studio`.
  - **The recorder.** It runs in the old plugin's frontend until that plugin
    is updated, so the safe order is: finish recordings, update the plugin,
    then Studio, then `bb talk migrate`.
  - **Update order and agent tools.** In the staged migration, Studio updated
    first started while the old Talk still held `talk_*`, and ran without
    them (`tool "talk_make_notes" is already registered by plugin "talk"`)
    until `bb plugin reload studio`. A plugin can't register a tool later, so
    Setup and the bridge README say to update the old plugin first. The
    earlier bridges have the same window. Browser storage is per origin and
    Studio keeps the same IndexedDB and localStorage names, so pieces the
    browser set aside carry over and upload to Studio once the bridge has
    copied their recording. Forwarded legacy RPCs (`segment_put` from an old
    iOS build or a stale tab) wait for the copy, like every forwarded call.
  - **A page that isn't an item.** The unsent-audio page lives at
    `recordings/unsent`; `BuiltinRoute.pages` keeps `builtinItemAt` from
    taking it for an item, and the library shows a banner pointing at it
    when filtered to recordings.
  - **Kit contracts in the frontend.** A kit contract the app imports at
    runtime must not import the root SDK, including through another kit
    contract (`decisions-contract` now uses the local `defineRpcContract`).
- **Pages** (done) was the biggest and the most linked-to. What it added:
  - **Item namespace vs. host.** `PLUGIN_ID` stays `pages` (refs, mentions,
    and backups), and a separate `HOST_PLUGIN_ID`/`HTTP_ROOT`
    builds RPC and HTTP addresses. Every `/api/v1/plugins/${PLUGIN_ID}/http`
    in the moved code was a bug waiting to happen.
  - **URLs inside content.** Pages embed their uploaded files' addresses in
    the document (Yjs block attributes and the Markdown cache). Studio
    rewrites `/api/v1/plugins/pages/http/files` to
    `/api/v1/plugins/studio/http/pages/files` on import (pages and saved
    versions), and the editor's `resolveFileUrl` maps any left over (an old
    backup restored later). The bridge also redirects the old URL.
  - **Sub-paths after the id.** `<id>/chat/<thread>` is kept by
    `builtinItemAt` and passed to the view as `rest`; the kit's reference
    route lists it as `subpaths: ["chat/:id"]`.
  - **Many internal callers.** Studio's chat, comments and version adapters,
    Talk's notes pages and Artifacts' "Save as page" called the `pages`
    plugin's RPC; they call Studio's `pages.*` now (a plugin may call its
    own RPC through `bb.sdk.plugins.callRpc`).
  - **A feature riding along.** Explore ran inside Pages (its own
    `explore.db`, settings prefixed `explore_`, RPC prefixed `explore_`).
    Studio appends only the live table's statements (`next_suggestions`) to
    its migrations, keeps the setting keys, and the bridge copies the click
    log once (`explore.importNextSuggestions`). Its instructions keep their
    order after Pages' in Studio's one `agents.configure`.
  - **Heavy editor.** `frontend-imports.test.ts` keeps BlockNote, tiptap,
    Yjs, y-prosemirror, y-protocols, lib0, Mermaid, Shiki and Recharts out of
    app.tsx's static graph (the `::page` card reads metadata through
    `use-panel-page.ts`, not the editor's frame), and pdf-lib out of the
    server's.
  - **Pinned installs.** `bb plugin update` skips an install pinned to a
    commit, and BB refuses to install an id over an installed one. Staging
    showed `bb plugin remove` keeps a plugin's database, files and KV but not
    its settings, so the guide moves a pinned install by noting its
    settings, removing, installing, and setting them again before migrating.
  - **Update order for all bridges.** Old add-on first, then Studio, for
    every bridge (Setup's steps say so now); one procedure covers them all.
- After the bridges' release cycle, delete each bridge package and its iOS
  fallback the way studio-chat went (commits `d3df3ceb`, `f4f1ae22`). Keep
  the old-address mapping; it costs nothing.

## After the merge

- Done: the bridge packages (`bb-studio-pages`, `-talk`, `-draw`,
  `-artifacts`, `-design`), their marketplace entries, Setup's `RETIRED`
  entries for them, the import RPCs and the iOS fallbacks are deleted.
- The Decisions and Code upgrade bridges are now retired too. Their packages,
  marketplace entries, import RPCs and tarball dependencies are removed. The
  slim kit tarball existed only for those bridges. Reactions had no items, so
  it moved without a bridge: Studio defines its settings and copies the old
  plugin's once on start (`src/reactions/server.ts`), and Setup lists
  `emoji-react` as retired.

Done: the kit's `AddOnCollection`, `AddOnPanel` and `handOver` are gone (Code
hands its collection path to Studio itself), and provider discovery no longer
keeps a list of known add-ons, since every kind that had one is built in.

## Decisions merge (21 October 2026)

Decisions is a service, with no item routes or database tables. Its server and settings live in `src/decisions`, with `decisions.*` RPCs and commands under `bb studio decisions`. The retired bridge copied ordinary settings, five secrets, fallback configuration and recent decisions while preserving destination values. Those import RPCs and bridge gates are removed now that migration is complete. Smart Queue uses Studio's local settings and still pauses for the standalone `smart-queue` plugin; recovery cleans stale classifier threads owned by Studio.

## Code merge (21 October 2026)

VS Code lives in `src/code`, with `code.*` RPCs and unchanged agent tool and
skill names. The retired bridge quiesced the old process tree and copied editor
files and rows. Those import RPCs and start gates are removed after the
migration. Studio retains the process fence for its own server restarts.
Workspace ids keep the `studio-code` item namespace and old URLs still resolve.
See [the compatibility note](upgrade-studio-code.md).
