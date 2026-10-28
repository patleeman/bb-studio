# BB Studio

[BB](https://getbb.app) plugins for writing, talking, drawing, designing and
keeping what your agents make. Studio is one plugin with pages, recordings,
drawings, designs and artifacts built in: every item lives in one collection
that you can search, tag, and hand to an agent. Emoji reactions on replies
are built in too. VS Code and Decisions are part of Studio; Mobile is a
separate add-on for the iOS app.

![Live BB screenshot of the Studio collection](packages/bb-studio/assets/staged-preview.png)

| Plugin | ID | What it does |
| --- | --- | --- |
| [Studio](packages/bb-studio/) | `studio` | The hub, with everything you make built in: pages (collaborative documents with checklists you hand to agents, inline whiteboards and Explore's Next row), recordings and dictation (audio saved as you speak, then transcribed), drawings (Excalidraw scenes), designs (UI prototypes and slide decks with a reviewer) and artifacts (the files agents make). One collection with search, tags, project filters, templates, item chats, quotes and emoji reactions on replies, plus project leads with a Heartbeat, a Setup page, plugin health and backup and restore. |
| [Studio Mobile](packages/bb-studio-mobile/) | `mobile` | The server side of the iOS app: push notifications, muted threads and the status Live Activity. |

Install Studio first. Install Mobile only if you use the iOS app. Existing
VS Code workspace ids and links keep resolving; see [the compatibility note](docs/upgrade-studio-code.md).

## iOS app

[`apps/ios`](apps/ios/) is BB Studio for iPhone and Apple Watch: BB's threads,
approvals, terminals and automations, plus native Studio, Pages, Talk, Draw
and Artifacts. It talks to your BB server and uses the plugins
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
2. Ask whether to install Studio and, if I use the iOS app, Studio Mobile.
   Studio includes the collection and project leads, pages, dictation and
   recordings, drawings, designs, artifacts, VS Code, Decisions and Smart Queue.
   Mobile adds push notifications and muted-thread controls.
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
all day; CI fast-forwards `stable` to each `main` commit whose checks and
tests pass (the `promote-stable` job in `.github/workflows/ci.yml`), so
`stable` is the newest green `main`. `bb plugin update` gets it.
`node scripts/release.mjs` is the manual fallback.

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
bb plugin remove studio
bb plugin install studio@bb-studio --yes
```

Your items (pages, recordings, drawings, designs and artifacts) are kept, but removing a
plugin deletes its settings and secrets, so note them first.

## Consolidation upgrades

Chat, Pages, Artifacts, Draw, Design, Talk, Decisions and VS Code now ship in
Studio. Studio Sidebar (`thread-list-plus`) and Studio Tables (`studio-tables`)
are retired. A fresh install needs Studio; add Mobile only for the iOS app.
The old content add-ons and upgrade bridges are gone. See [Upgrading from the
separate add-ons](docs/upgrade-unified-studio.md) for the original item moves.
Old links to those items and Code workspaces still open in Studio.

To see where an existing install stands, open **Studio → Setup**. It lists
the add-ons you're missing, flags installed retired plugins, says what
removing each keeps and deletes, and removes one only after you confirm. See
[Studio's Setup page](packages/bb-studio/README.md#setup). Without the page,
`bb studio setup` prints the same list and the commands to run.

## Development

This is a pnpm workspace. Each plugin declares its own runtime dependencies;
the release dry run checks that Studio and Mobile install and build from their
package directories without workspace-only dependencies.
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
node scripts/staged-bb.mjs start         # stage the suite; stop removes it
node scripts/staged-bb.mjs start --plugin studio # all plugins, only this capture's fixtures
```

The iOS app builds with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
from `apps/ios`; its README has the commands.

See [`AGENTS.md`](AGENTS.md) for the SDK pinning, marketplace and screenshot
rules, and [`docs/`](docs/) for the design notes.

## License

[MIT](LICENSE)
