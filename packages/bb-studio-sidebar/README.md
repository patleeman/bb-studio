# Studio Sidebar

> **Studio Sidebar** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, and keeping what your agents make. See the [suite overview](../../README.md).

Studio Sidebar replaces BB's Thread List sidebar provider. It keeps the thread
list and its organization controls, and adds the features below. Its plugin
id is `thread-list-plus`.

## Install

Install the plugin in BB, then choose **Studio Sidebar** in **Settings →
Appearance → Sidebar → Thread list provider**. The bundled Thread List plugin
stays installed. It needs BB 0.45 or newer and Plugin SDK 0.6.15 or newer.

## Features

- **Studio sections above your threads.** Each Studio app can add a section,
  like Studio's tabs for the items you have opened. Everything scrolls as one
  list; no section has its own scroll area.
- **Section controls.** A section's ⋯ menu moves it up or down or hides it.
  **Threads ⋯** lists hidden sections to show again. The layout is kept per
  browser and follows across windows.
- **New project** in the **Threads ⋯** menu. It opens a folder picker or takes
  a folder path, creates the project, and opens it.
- **Hide empty projects** in **Filter → Projects**. Selected, new, and renamed
  projects stay visible.
- **Needs me sort.** Threads waiting on you come first, then working threads,
  then the rest. A parent ranks by its most urgent sub-thread.
- **Hidden threads.** Choose **Hide** in a thread's menu. It leaves every
  section along with its sub-threads. A section's ⋯ menu offers **Show N hidden
  threads** until the window reloads, and **Hide hidden threads** to put them
  away. A shown hidden thread offers **Unhide**; its sub-threads offer neither.
  Pinned threads, the open thread, and Space leads always show. BB's **Hide from
  list** still hides a whole section.
- **Studio Navigation**, selectable in BB Appearance. See [Navigation](#navigation).
- **Automations tab.** In a thread's side panel, **+ → Automations** lists the
  automations that wake that thread. Each row shows the name, the schedule in
  words (such as "Every 30 min" or "Weekdays 9:00"; other crons show as
  written), when it runs next, and the last run's result or error. A switch
  pauses or resumes it, and **Edit** opens it in Automations. The tab
  refreshes when it opens and every 30 seconds while it's visible. If nothing
  targets the thread, it says so. If BB's Automations plugin is off or doesn't
  answer, the tab says Automations are unavailable.
- **Automations badge.** A thread that automations wake shows a clock with
  their count in its header. Click it to open the Automations tab. The badge
  uses BB's experimental thread header slot, so the plugin still loads where
  that slot is missing.

### By space

**Threads ⋯ → Organize → By space** shows one [Studio](../bb-studio) Space at
a time, like Arc. It needs a Studio with Spaces. Until Studio answers, the
option is disabled, and a list already set to By space shows By project.

- **Switcher.** A row of dots at the bottom of the list. The first dot, a
  grid, is **All**: every Space stacked in Studio's order, each collapsible.
  Then one dot per Space (its emoji, or a dot in its colour). Hover for the
  name; **+** makes a new Space. An amber mark on a dot or heading means a
  thread there needs you.
- **Switch Spaces** with **⌃⌥←** and **⌃⌥→** (not in text fields) or a
  horizontal two-finger swipe over the list. The choice is a synced
  preference.
- **No headings inside a Space.** Top to bottom: its open Studio items as
  small chips under the Space heading; the **lead**, with a star instead of a
  status dot; pinned threads, in pin order; then the other threads, with
  threads that need you first. Sub-threads stay with their root, and dropping
  one thread on another still nests it. Threads in no Space belong to the
  default Space (Personal).
- **Chips.** Click to open the item in place of the current pane; ⌘/Ctrl-click
  to open it in a split. × or a middle-click closes the chip without touching
  the item. Right-click (or long-press) for Open in split, Pin, Rename, Copy
  link, Copy ID, Close, Archive, and Delete. Pinned chips stay first.
- **Thread rows** show a status dot (amber needs you, green working, red
  unread error, blue unread result; none when read and idle), the age on the
  right, and a muted second line with the latest progress from Studio (red for
  a failure, amber when blocked).
- **Space heading.** Its ⋯ menu has **New thread here**, **Command view**
  (shown once Studio is installed), **Lead and heartbeat…**, **Edit Space**,
  and **Delete Space**. On hover, **+** starts a thread in the Space's default
  project or makes a Studio item of any kind, and **Browse** searches the
  Space's closed Studio items and archived threads together (10 recent
  archived threads, then **Load more**).
- **Lead.** Any thread's menu offers **Make Space lead** or **Remove as Space
  lead**. A lead can't be archived from the sidebar: not from its row, its
  menu, or an environment's **Archive threads** (which archives the rest).
  Remove it as lead first. BB's own archive shortcut still archives a lead.
- **Move to Space.** A top-level thread's menu lists the Spaces to move it
  to. Dropping a thread on a Space's section, heading, or dot also moves it.
  A thread belongs to one Space.
- **Pins live in their Space** instead of a Pinned section. Studio's own
  **Spaces** section steps aside while By space is on.
- **New thread.** With one Space shown, BB's **New thread** (with Studio
  Navigation) starts in that Space's project.

## CLI and settings

`bb thread-list-plus prefs list | get <key> | set <key> <json> | reset <key>`
reads and changes the layout preferences, for example
`bb thread-list-plus prefs set hiddenThreads '["thr_…"]'`. Run `prefs list`
for every key. The plugin defines no agent tools and no `settings.define`
entries.

## Upstream

