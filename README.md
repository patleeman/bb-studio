# BB Studio

[BB](https://getbb.app) plugins for writing, talking, drawing, designing and
keeping what your agents make. Studio is one plugin with pages, recordings,
drawings, designs and artifacts built in: every item lives in one collection
that you can search, tag, and hand to an agent. Emoji reactions on replies
are built in too. Code, Decisions and Mobile are separate plugins
beside it.

![Live BB screenshot of the Studio collection](packages/bb-studio/assets/staged-preview.png)

| Plugin | ID | What it does |
| --- | --- | --- |
| [Studio](packages/bb-studio/) | `studio` | The hub, with everything you make built in: pages (collaborative documents with checklists you hand to agents, inline whiteboards and Explore's Next row), recordings and dictation (audio saved as you speak, then transcribed), drawings (Excalidraw scenes), designs (UI prototypes and slide decks with a reviewer) and artifacts (the files agents make). One collection with search, tags, project filters, templates, item chats, quotes and emoji reactions on replies, plus project leads with a Heartbeat, a Setup page, plugin health and backup and restore. |
| [Studio Code](packages/bb-studio-code/) | `studio-code` | VS Code as BB's editor: each thread gets its own VS Code on its worktree, and code files open there. Run by a local code-server. |
| [Studio Decisions](packages/bb-studio-decisions/) | `smart-decisions` | One place to set up the fast Jev model and a fallback model. Runs Smart Queue, which steers or queues a message sent to a busy thread. |
| [Studio Mobile](packages/bb-studio-mobile/) | `mobile` | The server side of the iOS app: push notifications, muted threads and the status Live Activity. |

Install Studio first; the other plugins are built to run beside it. Studio
Code's workspaces appear in Studio's collection.

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
2. Ask me whether to install all of these plugins or only some. List them with
   a one-line description each:
   - studio: the Studio collection and project leads, with pages, dictation and recordings, drawings, designs and artifacts built in; required, since the others run beside it
   - smart-decisions: Studio Decisions; the fast Jev model for Smart Queue
   - studio-code: Studio Code; VS Code beside each thread as BB's editor (downloads code-server on first open)
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
bb plugin remove studio
bb plugin install studio@bb-studio --yes
```

Your items (pages, recordings, drawings, designs and artifacts) are kept, but removing a
plugin deletes its settings and secrets, so note them first.

## Consolidation upgrades

Chat, Pages, Artifacts, Draw, Design and Talk now ship in Studio, and Studio
Sidebar (`thread-list-plus`) and Studio Tables (`studio-tables`) are retired.
New installs need at most 6 plugins. The separate Pages, Talk, Draw, Artifacts
and Design add-ons and their upgrade bridges are gone; to move items from one
of them, see [Upgrading from the separate add-ons](docs/upgrade-unified-studio.md).
Old links to their items still open in Studio.

To see where an existing install stands, open **Studio → Setup**. It lists
the add-ons you're missing, flags installed retired plugins, says what
removing each keeps and deletes, and removes one only after you confirm. See
[Studio's Setup page](packages/bb-studio/README.md#setup). Without the page,
`bb studio setup` prints the same list and the commands to run.

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
scripts/refresh-locks.sh bb-studio-code   # refresh a plugin npm lock in a clean clone
node scripts/staged-bb.mjs start         # stage the suite; stop removes it
node scripts/staged-bb.mjs start --plugin studio # all plugins, only this capture's fixtures
```

The iOS app builds with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
from `apps/ios`; its README has the commands.

See [`AGENTS.md`](AGENTS.md) for the SDK pinning, marketplace and screenshot
rules, and [`docs/`](docs/) for the design notes.

## License

[MIT](LICENSE)
