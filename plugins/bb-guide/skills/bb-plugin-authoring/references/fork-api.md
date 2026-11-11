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
  `{ zone: "workbench", threadId }` (a side panel; `threadId` null on a
  plugin page), `{ zone: "composer", threadId, insertText(text) }` (null
  for the new-thread composer) or `{ zone: "main" }`. `canDrop` runs on
  every drag move: synchronous and cheap. bb outlines the zone while a
  handler accepts, and calls `drop` on the first handler, by plugin id,
  whose `canDrop` is true.
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

## Windows

- `app.slots.experimental_window({ id, title, component })` → a component
  bb can show in a window of its own, with no bb chrome around it.
- `experimental_useWindows()` → `{ native, register, open, toggle, close }`.
  `open(windowId, { width, height, x, y, transparent, frame, alwaysOnTop,
clickThrough, resizable, hotkey, menuBarTitle, params })`. `hotkey` is a
  system-wide shortcut that shows or hides the window; `menuBarTitle` adds a
  menu bar entry; `register` sets both up without showing the window.
  `params` reach the component as the page's query string. In a browser
  `native` is false and `open` opens a plain popup. `hotkeyRegistered(windowId)`
  says whether the system took the window's hotkey; another app may hold it.
  Also `minWidth`, `minHeight`, `titleBar: "hiddenInset"` (traffic lights
  inside the content) and `rememberBounds` (reopen at the last place and size,
  per display). `setClickThrough(windowId, on)` switches click-through on an
  open window; while on, the hotkey and menu bar entry turn it off instead of
  hiding the window, and the page gets a `bb-fork-window-click-through` event.
  `setClickThrough(windowId, false, { hold: true })` pauses it (a modifier
  held over the window) without turning it off. `center` opens it mid-screen; `hideOnBlur` closes it when it loses focus.

## Approvals

- Backend: `await bb.experimental_hooks.experimental_requestApproval({ title,
message, detail?, items?, confirmLabel? })` → `{ approved, picked }`. bb
  shows the request in a dialog the plugin does not draw and waits up to ten
  minutes. `picked` is the ids of the `items` the person allowed.
- Only a person can answer: the desktop app shows a native dialog and signs
  the answer with a key that exists only in its main process; a browser
  must first be paired through that dialog. Agents, the CLI and plugin code
  can ask but cannot approve, so do not build your own approve button or
  token for anything an agent must not grant itself.

## Interrupted turns and host daemons

- `bb.events.on("experimental_turn.interrupted", ({ thread, reason }) => …)`:
  a turn ended without finishing. `reason` is `manual-stop`, `host-removed`,
  `host-daemon-restarted`, `host-connection-lost`, `provider-turn-idle` or
  `provider`. bb also emits `thread.idle` or `thread.failed` for that turn.
- `bb.events.on("experimental_host.connected", ({ host, restarted }) => …)`:
  a machine's host daemon connected; `restarted` is true for a new daemon
  process.
- `bb.events.on("experimental_host.disconnected", ({ host, reason }) => …)`:
  the daemon went away (`daemon-disconnect`, `expired` or `removed`).

## Files an agent changed

- `bb.events.on("experimental_thread.fileChanged", ({ thread, changes }) =>
…)`: an agent in the thread finished an edit, a write or a patch.
  `changes` is `[{ itemId, path, kind: "add" | "update" | "delete",
movePath? }]`, in order. Use it to refresh an open editor or preview
  without polling the thread's events.

## Before a thread is deleted

- Backend: `bb.experimental_hooks.experimental_beforeThreadDelete(async ({
threadId }) => { ... })`. bb awaits it for the thread and for each thread
  deleted with it, before anything is marked deleted. Throw to refuse the
  deletion; the message is shown to whoever asked. One handler per plugin.

## Context at the start of each turn

