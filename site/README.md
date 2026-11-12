# BB Studio site

The public showcase site for BB Studio: one static page, plain HTML and CSS with a few lines of JavaScript. It has no framework, no external fonts or CDNs, and no trackers.

It is built and deployed by `.github/workflows/pages.yml` to GitHub Pages at `https://patleeman.github.io/bb-studio/`. For now that workflow runs only by hand (`workflow_dispatch`): the site goes public when Patrick says so. Every URL in the build is relative, so the same build works under `/bb-studio/`, at a domain root, and from a local server.

## Layout

| Path | What |
|---|---|
| `src/index.html` | The page. `{{pic}}`, `{{theme}}`, `{{clip}}` and `{{srcset}}` tags expand at build time. |
| `src/styles.css`, `src/site.js` | Styles, and the script that plays the scene clips while they are on screen (never under reduced motion) and fills in the download link. |
| `src/fonts/` | Jost (SIL OFL 1.1, license beside it), the font BB Studio bundles for Miami 1985's headings. |
| `assets/img/`, `assets/video/` | The optimized screenshots (AVIF and WebP at several widths) and clips (WebM and MP4). Generated; do not edit. |
| `scripts/` | The demo seeding (`demo-data.mjs`, `demo-features.mjs`), capture, image and build scripts. |
| `dist/` | The build. Not committed. |

## Download

The Download section says "Coming soon". `site.js` asks GitHub for `repos/patleeman/bb-studio/releases/latest`, which returns only a published, non-prerelease release (drafts never), and then links its DMG, or the release page. That request is the page's only one to another site.

## Build and preview

```sh
node site/scripts/build.mjs
mkdir -p /tmp/bbsite-serve && ln -sfn "$PWD/site/dist" /tmp/bbsite-serve/bb-studio
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/bbsite-serve
```

Open `http://127.0.0.1:8765/bb-studio/`, the same base path as GitHub Pages.

## Publish

Patrick reviews the local build first. Then run the Pages workflow from the Actions tab (or `gh workflow run pages.yml -R patleeman/bb-studio`). To deploy on every push again, put back its `push` trigger (branch `main`, paths `site/**` and the workflow file).

## How the screenshots were made

The screenshots come from a scratch BB Studio with made-up data. Nothing in them comes from a real install.

- **The scratch instance.** `scripts/scratch.sh start` runs `$DESKTOP/packages/bb-app/dist/bb-app.js` (`--bundled --no-in-app-updates`, an unsigned build) with its own data dir (`/tmp/bbsite/data`), port 38994 (daemon 38995), `BB_STUDIO_IMPORT_FROM=off` (no import or mirror of `~/.bb`), Pi off (`BB_PI_BRIDGE_COMMAND=/usr/bin/false`, because Pi writes its sessions under `~/.bb` whatever the data dir), and a `PATH` with no agent CLI on it. `HOME` stays the real one, so the keychain is there; every write goes to the data dir. No agent turn can start: the Claude Code and Codex CLIs are not found.
- **Studio.** `scripts/demo.sh` builds Studio and Visual Chat from this repository's `HEAD` (`git archive` into the scratch dir) and installs them there by path. It marks Studio's first run as done first, so Studio does not make its own Assistant.
- **The demo data** is in `scripts/demo-data.mjs`: three Bots (Atlas, Juniper, Scout), their conversations, workers, one pending approval, pages, a whiteboard, memory records, todos, paused automations and four saved skills.
  - `scripts/seed-db.mts` writes the threads and their messages into bb's database with bb's own DB helpers (`@bb/db`: `createThread`, `insertEvents`, `createPendingInteraction`), with the server stopped.
  - `scripts/seed-studio.mjs` makes the Bots on those threads and sets their themes and presences through Studio's RPCs, creates pages and the whiteboard with the `bb studio` CLI, adds memory and automations through RPCs, and writes todos and skills to Studio's store. It turns off Smart Queue and resume-after-restart for the demo.
  - `scripts/fixups.mjs` puts back what the server settles on start (the running worker, the pending approval) and places each thread with its Bot.
  - `scripts/seed-features.mjs` adds the Studio items in `scripts/demo-features.mjs`: a launch page with stats, a chart, a checklist and live embeds, its whiteboard, a design with three screens, a dashboard, a mini app with records, three artifacts, a recording with its transcript, summary and notes page, a Visual Chat board, and a code folder with its project and Studio Code workspace. It uses Studio's CLI and RPCs where they work without an agent turn; the design, the recording's transcript and the board's finished page are written to the stores directly, because only an agent (or a microphone and a speech model) makes those.
