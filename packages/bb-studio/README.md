# Studio

Studio is your office in BB. Work directly in threads and documents, or delegate
to a bot and follow its progress. Spaces keep your work, team, conversations,
and Inbox together.

## Work in Spaces

A Space contains folders, and each folder is a BB project. It can be a code
checkout or an ordinary directory. Threads and the items they create belong to
that folder. Personal is the default Space.

Work includes threads, pages, drawings, tables, boards, tasks, recordings, and
saved artifacts. Search across them, open an editor, or give an item to a bot
as context. Pages and drawings come from the separate
[Pages](../bb-studio-pages) and [Draw](../bb-studio-draw) plugins.

The sidebar has a Space switcher, Home, Inbox, search, Team faces,
conversations, Favorites, and folders. Bot work stays under its tasks.

## Work with your team

Each bot belongs to a Space and has a role, persistent memory, model, and trust
level. Open its desk to chat or inspect its tasks. Talk includes both direct
messages and channels with several bots.

Delegate a brief, choose a folder, and attach any relevant items. One-off and
recurring tasks track the work. Outputs return to that folder, with the bot
recorded as author. A finished task can produce a report in your Inbox.

**Ask first** is the default trust level. Bots can work within their workspace;
actions beyond that allowance ask for approval. **Act freely** allows broader
actions without those prompts. Requests appear in the Inbox so you can approve
or decline them.

## Keep up through Home and Inbox

Home shows requests, active work, reports, and recent items in the current Space.
Inbox combines approvals, questions, reports, and comments. View a single Space
or **All spaces**. Reading or marking an event done updates its Inbox state;
requests route your answer to the source that owns them.

## Install

Install `studio@bb-studio` from the
[BB Studio marketplace](../../README.md#install). Studio includes tasks, tables,
recordings, artifacts, bots, conversations, reports, chat, and its sidebar.
There are six installable plugins: Studio, Pages, Draw, Float, Reactions, and Mobile.

For an existing 17-plugin installation, disable the old plugins and reload Studio
and Pages to import their data and settings before uninstalling them. Sources
are retained. [Legacy cleanup](../../docs/legacy-data-cleanup.md) is an explicit
preview-and-archive action; it preserves bot homes and any data it cannot safely
remove.

## Staged preview

![Studio running in an isolated staged BB](assets/staged-preview.png)

Captures use the real BB app with a separate data directory and seeded Orbit
work. Run `node scripts/staged-bb.mjs start`, source its `capture.env`, then use
`scripts/capture-plugin-screenshots.mjs`. Capture definitions assert the live
surface and fixture content before writing images.

## Commands and agent tools

```sh
bb studio list --query Orbit --json
bb studio providers
bb studio reindex
bb studio studio-tasks list
bb studio studio-tables list
bb studio talk list
bb studio bot-teams list
```

Existing tool names such as `tasks_create`, `tables_query`, `artifacts_save`,
`feed_post`, and `bots_create` remain available. A Feed post becomes an Inbox
report. Module CLI commands live under `bb studio <old-id> …`.

## Development

Core modules use in-process services and separate SQLite databases. External
providers, such as Pages and Draw, publish the Studio item contract. Studio
aggregates module kinds under the `studio` provider and indexes items for search.
The old plugin IDs are accepted by Studio's item resolver.

```sh
pnpm --filter @bb-studio/studio typecheck
pnpm --filter @bb-studio/studio test
pnpm check
bb plugin build packages/bb-studio
```

The exact stable SDK version is pinned. The shared kit is installed from
`file:../bb-studio-kit.tgz`; refresh its npm locks with
`scripts/refresh-locks.sh bb-studio` after kit or dependency changes.
See the [office model](../../docs/office-model.md) for the architecture and
compatibility decisions.
