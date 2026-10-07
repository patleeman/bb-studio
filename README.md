# BB Studio

A suite of [BB](https://getbb.app) plugins for writing, talking, drawing, and
keeping what your agents make. Every
item lives in one Studio collection that you can search, tag, and hand to an
agent.

![Live BB screenshot of the Studio collection](packages/bb-studio/assets/staged-preview.png)

| Plugin | ID | What it does |
| --- | --- | --- |
| [Studio](packages/bb-studio/) | `studio` | The hub. One collection for pages, recordings, drawings, artifacts and tables, with search, tags, project filters, templates, item chats and quotes, and Spaces: areas of work, each with a lead thread and a brief. |
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

Requires BB 0.44 or later. Paste this prompt into a BB thread and your agent
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

Chat now ships in Studio, and Navigation ships in Studio Sidebar. New installs
need at most 12 plugins. For an existing install, update Studio and the old Chat plugin,
then run `bb studio-chat migrate`. Wait for **Migration complete** before
removing the bridge. Keep it for older native clients or chat bookmarks that
still address `studio-chat`.

Float is retired: threads and Studio items open in the main view, or in a
split with ⌘-click, and the sidebar lists what you open. Update every Studio
plugin, then remove it with `bb plugin remove float`.

Update Studio Sidebar and select its **Studio Navigation** provider in
Appearance before removing `studio-navigation`. Navigation visibility and order
remain in BB's existing preferences. Saved drafts, quotes, page history and
historical bot authors remain readable.

Studio Teams (`bot-teams`) is retired and its package is deleted, so it gets no
more updates. An installed copy keeps running until you remove it. Space Command
now ships in Studio. Before removing Teams, export what you want to keep:
`bb bots list --json` lists every bot, `bb bots show <bot> --json` prints a
profile with its bot home, and `bb bots mission <bot>` and
`bb bots memory <bot>` print its MISSION.md and MEMORY.md. Copy any bot home you
still need, then run `bb plugin remove bot-teams`. Threads that worked as a bot
remain ordinary BB threads.

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
```

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
