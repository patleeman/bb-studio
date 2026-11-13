# Link audit

Every link to a Studio or bb entity opens through one router,
`src/links/router.ts`, built on the tab kinds registry (`src/tab-kinds.ts`,
`docs/tab-kinds-audit.md`). The tables below are generated from
`src/links/audit.ts` (`linkSchemeTable()`, `linkAuditTable()`,
`linkAuditSources()`); `src/links/audit.test.ts` fails when this file and the
code disagree, and `src/links/router.test.ts` checks that every registry kind
has a canonical link that parses back to itself and opens through the router.

## The rule

- A click opens the target in the workbench of the conversation on screen
  (the registry's open spec: a Studio tab, a sibling plugin's tab, or bb's own
  file, diff or browser tab through the workbench API).
- ⌘-click (Ctrl elsewhere) opens a new tab in the workbench's second pane
  (pane 2 when there are two, a new pane when there is one).
- Shift-click opens a window of its own (`experimental_popOut` at the target's
  app route; a file or diff opens in the workbench, then pops out).
- An external http(s), mailto or tel link goes to the user's browser setting
  (system browser, or the in-app browser), whatever the modifier.
- With no conversation on screen, a thread opens in the main view; an item
  opens beside the Studio page, or in the main view elsewhere.
- A Bot page (Memory, Library, Todos, Archive) is a list: a row
  opens its item as a tab in the workbench beside the page, a thread
  included (a conversation tab), and the page stays. Every row calls
  `useRowOpen()` (`src/ui/bot-page/open-row.ts`), which hands the row's
  canonical link and the click's modifiers to the router with the source
  `botPage`. The row of the workbench's selected tab is highlighted, and
  closing the tab returns focus to its row. A Studio page's workbench has no
  workbench API (`experimental_workbench` answers for threads only), so
  beside a page ⌘-click opens a tab like a click does; beside a conversation
  it opens the second pane.
- In the launcher, a popped-out item or tab, or any other window of
  Studio's, the same rule runs in bb's main window: the window relays the link
  and the rule (`window.runInMain { kind: "link", link, how }`), and the main
  window's bridge (`src/windows/ui/WindowsBridge.tsx`) opens it.
- A target that no longer exists (deleted, gone from the index, a thread or
  Bot that isn't there) opens a Not found tab (`link-not-found`, title
  "Not found") with the kind, the id and the link as typed. Existence is one
  server call, `links.resolve`, that uses the lookups `workbench_open` opens
  by (thread title, item title, Bot name, the file target); kinds with one per
  window (Library, VS Code), bot pages without a Bot id and browser URLs are
  not checked. A failed check still opens.

`howFor(modifiers)` is the one place the modifier rule lives; `openLink`
takes `how` from it unless the caller names one (the agent, a relay).

## The URL scheme

