# Drag and drop audit

One payload carries "an item" through every drag in Studio and in BB: a
thread, a document, a tab or a file (`src/kit/app/item-drag.ts`, MIME type
`application/x-bb-item`). Every drag is a native drag since 11 Nov: BB's own
side panel tabs are `draggable` elements that write the payload in
`dragstart`, so a tab can leave its window. A side panel tab carries `tab`
(a plugin action tab) and `open` (what BB's workbench API opens it with); a
tab that cannot leave its window (terminal, browser, Info, Diff, New Tab,
fixed tabs) carries neither and BB marks the drag `application/x-bb-item-local`.
This table says what each source does on each target, from what the code
does and its tests prove. Nothing here was dragged by hand in a running BB.

- **works**: Studio's code handles it and a test covers it.
- **works (BB)**: the target is BB's own surface. BB decides where the
  pointer is and draws the indicator, then calls Studio's handler
  (`slots.experimental_itemDrop`, `src/ui/item-drop.ts`). The handler is
  tested with the calls BB makes; BB's side is tested in the fork.
- **BB moves it**: BB handles the drop itself, before any plugin's handler;
  Studio's handler is not asked.
- **not**: it does nothing. The footnote says why.
- **n/a**: the pair makes no sense, or belongs to BB alone.

| Source ↓ / Target → | Main panes (tab row, panel body, right edge) | Popped-out window's tab row | Composer | Page body | Main view |
| --- | --- | --- | --- | --- | --- |
| Bot sidebar row (a conversation or a worker) | works (BB) [a] | works (BB) [a] [k] | works (BB) [b] | works | works (BB) |
| Bot page row (Memory, Library, Automations, Todos, the Archive's row) | works (BB) [a] | works (BB) [a] [k] | works (BB) [i] | not [4] | works (BB) |
| Bot switcher icon (a Bot) | works (BB) [a] | works (BB) [a] [k] | works (BB) [i] | not [4] | works (BB) |
| Library row (a file) | works (BB) [c] | works (BB) [c] [k] | works (BB) [b] | works [d] | works (BB) |
| New Tab Recent or search row | works (BB) [a] [j] | works (BB) [a] [j] [k] | works (BB) [b] [j] | works [d] [j] | works (BB) [j] |
| Search result: thread or document | works (BB) [a] [c] | works (BB) [a] [c] [k] | works (BB) [b] | works [d] | works (BB) |
| Side panel tab (Studio's, in the main window) | BB moves it [e] | BB moves it [l] | works (BB) [b] | works [f] | works (BB) [g] |
| Side panel tab (BB's file: workspace, host, thread storage) | BB moves it [e] | BB moves it [l] | not [1] | not [1] | not [1] |
| Side panel tab (terminal, browser, Info, Diff, New Tab, fixed) | BB moves it [e] | not [5] | not [1] | not [1] | not [1] |
| Popped-out window's tab (Studio's) | BB moves it [l] | BB moves it [e] [m] | works (BB) [b] | works [f] | works (BB) [g] |
| Popped-out window's tab (BB's file) | BB moves it [l] | BB moves it [e] [m] | not [1] | not [1] | not [1] |
| Finder file | not [2] | not [2] | n/a [3] | works [h] | not [2] |
| Transcript card or link | works (BB) [c] | works (BB) [c] [k] | works (BB) [b] | works [d] | works (BB) |

## What "works" means in each case

- [a] Opens it as a tab beside the conversation on screen (a thread: not
  the conversation that workbench is beside). Dropped on a pane's tab row
  it opens at that place in that pane; on the workbench's right edge, in a
  second pane; elsewhere on the panel, where tabs open. What each row opens
  is the tab kinds registry's (`src/tab-kinds.ts`, `docs/tab-kinds-audit.md`).
- [b] Where BB has the fork's `insertThreadMention` and `insertMention`, a
  pill: BB's own thread mention, or Studio's item mention (the item's kind is
  the provider). Elsewhere the text Studio already uses to mention an item in
  a new thread's prompt: a Markdown link, `[Title](/threads/…) ` or
  `[Title](/plugins/studio/studio/…) `, through `target.insertText`.
- [c] Only for kinds with a workbench view (every kind `typeOfId` knows that
  the Studio tab can show). `canDrop` is false for the rest, and for a tab
  already in that workbench.
- [d] A whiteboard, an artifact, a recording and a mini app become their
  embed card after the block dropped on; a thread, a page and every other
  document become a mention at the end of that block.
- [e] A tab dropped on a tab row of its own window: BB reorders it in its
  pane, moves it to the other pane (the row, or the pane's body, which puts
  it last), or makes a second pane for a drop on the right edge of a single
  pane. The tab keeps its key. Studio's `canDrop` is false for a tab of that
  very workbench anyway.
- [f] BB's side panel tabs are native drag sources, so the page gets the
  drag events with the payload and decides as for any item.
- [g] The workbench tab moves: it opens in the main view and its workbench
  tab closes. In the same window Studio closes it (`requestCloseWorkbenchTab`);
  from another window BB closes it, because the drop ended as a move.
- [h] The editor uploads it, as before (an image shows as an image).
- [i] The page's address as a Markdown link, `[Memory](/plugins/studio/studio/memory/…) `.
- [j] BB draws the row and writes the payload Studio gives it
  (`experimental_dragItem`): a thread, a document or a Studio tab, as the
  row's kind drags anywhere else.
- [k] The same handler as in the main window. BB hands the target its own
  `open` (the panel the drop landed in), and Studio opens through it, so no
  Studio component has to be mounted in that window (`depsForTarget`,
  `src/ui/item-drop.ts`). The window's panel is the conversation's, so a
  conversation row for that very conversation is refused as in [a].
- [l] Between windows: BB opens the tab in the panel the drop landed in from
  the payload's `open` spec, at the place dropped, and the window it came
  from closes its tab when its `dragend` reports the drop as a move. Studio's
  handler is not asked. A window whose last tab leaves closes.
- [m] A popped-out window's own tabs reorder and split into two panes as
  in the main window; Return to workbench brings every tab back to the
  panel that popped the first one out.

## Why the rest doesn't

- [1] BB's own tabs name no address and no Studio item: `dragItemRef` is
  null, and Studio's handler refuses them. Terminal and browser tabs carry no
  `open` either.
- [2] A file from Finder is BB's own on its surfaces: it attaches it to the
  composer, and Studio's handler leaves files alone.
- [3] BB attaches files to a message itself.
- [4] A page body takes threads and documents only.
- [5] The tab cannot be shown in another window (a terminal, a browser tab,
  Info, Diff, New Tab, a fixed tab, a file opener tab, an attachment). BB
  marks the drag `application/x-bb-item-local`, the other window shows the
  no-drop cursor, and nothing happens on drop.
