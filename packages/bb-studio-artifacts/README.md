# Studio Artifacts

> **Studio Artifacts** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, and keeping what your agents make. See the [suite overview](../../README.md).

Keep the images, reports, pages and files your agents make. Save a file from
a thread and it becomes an artifact in Studio's collection. You can view it,
download it, mention it in other threads, or start a new thread from it. Saving the same file
from the same thread again adds a new version.

Nothing is saved automatically. You pick what to keep, or you ask the
agent to save it.

## Staged preview

![The compact Artifacts header](assets/compact-header.png)

The live 390-pixel viewer shows the seeded Q3 HTML report. **Chat** stays
visible while **Item actions** is open below it with Related, Open in split,
Source, Copy, Download and the ⋯ menu.
These compact captures run on stable BB 0.45.0 with the full suite installed
from pushed commit 306c841. They check viewport bounds, button hit targets,
and the Related popover before capture.

![Live BB screenshot of the Studio Artifacts viewer](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`). It shows an
HTML report, "Q3 usage report", saved twice from a staged thread's workspace.
The viewer shows version 2 (`HTML · 2.1 KB · v2`) in its sandboxed frame,
under Studio's shared item header, with **Chat**, Related, Open in split, the
Source toggle, Copy, Download and the ⋯ menu.

## What you get

- **Artifacts in Studio.** With [Studio](../bb-studio) installed, artifacts join its collection next to pages, recordings and drawings. They get type, size and version columns, image thumbnails, projects, archive, move and delete. Studio search matches titles, descriptions and the text of text files up to 1 MB (HTML is searched by its words). Saving to an archived artifact brings it back. Studio can't create an artifact, because artifacts come from threads. Without Studio, the **Artifacts** panel shows the same collection.
- **Viewer** (`/plugins/artifacts/artifacts/<id>`):
  - Images fit the window. Click to switch to actual size.
  - HTML runs in a sandboxed frame.
  - PDFs open in the browser's viewer.
  - Audio (MP3, WAV, OGG, Opus, M4A, AAC, FLAC) and video (MP4, WebM, MOV) play
    in the browser's player, in Studio and on the artifact's card in a chat.
    The content route answers range requests, so seeking works.
  - Markdown renders as a document.
  - Code and text use BB's source viewer. Only the first 2 MB shows; Download has the rest.
  - Other files offer a download.

  The header has an editable title, the artifact's thread (with [Studio chat](../bb-studio); otherwise **New thread**, which starts a thread that mentions the artifact), Copy (text, or the image), Download, and a menu with Open source thread, Save as page (Markdown, text and code up to 1 MB), Versions, Move to, and Delete.
- **Send to thread.** Select text in a Markdown, HTML, code or text artifact, or drag over an image, then choose **Send to thread**. Add a note and send. The passage (or the cropped area, with pixel coordinates) goes to the artifact's thread, or to the thread you pick. Without Studio, BB's composer opens with the quote. PDFs aren't supported.
- **Save from a thread.** **Artifacts** in the thread panel launcher opens a side panel with the files the latest reply created, changed or generated (new ones ticked), the thread's storage files, and what the thread already saved. Nothing is saved automatically.
- **Capture from iPhone.** The Mobile Capture sheet saves a photo or file as an artifact in the default project.
- **Agent tools.** `artifacts_save` (a workspace or storage `path`, or short `content` plus `name`), `artifacts_list` (`thisThread`, `query`) and `artifacts_read`. The `artifacts` skill says when to save. A saved artifact comes back as `::artifact{id="art_…"}`, which shows as a card with an inline preview. The title or arrow opens the viewer in the thread's **Artifacts** tab beside the chat; without a workbench, in the main area. For repository coding tasks, agents keep changes in Git and save patches, logs or summaries only when you ask.
- **`@artifact` mentions.** The agent gets the artifact's details and, for text up to 1 MB, its contents.
- **Duplicate and export.** Studio can duplicate an artifact from its latest version. Export gives the original file with its name and type.
- **Backup.** `bb studio backup` includes every artifact with all version bytes. See [Backup and restore](../../docs/backup.md).

## Commands

- `bb artifacts save <path> [--title <title>] [--description <text>]`
- `bb artifacts list [--thread]`
- `bb artifacts show <id>` prints a text artifact.
- `bb artifacts export <id> [path] [--force]` copies it into the thread's workspace so an agent can edit it and save it back. It won't replace a file without `--force`.
- `bb artifacts delete <id>` deletes it and all its versions.

The plugin has no settings.

## Limits

- **25 MB per file.** Larger files are refused, including phone captures.
- **Versions.** A version is keyed on its source thread and path. A save with unchanged bytes adds no version.
- **Source paths.** Saving reads from the thread's workspace or thread storage on the thread's machine. Other paths are refused.
- **Text.** Search, mentions, `artifacts_read` and Save as page use text up to 1 MB. `artifacts_read` returns at most 100,000 characters.

## How it works

- Files are stored as BLOBs in the plugin's SQLite database.
- The "this reply's files" list comes from the thread's event history: generated images and file changes between the reply's turn request and its end, minus deleted files.
- HTML quoting: the preview asks for `content?…&quote=1`, which adds a small script that posts the selected text to the viewer. The viewer accepts messages only from its own frame. A page whose CSP blocks inline scripts can't be quoted.
- Contents come from `GET /api/v1/plugins/artifacts/http/content`. Every response except a real PDF carries a `sandbox allow-scripts` CSP, so HTML gets an opaque origin and can't call BB's API with your session, even when opened directly. Chrome's PDF viewer won't load in a sandbox, so the route checks that a file's bytes are really a PDF before serving it unsandboxed.

## Development

```
bb plugin install .     # register (path install; server.ts loads from source)
bb plugin dev           # watch: rebuild frontend + reload on every save
bb plugin build .       # emit dist/ (server.js + app.js/app.css)
```

`@bb-studio/kit` is a `file:../bb-studio-kit.tgz` dependency. Keep `package-lock.json` current (regenerate it in a clean clone, not the pnpm workspace), because BB's Git install runs `npm install` from it.
