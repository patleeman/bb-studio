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

- `app.slots.experimental_linkHandler({ id, handle(url) })` → open some
  links yourself. bb asks before it opens a link someone clicked in a chat
  reply or another bb surface; return true when you opened it, false to
  pass. Synchronous. A click with a modifier key is not asked.

## Quiet turns

- Backend: `bb.experimental_hooks.experimental_classifyTurns(({ threadId,
finalOutput }) => ({ quiet }))`. bb asks it for every turn that finishes;
  it must be synchronous, pure and fast. A quiet turn leaves the thread
  read, posts no completion notice to its parent and sends no notification,
  and `thread.idle` carries `experimental_quiet`.
- Frontend: `app.slots.experimental_replyClassifier({ id, classify(text) })`
  → `{ quiet }` makes the thread view draw that reply as a small "Quiet
  check" marker. Use the same rule on both sides.

## Launcher items

- `app.slots.experimental_launcherItem({ id, title, icon, section, keywords?,
order?, run })` → an app (`section: "apps"`) or action (`"actions"`) a
  launcher can list and run. `run` is called in the launcher's window, so it
  must work from any window.
- `experimental_useLauncherItems()` → every plugin's items, for the plugin
  that draws the launcher (Studio's, on a window with `center` and
  `hideOnBlur`).

Names: `ExperimentalLauncherItemRegistration`, `ExperimentalLauncherItem`.

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

Names: `ExperimentalPanelTabActionRegistration`,
`ExperimentalPanelTabActionTab`.

## A conversation's workbench