`source/` vendors BB's MIT-licensed Thread List plugin at the commit in
`upstream/BB_COMMIT` (currently `8595b6ea4b8bfa771f84d57e69124e76bacf9eef`).
Studio's additions live in `source/app/studio/`, with small hooks in a few
upstream files. Those hooks are kept as `upstream/studio-hooks.patch` (runtime)
and `upstream/tests.patch` (tests).

```sh
node upstream/sync.mjs --upstream /path/to/bb --check          # vendored files match the patched commit
node upstream/sync.mjs --upstream /path/to/bb --commit <sha>   # move to a newer BB commit
node upstream/sync.mjs --upstream /path/to/bb --write-patches  # rebuild both patches after editing source/
```

The package tests run `--check` through `upstream-patches.test.ts` when a BB
checkout is found (`BB_UPSTREAM`, or `bb` beside this repository). Editing a
vendored file without `--write-patches` fails that test. See
[UPSTREAM.md](UPSTREAM.md) for the changed files, and [LICENSE](LICENSE) for
the upstream license.

## Staged preview

![Studio section with two open tabs above Threads](assets/staged-preview.png)

Captured from the sidebar of a staged BB (`node scripts/staged-bb.mjs start`), with Studio Sidebar selected as the
thread list provider. Two staged pages, "Offline mode launch" and "Release
notes: October", were opened, so the Studio section lists them as tabs above
the Threads list. The capture asserts that both tabs are present, that the
section sits above Threads, and that it has no scroll area of its own.

![Threads organized by Studio Space](assets/by-space.png)

The By space capture creates two Spaces, Launch (🚀) and Research, and adds
"Launch plan", "Launch checklist", and "Release digest" to Launch, and "Paper
notes" and "Atlas weekly sync" to Research. It makes Launch plan the Space's
lead and pins Launch checklist, then shows Launch. The live check verifies
that only Launch shows, with its threads and emoji, that the lead comes first
with a star and the pin next with a pin, under no Lead, Studio or Threads
headings, that the switcher
at the bottom has All first and a dot for each Space with Launch current, that
every Launch row has its status dot, and that Studio's
own Spaces section is gone while By space shows. No agent runs during this
capture.

![A hidden thread revealed in its Space](assets/hidden-threads.png)

The same fixture after hiding Release digest from its row's right-click menu:
the capture checks that it leaves Launch with no footer row, then opens
Launch's ⋯ menu and clicks **Show 1 hidden thread**. Release digest is back,
and Launch's ⋯ menu, left open, now offers **Hide hidden threads**.

![New project folder dialog](assets/project-dialog.png)

The dialog capture opens **New project** from the live **Threads ⋯** menu (or,
with no loose threads, the seeded Orbit project's ⋯ menu) and
checks for the folder path, Browse, and Create project controls. No project
is created during capture.

## For Studio apps

A Studio app adds a section from any always-mounted component, such as an
`experimental_appOverlay`, with [`@bb-studio/kit`](../bb-studio-kit):

```tsx
<SidebarPortal id="tabs" title="Studio" order={0}>
  <SidebarSection title="Studio" menu={…}>{rows}</SidebarSection>
</SidebarPortal>
```

Studio Sidebar renders an empty anchor for each registered section and the app
portals into it. Without Studio Sidebar, `SidebarPortal` renders nothing.

An app can also put a mark before a thread's title. Only threads with a badge
show one:

```ts
const unpublish = publishThreadBadges(pluginId, new Map([[threadId, { glyph: "🦉", label: "Working as Atlas" }]]));
```

## Preferences and Studio

Preferences are synced and set with the CLI above. The ones people ask about:

- `organizationMode`: `project`, `chronological`, `machine`, or `space`.
- `hiddenThreads`: thread ids to hide. Ids of deleted threads drop out once
  the list has loaded; archived threads stay hidden.
- `currentSpace`: the Space By space shows (a Space id, `all`, or null for the
  default Space). `collapsedSpaces` lists Spaces collapsed in All.
- `collapsedSpaceSections` is unused and kept only for old data.

Each row's second line comes from Studio's `thread_lines` RPC (leads first,
then by recency, at most 60 threads). It refreshes when the shown threads or
their status change, on focus, and every 30 seconds while the window is
visible. A lead is set through Studio's `space_set_lead` RPC.

Studio and this package talk without the kit, through browser events:

- This package writes the organization to `localStorage["bb-studio:sidebar-organization"]`
  and fires `bb-studio:sidebar-organization`. Studio's Spaces section hides
  while it reads `space`.
- Studio fires `bb-studio:studio-changed` for realtime changes and
  `studio:space-changed` after its Space dialogs. Either makes By space
  refetch, as do focus and a 30-second poll.
- This package opens Studio's dialogs with `studio:new-space` and
  `studio:space-dialog` (`{ spaceId, dialog }`).

## Development

`@bb-studio/kit` is a `file:../bb-studio-kit.tgz` dependency. Keep
`package-lock.json` current (regenerate it in a clean clone, not the pnpm
workspace), because BB's Git install runs `npm install` from it.

```sh
pnpm --filter @bb-studio/thread-list-plus typecheck
pnpm --filter @bb-studio/thread-list-plus test
bb plugin build .
```

## Navigation

Studio Sidebar also provides **Studio Navigation**, selectable in BB Appearance.
It keeps BB's and other plugins' navigation rows, hides duplicate Studio add-on
rows when the Studio hub is available, and starts new threads in the selected
Space. The separate `studio-navigation` package is retired: update Studio
Sidebar, select its navigation provider in Appearance, then remove the old
plugin.

![Studio Sidebar navigation with Studio and the staged Forecast plugin](assets/navigation-preview.png)