`bb://<kind>/<id>` is the canonical link of every registry kind (`linkFor`),
with the id URL-encoded; a kind with one per window has `bb://<kind>`.
`parseLink` also reads `bb://` plus an app route (`bb://threads/thr_1`, as the
mobile app's deep links do), an app route path, a full URL on this bb, a card
directive, the older `page:` and `thread:` references, and `file://` URLs.
http(s), mailto and tel links are external. A same-origin URL to a route the
registry doesn't know (Settings) parses to nothing and stays bb's.

| Kind | bb:// link | App route | Card directive |
| --- | --- | --- | --- |
| Conversation | `bb://conversation/thr_1` | `/threads/thr_1` |  |
| Worker | `bb://worker/thr_2` | `/threads/thr_2` |  |
| Bot | `bb://bot/bot_main` | `/plugins/studio/studio/bot/bot_main` |  |
| Page | `bb://page/pg_0123456789abcdef` | `/plugins/studio/studio/pages/pg_0123456789abcdef` | `::page{id="pg_0123456789abcdef"}` |
| Whiteboard | `bb://whiteboard/drw_0123456789abcdef` | `/plugins/studio/studio/drawings/drw_0123456789abcdef` | `::drawing{id="drw_0123456789abcdef"}` |
| Design | `bb://design/dsn_0123456789abcdef` | `/plugins/studio/studio/designs/dsn_0123456789abcdef` | `::design{id="dsn_0123456789abcdef"}` |
| App | `bb://app/mini_0123456789abcdef` | `/plugins/studio/studio/minis/mini_0123456789abcdef` | `::mini{id="mini_0123456789abcdef"}` |
| Artifact | `bb://artifact/art_0123456789abcdef` | `/plugins/studio/studio/artifacts/art_0123456789abcdef` | `::artifact{id="art_0123456789abcdef"}` |
| Recording | `bb://recording/rec_0123456789` | `/plugins/studio/studio/recordings/rec_0123456789` | `::recording{id="rec_0123456789"}` |
| Visual Chat board | `bb://board/thr_board` | `/plugins/studio-visual-chat/canvas/thr_board` |  |
| Memory | `bb://memory/bot_main` | `/plugins/studio/studio/memory/bot_main` |  |
| Skills | `bb://skills/bot_main` | `/plugins/studio/studio/skills/bot_main` |  |
| Library | `bb://library` | `/plugins/studio/studio` |  |
| Scheduled | `bb://automations` | `/plugins/studio/automations` |  |
| Todos | `bb://todos/bot_main` | `/plugins/studio/studio/bot/bot_main/loops` |  |
| Archive | `bb://archive/bot_main` | `/plugins/studio/studio/conversations/bot_main` |  |
| Automation | `bb://automation/bot_main%3Aaut_0123456789abcdef` | `/plugins/studio/studio/automation/bot_main%3Aaut_0123456789abcdef` |  |
| Todo | `bb://todo/loop_0123abcd` | `/plugins/studio/studio/todo/loop_0123abcd` |  |
| Memory record | `bb://record/mem_0123456789abcdef` | `/plugins/studio/studio/record/mem_0123456789abcdef` |  |
| VS Code | `bb://vscode` | `/plugins/studio/vscode` |  |
| File (bb) | `bb://file/%2FUsers%2Fp%2Fsrc%2Fa.ts` |  |  |
| Diff (bb) | `bb://diff/src%2Fa.ts` |  |  |
| Browser (bb) | `bb://browser/https%3A%2F%2Fexample.com%2Fdocs%3Fx%3D1` |  |  |
| Terminal (bb) | `bb://terminal` |  |  |
| Workflow run (bb) | `bb://workflow/wfr_0123abcd` |  |  |

## Sources × kinds

**routes** means the source hands the link to the router, which opens it by
the rule above; **n/a** says why it can't.

| Kind | Transcript link | Mod/Shift-click | Chat card | Link in a page | Link on a whiteboard | Link in a design | Mini app bb.open | Cmd+K | Launcher | workbench_open | Popped-out window | Bot page row |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Conversation | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Worker | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Bot | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Page | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Whiteboard | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Design | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| App | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Artifact | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Recording | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Visual Chat board | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Memory | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Skills | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Library | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Scheduled | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Todos | routes | routes | routes | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Archive | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| Automation | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Todo | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| Memory record | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | routes |
| VS Code | routes | routes | n/a [2] | routes | routes | n/a [1] | routes | routes | routes | routes | routes | n/a [3] |
| File (bb) | routes | n/a [4] | n/a [2] | routes | routes | n/a [1] | routes | n/a [5] | n/a [5] | routes | routes | n/a [3] |
| Diff (bb) | n/a [6] | n/a [4] | n/a [2] | routes | routes | n/a [1] | routes | n/a [5] | n/a [5] | routes | routes | n/a [3] |
| Browser (bb) | routes | n/a [4] | n/a [2] | routes | routes | n/a [1] | routes | n/a [5] | n/a [5] | routes | routes | n/a [3] |
| Terminal (bb) | n/a [7] | n/a [7] | n/a [7] | n/a [7] | n/a [7] | n/a [1] | n/a [7] | n/a [7] | n/a [7] | n/a [8] | n/a [7] | n/a [7] |
| Workflow run (bb) | routes | n/a [4] | n/a [2] | routes | routes | n/a [1] | routes | n/a [5] | n/a [5] | routes | routes | n/a [3] |

[1] A design's screens are sandboxed frames; a link in one opens as the frame's popup. The design's card and header go through the router.
[2] No card names one.
[3] No Bot page lists one.
[4] Only by a bb:// link or file:// URL; marked items and in-app links are Studio's and threads.
[5] Cmd+K lists no such rows; a typed bb:// link, app route or web address goes through the router.
[6] Replies don't link a diff; bb's change cards open it.
[7] A terminal has no id; nothing links one.
[8] A terminal opens by starting one; workbench_focus selects an open one.

## Sources

| Source | Where it calls the router | Test |
| --- | --- | --- |
| Transcript link | src/ui/link-handler.ts (bb's experimental_linkHandler) | src/ui/link-handler.test.ts; src/links/router.test.ts |
| Mod/Shift-click | src/ui/ItemGestures.tsx linkGesture | src/ui/ItemGestures.test.tsx |
| Chat card | src/links/open.ts useOpenCard (PageCard, DesignCard, DrawingDirective, MiniCard, ArtifactCard, RecordingCard) | src/ui/studio-open.wiring.test.tsx (reply cards) |
| Link in a page | src/pages/ui/PagesPanel.tsx openLink, src/pages/ui/PageEditor.tsx | src/ui/studio-open.wiring.test.tsx (page content) |
| Link on a whiteboard | src/links/whiteboard.ts (Excalidraw onLinkOpen) | src/links/whiteboard.test.ts |
| Link in a design | none: screens are sandboxed frames | none |
| Mini app bb.open | src/minis/ui/mini-frame.tsx openTarget | src/ui/studio-open.wiring.test.tsx (mini apps' bb.open) |
| Cmd+K | src/launcher/ui/CommandPalette.tsx run | src/launcher/ui/CommandPalette.test.tsx |
| Launcher | src/launcher/ui/Launcher.tsx run | src/launcher/ui/Launcher.test.tsx |
| workbench_open | src/workbench-agent/server.ts linkedInput | src/workbench-agent/workbench-agent.test.ts |
| Popped-out window | src/links/open.ts inMainWindow, LinksBridge in each window | src/links/open.test.ts; src/links/router.test.ts (relay) |
| Bot page row | src/ui/bot-page/open-row.ts useRowOpen (Automations, Todos, Library, Memory, Archive) | src/ui/bot-page/open-row.test.tsx; each page's test |

## Not wired

- Links inside a design's screens: the screens render in sandboxed frames
  (`allow-popups`, no `allow-same-origin`), so a click in one can't be seen
  from outside; it opens as the frame's popup. The design card in chat and the
  design's header go through the router.
- A plain click on a bb route inside a transcript reaches the router only on
  a bb with the link-handlers seam's click capture (the fork patch in
  `/tmp/sn-link-router-fork`); on an older fork, bb navigates the main view
  itself and ⌘- and Shift-clicks are taken by `ItemGestures`.
- Mentions and embeds inside a page (`openPage`, `openPath`, `openThread`)
  keep Studio's container rule (`src/ui/studio-open.tsx`); only link text
  goes through the router.

Nothing here was checked in a running bb.
