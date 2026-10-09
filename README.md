# BB Studio

A suite of [BB](https://getbb.app) plugins for writing, talking, drawing, and
keeping what your agents make. Every
item lives in one Studio collection that you can search, tag, and hand to an
agent.

![Live BB screenshot of the Studio collection](packages/bb-studio/assets/staged-preview.png)

| Plugin | ID | What it does |
| --- | --- | --- |
| [Studio](packages/bb-studio/) | `studio` | The hub. One collection for pages, recordings, drawings, artifacts and tables, with search, tags, project filters, templates, item chats and quotes, Spaces (areas of work with a lead thread and a Command view), a Setup page for the add-ons, plugin health and backup and restore. |
| [Studio Pages](packages/bb-studio-pages/) | `pages` | Collaborative pages you write with your agents, with checklists you hand to agents, inline whiteboards, and Explore: pages explaining what an agent noticed along the way. |
| [Studio Talk](packages/bb-studio-talk/) | `talk` | Long-form dictation and recording that saves audio as you speak and transcribes it. |
| [Studio Draw](packages/bb-studio-draw/) | `excalidraw` | Excalidraw drawings you sketch with your agents. |
| [Studio Artifacts](packages/bb-studio-artifacts/) | `artifacts` | Keeps the images, pages, reports and files your agents make. |
| [Studio Tables](packages/bb-studio-tables/) | `studio-tables` | Structured tables with typed columns, rows, views, CSV import and export, and agent tools. |
| [Studio Design](packages/bb-studio-design/) | `design` | UI prototypes you design with your agents: HTML screens on a canvas, a few options per round, and a reviewer that checks the work. |
| [Studio Code](packages/bb-studio-code/) | `studio-code` | VS Code workspaces in your Spaces: one or more folders in a full editor beside your threads, run by a local code-server. |
| [Studio Sidebar](packages/bb-studio-sidebar/) | `thread-list-plus` | Thread lists organized by Space, project, section or machine, plus navigation without duplicate Studio rows. |
| [Studio Reactions](packages/bb-studio-reactions/) | `emoji-react` | Emoji reactions on replies that draft your answer, plus optional smart reactions the assistant suggests for each reply. |
| [Studio Decisions](packages/bb-studio-decisions/) | `smart-decisions` | One place to set up the fast Jev model and a fallback model. Runs Smart Queue, which steers or queues a message sent to a busy thread. |
| [Studio Mobile](packages/bb-studio-mobile/) | `mobile` | The server side of the iOS app: push notifications, muted threads and the status Live Activity. |

Every add-on works on its own. With Studio installed, their items also appear in
Studio's collection. Studio Reactions and Studio Decisions don't use Studio at
all.

## iOS app

[`apps/ios`](apps/ios/) is BB Studio for iPhone and Apple Watch: BB's threads,
approvals, terminals and automations, plus native Studio, Pages, Talk, Draw,
Artifacts and Tables. It talks to your BB server and uses the plugins
above; install `mobile` for push notifications. See its
[README](apps/ios/README.md) to build it and ship it to TestFlight.

## Install

Requires BB 0.45 or later. Paste this prompt into a BB thread and your agent
sets it up:

```text
Install BB Studio from https://github.com/patleeman/bb-studio in my BB.

1. Add its marketplace: `bb marketplace add git:github.com/patleeman/bb-studio@main`.
   If `bb marketplace list` already shows `bb-studio`, run
   `bb marketplace refresh bb-studio` instead.
2. Ask me whether to install all of these plugins or only some. List them with
   a one-line description each:
   - studio: the Studio collection, Spaces and Command view; recommended, since the others plug into it
   - pages: collaborative pages
   - talk: dictation and voice recordings with transcripts
   - excalidraw: Excalidraw drawings
   - artifacts: keeps files your agents make
   - studio-tables: structured tables with views and CSV import and export
   - thread-list-plus: Studio Sidebar; thread organization and sidebar navigation
   - emoji-react: Studio Reactions; emoji reactions that draft quick replies
   - smart-decisions: Studio Decisions; the fast Jev model for Smart Queue
   - design: Studio Design; UI prototypes designed with agents
   - studio-code: Studio Code; VS Code workspaces beside your threads (downloads code-server on first open)
   - mobile: push notifications for the BB Studio iOS app; only if I use it
3. Install each one I choose with `bb plugin install <id>@bb-studio --yes`.
4. Run `bb plugin list`, confirm each installed plugin is running, and report
   anything that failed with its error.
```

To do it yourself, add the marketplace in **Settings → Plugin marketplaces**
with the source `git:github.com/patleeman/bb-studio@main` (or run the
`bb marketplace add` command above), then install from the store or with
`bb plugin install <id>@bb-studio`.

The `@bb-studio` suffix matters if you have another marketplace that lists
the same IDs. Without it, BB refuses the install and lists the choices.

### Releases

Plugins install from the `stable` branch, not `main`. Work lands on `main`
all day; `stable` moves forward only after every check and test passes on a
clean copy of the commit (`node scripts/release.mjs`). `bb plugin update`
gets the latest release.

An install made before 7 October 2026 follows `main`, because BB updates a
plugin from the branch it was installed from. To switch one to releases,
reinstall it: `bb plugin remove <id>`, then
`bb plugin install <id>@bb-studio --yes`. Removing a plugin deletes its
settings and secrets, so note them first; your items are kept.

### Coming from patleeman/bb-plugins

These plugins also ship in [patleeman/bb-plugins](https://github.com/patleeman/bb-plugins)
for now, with the same IDs. BB won't move an installed plugin to a new source,
so to switch one, remove it and install it from here:

```sh
bb plugin remove talk
bb plugin install talk@bb-studio --yes
```

Your items (pages, recordings, drawings, artifacts and tables) are kept, but removing a
plugin deletes its settings and secrets, so note them first.

## Consolidation upgrades

Chat now ships in Studio, Navigation ships in Studio Sidebar, and Float and
Studio Teams (`bot-teams`) are retired. New installs need at most 12 plugins.
To upgrade an existing install, update Studio and open **Studio → Setup**. It
lists the add-ons you're missing, flags installed retired plugins, says what
removing each keeps and deletes, and removes one only after you confirm. See
[Studio's Setup page](packages/bb-studio/README.md#setup).

Without the page, `bb studio setup` prints the same list and the commands to
run. The short version:

```sh
bb studio-chat migrate              # wait for "Migration complete" first
bb plugin remove studio-chat
bb plugin remove studio-navigation  # after picking Studio Sidebar's Studio Navigation provider in Appearance
bb plugin remove float
bb bots list --json                 # export the bots you want before removing Teams
bb plugin remove bot-teams
```

## Development

This is a pnpm workspace. [`@bb-studio/kit`](packages/bb-studio-kit/) holds the
shared contract, UI and helpers. BB installs a Git plugin by running npm in its
package directory alone, so each plugin depends on the packed kit,
`file:../bb-studio-kit.tgz`, which npm copies into the plugin's `node_modules`
where the kit's own imports resolve. The workspace overrides that with a link to
the live kit sources. After changing the kit or a plugin's dependencies, run
`scripts/refresh-locks.sh` for every plugin: it repacks the kit and refreshes
the npm locks, which pin the tarball's hash. `pnpm check:kit` fails while the
tarball is stale.
The Studio plugins use `sonner` 1.x because the BB host shims its installed
`sonner@1.7.4` instance.

```sh
pnpm install
pnpm check            # typecheck, tests, compatibility, documentation and marketplace
pnpm typecheck
pnpm test
pnpm check:compat        # every plugin installs on the current stable BB
node scripts/release.mjs --dry-run  # check a commit for release; without --dry-run it moves stable
bb marketplace add path:.   # try the catalog from a local checkout
pnpm plugins:install     # install every plugin from this checkout
scripts/refresh-locks.sh bb-studio-pages  # refresh a plugin npm lock in a clean clone
node scripts/staged-bb.mjs start         # stage the suite; stop removes it
node scripts/staged-bb.mjs start --plugin studio # all plugins, only this capture's fixtures
node scripts/solo-check.mjs [--plugin <id>] [--ref <sha>] # each plugin alone on a fresh stable BB
```

`scripts/solo-check.mjs` installs each plugin from GitHub (default:
`origin/main`) as the only BB Studio plugin on its own fresh stable BB, then
checks that BB reports it running, that its CLI and `studio_health` answer, and
that its main surface loads in headless Chrome without an error screen or
uncaught exception. It prints a pass/fail table and exits 1 on any failure.

The iOS app builds with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
from `apps/ios`; its README has the commands.

See [`AGENTS.md`](AGENTS.md) for the SDK pinning, marketplace and screenshot
rules, and [`docs/`](docs/) for the design notes.
The [October 2026 codebase and product review](docs/codebase-review-2026-10-02.md)
records verified fixes, plugin and mobile coverage, and remaining priorities.
The active [issue and evidence ledger](docs/review-issues.md) tracks their fixes
and the verification still required.

## License

[MIT](LICENSE)
