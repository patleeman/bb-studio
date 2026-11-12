# Fork API (BB Studio)

Plugin API that exists only in the BB Studio fork of bb. All of it is
experimental, and a plugin that also runs on stock bb must feature-detect
each member before using it. The types are in the SDK file
`app-contract.fork.ts`; the audit notes are in `docs/api_to_audit.fork.md`.

## Hooks, navigation and the composer

- `experimental_useAppRoute()` → `{ pathname, search, hash }` of the main
  view, re-rendering on every bb navigation (no `popstate` or polling).
- `openTab({ tab, params, experimental_global: true })` → opens an action
  tab as a fixed tab: drawn first in every side panel where the plugin
  registers that tab id, before the panel's own tabs, with no close button
  and no dragging. `experimental_useGlobalTabs()` → the fixed tabs
  `{ pluginId, tabId, title, params }`.
- `useBbNavigate().experimental_closeFixedTab({ tab: { id }, params? })` →
  closes one of your fixed tabs everywhere; nothing else closes it. Returns
  false when you have no such fixed tab.
- An action tab with `experimental_compactWhenFixed: true` is drawn as its
  icon alone while fixed; its title is the tooltip.
- `experimental_useAppTheme()` → `{ mode, epoch }`: resolved `"light"` or
  `"dark"`, and a counter that changes when theme CSS variables may have;
  key an effect on both to copy colors into a canvas or iframe.
- `experimental_useAppPanes()` → `{ panes, focus(paneId), close(paneId) }`,
  bb's split workspace; a pane is `{ id, path, focused }`. Open a route in a
  new pane with `useBbNavigate().experimental_toAppPath(path, { split: true })`.
- Composer footer items register `[{ id, component }]` through
  `experimental_footer` on a `thread`-scoped customization, in the row under
  the input before bb's own controls. Draw one one-line chip, or return null.
  Read the thread with `useBbContext()`. Hidden while the composer is collapsed.
- `useBbNavigate().experimental_toAppPath(path, { replace?, split? }?)` →
  navigate the main view to any bb route by path, like an in-app link;
  `split: true` opens it in a new pane.

## Replace the composer

- `app.composer.customize({ id, scopes: ["thread"], experimental_replace: {
useActive, component } })` → draws `component` where an existing
  thread's composer box goes, for threads nobody should type into (a
  read-only worker, a mirrored thread). bb calls `useActive({ threadId })`
  as a React hook for every thread composer it shows, in the main thread
  view and in every `ThreadChat`; while it returns true, `component` gets
  `{ threadId }` and takes the composer's place and width, and no composer
  is drawn. Read the thread from the `threadId` prop, not `useBbContext()`:
  in a `ThreadChat` the route shows another thread. The first active plugin
  by id wins. A throw in `useActive` counts as false, and a crash in
  `component` shows bb's composer again.

Names: `ExperimentalComposerReplace`, `ExperimentalComposerReplaceProps`.

## Slots, tabs and the search palette

