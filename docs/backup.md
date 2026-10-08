# Backup and restore

One file holds every Studio item: pages, Talk recordings, drawings,
artifacts, tables and designs, plus Studio's own data (tags, Spaces, saved
views, item links, comments and versions). Restoring it on another BB adds
what's missing. A second restore changes nothing, and work that is newer on
the BB you restore to is never overwritten.

```sh
bb studio backup                      # bb-studio-backup-<time>.zip in the current folder
bb studio backup --out ~/Backups      # into a folder, or name a file
bb studio restore <file>              # shows what would change; changes nothing
bb studio restore <file> --yes        # restores
bb studio restore <file> --dry-run    # shows what would change, explicitly
```

On Studio's Setup page, **Backup and restore** has the same two actions.
**Back up** makes the file on the BB server and downloads it. **Restore…**
uploads a file in 4 MB pieces, shows the dry run, and restores only after you
press **Restore**. The Setup page takes files up to 4 GB. For anything larger,
use the CLI.

## What's in a backup

| Section | Plugin | What's saved |
| --- | --- | --- |
| `pages/` | Studio Pages | Each page's row, its Yjs state (comments live inside it), the Markdown cache, saved versions and uploaded files. |
| `talk/` | Studio Talk | Each recording with its segments, transcripts, meeting notes and the id of its notes page, and its audio files. |
| `excalidraw/` | Studio Draw | Each drawing's scene, and its images as separate files. |
| `artifacts/` | Studio Artifacts | Each artifact with every version's bytes. |
| `studio-tables/` | Studio Tables | Each table: its columns, views and rows. |
| `design/` | Studio Design | Each design with its rounds, screens (as HTML files) and comments. |
| `studio/` | Studio | Tags and which items have them, saved views, Spaces with their projects, threads, leads and check-in settings, item links, item chats, comments, versions and activity. |

## What isn't

Every manifest lists these under `excluded`:

- **Studio Code workspaces.** A workspace is a folder on disk. Back up the folder with your other files.
- **Studio Mobile, Reactions, Decisions and Sidebar.** These hold settings for one BB, not items. Set them up again on the new BB.
- **BB threads, projects and their files.** These belong to BB itself. Restore matches items to projects that already exist on the new BB.
- **Secrets and provider credentials.** They never leave the BB they were entered on.

Each add-on also leaves out state that points at BB threads, which won't exist
on another BB. That means page chats, bot request history and checklist
hand-offs; the thread a recording or design was started from; and Draw's
recovery keys and thumbnails, which are rebuilt. The section's `notes` say what
was left out.

An add-on that isn't installed, is turned off, or is too old to back up is
listed in the manifest as `skipped` with the reason. If an add-on fails, it is
listed as `failed`; the rest of the backup is still written, and the CLI exits 1.

## File format

A backup is a plain ZIP archive (no ZIP64, so at most 65,535 files and 4 GiB).
`manifest.json` comes first. Every other file belongs to one section folder,
named by plugin id.

```json
{
  "format": "bb-studio-backup",
  "version": 1,
  "createdAt": "2026-10-07T10:00:00.000Z",
  "bb": { "version": "0.44.0" },
  "projects": [{ "id": "proj_…", "name": "App", "path": "/Users/me/code/app", "personal": false }],
  "sections": [{
    "pluginId": "pages", "name": "Studio Pages", "status": "included", "reason": null,
    "pluginVersion": "0.1.0", "version": 1,
    "counts": { "pages": 12, "versions": 40, "files": 3 }, "files": 70, "bytes": 1048576,
    "notes": ["…"]
  }],
  "excluded": [{ "what": "Studio Code workspaces", "why": "…" }]
}
```

`version` is the archive layout. Each section has its own `version`, which
its add-on reads. A reader refuses a newer layout and says to update first.

Inside a section, an add-on writes one JSON file per item at
`items/<item id>.json`. Large data goes in separate files beside it, such as a
page's Yjs state, audio, images, artifact versions and screen HTML. JSON never
carries large binaries as base64. In file names, `<id>` is `fileSafeId(id)`: a lowercase id without `:` as it is;
any other id is lowercased, `:` becomes `_`, and `~` plus 8 hex characters of
a hash of the exact id follows, so ids never share a file name, even on a
case-insensitive filesystem. Restore also accepts the older names (no hash).
Section layouts:

- `pages/`: `items/<id>.json`, `files/<id>/state.bin`, `files/<id>/page.md`, `files/<id>/snapshots/<snapshot id>.bin`, `files/<id>/attachments/<file id>`.
- `talk/`: `items/<id>.json`, `audio/<id>/<segment file>`.
- `excalidraw/`: `items/<id>.json`, `files/<id>/<n>`; each image's path and MIME type are in the item JSON.
- `artifacts/`: `items/<id>.json`, `files/<id>/<version id>`.
- `studio-tables/`: `items/<id>.json`.
- `design/`: `items/<id>.json`, `files/<id>/screens/<screen id>.html`.
- `studio/`: `tags.json`, `item-tags.json`, `views.json`, `spaces.json`, `links.json`, `item-chats.json`, `comments.json`, `versions.json`, `activity.json`, `blobs/<sha256>`.

## How it works

Files never travel through RPC. All plugins run on the same BB server. Studio
makes a session folder at
`<BB data>/plugins/studio/backup-sessions/<session>/`. It calls each add-on's
`studio_backup({ session })`. The add-on writes its own `<session>/<plugin id>/`
folder, hard-linking audio where it can. Studio adds `studio/` and
`manifest.json`, then streams the folder into the ZIP. The session folder is
deleted afterwards.

The two methods are an optional part of the Studio provider contract
(`@bb-studio/kit/backup`). An add-on registers them with
`registerStudioBackup` from `@bb-studio/kit/server`. It is given only a
session id, never a path: the kit joins the id to Studio's session folder and
refuses anything else.

Restore runs in this order:

1. **Check the archive before extracting.** Restore reads the ZIP directory.
   It refuses absolute paths, `..`, backslashes, drive letters, control
   characters, duplicate names, encryption, unknown compression, entries out
   of range, more than 8 GiB unpacked, and ratios that look like a ZIP bomb.
   It then reads `manifest.json` and checks its format and version.
2. **Extract.** Only the folders of sections the manifest lists are
   extracted. Each file streams through a size and CRC-32 check into a
   temporary file, then is renamed into place.
3. **Map projects.** Each backed-up project is matched to a project on this
   BB, trying these in order: the same id (restoring on the same BB), then
   Personal, then the same folder path, then the only project with the same
   name. If no project matches, its items become global items. The summary
   lists those projects, and you can move the items with `bb studio move`.
4. **Restore each add-on, then Studio.** Each add-on gets
   `studio_restore({ session, dryRun, version, projects })` and decides each
   item by its original id and `updatedAt`:
   - *new*: it isn't on this BB, so it's created with the same id.
   - *updated*: the backup is newer, so it replaces the copy here.
   - *already here*: same age; nothing happens. This is what makes a re-run safe.
   - *kept*: the copy here is newer, so it stays. The summary names it.
   - *failed*: the item was invalid or couldn't be written. The summary gives the reason.

   Child rows (versions, files, comments) are keyed by their own ids, so
   none are duplicated. Each add-on checks every item first, writes its files
   (temporary file, then rename), and then makes all its database writes in
   one transaction. A dry run makes no writes. Studio's own section runs its
   transaction and rolls it back, so its counts match a real run, with one
   exception: a real run's add-ons record links and activity for the items
   they restore, so Studio then finds a few rows already here that the dry
   run counted as new.
5. **Studio's data.** Tags and saved views are matched by id, then by name.
   Spaces are matched by id, then the default space, then by name; a missing
   space is created. A project joins its restored space, unless you have
   already put it in another space here. Item chats, space threads and leads
   are restored only when their BB thread exists here. Check-ins come back
   switched off. The search index is rebuilt afterwards.

If an add-on isn't installed on the BB you restore to, its section is skipped
with a note. Install the add-on and restore the same file again; items that
were already restored are reported as already here.

A page that is open in an editor, or has unsaved changes, isn't overwritten.
It's reported as failed with a reason. Close it and restore again.
Recordings that were still recording or transcribing when the backup was made
come back as finished. Pieces that were never transcribed are marked failed,
so you can retry them. Restore never sends audio to be transcribed again.

Only one backup or restore runs at a time. Session folders and abandoned
uploads (older than a day) are cleaned up when Studio starts. The Setup page
keeps your three newest backups on the server so you can download them again.

## Needs a live check

Each add-on's unit tests make a backup, restore it into an empty store, restore
it again with no changes, and check conflicts, dry runs and bad items. Studio's
tests do the same with its own data, and also cover the ZIP reader and the
upload path. These parts haven't been checked on a running BB yet:

- An add-on calling `studio_backup` and `studio_restore` over real plugin RPC.
- Hard-linking audio across plugin data folders.
- The Setup page download and upload.
- Restoring onto a second BB with different project ids.