- **Capture.** `scripts/capture.mjs` drives headless Chromium (Playwright) at 1600 × 1000 and 2x against the scratch server, with `window.bbDesktop = { platform: "macos" }` so the app draws the desktop app's framed layout. It switches Atlas's theme through Studio's RPCs for each theme shot, opens Cmd+K, Edit space and a two-pane workbench by keyboard and mouse, opens each Studio item in its own tab (Studio Code with `code.reveal` on a few lines), captures the composer, captures Skills in Atlas's controls and the Accounts panel from the sidebar footer, and records three 16-second clips. The scratch server has no Account Pooler and no provider signed in, so `capture.mjs` answers `accounts.status` itself with three made-up accounts (no emails, no tokens); the panel draws them as it draws real ones. Tonight's Sky is previewed at night (`bb studio theme sky --date`); Kyoto Garden by day.
- **iPhone.** `ios-*.png` come from the iPhone app's own offline demo (`-qaBotDemo chat`, `-qaBotDemo needs`, `-qaBotDemo chat -qaStateDemo widgets-bot`, with `-serverURL https://offline-fixtures.invalid`) in an unsigned Debug build on a simulator device made for the purpose. Copy them into the raw folder before `images.mjs`.
- **Presence sheet.** From Studio's own script: `node <scratch>/src/plugins/packages/bb-studio/scripts/presence-sheet.mjs <raw>/presence-sheet.png` (needs Google Chrome).
- **Images.** `scripts/images.mjs <raw-dir>` crops and resizes with `sips` and `ffmpeg`, then writes AVIF (`avifenc`) and WebP (`cwebp`), and encodes 6-second clips at 960 px.

To make them again (from the repository root; raw captures stay out of git):

```sh
npm i --prefix /tmp/bbsite-tools playwright@1.64.1   # once; uses the cached Chromium
# A built copy of the desktop app, so the scratch server never runs from a worktree someone else is building in:
git -C ~/workingdir/bb-studio-app-desktop archive HEAD | tar -x -C /tmp/bbsite-desktop && (cd /tmp/bbsite-desktop && pnpm install --frozen-lockfile && pnpm build)
export DESKTOP=/tmp/bbsite-desktop BB_CLI=~/workingdir/bb-studio-app-desktop/apps/cli/dist/index.js
RAW=/tmp/bbsite-shots/raw   # any folder outside the repository
site/scripts/demo.sh                                 # scratch server, seeded, left running
node site/scripts/capture.mjs /tmp/bbsite/ids.json "$RAW"   # Chromium runs with --use-mock-keychain
node /tmp/bbsite/src/plugins/packages/bb-studio/scripts/presence-sheet.mjs "$RAW/presence-sheet.png"
node site/scripts/images.mjs "$RAW"
node site/scripts/build.mjs
site/scripts/scratch.sh stop && site/scripts/scratch.sh wipe
```

`DESKTOP` is a built desktop tree (default `~/workingdir/bb-studio-app-desktop`); `BB_CLI` is the bb CLI the scripts call (default `$DESKTOP/apps/cli/dist/index.js`); `SCRATCH` is the scratch dir (default `/tmp/bbsite`). The scripts refuse a data dir under `~/.bb` or `~/.bb-studio`.

## Copy

Plain, concrete sentences. State what the app does. No taglines, quips or invented numbers. The facts come from `plugins/packages/bb-studio/README.md`.