- An action tab may give `experimental_instanceIcon(params)` → a bb icon
  name for one open instance (null keeps the registration's `icon`). Keep it
  pure and cheap; it runs while the tab strip renders.
- `app.slots.experimental_sidebarNewItem({ id, title, icon, group?, run })` →
  a row in a New menu that a plugin draws (bb's own sidebar header has only
  New thread); rows sharing a `group` sit under one divider. `run` creates
  the thing and shows it. The plugin that draws the menu reads every row
  with `experimental_useSidebarNewItems()`.
- A palette search result may add `icon` (a bb icon name or an emoji),
  `experimental_onModSelect()` (what Mod+Enter or a Mod-click does instead
  of opening `path`) and `experimental_modSelectLabel` to name it. Rows
  whose title contains the query list above threads.
- `app.slots.experimental_sidebarSection({ id, title, component })` → a
  section of the plugin's own rows in the sidebar, below the thread list and
  scrolling with it. The component draws its own heading and rows and
  receives `{ activeThreadId, activeProjectId, isCompactViewport,
onNavigate }`; call `onNavigate` after opening something so the mobile
  drawer closes. Use it to add to the sidebar. Replace the whole list with
  `experimental_threadList` only when the plugin draws threads itself.
- `app.slots.experimental_paletteSearch({ id, title, search })` → a group of
  the plugin's own items in bb's search palette (Mod+K), listed under `title`
  after threads. `search(query, { signal })` resolves to `{ id, title,
subtitle?, path }` rows; it is debounced, called with the trimmed query
  (empty asks for recent items), and `signal` aborts when the query changes.
  `path` is a bb route, such as one of the plugin's panel paths, and opens
  like an in-app link. bb shows the first five rows, drops rows whose path
  is not a bb route, and logs a rejection without breaking the palette.

## Replace the quick palette

- `app.slots.experimental_commandPalette({ id, component })` → bb opens
  `component` instead of its own quick palette, command list and thread
  search both, on every entry point: Search (Mod+K, the rail's Search
  button, the `thread.search` command) and the palette command
  (Shift+Mod+P). It is drawn in bb's palette dialog, so the overlay, focus
  trap and Escape (which closes it) stay bb's. Props:
  `{ initialMode, close, experimental_onEscape }`.
  `initialMode` is `"search"` or `"commands"` by entry point; pressing an
  entry point while it is open mounts the component again with that mode.
  `close(then?)` closes the dialog and runs `then` once focus is back where
  it was. `experimental_onEscape(handler)` → bb asks `handler()` first on
  Escape, before the key reaches the focused element; true keeps the palette
  open (clear a query that way), false or a throw closes it. It returns the
  function that removes the handler, so call it in `useEffect`. The first
  registration by plugin id wins; none leaves bb's palette. A crash in
  `component` shows bb's palette.
- `experimental_useAppCommands()` → what bb's palette lists as commands:
  bb's available app commands, plugin palette commands, settings pages,
  plugin pages and server switches, each `{ id, title, group, shortcut?,
run() }`. `id` is bb's palette id (`app:thread.new`, `settings:general`,
  `plugin:<plugin>/<id>`); `shortcut` is the label bb shows (`⌘N`). Inside
  the replacement palette the list is taken when the palette opens and
  `run()` closes it first, as bb's palette does. Elsewhere (a plugin window)
  it is read again on mount and on window focus, and runs in that window.
  bb lists no keywords. A settings section opens with
  `experimental_toAppPath("/settings/<section>")`.

Names: `ExperimentalCommandPaletteRegistration`,
`ExperimentalCommandPaletteProps`, `ExperimentalAppCommand`,
`experimental_useAppCommands`.

## Rename an open tab

- `useBbNavigate().experimental_renameTab({ tab: { id }, params?, title })` →
  gives an open action tab a new title wherever it is open (as a fixed
  tab and in each thread panel opened in this window). The tab is matched
  by registration and `params`, as `openTab` matches it. Call it when the
  thing the tab shows is renamed.

## The project menu

- `<experimental_ProjectActionsMenu projectId className? />` → bb's own
  project menu (rename, add a local path, settings, delete) behind a "more"
  button, for a plugin that draws project rows.
- `<experimental_ProjectActionsContextMenu projectId>{row}</…>` → the same
  menu on a right-click of its one child. Both render nothing extra for an
  unknown project.

## File openers

- A `fileOpener` registration may add `experimental_handleOpen({ path,
source, lineRange })`. bb calls it before it opens a tab for that opener;
  return (or resolve) `true` when the plugin showed the file elsewhere, such
  as its own panel tab, and bb opens no file tab. `false`, a throw, or no
  answer within 3 seconds opens the normal tab. It is skipped for one-off
  "Open with" choices and for files picked from a New Tab's search.

## Links

- `app.slots.experimental_linkHandler({ id, handle(url, click?) })` → open
  some links yourself. bb asks before it opens a link someone clicked in a
  chat reply or another bb surface, and for a click with ⌘, Ctrl or Shift on
  any link in the app; `click.modifiers` has `meta`, `ctrl`, `shift` and
  `alt`, and `click` is left out when bb opens a URL without a click. Return
  true when you opened it, false to pass. Synchronous.

## A row above the main view

- `app.slots.experimental_mainHeader({ id, component })` → a row bb draws
  above the main view, across the view and its side panel (a tab strip).
  The component sets its own height and returns null to take no room. Read
  where the user is with `experimental_useAppRoute()`.

Names: `ExperimentalMainHeaderRegistration`.

- `app.slots.experimental_threadBanner({ id, component })` → a row bb draws
  in every thread view, under the thread's header and above its transcript.
  The component gets `{ threadId }` (the thread it is drawn in, not
  necessarily the route's), sets its own height and returns null to take no
  room.

Names: `ExperimentalThreadBannerRegistration`, `ExperimentalThreadBannerProps`.

- `app.slots.experimental_threadHeader({ id, useDecoration })` → changes
  each thread's header row. `useDecoration({ threadId })` is a hook bb calls
  in the main thread view and in every split pane; return `{ title?, after?
}` or null to leave the header alone. `title` replaces the title text
  shown (renaming still edits the thread's real title), `after` is a small
  node drawn right after the title in the same row (a status pill, a tag).
  When several plugins return a decoration, the first by plugin id, then
  registration id, wins. A hook that throws is dropped and bb's title stays.

Names: `ExperimentalThreadHeaderRegistration`, `ExperimentalThreadHeaderArgs`,
`ExperimentalThreadHeaderDecoration`.

## Items in a chat message's ··· menu

- `app.slots.experimental_messageAction({ id, title, icon?, isAvailable?,
run })` → an item in the ··· menu of chat messages, in the main thread
  view and in every `ThreadChat`, before bb's own Fork item and never as an
  inline icon. `isAvailable(message)` and `run(message)` get `{ threadId,
messageId, turnId, role, sourceSeqEnd }`; `role` is `"user"` or
  `"assistant"` and `turnId` is null outside a turn. Keep `isAvailable`
  synchronous and cheap; it runs while the message renders, and a throw
  hides the item. `experimental_replaces: "thread.fork"` hides bb's own
  Fork item where yours shows. To fork after the message, call
  `useSdk().threads.fork({ sourceThreadId: message.threadId, sourceSeqEnd:
message.sourceSeqEnd })` (or `bb.sdk.threads.fork` from the backend).

Names: `ExperimentalMessageActionRegistration`,
`ExperimentalMessageActionMessage`.

## A thread list without bb's sidebar header

- `app.slots.experimental_threadList({ id, title, component,
experimental_hideSidebarHeader: true })` → while this list is the
  sidebar's, bb draws no sidebar header: no New button or New menu from the
  navigation provider, and no back and forward buttons. Back and forward
  move to the start of the main view's header row and keep their shortcuts
  (in the desktop app's title bar layout they already sit there). Draw your
  own create control in the list.

## A tinted sidebar

- `app.slots.experimental_threadList({ id, title, component,
experimental_useSidebarStyle })` → while this list is the sidebar's, bb
  runs `experimental_useSidebarStyle()` in your plugin's scope and paints
  the returned `{ background?, accent? }` on its sidebar. `background` is any
  CSS background (a color or a gradient) for the sidebar's body, the thread
  list area and the footer under it; the rail keeps bb's. `accent` is a CSS
  color that becomes `--fork-sidebar-accent` and bb's `--sidebar-accent` in
  that body, so bb's selected and hovered rows use it; read
  `var(--fork-sidebar-accent)` for your own selected row. bb changes no text
  color: pick colors that keep text readable in light and dark
  (`experimental_useAppTheme()` says which). Return null, or leave a field
  out, for bb's own; a throw counts as null, and a value the browser cannot
  parse is dropped.

Names: `ExperimentalSidebarStyle`.

## A backdrop behind the app

- `app.slots.experimental_appBackdrop({ id, component, useAppearance? })` →
  bb draws `component` once per main window behind its whole layout: full
  window, under every surface, with no pointer events (a WebGL scene, an
  image). bb's own surfaces turn see-through (the window, the sidebar, the
  main view, its header, the side panel and the composer box) while
  `useAppearance()`, a hook bb calls in your plugin's scope, returns
  `{ mode?, tokens?, surfaces? }`, or always if you leave the hook out. A
  null keeps bb's own look, with your component still drawn under it:
  - `mode: "light" | "dark"` overrides this window's light or dark, so
    bb's `.dark` class, its `dark:` styles and
    `experimental_useAppTheme().mode` follow your theme. bb's own setting
    is back when you leave it out.
  - `tokens: { "--canvas": "…", "--ink": "…" }` are set on `<html>`. A
    name that is not `--` plus letters, digits, `-` or `_`, or a value the
    browser cannot parse, is dropped. Inside the sidebar and the side panel
    bb sets `--sidebar` to transparent; paint them with `surfaces`.
  - `surfaces: { sidebar?, main?, composer?, secondaryPanel?, header? }`,
    each `{ background?, backdropFilter?, edge? }`: a CSS background, a CSS
    backdrop-filter and the color of the surface's border lines. A surface
    left out is fully see-through. Surfaces nest: the header, side panel
    and composer sit on `main`. A thread list's `experimental_useSidebarStyle`
    still paints over the sidebar's. Inside the main view and side panel,
    `panel?` (default `--canvas` 32%) paints cards, sections, page roots
    and fields, and `code?` (default `--canvas` 58%, `blur(8px)`) code
    blocks, sticky headers and floating bars; bb's fill tokens there turn
    translucent. `popover?` (default `--canvas` 76%, `blur(12px)`) paints
    overlays under `layout.cards`; without it they stay opaque.
  - `layout: { cards: { gap, radius } }` lays bb out as floating cards
    with `gap` px (0–24) between them and the window's edges and corner
    radius `radius` px (0–28). Cards have no border (`edge` is not drawn),
    only `--fork-cards-shadow`. The rail and the header sit bare on the
    scene; the sidebar (content and footer) is one `sidebar` card, the
    back/forward, title and actions groups and the sidebar toggle are
    `header` pills (radius − 2 px), each thread's 808 px text column is a `main` card with
    the composer box a `composer` card over a dense fade inside it, and the side panel a
    `secondary-panel` card. Settings, Skills, Plugins and their pages get one `main` card on
    their content column. Cards and their controls draw no 1px line. Any element with
    `data-fork-card="<surface>"` outside the sidebar is painted the same way: mark your own page's
    column card with it. `<html>` gets `data-fork-cards`, `--fork-cards-gap`, `--fork-cards-radius`.
    `titleRow: true` puts each page's title in its card ("Title rows in cards", fork-api-host.md).
- The first registration by plugin id wins. A crash in `component` or a throw in `useAppearance`
  removes the backdrop and every override. Plugin windows, popped-out routes and tabs get none.

Names: `ExperimentalAppBackdropRegistration`, `ExperimentalAppAppearance`,
`ExperimentalAppSurface`, `ExperimentalAppSurfaceStyle`.

## Skills on bb's Skills page

- `app.slots.experimental_skillSource({ id, label, useSkills })` → bb's
  Skills page lists the source's skills under its own, under a `label`
  heading, and its filter menu gets a Source group with one option per
  source. `useSkills()` is a React hook bb runs in your plugin's scope while
  the page is open; it returns `{ id, name, description?, path?, onOpen? }[]`
  (keep the array stable while nothing changes). Opening a row calls
  `onOpen()`, or opens `path` in the person's editor when there is no
  `onOpen`. The page's search matches name, description and label. Choosing
  sources lists only their skills, plus bb's own that match when bb's Type
  or Provider filter is also set; bb's filters alone list no source. A throw
  hides that source's rows.

Names: `ExperimentalSkillSourceRegistration`, `ExperimentalSourceSkill`.

## Items in a side panel tab's menu

- `app.slots.experimental_panelTabAction({ id, title, icon?, isAvailable?,
run })` → an item in the right-click menu of plugin action tabs in the
  side panel's tab strip (any plugin's tab, never bb's file, diff or
  terminal tabs). `isAvailable(tab)` and `run(tab)` get `{ pluginId, tabId,
params, title, threadId }`; `threadId` is null on a plugin page. Keep
  `isAvailable` synchronous and cheap; it runs while the menu renders.

bb's own "Open in new window" item is in the same menu for every tab
`experimental_workbench(...).popOut` can pop out.

Names: `ExperimentalPanelTabActionRegistration`,
`ExperimentalPanelTabActionTab`.

## A conversation's workbench

- `useBbNavigate().experimental_workbench(threadId?)` → the side panel of a
  thread view on screen in this window, for code outside that view (an agent
  tool's handler), or null when that thread is not on screen. No `threadId`:
  the thread in the main view. Your own page's panel: `fork-api-host.md`.
  It returns `{ threadId, list, open, close, focus, layout, arrange,
isTyping }`:
  - `list()` → `{ open, selectedKey, tabs }`, every open tab (files, the
    diff tab, terminals, browser tabs, plugin tabs, Info) as
    `experimental_usePanelTabs()` lists them.
  - `open(spec, { focus?, pane?, index? })` → resolves the tab's key, or
    null when the panel declined or the tab did not appear within three
    seconds. `spec` is `{ kind: "tab", tab: { id, pluginId? }, params?,
    title? }` (your thread action tab: a page, a whiteboard, a design, a
    thread; with `pluginId`, another plugin's thread action tab, which must
    be registered with `experimental_openableByPlugins: true`, or `open`
    resolves null; params and title work as in `openTab`),
    `{ kind: "file", target, location? }`, `{ kind: "diff", path }`,
    `{ kind: "url", url }` (the desktop app's in-app browser; null
    elsewhere) or `{ kind: "terminal", terminalId }`. `focus: false` opens
    it behind the selected tab and keeps a closed panel closed. `pane` is 1
    or 2 (left to right) or `"new"` (a second pane on the right, made for
    this tab); a tab already open moves there. `index` is its place in that
    pane's tab row, as `layout().panes[n].tabs` counts without it. Pane 2
    needs two panes and `"new"` needs one; otherwise `open` resolves null
    and opens nothing.
  - `close(key)`, `focus(key)` → close or select any tab by key.
  - `layout()` → `{ panel, widthPercent, conversation, panes }`: the panel
    open or closed, its share of the view (20 to 80), the conversation shown
    or collapsed, and its panes left to right as `{ tabs, widthPercent }`
    (tab keys in tab-row order, share of the panel). The side panel has one
    pane or two side by side, never more and never stacked; a pane that
    loses its last tab closes.
  - `arrange({ panel?, widthPercent?, conversation?, panes?, paneWidths? })`
    → changes those. `panes: 2` moves the selected tab into a new pane on
    the right (the pane needs another tab); `panes: 1` moves pane 2's tabs
    into pane 1. `paneWidths: [2, 1]` sets the two panes' ratio (each keeps
    at least 15 percent). False, with nothing changed, when a value is out
    of range or the panes cannot be made.
  - `isTyping()` → true while keyboard focus is in a text field, an editable
    element or a frame in the side panel; check it before `open` or `focus`.
  - `popOut(key)` → `Promise<boolean>`: shows a tab in a window of its own
    and closes it in the panel, as the tab menu's "Open in new window" does.
    The window is a workbench panel of the thread with its own tab state
    (never the main window's): more tabs reach it by drag and drop, its tabs
    reorder, split into two panes and drag out as in the main window, its
    title follows the selected tab, and it closes when its last tab is
    dragged out. In that window `experimental_workbench(threadId)` from a
    component mounted there is that window's panel; `list()` in the main
    window does not include tabs living in windows. Its "Return to
    workbench" button opens every tab again in the panel that popped the
    first one out (pane 2 is made again when it is gone), showing the
    conversation there first if needed, or else in another window showing
    the conversation. Plugin action tabs and workspace, host and thread
    storage file tabs pop out. False, nothing changed, for anything else
    (terminals, browser tabs, Info, Diff, New Tab, attachments, fixed tabs,
    file opener tabs), an unknown key or a blocked popup. In the window a
    tab gets its `threadId` and `environment` props; `useBbContext()` has no
    thread.
- `experimental_useTabWindow()` → `{ title, toolbar } | null`: non-null in a
  popped-out window, whose bar shows the selected tab's `title`, so leave
  out your own title row there. `toolbar` is an element in that bar before
  "Return to workbench" (null until it mounts, and null for a tab that is
  not selected); `createPortal` the tab's other controls into it.

- `experimental_openableByPlugins: true` on an action tab registration lets
  other plugins open that tab with `experimental_workbench(...).open`. Leave
  it out and only your plugin opens it there. The opener chooses the params,
  so validate them in the tab.

Names: `ExperimentalWorkbench`, `ExperimentalWorkbenchOpenSpec`,
`ExperimentalWorkbenchOpenOptions`, `ExperimentalWorkbenchLayout`,
`ExperimentalWorkbenchPane`, `ExperimentalWorkbenchArrangement`,
`ExperimentalTabRegistration.experimental_openableByPlugins`,
`experimental_useTabWindow`, `ExperimentalTabWindow`.

## New Tab items

- `app.slots.experimental_newTabItems({ id, title, useRecents?, search? })`
  → your items on the side panel's New Tab page. `useRecents({ threadId })`
  is a React hook; its items join bb's Recent list, newest first, each row
  showing the title, the kind and the time. `search(query, { signal,
threadId })` answers the search box (debounced, trimmed, never empty); bb
  lists the first eight under `title`. An item is `{ id, title, kind, icon?,
updatedAt, open, experimental_dragItem? }`; `open()` shows it, usually
  with `openTab`. Items without a numeric `updatedAt` or an `open` function
  are dropped. With `experimental_dragItem` (an `ExperimentalDragItem`) the
  row is draggable: bb writes that payload as `experimental_writeDragItem`
  does, so it drops into a side panel pane or a composer through your
  `slots.experimental_itemDrop` handler. An invalid drag item leaves the row
  undraggable.
- An action tab registered with `experimental_showInNewTab: false` is left
  out of the page's Actions list and action search; `openTab` and the rest
  of bb still open it. `useVisible` hides a tab from the whole panel instead.
- `experimental_newTabGroup: "New"` on an action tab registration lists the
  tab under that heading on the New Tab page instead of under Actions.
  Headings follow bb's Actions section, in the order registrations first
  name them; each keeps bb's drag-to-reorder. The search box still lists
  matching actions under Actions.

Names: `ExperimentalNewTabItemsRegistration`, `ExperimentalNewTabItem`,
`ExperimentalNewTabItem.experimental_dragItem`,
`ExperimentalTabRegistration.experimental_showInNewTab`,
`ExperimentalTabRegistration.experimental_newTabGroup`.

## Dragging items

One drag payload for a thread, a plugin document, a side panel tab or a
file: JSON of `ExperimentalDragItem` under the MIME type
`application/x-bb-item`. `{ kind: "thread" | "doc" | "tab" | "file", id,
title, path?, pluginId?, tab?, open? }`; for kind `"tab"`, `tab` is
`{ pluginId, tabId, params, threadId }` (a plugin action tab) and `open` is
the `ExperimentalWorkbench.open` spec that shows the same tab elsewhere.

- `experimental_writeDragItem(event.dataTransfer, item)` in your
  `dragstart` → makes your element a source. `experimental_readDragItem(
event.dataTransfer)` in your own `dragover` and `drop` → the item or null
  (null in `dragover` for another window's drag: its data is sealed until
  `drop`). Gate on `event.dataTransfer.types.includes("application/x-bb-item")`,
  and call `preventDefault()` in `dragover` and `drop` on your own targets:
  bb leaves a drag alone once a target inside the page accepted it.
- `app.slots.experimental_itemDrop({ id, canDrop(item, target),
drop(item, target) })` → takes drops on bb's own surfaces. `target` is
  `{ zone: "workbench", threadId, pane?, index?, open }` (a side panel:
  a thread's, a plugin page's with `threadId` null, or a popped-out tab
  window's), `{ zone: "composer", threadId, insertText(text) }` (null for
  the new-thread composer) or `{ zone: "main" }`. `canDrop` runs on every
  drag move: synchronous and cheap. bb outlines the zone while a handler
  accepts, and calls `drop` on the first handler, by plugin id, whose
  `canDrop` is true. While a drag from another window is over a surface, bb
  asks no handler (the item is sealed) and shows the move cursor; on `drop`
  it asks as usual, and a drop no handler takes ends with effect `none`.
- In a side panel, over a pane's tab row `pane` is 1 or 2 and `index` the
  insertion point (bb draws an insertion bar there); over the right edge of
  a panel with one pane `pane` is `"new"` (bb highlights that half). Elsewhere
  in the panel both are absent and bb outlines the panel. Open the item
  there with `target.open(spec, { pane, index })`: it is
  `experimental_workbench(threadId).open` bound to that very panel, and the
  one way into a popped-out window's panel, where no component of yours is
  mounted to call `useBbNavigate()`.
- On the composer zone, `insertText(text)` inserts plain text at the
  composer's caret (appends when there is none).
  `insertMention({ provider, id, label })` inserts one of your own mention
  pills there, the pill `useComposer().insert` makes (`provider` is a
  mention provider you registered; it resolves `id` at send time).
  `insertThreadMention({ id, title })` inserts bb's own thread pill, as
  typing @ and picking the thread does. Each returns false when that
  composer is not on screen or the value is not valid.
- Every side panel tab is a native drag source (a drag image, and the drag
  can leave the window): your targets get `dragenter`, `dragover`,
  `dragleave` and `drop` with `{ kind: "tab", id, title, pluginId?, tab?,
open? }`. Plugin action tabs and workspace, host and thread storage file
  tabs carry `open`; terminal, browser, Info, Diff, New Tab and fixed tabs
  carry neither `tab` nor `open`, and their drag also has the type
  `application/x-bb-item-local`: it can be dropped only in its own window.
- A tab dropped on a side panel's tab row is bb's own move, before any
  handler: in its own window it is reordered or moved between panes; in
  another window it opens there from `open` and the source window closes it
  when its `dragend` reports `dropEffect` `"move"`. bb sets `"move"` on the
  workbench and main zones and `"copy"` on the composer, so a source that
  closes on `"move"` keeps its tab after a composer drop. A handler that
  takes a tab on the main zone in the same window closes the source itself.

Names: `ExperimentalDragItem`, `ExperimentalItemDropTarget`,
`ExperimentalItemDropRegistration`, `ExperimentalDropMention`.

## The context popover

- `app.slots.experimental_contextCardRow({ id, useRow })` → a row in bb's
  context popover (the card behind the context ring under the composer).
  `useRow()` is a hook returning `{ label, value, note?, actions? }` or
  null; bb draws it in the card's own style, with `actions` as small text
  buttons. Read the thread with `useBbContext()`.
- `experimental_useContextCard()` → `{ available, open() }`: open that
  popover from the plugin's own control (a chip in the composer footer).
  `available` is false while the thread has no context ring.

Windows, launcher items, popping out a route, approvals, the close command, quiet turns and the backend hooks are in fork-api-host.md.

## Names

`ExperimentalAppAppearance`, `ExperimentalAppBackdropRegistration`, `ExperimentalAppCommand`, `ExperimentalAppPane`, `ExperimentalAppPanes`, `ExperimentalAppRoute`, `ExperimentalAppSurface`, `ExperimentalAppSurfaceStyle`, `ExperimentalAppTheme`, `ExperimentalApprovalDecision`, `ExperimentalApprovalRequest`, `ExperimentalBeforeThreadDeleteHandler`, `ExperimentalCommandPaletteProps`, `ExperimentalCommandPaletteRegistration`, `ExperimentalCompletedTurn`, `ExperimentalComposerReplace`, `ExperimentalComposerReplaceProps`, `ExperimentalDropMention`, `ExperimentalThreadForkPoint`, `ExperimentalTurnContextProvider`, `ExperimentalContextCard`, `ExperimentalContextCardRow`, `ExperimentalContextCardRowRegistration`, `ExperimentalGlobalTab`, `ExperimentalPaletteSearchRegistration`, `ExperimentalPaletteSearchResult`, `ExperimentalLinkHandlerRegistration`, `ExperimentalLinkClick`, `ExperimentalMessageActionMessage`, `ExperimentalMessageActionRegistration`, `ExperimentalNewTabItem`, `ExperimentalNewTabItemsRegistration`, `PluginFileOpenerOpenArgs`, `ExperimentalProjectActionsContextMenuProps`, `ExperimentalProjectActionsMenuProps`, `ExperimentalReplyClassification`, `ExperimentalThreadFileChange`, `ExperimentalReplyClassifierRegistration`, `ExperimentalSidebarNewItemRegistration`, `ExperimentalSidebarNewItem`, `ExperimentalSidebarSectionProps`, `ExperimentalSidebarSectionRegistration`, `ExperimentalSidebarStyle`, `ExperimentalSkillSourceRegistration`, `ExperimentalSourceSkill`, `ExperimentalTurnClassification`, `ExperimentalWindowOptions`, `ExperimentalWindowRegistration`, `ExperimentalWindows`, `ExperimentalWorkbench`, `ExperimentalWorkbenchArrangement`, `ExperimentalWorkbenchLayout`, `ExperimentalWorkbenchOpenOptions`, `ExperimentalWorkbenchOpenSpec`, `ExperimentalWorkbenchPane`, `ExperimentalTurnInterruptedReason`, `FORK_PLUGIN_EVENT_NAMES`, `ExperimentalTurnClassifier`, `experimental_useAppCommands`, `experimental_useAppPanes`, `experimental_useAppRoute`, `experimental_useAppTheme`, `experimental_useGlobalTabs`, `ForkBbNavigate`, `ForkPluginEventPayloads`, `ForkPluginHooks`, `ForkThreadIdlePayload`, `ForkComposerCustomization`, `ForkFileOpenerFields`, `ForkPluginAppSlots`, `ForkPluginSdkApp`, `ForkTabFields`, `ForkThreadListFields`.

The contract's own interfaces take the fork's members from these helper
interfaces; plugins never name them:
