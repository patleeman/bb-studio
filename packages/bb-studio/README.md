# Studio

> **Studio** is the core of **BB Studio**, a suite of plugins for writing, talking, drawing, tracking tasks, running bot teams, and keeping what your agents make: Studio, [Studio Pages](../bb-studio-pages), [Studio Talk](../bb-studio-talk), [Studio Draw](../bb-studio-draw), [Studio Artifacts](../bb-studio-artifacts), [Studio Tasks](../bb-studio-tasks), [Studio Chat](../bb-studio-chat), and [Studio Teams](../bb-studio-teams).

Home shows work that needs attention, agents working now, recent items, scheduled
automations and activity. Open **Collection** for everything the Studio add-ons make: pages, Talk
recordings and dictations, drawings, and saved artifacts. Search across all of them, filter by
kind, project and tag, and hand any of them to an agent.

## Staged preview

![Live BB screenshot of the Studio collection](assets/staged-preview.png)

Captured from the running BB application: the Studio collection in a staged
project, listing a page, a Talk recording and a drawing side by side, with
the kind filters and New menu in the header.

![Live BB screenshot of Studio search](assets/search.png)

Studio search (Cmd/Ctrl+K) over the same staged project, searching
"offline sync": a task matches on its title, and another task, an HTML
artifact and two pages match on their content, each showing the matching
text with the match in bold.

## What you get

- **Home** (sidebar → Studio) puts **Needs you** first: pending thread approvals
  and questions, Teams attention, review and due tasks, and unresolved comment
  replies or mentions. Rows open their source; simple approvals and single-text
  questions can be answered in place. This is a live view of the sources, with
  no separate read or done state.
- Home also brings together due and review tasks, active threads
  and bots, recent items, today's automations and Studio activity. Sections whose
  add-ons are unavailable stay hidden. The Activity tab shows measured thread
  turns, duration and failures, plus Teams bot usage and configured limits.
  Choose 1, 7 or 30 days. The `home` RPC returns the same data for other clients.
- **One collection** (sidebar → Studio): every add-on's items in one list or
  grid, with search over titles and content, kind pills, a project filter,
  and an Archived view. Drawings show thumbnails; recordings show their
  length and word count.
- **Search from anywhere.** Cmd/Ctrl+K (or **Studio: Search everything**
  in the command palette, Cmd/Ctrl+Shift+P) opens a quick-open box over any
  page. Studio indexes titles and text from current add-ons, then searches BB threads and Studio Teams channels live. The palette also has recent items and commands for creating items, opening the inbox, handing work to an agent and opening threads. Titles match as you type; each add-on also searches its content —
  page text, transcripts, drawing text, artifact files, task notes, bot
  descriptions — and the row shows the text that matched. With nothing typed
  it lists recently changed items. ↑↓ and ↵ open one.
- **Tags** group items across add-ons: a page, a drawing and a task can all
  be tagged "Launch". Tag from an item's ⋯ menu or the selection bar, filter
  by tag (or Untagged) from the tag menu, and click a chip to filter by it.
  The tag menu also renames and deletes the active tag.
- **Shared actions**: select items (shift-click for a range) to start a
  **New thread** that mentions them, move them to a project, archive, or
  delete. Actions an add-on defines, like Talk's "Copy transcripts" or Draw's
  "Copy text", appear when the selection is all that kind.
- **Tabs in the sidebar.** With [Studio Sidebar](../bb-studio-sidebar)
  as the thread list, each Studio item you open gets a tab in a Studio section
  above your threads. × or middle-click closes a tab; closing the one on
  screen opens the next. The section's ⋯ menu groups tabs by app, sorts them,
  and closes other or all tabs. Studio keeps the tabs, so every window shows
  the same ones, and closes tabs of deleted items.
- **New ▾** creates any kind an installed add-on offers, in the current
  project.
- **Takes over from the add-ons.** With Studio installed, each add-on's own
  collection hands over to Studio filtered to its kind, and item pages lead
  back to Studio. Studio's ⋯ menu can hide the add-ons' sidebar rows, so
  Studio is the only entry. Without Studio, each add-on works on its own.
- **The BB Studio theme**: the app icon's colors for all of BB, light and
  dark. Teal-black and pale-teal surfaces, a coral accent, teal file paths.
  Pick **BB Studio** in Settings → Appearance, or run `bb theme set
  plugin:studio:bb-studio`.
- **For agents**: the `studio_list_items` and `studio_tag_items` tools, the
  `bb studio` CLI, and a `studio` skill.

```sh
bb studio list [--all] [--kind <kind>] [--query <text>] [--tag <tag>] [--json]
bb studio tags
bb studio providers
bb studio reindex
```

## How it works

- Add-ons implement the Studio provider contract (`studio_describe`,
  `studio_list`, `studio_search`, `studio_create`, `studio_move`,
  `studio_archive`, `studio_delete`, `studio_action`) from
  [`@bb-studio/kit`](../bb-studio-kit), and publish them for RPC discovery.
  Studio finds them with `bb.sdk.plugins.experimental_discoverRpc` and calls
  them with `callRpc`. Any plugin can join the suite this way.
- Studio keeps an FTS5 index of item titles and `studio_read` text. `studio_changed` updates changed items; `bb studio reindex` rebuilds the index. Older v1 add-ons use `studio_search` as a fallback. The `searchAll` RPC returns ranked items, thread matches and channel messages with snippet ranges.
- An add-on tells Studio when its items change (`studio_changed`); Studio
  relays that over realtime and the open collection refetches.
- A stopped or failing add-on shows up as unavailable instead of breaking the
  collection.
- Studio stores only tags and open tabs, keyed by `<plugin id>:<item id>`, so add-ons
  don't need to know about them. Tags on items an add-on no longer lists are
  dropped. Each add-on owns its data, editors, tools, CLI and mentions.

See [`docs/studio.md`](../../docs/studio.md) for the design.

## Development

```sh
pnpm typecheck
pnpm test
bb plugin build .
```

`@bb-studio/kit` is a `file:../bb-studio-kit` dependency. Keep
`package-lock.json` current (regenerate it in a clean clone, not the pnpm
workspace), because BB's Git install runs `npm install` from it.

## Templates, playbooks, and export

Pages, drawings, and tasks can be saved as templates from an item's menu. The New menu lists those templates and three built-in playbooks: Launch review, Bug triage, and Weekly review. A playbook creates pages and tasks in the selected project. `bb studio playbooks` lists them; `bb studio playbook-run <id> --project <id> [--name <value>]` runs one. Agents can call `studio_playbook_run`. Custom playbooks can be saved through `savePlaybook` and run through `runPlaybook`; `startHandoffs` starts threads for tasks with handoff prompts.

The hub offers `duplicate`, `setTemplate`, `instantiateTemplate`, `templates`, `exportItem`, and `exportBulk` RPCs. `exportBulk` returns a base64 ZIP containing the provider's files. Individual exports use the item's menu. Template fields use `{{name}}` style variables; unknown variables remain visible.