- Backend: `bb.experimental_hooks.experimental_turnContext(({ threadId }) =>
string | null | Promise<string | null>)`. bb calls it each time a turn
  starts in any thread (a thread starting, or a message that starts a new
  turn; not a message steered into a running turn) and gives the agent what
  it returns, under "Context from the <plugin> plugin at the start of this
  turn:", after the turn's own input. It is agent-only: the timeline does
  not show it, and it is not stored in the thread's history. Return null for
  threads you have nothing to say about. Bounded: bb waits at most 500 ms
  for all plugins together, keeps at most 8000 characters per plugin, and
  ignores a throw, a rejection or a late answer. One provider per plugin.
  bb's own `bb.agents.contributeInstructions` and `configure` instructions
  are different: they are read only when a provider session is built, so a
  live session never sees later changes.

Names: `ExperimentalTurnContextProvider`.

## Where a fork came from

- A fork's `ThreadResponse` (in `thread.created`, `bb.sdk.threads.get` and
  `list`) has `originKind: "fork"` and `sourceThreadId`; `list` filters by
  both. Backend: `await bb.experimental_hooks.experimental_threadForkPoint(threadId)` →
  `{ sourceThreadId, sourceTurnId, sourceSequence } | null` adds where in
  the source it branched: the last source turn its copied history ends with,
  and the sequence of that turn's `turn/completed` event in the source.
  Both are null when the fork copied no history. Resolves null for a thread
  that is not a fork or whose source was deleted. It reads the events, so it
  works for forks made before it existed; call it after `thread.created`
  once the fork has started (its history is copied right after creation).

Names: `ExperimentalThreadForkPoint`.

## Names

- `ExperimentalAppPane`
- `ExperimentalAppPanes`
- `ExperimentalAppRoute`
- `ExperimentalAppTheme`
- `ExperimentalApprovalDecision`
- `ExperimentalApprovalRequest`
- `ExperimentalBeforeThreadDeleteHandler`
- `ExperimentalCompletedTurn`
- `ExperimentalComposerReplace`
- `ExperimentalComposerReplaceProps`
- `ExperimentalDropMention`
- `ExperimentalThreadForkPoint`
- `ExperimentalTurnContextProvider`
- `ExperimentalContextCard`
- `ExperimentalContextCardRow`
- `ExperimentalContextCardRowRegistration`
- `ExperimentalGlobalTab`
- `ExperimentalPaletteSearchRegistration`
- `ExperimentalPaletteSearchResult`
- `ExperimentalLinkHandlerRegistration`
- `ExperimentalMessageActionMessage`
- `ExperimentalMessageActionRegistration`
- `PluginFileOpenerOpenArgs`
- `ExperimentalProjectActionsContextMenuProps`
- `ExperimentalProjectActionsMenuProps`
- `ExperimentalReplyClassification`
- `ExperimentalThreadFileChange`
- `ExperimentalReplyClassifierRegistration`
- `ExperimentalSidebarNewItemRegistration`
- `ExperimentalSidebarNewItem`
- `ExperimentalSidebarSectionProps`
- `ExperimentalSidebarSectionRegistration`
- `ExperimentalSidebarStyle`
- `ExperimentalSkillSourceRegistration`
- `ExperimentalSourceSkill`
- `ExperimentalTurnClassification`
- `ExperimentalWindowOptions`
- `ExperimentalWindowRegistration`
- `ExperimentalWindows`
- `ExperimentalTurnInterruptedReason`
- `FORK_PLUGIN_EVENT_NAMES`
- `ExperimentalTurnClassifier`
- `experimental_useAppPanes`
- `experimental_useAppRoute`
- `experimental_useAppTheme`
- `experimental_useGlobalTabs`

The contract's own interfaces take the fork's members from these helper
interfaces; plugins never name them:

- `ForkBbNavigate`
- `ForkPluginEventPayloads`
- `ForkPluginHooks`
- `ForkThreadIdlePayload`
- `ForkComposerCustomization`
- `ForkFileOpenerFields`
- `ForkPluginAppSlots`
- `ForkPluginSdkApp`
- `ForkTabFields`
- `ForkThreadListFields`