- `useBbNavigate().experimental_workbench(threadId?)` → the side panel of a
  thread view on screen in this window, for code outside that view (an agent
  tool's handler in an always-mounted component), or null when that thread
  is not on screen. Leave `threadId` out for the thread in the main view.
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

- `experimental_openableByPlugins: true` on an action tab registration lets
  other plugins open that tab with `experimental_workbench(...).open`. Leave
  it out and only your plugin opens it there. The opener chooses the params,
  so validate them in the tab.

Names: `ExperimentalWorkbench`, `ExperimentalWorkbenchOpenSpec`,
`ExperimentalWorkbenchOpenOptions`, `ExperimentalWorkbenchLayout`,
`ExperimentalWorkbenchPane`, `ExperimentalWorkbenchArrangement`,
`ExperimentalTabRegistration.experimental_openableByPlugins`.

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
title, path?, pluginId?, tab? }`; `tab` is `{ pluginId, tabId, params,
threadId }` for kind `"tab"`.

- `experimental_writeDragItem(event.dataTransfer, item)` in your
  `dragstart` → makes your element a source. `experimental_readDragItem(
event.dataTransfer)` in your own `dragover` and `drop` → the item or null.
  Gate on `event.dataTransfer.types.includes("application/x-bb-item")`,
  and call `preventDefault()` in `dragover` and `drop` on your own targets:
  bb leaves a drag alone once a target inside the page accepted it.
- `app.slots.experimental_itemDrop({ id, canDrop(item, target),
drop(item, target) })` → takes drops on bb's own surfaces. `target` is
  `{ zone: "workbench", threadId, pane?, index? }` (a side panel;
  `threadId` null on a plugin page), `{ zone: "composer", threadId,
insertText(text) }` (null for the new-thread composer) or
  `{ zone: "main" }`. `canDrop` runs on every drag move: synchronous and
  cheap. bb outlines the zone while a handler accepts, and calls `drop` on
  the first handler, by plugin id, whose `canDrop` is true.
- In a side panel, over a pane's tab row `pane` is 1 or 2 and `index` the
  insertion point (bb draws an insertion bar there); over the right edge of
  a panel with one pane `pane` is `"new"` (bb highlights that half, as for
  a tab dragged there). Elsewhere in the panel both are absent and bb
  outlines the panel. Open the item there with
  `useBbNavigate().experimental_workbench(threadId)?.open(spec, { pane,
index })`.
- On the composer zone, `insertText(text)` inserts plain text at the
  composer's caret (appends when there is none).
  `insertMention({ provider, id, label })` inserts one of your own mention
  pills there, the pill `useComposer().insert` makes (`provider` is a
  mention provider you registered; it resolves `id` at send time).
  `insertThreadMention({ id, title })` inserts bb's own thread pill, as
  typing @ and picking the thread does. Each returns false when that
  composer is not on screen or the value is not valid.
- A plugin action tab dragged out of a side panel's tab strip is a source
  already: your targets get `dragenter`, `dragover`, `dragleave` and `drop`
  with `{ kind: "tab", id, title, pluginId, tab }`. bb's file, diff and
  terminal tabs and fixed tabs carry nothing. These events come from bb's
  own pointer drag, so there is no native drag image and the drag cannot
  leave the window.

Names: `ExperimentalDragItem`, `ExperimentalItemDropTarget`,
`ExperimentalItemDropRegistration`, `ExperimentalDropMention`.

## Pop out a route

- `useBbNavigate().experimental_popOut({ path, title?, width?, height? })`
  → `Promise<boolean>`: opens any bb route (a thread `/threads/<id>`, a
  plugin panel, the `path` of a dragged item) in a window of its own with
  no sidebar, rail, plugin main header or bb page header; everything else
  works as in the main window. In the desktop app it is a native window that
  remembers its size and place per path; in a browser, a popup. Popping out
  an open path focuses its window. Defaults to 960 by 720. Resolves false
  when `path` is not a bb route of this origin (it must start with `/`) or
  the popup was blocked.

## The close command

- `app.slots.experimental_closeFallback({ id, close() })` → what Mod+W
  closes when it is not closing a side panel tab: bb asks when keyboard
  focus is outside the side panel, or the panel has no closable selected
  tab. Return true when you closed something; bb then does nothing else.
  Return false to leave bb's own behavior (in the desktop app that can
  close the window).

Names: `ExperimentalCloseFallbackRegistration`.

## The context popover

- `app.slots.experimental_contextCardRow({ id, useRow })` → a row in bb's
  context popover (the card behind the context ring under the composer).
  `useRow()` is a hook returning `{ label, value, note?, actions? }` or
  null; bb draws it in the card's own style, with `actions` as small text
  buttons. Read the thread with `useBbContext()`.
- `experimental_useContextCard()` → `{ available, open() }`: open that
  popover from the plugin's own control (a chip in the composer footer).
  `available` is false while the thread has no context ring.

Windows, approvals and the backend hooks are in fork-api-host.md.

## Names

`ExperimentalAppPane`, `ExperimentalAppPanes`, `ExperimentalAppRoute`, `ExperimentalAppTheme`, `ExperimentalApprovalDecision`, `ExperimentalApprovalRequest`, `ExperimentalBeforeThreadDeleteHandler`, `ExperimentalCompletedTurn`, `ExperimentalComposerReplace`, `ExperimentalComposerReplaceProps`, `ExperimentalDropMention`, `ExperimentalThreadForkPoint`, `ExperimentalTurnContextProvider`, `ExperimentalContextCard`, `ExperimentalContextCardRow`, `ExperimentalContextCardRowRegistration`, `ExperimentalGlobalTab`, `ExperimentalPaletteSearchRegistration`, `ExperimentalPaletteSearchResult`, `ExperimentalLinkHandlerRegistration`, `ExperimentalMessageActionMessage`, `ExperimentalMessageActionRegistration`, `ExperimentalNewTabItem`, `ExperimentalNewTabItemsRegistration`, `PluginFileOpenerOpenArgs`, `ExperimentalProjectActionsContextMenuProps`, `ExperimentalProjectActionsMenuProps`, `ExperimentalReplyClassification`, `ExperimentalThreadFileChange`, `ExperimentalReplyClassifierRegistration`, `ExperimentalSidebarNewItemRegistration`, `ExperimentalSidebarNewItem`, `ExperimentalSidebarSectionProps`, `ExperimentalSidebarSectionRegistration`, `ExperimentalSidebarStyle`, `ExperimentalSkillSourceRegistration`, `ExperimentalSourceSkill`, `ExperimentalTurnClassification`, `ExperimentalWindowOptions`, `ExperimentalWindowRegistration`, `ExperimentalWindows`, `ExperimentalWorkbench`, `ExperimentalWorkbenchArrangement`, `ExperimentalWorkbenchLayout`, `ExperimentalWorkbenchOpenOptions`, `ExperimentalWorkbenchOpenSpec`, `ExperimentalWorkbenchPane`, `ExperimentalTurnInterruptedReason`, `FORK_PLUGIN_EVENT_NAMES`, `ExperimentalTurnClassifier`, `experimental_useAppPanes`, `experimental_useAppRoute`, `experimental_useAppTheme`, `experimental_useGlobalTabs`, `ForkBbNavigate`, `ForkPluginEventPayloads`, `ForkPluginHooks`, `ForkThreadIdlePayload`, `ForkComposerCustomization`, `ForkFileOpenerFields`, `ForkPluginAppSlots`, `ForkPluginSdkApp`, `ForkTabFields`, `ForkThreadListFields`.

The contract's own interfaces take the fork's members from these helper
interfaces; plugins never name them:
