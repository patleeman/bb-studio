# BB Studio

Your office in [BB](https://getbb.app), with a team of bots you can work with
and delegate to. Keep your work in Spaces and folders. Talk to your team in
DMs and channels. Read their reports and answer requests in one Inbox.

![BB Studio in a staged BB](packages/bb-studio/assets/staged-preview.png)

- **Spaces** separate your work, team, conversations, and settings. Each folder
  is a BB project, with or without a Git repository.
- **Work** holds your threads, pages, drawings, tables, task boards, recordings,
  and files. Search them together and keep related work in the same folder.
- **Team** gives each bot a role, memory, model, and trust level. Open a bot's
  desk to chat or see its tasks.
- **Delegate** a brief and relevant items to a bot. Its task keeps the progress
  and outputs together, in the folder where the work belongs.
- **Inbox** collects requests, reports, and comments. Choose one Space or
  **All spaces**. Home shows what needs you, active work, reports, and recent items.
- **Trust** is explicit: **Ask first** bots request approval for actions outside
  their allowed work; **Act freely** bots can proceed with broader permissions.

## Six plugins

| Plugin | ID | What it adds |
| --- | --- | --- |
| [Studio](packages/bb-studio/) | `studio` | The office: Spaces, Work, Team, Talk, Inbox, delegation, tasks, tables, recordings, and artifacts. |
| [Pages](packages/bb-studio-pages/) | `pages` | Collaborative pages and Explore explainers. |
| [Draw](packages/bb-studio-draw/) | `excalidraw` | Excalidraw drawings you and your agents can edit. |
| [Float](packages/bb-studio-float/) | `float` | Keep threads, conversations, and items open in a floating or docked panel. |
| [Reactions](packages/bb-studio-reactions/) | `emoji-react` | Emoji reactions that draft quick replies. |
| [Mobile](packages/bb-studio-mobile/) | `mobile` | Push notifications and server support for the iOS app. |

Studio includes the former Sidebar, Navigation, Feed, Teams, Tasks, Artifacts,
Chat, Tables, Talk recordings, and Decisions plugins. Explore is part of Pages.
Pages and Draw also work on their own; their items join Work when Studio is installed.
Bots and conversations have their own places in Team and Talk.

## Install

Paste this into a BB thread:

```text
Install BB Studio from https://github.com/patleeman/bb-studio in my BB.

1. Add the marketplace with:
   bb marketplace add git:github.com/patleeman/bb-studio@main
   If bb marketplace list already shows bb-studio, use:
   bb marketplace refresh bb-studio
2. Install studio, pages, and excalidraw with:
   bb plugin install <id>@bb-studio --yes
   Ask whether I also want float (floating panels), emoji-react (quick replies),
   and mobile (notifications for the iOS app), then install my choices.
3. If I have the old separate Studio plugins, disable them first and reload
   Studio and Pages so they import the old data and settings. Verify the import
   before uninstalling the old plugins. Do not remove their data directories.
4. Run bb plugin list, verify the selected plugins are running, and report
   any failures with their errors. Show me Home and Inbox in the Studio sidebar.
```

You can also add `git:github.com/patleeman/bb-studio@main` in
**Settings → Plugin marketplaces** and install from the store. The
`@bb-studio` CLI suffix chooses this marketplace when another lists the same IDs.
The plugins target stable BB; `pnpm check:compat` checks the current stable release.

### Upgrading from the 17-plugin layout

Disable the old plugins, then reload Studio and Pages. Imports preserve their
items, settings, links, recordings, and bot homes. Verify the imported content
before uninstalling the old plugins: uninstalling clears their host settings
and secrets. Studio commands now use `bb studio <old-id> …`; Explore uses
`bb pages explore …`.

Old links in past thread transcripts and browser bookmarks may no longer open.
Studio's own resolver accepts old item prefixes. Imported data stays in separate
module databases; source files remain until you explicitly clean them up.
See [legacy data cleanup](docs/legacy-data-cleanup.md) for previews, archives,
and the directories that must remain in place.

## iOS

The [iPhone app](apps/ios/) has **Inbox**, **Home**, **Work**, and **Team** tabs.
It connects to your BB server and uses the same Spaces, bots, tasks, and items.
Install `mobile` for push notifications. See the [iOS README](apps/ios/README.md)
for building and testing it, plus Apple Watch support.

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
scripts/refresh-locks.sh bb-studio  # refresh a plugin npm lock in a clean clone
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
