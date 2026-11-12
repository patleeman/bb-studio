# Tab kinds audit

Every kind of thing that can be a tab in a conversation's workbench, and
whether each surface reaches it. The kinds, their names, icons, tabs,
addresses and listings are one registry, `src/tab-kinds.ts`; the New Tab
Actions and search groups, the drag payloads, workbench_open's `type` enum
and the link handling are made from it. The table below is generated from the
registry (`auditTable()`); `src/tab-kinds.test.ts` fails when this file and
the registry disagree, and checks that every "had" or "added" cell is true of
the code.

- **had**: the surface reached the kind before the registry.
- **added**: it does now.
- **n/a**: it can't; the footnote says why.

Columns: **New tab** is the side panel's New Tab page (an Action, or found by
its search); **Recent** its Recent list; **Sidebar drag** a row in Studio's
sidebar or the Library dragged onto the workbench; **workbench_open** the
agent's tool; **Chat link** a link or card in a reply that opens it (and drags
as it).

| Kind | New tab | Recent | Sidebar drag | workbench_open | Chat link |
| --- | --- | --- | --- | --- | --- |
| Conversation | had | had | had | had | had |
| Worker | had | had | had | had | had |
| Bot | added | added | added | added | had |
| Page | had | had | added | had | had |
| Whiteboard | had | had | added | had | had |
| Design | had | had | added | had | had |
| App | added | added | added | added | had |
| Dashboard | added | added | added | added | had |
| Artifact | added | added | added | added | had |
| Recording | added | added | n/a [1] | added | had |
| Visual Chat board | had | had | n/a [2] | added | had |
| Memory | added | added | added | added | had |
| Skills | added | added | added | added | added |
| Library | added | added | added | added | had |
| Automations | added | added | added | added | had |
| Todos | added | added | added | added | had |
| Archive | added | added | added | added | had |
| Automation | added | n/a [3] | added | added | added |
| Todo | added | n/a [4] | added | added | added |
| Memory record | added | n/a [5] | added | added | added |
| VS Code | added | added | n/a [6] | added | had |
| File (bb) | had | had | n/a [7] | had | had |
| Diff (bb) | n/a [8] | n/a [9] | n/a [10] | had | n/a [11] |
| Browser (bb) | had | n/a [12] | n/a [10] | had | had |
| Terminal (bb) | had | n/a [13] | n/a [10] | n/a [14] | n/a [15] |
| Workflow run (bb) | had | n/a [16] | n/a [10] | added | had |

[1] The Library lists no recordings; drag one from the New Tab page's Recent or search, or Talk's Recordings page.
[2] Boards have no row in Studio's sidebar; drag one from the New Tab page's Recent or search.
[3] Automations change on their own and would crowd Recent; the New Tab search finds one.
[4] Todos change on their own and would crowd Recent; the New Tab search finds one.
[5] Memory records change on their own and would crowd Recent; the New Tab search finds one.
[6] VS Code has no sidebar row; drag it from the New Tab page's Recent, or open it from the launcher or a file.
[7] bb's own: files are dragged from Finder, which bb attaches to the composer.
[8] bb's New Tab page lists no diffs; bb's Git panel opens them.
[9] bb keeps no recent diffs.
[10] bb's own: no row.
[11] Replies don't link a diff; bb's change cards open it.
[12] bb keeps no recent browser tabs.
[13] bb keeps no recent terminals.
[14] A terminal opens by starting one; the agent has no terminal id to open. workbench_focus selects an open one.
[15] Replies don't link a terminal.
[16] bb keeps no recent workflow runs.

## Notes

- Conversations and workers open as the same tab (a thread); a dragged or
  linked thread reads back as a conversation.
- An automation, a todo and a memory record are each a tab of their own
  (`automation`, `todo`, `memory-record`, params `{ id }`): the detail a Bot
  page's row opens beside the page. An automation's id is
  `<botId>:<row id>` (the heartbeat and maintenance rows are per Bot). The
  New Tab search lists them under Automations, Todos and Memory records
  (one heading per plural, shared with the page of that name); they are
  dragged from their page's rows.
- Memory, Library, Automations, Todos, the Archive and VS Code are one page
  each. Their Recent rows are this window's record of when they were last
  opened (`src/ui/opened-tabs.ts`); the server keeps no recency for them.
- A Visual Chat board is Visual Chat's own tab (`board`) and a workflow run
  the Workflows plugin's (`workflow-run`); both are registered with
  `experimental_openableByPlugins`, so Studio opens them through the
  workbench API's `tab.pluginId`. On a BB from before that, Studio asks
  Visual Chat to open a board over a window event (`src/ui/tab-open.ts`,
  `packages/bb-studio-visual-chat/src/board-tab.tsx`).
- Every New Tab Recent and search row is a drag source too: it carries its
  payload as `experimental_dragItem`, which bb writes when the row is
  dragged. That reaches every kind with a Recent or search row, sidebar or
  not.
- The New Tab Actions sit under two headings (`experimental_newTabGroup`):
  **New** (Conversation, Page, Whiteboard, Design, App, Dashboard) and
  **Open** (Conversation, Page, Memory, Library, Automations, Todos, Archive,
  VS Code), titled by the kind's name. bb's action search lists matches under
  its own Actions heading, where each tooltip says "New page" or "Open page".
- Nothing here was checked in a running BB.
