# Fork API (BB Studio): windows, approvals, the close command and backend hooks

The rest of the fork-only API, with the same rules as fork-api.md: every member is experimental, and a plugin that also runs on stock bb checks each one exists before using it. The names are listed in fork-api.md.

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
  `vibrancy: "hud" | "under-window"` with `transparent` puts macOS's blurred
  material behind the component, active even unfocused; other systems
  ignore it. Opening a window that is already open with other `params`
  loads the new address in the same window, which keeps its place and size.

## Launcher items

- `app.slots.experimental_launcherItem({ id, title, icon, section, keywords?,
order?, run })` → an app (`section: "apps"`) or action (`"actions"`) a
  launcher can list and run. `run` is called in the launcher's window, so it
  must work from any window.
- `experimental_useLauncherItems()` → every plugin's items, for the plugin
  that draws the launcher (Studio's, on a window with `center` and
  `hideOnBlur`).

Names: `ExperimentalLauncherItemRegistration`, `ExperimentalLauncherItem`.

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

## The close command

- `app.slots.experimental_closeFallback({ id, close() })` → what Mod+W
  closes when it is not closing a side panel tab: bb asks when keyboard
  focus is outside the side panel, or the panel has no closable selected
  tab. Return true when you closed something; bb then does nothing else.
  Return false to leave bb's own behavior (in the desktop app that can
  close the window).

Names: `ExperimentalCloseFallbackRegistration`.

## Quiet turns

- Backend: `bb.experimental_hooks.experimental_classifyTurns(({ threadId,
finalOutput }) => ({ quiet }))`. bb asks it for every turn that finishes;
  it must be synchronous, pure and fast. A quiet turn leaves the thread
  read, posts no completion notice to its parent and sends no notification,
  and `thread.idle` carries `experimental_quiet`.
- Frontend: `app.slots.experimental_replyClassifier({ id, classify(text) })`
  → `{ quiet }` makes the thread view draw that reply as a small "Quiet
  check" marker. Use the same rule on both sides.

## Title rows in cards

`layout: { cards: { gap, radius, titleRow: true } }` in an app backdrop's
`useAppearance()` makes a page's title the first row of its card. bb sets
`data-fork-title-rows` on `<html>` and moves the header's title group (the
title, breadcrumbs, a thread's rename field and its menu, and your
`experimental_threadHeader` node) into the first element marked
`data-fork-title-host` under the header's parent. The nodes move; they do
not remount, and they return to the bar when the host or the flag goes.

- bb's Settings, Skills and Plugins pages carry a host and draw the row:
  44 px, sticky, the card's width, with dense blurred glass that shows once
  the page scrolls (`--fork-title-row-background`, `--fork-title-row-filter`).
- Your own page or a thread: render an empty `<div data-fork-title-host="">`
  where the title should go and style it yourself. A page with no host keeps
  its title in the bar.
- Under `cards`, bb's page, transcript and list scrollers reserve no
  scrollbar gutter and show a thin overlay thumb on hover and scroll. Mark
  your own scroller `data-fork-overlay-scroll` for the same.

## The workbench of your own page

A nav-panel page has the same side panel as a thread. Reach it with
`useBbNavigate().experimental_workbench("page:<pluginId>/<panelId>")`, where
`panelId` is the id you registered the nav panel with. It is null while that
page is not on screen, and for a page of another plugin.

- `list`, `open`, `close`, `focus`, `layout`, `arrange` and `isTyping` work
  as for a thread, panes included: `open(spec, { pane: 2 })`,
  `open(spec, { pane: "new" })`, `arrange({ panes: 2 })`.
- `open({ kind: "tab", tab: { id } })` opens your tab registered for that
  page (`context: { kind: "nav-panel", panelId }`). Another plugin's tab is
  declined.
- `arrange` declines `widthPercent` and `conversation`, and `popOut`
  resolves false: a page's panel has no conversation beside it and no window
  of its own.
- `experimental_workbench()` with no argument never returns a page's panel.
