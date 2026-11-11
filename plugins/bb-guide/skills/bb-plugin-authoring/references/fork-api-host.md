# Fork API (BB Studio): windows, approvals and backend hooks

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
