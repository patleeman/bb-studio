# Studio Navigation

> **Studio Navigation** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, running bot teams, and keeping what your agents make. See the [suite overview](../../README.md).

Studio Navigation replaces BB's sidebar navigation, the rows above the thread
list. It draws the same rows as BB's bundled Navigation plugin, and leaves out
the Studio rows that another surface already opens:

| Row | Left out while |
| --- | --- |
| Pages, Drawings, Artifacts, Recordings, Tables | Studio's row is there, since the Studio hub lists and opens every add-on. |
| Explore | Always. Explore's panel in [Studio Pages](../bb-studio-pages); explainers open from their links. |
| Companions | Always. [Float](../bb-studio-float)'s dock and toggle open it. |
| Chat | Always. [Studio Chat](../bb-studio-chat) starts chats from Studio items and its overlay. |
| Command | Always. Each Space's ⋯ menu in [Studio Sidebar](../bb-studio-sidebar) opens [Studio](../bb-studio)'s Command view. |

Left-out rows are in neither the rows nor **More**; their plugins still run
and their links still open. Everything else stays: BB's own rows (New thread,
Search threads, Plugins, Skills, Automations), Studio, Teams, and every panel from a
plugin outside BB Studio. Hide, reorder, **More**, and **Customize sidebar** work as in BB's
Navigation. A row Studio Navigation leaves out keeps its place in BB's saved
order, so it comes back where it was if you switch back. Row order is always
BB's saved order: BB passes it without saying whether you saved it, so Studio
Navigation can't set a default order without overriding yours. Drag a row
under Search threads to put it there.

Installing it makes it the sidebar navigation, unless you picked a provider
under **Settings → Appearance → Navigation**. Choose **Navigation** there to
go back to BB's. The package requires BB 0.44 or newer and Plugin SDK 0.5.29
or newer.

The `source/` directory vendors BB's MIT-licensed Navigation plugin from BB
0.44.0, with the shared UI it imports under `components/` and `lib/`. Studio's
additions are in `source/app/studio/`, with a small hook in two upstream
files. See [UPSTREAM.md](UPSTREAM.md) for the changed files and sync command,
and [LICENSE](LICENSE) for the upstream license.

## Staged preview

![Studio Navigation with BB's rows, Teams, Forecast, and Studio, and More open](assets/staged-preview.png)

Captured from a staged BB 0.44.0 started by `scripts/staged-bb.mjs`, with
every BB Studio plugin installed from this repository's Git source and a demo
project, Orbit. Studio Navigation draws the rows and Studio Sidebar the thread
list. The rows show BB's New thread, Plugins, Skills, and Automations, Studio
Teams, Studio, and Forecast, a staged plugin outside BB Studio; **More** holds
Search threads. The capture asserts that Studio Navigation draws the region,
that those rows are present, and that none of Pages, Drawings,
Artifacts, Recordings, or Tables appear in the rows or in **More**.

## Development

```sh
pnpm --filter @bb-studio/studio-navigation typecheck
pnpm --filter @bb-studio/studio-navigation test
node upstream/sync.mjs --upstream /path/to/bb --commit desktop-v0.44.0 --check
bb plugin build .
```

`@bb-studio/kit` is the packed `file:../bb-studio-kit.tgz` dependency. Keep
`package-lock.json` current with `scripts/refresh-locks.sh bb-studio-navigation`,
because BB's Git install runs `npm install` from it.

With Studio Sidebar showing one Space, **New thread** starts the thread in that Space's project, as the Space's own **+** does; ⌘-click and the All view keep bb's usual behavior.
