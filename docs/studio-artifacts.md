# Studio Artifacts (plan)

**Studio Artifacts** is a Studio add-on that keeps the things agents make in
threads: generated images, HTML pages, reports, Markdown, code, PDFs, data
files. Today these land in a workspace or a thread's storage directory and are
lost in the scroll. Artifacts copies them into one place, where they sit in
the Studio collection next to pages, recordings and drawings.

Plugin id `artifacts`, display name "Studio Artifacts", kind `artifact`.

## What BB gives us

BB has no artifact concept of its own, so the add-on keeps its own index and
copies of the bytes. What it can build on (all in the stable SDK 0.5.29):

- **Agent tools and CLI** (`bb.agents.registerTool`, `bb.cli`): an agent saves
  a deliverable on purpose.
- **Thread history** (`bb.sdk.threads.events.list`, `item/completed`): typed
  items for `imageGeneration { path }`, `fileChange { changes[].path }` and
  `toolCall`. Completed items survive pruning.
- **Thread storage** (`bb.sdk.threads.storageFiles`, `/thread-storage/content`):
  the per-thread directory agents are told to write outputs into.
- **Host files** (`bb.sdk.files.read`) for workspace paths.
- **`messageAction`**: an action on any assistant message.
- **`messageDirective`**: `::name{attrs}` in assistant Markdown, rendered by
  the plugin (the inline-vis pattern).
- **`thread.idle`** event, with no per-tool-call push event.

Limits that shape the design:

- Workspace and thread-storage files are live and can change or vanish, and
  thread storage is only readable while its host is connected. **Artifacts
  copy bytes at save time**; they never point at the original.
- There is no list API for project attachments, and core timeline rows can't
  be re-rendered. We don't try to decorate BB's own tool rows.
- Plugin HTTP routes get no default CSP. The plugin sets
  `content-security-policy: sandbox allow-scripts` on every artifact response
  itself, except a real PDF (see The viewer).
- Plugins get a key-value store and SQLite, but no data directory for files.

## Capture

Saving is **explicit**. Studio is a place for things someone chose to keep,
and an automatic sweep of every file an agent touches would bury them.

1. **Agent saves it.** An `artifacts_save` tool takes a thread-storage or
   workspace path (or inline content for small text), a title, and an optional
   description. The skill tells agents to save finished deliverables, not
   scratch files. The CLI mirror is `bb artifacts save <path>`. The tool
   replies with a `::artifact{id=…}` directive, so the saved item shows as a
   card in the conversation.
2. **You save it.** A "Save to Studio" `messageAction` opens a picker listing
   the files that message's turn produced: images it generated, files it
   created or changed, and new thread-storage files, all read from thread
   history between the message's sequence bounds. Tick the ones to keep.
3. **Later, opt-in:** a setting to suggest (not save) generated images and new
   thread-storage files when a thread goes idle. Suggestions show in the thread
   panel, not in the collection. Not in the first version.

Saving the same source path from the same thread again adds a **version**, not
a new item. The viewer can step back through versions.

## Storage

- SQLite for metadata: id, title, description, mime type, size, project,
  source thread, source path, created and updated, archived.
- Bytes in a SQLite BLOB table keyed by sha256, so identical versions share
  one copy. (There's no plugin data directory to put files in.) Deleting an
  artifact drops the bytes no other version uses.
- 25 MB per file (BB's download cap), with a clear error above it.

## The viewer

Item URL `/plugins/artifacts/artifacts/<id>`, with Studio's `ItemHeader`: the
back pill, an editable title, the type and size, and the source thread as a
link.

| Type | View |
|---|---|
| Image | Fitted to the pane, click to zoom |
| HTML | Sandboxed iframe (`allow-scripts` only) served from the plugin's HTTP route under a sandbox CSP |
| Markdown | Rendered, with a raw toggle |
| Code and text | BB's source viewer |
| PDF | The browser's PDF viewer in an iframe. Chrome's viewer refuses sandboxed documents, and a PDF can't run page scripts, so the route leaves out the CSP only when the bytes start with `%PDF-`; a `.pdf` that isn't one is sandboxed and served as `application/octet-stream` |
| Other | Name, type, size, and Download |

Header actions: **New thread** (mentions it), **Copy** (text types), **Download**,
**Open source thread**, **Save as page** (Markdown and text, through Pages'
`create { markdown }`), and in the ⋯ menu Versions, Move to project, Delete.

## Studio integration

- Implements the Studio provider contract with `registerStudioProvider`, and
  its own `AddOnCollection` when Studio isn't installed.
- `StudioItem.thumbnailUrl`: images use the stored bytes through the HTTP
  route (revision in the URL, cached forever). Other types show a type tile
  (HTML, Markdown, PDF, code, file). No server-side image resizing, which
  would need a native dependency.
- Facts: type, size, versions. Preview line: the description or the first
  line of text.
- `studio_search` matches titles, descriptions and the text of text types.
- @-mentions and `mentionPrompt` like the other add-ons.

## Build order

1. **Core.** Scaffold on SDK 0.5.29 and the kit; storage and migrations; the
   provider contract; the collection and viewer for images, text, Markdown
   and code; `artifacts_save`, the CLI and the skill. Tests for storage,
   provider and path safety.
2. **HTML and PDF.** The HTTP route with the sandbox CSP and the iframe
   viewers, with a test that the header is always set.
3. **Save to Studio.** The `messageAction` picker, reading thread history.
4. **Versions and Save as page.**
5. **Handoff.** Marketplace and `.bb/plugins.json` entries, a staged
   screenshot, README, compat check.
6. **Later.** The opt-in suggestions.

## As built

- The tools are `artifacts_save`, `artifacts_list` and `artifacts_read`.
  `artifacts_save` also takes `artifactId` to add a version to a chosen
  artifact.
- The CLI is `bb artifacts save | list | show | export | delete`. `export`
  copies an artifact into the thread's workspace, so an agent can edit a
  file and save it back.
- "Save to Studio" is also in the thread panel launcher, where it lists the
  latest reply's files. The picker lists the thread's storage files and what
  the thread has already saved, too.
- BB returns at most 100 events per request, so the picker reads a reply's
  history 100 events at a time, back to its turn request (at most 2,000
  events).

## Open questions

- **Name.** "Artifacts" matches what people call these in other tools.
  "Files" is plainer but collides with the filetree plugin's `files` skill.
- **Project.** Saved items take the source thread's project. Should a global
  save (no project) be offered at save time too?
