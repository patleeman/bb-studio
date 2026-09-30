# BB Studio

A suite of [BB](https://getbb.app) plugins for writing, talking, drawing,
tracking tasks, running bot teams, and keeping what your agents make. Every
item lives in one Studio collection that you can search, tag, and hand to an
agent.

![Live BB screenshot of the Studio collection](packages/bb-studio/assets/staged-preview.png)

| Plugin | ID | What it does |
| --- | --- | --- |
| [Studio](packages/bb-studio/) | `studio` | The hub. One collection for pages, recordings, drawings, artifacts, tasks and bots, with search, tags, project filters and tabs. |
| [Studio Pages](packages/bb-studio-pages/) | `pages` | Collaborative pages you write with your agents. |
| [Studio Talk](packages/bb-studio-talk/) | `talk` | Long-form dictation and recording that saves audio as you speak and transcribes it. |
| [Studio Draw](packages/bb-studio-draw/) | `excalidraw` | Excalidraw drawings you sketch with your agents. |
| [Studio Artifacts](packages/bb-studio-artifacts/) | `artifacts` | Keeps the images, pages, reports and files your agents make. |
| [Studio Tasks](packages/bb-studio-tasks/) | `studio-tasks` | A board of tasks you can hand to agents; each follows its thread from working to review. |
| [Studio Teams](packages/bb-studio-teams/) | `bot-teams` | Persistent bots that work together in channels, delegate, and keep their own workspaces and memory. |
| [Studio Chat](packages/bb-studio-chat/) | `studio-chat` | A chat that floats over the Studio item you're looking at. |
| [Studio Sidebar](packages/bb-studio-sidebar/) | `thread-list-plus` | Replaces BB's thread list with one that keeps a tab for each Studio item you open, above your threads. |
| [Studio Reactions](packages/bb-studio-reactions/) | `emoji-react` | Emoji reactions on replies that draft your answer, plus optional smart reactions the assistant suggests for each reply. |
| [Studio Mobile](packages/bb-studio-mobile/) | `mobile` | The server side of the iOS app: push notifications, muted threads and the status Live Activity. |

Every add-on works on its own. With Studio installed, their items also appear in
Studio's collection. Studio Reactions doesn't use Studio at all.

## iOS app

[`apps/ios`](apps/ios/) is BB Studio for iPhone and Apple Watch: BB's threads,
approvals, terminals and automations, plus native Studio, Pages, Talk, Draw,
Artifacts, Tasks and Teams. It talks to your BB server and uses the plugins
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
   - talk: dictation and voice recordings with transcripts
   - excalidraw: Excalidraw drawings
   - artifacts: keeps files your agents make
   - studio-tasks: a task board you hand to agents
   - bot-teams: persistent bots in channels
   - studio-chat: a chat that floats over Studio items
   - thread-list-plus: Studio Sidebar; it replaces BB's thread list
   - emoji-react: Studio Reactions; emoji reactions that draft quick replies
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
shared contract, UI and helpers; each plugin depends on it with
`file:../bb-studio-kit`, and BB's Git install clones the whole repository, so it
resolves without publishing the kit.

```sh
pnpm install
pnpm typecheck
pnpm check:compat        # every plugin installs on the current stable BB
bb marketplace add path:.   # try the catalog from a local checkout
pnpm plugins:install     # install every plugin from this checkout
```

The iOS app builds with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
from `apps/ios`; its README has the commands.

See [`AGENTS.md`](AGENTS.md) for the SDK pinning, marketplace and screenshot
rules, and [`docs/`](docs/) for the design notes.

## License

[MIT](LICENSE)
