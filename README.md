# BB Studio

A suite of [BB](https://getbb.app) plugins for writing, talking, drawing,
tracking tasks, running bot teams, and keeping what your agents make. Every
item lives in one Studio collection that you can search, tag, and hand to an
agent.

![Live BB screenshot of the Studio collection](packages/bb-studio/assets/staged-preview.png)

| Plugin | ID | What it does |
| --- | --- | --- |
| [Studio](packages/bb-studio/) | `studio` | The hub. Home for what needs you today, plus one collection for pages, recordings, drawings, artifacts, tasks, tables and bots, with search, tags, project filters, templates and tabs. |
| [Studio Pages](packages/bb-studio-pages/) | `pages` | Collaborative pages you write with your agents. |
| [Studio Explore](packages/bb-studio-explore/) | `explore` | Experimental. Agents end answers with things they noticed along the way; click one for a page explaining it. Needs Studio Pages. |
| [Studio Talk](packages/bb-studio-talk/) | `talk` | Long-form dictation and recording that saves audio as you speak and transcribes it. |
| [Studio Draw](packages/bb-studio-draw/) | `excalidraw` | Excalidraw drawings you sketch with your agents. |
| [Studio Artifacts](packages/bb-studio-artifacts/) | `artifacts` | Keeps the images, pages, reports and files your agents make. |
| [Studio Tasks](packages/bb-studio-tasks/) | `studio-tasks` | Boards of tasks you can hand to agents and embed in pages; each task follows its thread from working to review. |
| [Studio Tables](packages/bb-studio-tables/) | `studio-tables` | Structured tables with typed columns, rows, views, CSV import and export, and agent tools. |
| [Studio Teams](packages/bb-studio-teams/) | `bot-teams` | Persistent bots that work together in channels, delegate, and keep their own workspaces and memory. |
| [Studio Chat](packages/bb-studio-chat/) | `studio-chat` | "Work with this…" on every Studio item: a thread that knows what you're looking at. |
| [Float](packages/bb-studio-float/) | `float` | A panel of tabs for any thread, channel, Studio item or view, docked at the bottom or dragged anywhere. Keep several open while you work. |
| [Studio Sidebar](packages/bb-studio-sidebar/) | `thread-list-plus` | Replaces BB's thread list with one that keeps a tab for each Studio item you open, above your threads. |
| [Studio Navigation](packages/bb-studio-navigation/) | `studio-navigation` | Replaces BB's sidebar navigation with one that leaves out the Studio rows Studio and Studio Sidebar already open. Rows from BB and other plugins stay. |
| [Studio Reactions](packages/bb-studio-reactions/) | `emoji-react` | Emoji reactions on replies that draft your answer, plus optional smart reactions the assistant suggests for each reply. |
| [Studio Decisions](packages/bb-studio-decisions/) | `smart-decisions` | One place to set up the fast Jev model and a fallback model. Runs Smart Queue, which steers or queues a message sent to a busy thread, and routes Studio Teams channels. |
| [Studio Mobile](packages/bb-studio-mobile/) | `mobile` | The server side of the iOS app: push notifications, muted threads and the status Live Activity. |

Every add-on works on its own. With Studio installed, their items also appear in
Studio's collection. Studio Reactions and Studio Decisions don't use Studio at
all. Studio Teams needs Studio Decisions for its channel routing, and Studio
Explore needs Studio Pages.

## iOS app

[`apps/ios`](apps/ios/) is BB Studio for iPhone and Apple Watch: BB's threads,
approvals, terminals and automations, plus native Studio, Pages, Talk, Draw,
Artifacts, Tasks, Tables and Teams. It talks to your BB server and uses the plugins
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
   - studio: the Studio collection; recommended, since the others plug into it
   - pages: collaborative pages
   - explore: Studio Explore (experimental); pages explaining what an agent
     noticed along the way; needs pages
   - talk: dictation and voice recordings with transcripts
   - excalidraw: Excalidraw drawings
   - artifacts: keeps files your agents make
   - studio-tasks: a task board you hand to agents
   - studio-tables: structured tables with views and CSV import and export
   - bot-teams: persistent bots in channels
   - studio-chat: "Work with this…" on Studio items
   - float: a panel of tabs for threads, channels and Studio items, docked
     or dragged anywhere
   - thread-list-plus: Studio Sidebar; it replaces BB's thread list
   - studio-navigation: Studio Navigation; it replaces BB's sidebar navigation
     without the Studio rows that Studio and Studio Sidebar already open
   - emoji-react: Studio Reactions; emoji reactions that draft quick replies
   - smart-decisions: Studio Decisions; the fast Jev model for Smart Queue and
     Studio Teams routing; needed by bot-teams
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

### Coming from patleeman/bb-plugins

These plugins also ship in [patleeman/bb-plugins](https://github.com/patleeman/bb-plugins)
for now, with the same IDs. BB won't move an installed plugin to a new source,
so to switch one, remove it and install it from here:

```sh
bb plugin remove talk
bb plugin install talk@bb-studio --yes
```

Your items (pages, recordings, drawings, tasks, bots) are kept, but removing a
plugin deletes its settings and secrets, so note them first.

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
bb marketplace add path:.   # try the catalog from a local checkout
pnpm plugins:install     # install every plugin from this checkout
scripts/refresh-locks.sh bb-studio-tasks  # refresh a plugin npm lock in a clean clone
node scripts/staged-bb.mjs start         # a staged BB for README screenshots; stop removes it
```

The iOS app builds with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
from `apps/ios`; its README has the commands.

See [`AGENTS.md`](AGENTS.md) for the SDK pinning, marketplace and screenshot
rules, and [`docs/`](docs/) for the design notes.

## License

[MIT](LICENSE)
