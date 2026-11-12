# BB Studio site

The public showcase site for BB Studio: one static page, plain HTML and CSS with a few lines of JavaScript. It has no framework, no external fonts or CDNs, and no trackers.

It is published from a separate public repository, `patleeman/bb-studio-site`, served by GitHub Pages at `https://patleeman.github.io/bb-studio-site/`. Every URL in the build is relative, so the same build works at that path, at a domain root, and from a local server.

## Layout

| Path | What |
|---|---|
| `src/index.html` | The page. `{{pic}}`, `{{theme}}`, `{{clip}}` and `{{srcset}}` tags expand at build time. |
| `src/styles.css`, `src/site.js` | Styles, and the script that plays the scene clips while they are on screen (never under reduced motion). |
| `src/fonts/` | Jost (SIL OFL 1.1, license beside it), the font BB Studio bundles for Miami 1985's headings. |
| `assets/img/`, `assets/video/` | The optimized screenshots (AVIF and WebP at several widths) and clips (WebM and MP4). Generated; do not edit. |
| `scripts/` | The demo seeding, capture, image, build and publish scripts. |
| `dist/` | The build. Not committed. |

## Build and preview

```sh
cd site
node scripts/build.mjs
cd dist && python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/`. To check the GitHub Pages base path, serve the parent of a folder named `bb-studio-site` that holds `dist/`, and open `/bb-studio-site/`.

## Publish

Patrick reviews the local build first. Then:

```sh
node scripts/build.mjs
scripts/publish.sh ~/path/to/bb-studio-site   # a checkout of patleeman/bb-studio-site
```

`publish.sh` replaces the checkout's files with `dist/` (it keeps `.git` and `README.md`). It does not commit or push. Commit and push in that checkout.

## How the screenshots were made

The screenshots come from a scratch BB Studio with made-up data. Nothing in them comes from a real install.

- **The scratch instance.** `scripts/scratch.sh start` runs the desktop worktree's `packages/bb-app/dist/bb-app.js` with its own data dir (`/tmp/bbsite/data`), port 38994 (daemon 38995), a scratch `HOME`, `BB_STUDIO_IMPORT_FROM=off` (no import or mirror of `~/.bb`), and a `PATH` with no agent CLI on it. No agent turn can start: the Claude Code, Codex and Pi CLIs are not found.
- **Studio.** `scripts/demo.sh` builds the Studio plugin from this repository's `HEAD` (`git archive` into the scratch dir) and installs it there by path.
- **The demo data** is in `scripts/demo-data.mjs`: three Bots (Atlas, Juniper, Scout), their conversations, workers, one pending approval, pages, a whiteboard, memory records, todos and paused automations.
  - `scripts/seed-db.mts` writes the threads and their messages into bb's database with bb's own DB helpers (`@bb/db`: `createThread`, `insertEvents`, `createPendingInteraction`), with the server stopped.
  - `scripts/seed-studio.mjs` makes the Bots on those threads and sets their themes and presences through Studio's RPCs, creates pages and the whiteboard with the `bb studio` CLI, adds memory and automations through RPCs, and writes todos to Studio's store. It turns off Smart Queue and resume-after-restart for the demo.
  - `scripts/fixups.mjs` puts back what the server settles on start (the running worker, the pending approval) and places each thread with its Bot.
- **Capture.** `scripts/capture.mjs` drives headless Chromium (Playwright) at 1600 × 1000 and 2x against the scratch server, with `window.bbDesktop = { platform: "macos" }` so the app draws the desktop app's framed layout. It switches Atlas's theme through Studio's RPCs for each theme shot, opens Cmd+K, Edit space and a two-pane workbench by keyboard and mouse, captures the HUD's window route with a transparent background, and records three 16-second clips. Tonight's Sky is previewed at night (`bb studio theme sky --date`); Kyoto Garden by day.
- **Presence sheet.** From Studio's own script: `node <scratch>/src/plugins/packages/bb-studio/scripts/presence-sheet.mjs <raw>/presence-sheet.png` (needs Google Chrome).
- **Images.** `scripts/images.mjs <raw-dir>` crops and resizes with `sips` and `ffmpeg`, then writes AVIF (`avifenc`) and WebP (`cwebp`), and encodes 6-second clips at 960 px.

To make them again:

```sh
npm i --prefix /tmp/bbsite-tools playwright@1.64.1   # once; uses the cached Chromium
site/scripts/demo.sh                                 # scratch server, seeded, left running
node site/scripts/capture.mjs /tmp/bbsite/ids.json /tmp/bbsite-shots/raw
node /tmp/bbsite/src/plugins/packages/bb-studio/scripts/presence-sheet.mjs /tmp/bbsite-shots/raw/presence-sheet.png
node site/scripts/images.mjs /tmp/bbsite-shots/raw
node site/scripts/build.mjs
site/scripts/scratch.sh stop && site/scripts/scratch.sh wipe
```

Set `DESKTOP` to the desktop worktree and `SCRATCH` to another scratch dir if the defaults (`~/workingdir/bb-studio-app-desktop`, `/tmp/bbsite`) don't fit. The scripts refuse a data dir under `~/.bb` or `~/.bb-studio`.

## Copy

Plain, concrete sentences. State what the app does. No taglines, quips or invented numbers. The facts come from `plugins/packages/bb-studio/README.md`.
