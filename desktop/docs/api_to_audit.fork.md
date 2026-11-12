# Fork API to audit

Experimental plugin API added by the BB Studio fork. Same rules as
`docs/api_to_audit.md`: each entry says what the member does, which core
callers use the same path, and what to check before stabilizing it. Kept in
its own file so upstream changes to `docs/api_to_audit.md` never conflict.

## Composer footer (`ComposerCustomization.experimental_footer`)

`app.composer.customize({ id, scopes: ["thread"], experimental_footer: [{
id, component }] })` places a small status item in the row under an
existing thread's input, before the session-options, permission and
context-window controls. An item with `placement: "context"` is drawn right
before the context-window ring instead, in one wrapper with it
(`data-fork-context-control`), so the two read as one control; a click on it
should open the context popover (Studio's prompt-cache clock and minutes
left). A component returning null takes no space. Other scopes have no
footer row and ignore the field.

**Core callers.** None; core's own items in that row (`SessionOptionsMenu`,
the permission control, `ThreadContextWindowIndicator`) are passed in as
props by `ThreadDetailPromptArea`. The host is
`components/plugin/ForkComposerFooter.tsx`, mounted in
`FollowUpPromptBox`'s footer.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Decide ordering and an overflow rule when several plugins add items; the
   row is one line with no wrap.
2. Decide whether the New thread composer gets a footer row.
3. Decide whether core's own footer items should register through the same
   path.

## Composer replacement (`ComposerCustomization.experimental_replace`)

`app.composer.customize({ id, scopes: ["thread"], experimental_replace: {
useActive, component } })`. For every existing-thread composer bb shows, the
host mounts a probe per registration that calls `useActive({ threadId })` as
a hook (inside the plugin's slot boundary) and reports the result in a
layout effect, so the swap happens before paint. While one is true, bb
renders that plugin's `component` with `{ threadId }` in place of
`ThreadDetailPromptArea` (the composer box, its banners and pending
interaction stack), in the same footer slot and width. The first active
registration by plugin id, then customization id, wins. A throw in
`useActive` counts as false; a crash in `component` falls back to bb's
composer. Used by Studio for read-only workers ("Ask the Bot about this
worker") and mirrored threads.

**Core callers.** None: core hides its composer only through
`ThreadScreen`'s `composer: null` (transcript presentation). The host is
`components/fork/ForkComposerReplace.tsx`, called once from `ThreadScreen`,
which both the thread page and `ThreadChat` render.

**Audit before stabilizing.**

1. Decide whether pending interactions (approvals, questions) should stay
   visible above a replacement; today they are replaced with the composer.
2. Decide whether `useActive` should receive more than the thread id (the
   thread's state) so plugins need no fetch of their own.
3. Decide whether the queued-message and new-thread composers need it.

## App route (`experimental_useAppRoute`, `BbNavigate.experimental_toAppPath`)

`experimental_useAppRoute()` returns the main view's `{ pathname, search,
hash }` and renders the caller again on every navigation.
`useBbNavigate().experimental_toAppPath(path, { replace? })` navigates the
main view to any bb route: another plugin's panel, a thread, or settings.
It returns false and does nothing for a path that is not a bb route, a
protocol-relative path, or an absolute URL. `toPluginPanel` stays the way to
reach the plugin's own panels.

Before this, a plugin that hosts other plugins' items could only follow the
route by listening to `popstate` and polling `location.pathname`, and could
only leave its own panels by clicking a hidden anchor or rewriting history
behind the router.

**Core callers.** `experimental_toAppPath` validates with `resolveRouteHref`
and navigates with the router's `navigate`, the same two steps `RouteAnchor`
takes for a click on an in-app link and that `toPluginPanel` takes for its
own route. `experimental_useAppRoute` returns the router's `useLocation()`
fields, which `SplitWorkspaceRoute` and `AppLayout` read.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Decide whether the path should be opaque. Plugins that build paths for
   other plugins' panels depend on the `/plugins/<id>/<path>` shape; a typed
   builder may be the stable form.
2. Decide what the hook reports inside a split pane: the main view's route,
   as now, or the pane's own content.
3. Add a `split` option that follows `RouteAnchor`'s modifier-click
   placement, if a consumer needs it.

## Sidebar section (`slots.experimental_sidebarSection`)

A plugin adds a section of its own rows to the sidebar. Sections render
after the thread list, inside the same scroll area, in plugin order. The
component draws its own heading and rows and receives `{ activeThreadId,
activeProjectId, isCompactViewport, onNavigate }`. A crashed section leaves
the thread list and the other sections in place.

Before this, a plugin with rows of its own had to replace the whole thread
list through `experimental_threadList`, redraw threads itself, and switch
the user's `sidebar.threadListProvider` preference to make its list show.

**Core callers.** None: core's own lists are the navigation and the thread
list, both already replaceable plugins. The host is
`components/sidebar/ForkSidebarSections.tsx`, mounted in `AppSidebar`
next to `PluginThreadList` and given the same `closeOnMobile` callback.

Docs: `frontend-renderer-slots.md`.

**Audit before stabilizing.**

1. Decide placement: above the thread list, between its groups, or
   user-ordered with the navigation's customize mode.
2. Decide whether bb should draw the heading and collapse state so sections
   from different plugins match.
3. Decide whether a section may hide on routes, or show when a navPanel's
   `experimental_sidebar` has replaced the thread list. Today it follows
   the thread list.

## Palette search (`slots.experimental_paletteSearch`)

A plugin lists its own items in the search palette (Mod+K). Each
registration is a group, shown under its `title` after the thread groups.
`search(query, { signal })` is debounced 150 ms, receives the trimmed query
(empty for recents), and resolves to `{ id, title, subtitle?, path }` rows.
bb keeps five per group, drops repeat ids and rows whose `path` is not a bb
route, and opens the chosen row with the palette's own route navigation.
One provider rejecting leaves the others listed.

**Core callers.** Plugin rows join the palette's one option list in
`ThreadSearchPaletteMode`, so arrow keys, Home, End, Enter and pointer
highlight treat them like thread rows, and choosing one goes through the
same `runAfterClose` and `useRouteNavigate` call a thread row uses. The
fetch and rendering live in `components/commands/ForkPaletteSearch.tsx`.

Docs: `frontend-renderer-slots.md`.

**Audit before stabilizing.**

1. Decide ranking. Groups are appended in plugin order with no cross-group
   relevance; a plugin hit never outranks a thread.
2. Decide whether rows may carry an icon, highlight ranges, or an "open in
   split" action like thread rows.
3. Decide whether providers should also feed the command list (Mod+Shift+P)
   and the sidebar's Search threads row label.
4. The thread view menu's lifecycle and sort controls do not apply to plugin
   groups.

## Sidebar New menu (`experimental_sidebarNewItem`, `experimental_useSidebarNewItems`)

`slots.experimental_sidebarNewItem({ id, title, icon, group?, run })` adds a
row to a New menu that a plugin draws. Rows keep registration order;
neighbours with the same `group` share one divider.
`experimental_useSidebarNewItems()` returns every plugin's rows as
`{ key, pluginId, id, title, icon, group, run }` for the plugin that draws
the menu.

**Core callers.** None: since the rail is upstream's again, bb's rail header
is its own New thread button and draws no New menu. The host side is
`lib/fork-sidebar-new-items.ts`; a plugin that draws its own sidebar header
(`experimental_hideSidebarHeader`) reads the rows. bb's own New thread row
is not a registered row.

Docs: `frontend-renderer-slots.md`.

**Audit before stabilizing.**

1. Decide whether New thread should be a registered row, so one list drives
   the menu.
2. A row has no disabled state, shortcut or project context; add them only
   with a caller that needs them.

## Palette row Mod action (`ExperimentalPaletteSearchResult.experimental_onModSelect`)

A plugin palette row may carry `experimental_onModSelect()`. Mod+Enter or a
Mod-click runs it after the palette closes instead of opening `path`. A row
without it opens `path` either way. `experimental_modSelectLabel` names the
action on the highlighted row, and `icon` (a bb icon name or an emoji) draws
before the title. Rows whose title contains the query list above threads;
the rest stay below them.

**Core callers.** `ThreadSearchPaletteMode` passes its existing split flag
(Mod+Enter, used for threads to open in a split) to plugin rows;
`ForkPaletteSearch.tsx` carries the function on the row.

**Audit before stabilizing.**

1. Thread rows show a split hint; plugin rows show nothing for the Mod
   action. Add a hint label if this stays.

## Per-instance tab icon (`ExperimentalTabRegistration.experimental_instanceIcon`)

An action tab's registration may give `experimental_instanceIcon(params)`,
returning a bb icon name for one open instance from its params, or null to
keep the registration's `icon`. The tab strip calls it while
rendering. Nothing is stored: the icon is derived from the params the tab
already persists, so tab state and the server's thread-tabs schema are
unchanged.

**Core callers.** `lib/fork-tab-icon.ts` (`pluginTabInstanceIcon`), used by
`usePanelTabPresenter.tsx`.

**Audit before stabilizing.**

1. It runs during render, so a slow or impure plugin function costs every
   strip render; consider memoizing per params string.
2. Mobile's tab pager and the compact shelf draw through the same presenter;
   confirm they look right.

## Quiet turns (`experimental_classifyTurns`, `experimental_replyClassifier`, `thread.idle` `experimental_quiet`)

A plugin tells bb which finished turns are quiet: the agent had nothing to
say. For a quiet turn bb leaves the thread's attention time where it was (so
it stays read), posts no completion notice to the parent thread, and sends
no notification. The `thread.idle` plugin event carries `experimental_quiet`
so other plugins can follow. Core holds no rule of its own: with no
classifier registered, no turn is quiet. Studio registers the rule (a final
reply of exactly `[PASS]`).

- Backend: `bb.experimental_hooks.experimental_classifyTurns(classifier)`.
  Synchronous, one per plugin, removed when the plugin unloads. A throwing
  classifier counts as saying nothing.
- Frontend: `app.slots.experimental_replyClassifier({ id, classify })`. The
  thread view draws a reply classified quiet as a "Quiet check" marker.

**Core callers.** `services/threads/turn-classifiers.fork.ts` is the registry;
`services/threads/quiet-turn.fork.ts` asks it. `lifecycle-outcome.ts` calls
`forkBeforeLifecycle`/`forkAfterLifecycle` (`lifecycle-outcome.fork.ts`),
which keep `latestAttentionAt` after a quiet `run.succeeded`;
`internal/events.ts` adds one condition to the parent notice, and
`plugin-service.ts` spreads `forkIdleFields` into the event.
push-notifications' `sender.ts` returns early on the flag. On the client,
`lib/fork-reply-classifiers.ts` reads the slot for `ThreadTimelineRows`.

**Audit before stabilizing.**

1. The two halves (backend hook, frontend slot) must agree; consider one
   declaration that serves both.
2. Decide whether classification should carry more than `quiet`.
3. bb's own hook system is asynchronous (`experimental_hooks.on`). This one
   is synchronous because turn completion is; decide whether it should join
   the hook registry.

## Fixed workbench tabs (`experimental_global`, `experimental_useGlobalTabs`, `experimental_closeFixedTab`)

Each side panel keeps its own tabs. A fixed tab is one more plugin action
tab, synced as the preference `workbench.globalTabs`, that every side panel
draws first in its tab strip, before its own tabs, wherever the tab's plugin
registers that tab id: a thread for a `thread` tab, the plugin's own page
for a `nav-panel` tab. It has no close button, cannot be dragged, is left
out of "Close other tabs", and a close command on it does nothing. A thin
divider follows the last fixed tab. Which tab is selected stays per side
panel. The public names still say "global" because Studio calls them.

`openTab({ tab, params, experimental_global: true })` opens an action tab
as a fixed tab. `experimental_useGlobalTabs()` returns the fixed tabs as `{
pluginId, tabId, title, params }`.
`useBbNavigate().experimental_closeFixedTab({ tab: { id }, params? })`
closes one of the calling plugin's fixed tabs everywhere; nothing else
does.

**Core callers.** The merge is in `lib/fixed-panel-tabs.ts`: the tab state
every surface reads is the applicable fixed tabs plus its own stored state,
and a write sends each tab back to where it lives
(`lib/fork-global-panel-tabs.ts`). Thread tab sync reads and writes only the
thread's own tabs. `ThreadSecondaryPanel.tsx` marks the fixed tabs pinned
(`usePinnedFixedPanelTabs`), which is bb's own switch for "no close
button"; `SecondaryPanelTabStrip.tsx` sorts them first and draws them
through `workbenchFork.tsx`. Opening and closing are in
`lib/fork-plugin-global-tabs.ts`.

Docs: `fork-api.md`.

**Audit before stabilizing.**

1. Only plugin action tabs can be fixed. Browser, terminal and file tabs
   are bound to a thread or environment.
2. A tab that should show on every surface, the New thread screen and
   other plugins' pages included, needs an app-level tab context.
3. While a fixed tab applies, the side panel's open state is shared by
   every surface that shows it; decide whether that should stay.
4. Rename `experimental_global` and `experimental_useGlobalTabs` to say
   "fixed" when the API is stabilized.
5. A thread that already holds its own copy of the tab hides the copy while
   the fixed tab exists and shows it again after the plugin closes it.

## App theme (`experimental_useAppTheme`)

Returns `{ mode, epoch }`. `mode` is the light or dark mode in effect.
`epoch` changes whenever the theme's CSS variables may have new values. A
plugin that copies bb's colors somewhere CSS variables do not reach (a
canvas, a sandboxed iframe, an embedded editor's settings) reads the
variables again when either changes, instead of watching `<html>` and
`<head>` with a MutationObserver.

**Core callers.** The hook returns `usePreferredTheme()` and
`useAppThemeEpoch()`, the pair `ThreadTerminalView` and the Mermaid
renderer use to restyle the terminal and diagrams.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Decide whether to return resolved token values (`colors.background` as
   hex) so plugins stop reading CSS variables at all. That needs a named,
   versioned token list.
2. Decide whether the theme id and name belong here.

## Split panes (`experimental_useAppPanes`, `experimental_toAppPath` `split`)

`experimental_useAppPanes()` returns the split workspace's panes as
`{ id, path, focused }` in layout order, with `focus(paneId)` and
`close(paneId)`. `useBbNavigate().experimental_toAppPath(path, { split:
true })` opens a route in a pane. A plugin page is already a pane kind, so a
plugin can show its items beside threads in bb's own layout instead of
building a second pane system inside one nav panel.

**Core callers.** `split: true` calls `openPaneContentInSplit`, which
`RouteAnchor` calls for a modifier-click on an in-app link. `focus` and
`close` call `focusSplitPane` and `closeSplitPane`
(`views/thread-detail/splitPaneActions.fork.ts`), which `SplitThreadArea` calls
for a click on a pane and for its close button.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Panes hold one route each. A consumer that wants several items per pane
   needs tabs inside a pane, which is a layout change, not an API one.
2. Decide whether plugins may choose the side, or move and resize panes.
3. Pane ids are not stable across reloads; decide whether to expose a
   stable handle.
4. Through the plugin API, changing focus while a pane is maximized skips
   the scroll-position capture that `SplitThreadArea` does.

## Before a thread is deleted (`experimental_beforeThreadDelete`)

A plugin registers one handler on `bb.experimental_hooks`. The thread delete
route awaits it for the thread and for every thread deleted with it, before
anything is marked deleted. A handler that throws refuses the deletion with
a 409 that carries its message. A handler that does not answer in five
minutes counts as a refusal. Studio uses it to write the thread to a file
first (its "Export deleted threads" setting).

**Core callers.** `services/threads/thread-delete-hooks.fork.ts` is the registry;
`routes/threads/base.ts` asks it. Retention and agents delete through the
same route, so they are covered.

**Audit before stabilizing.**

1. Deletions that do not go through the route (project deletion cascades,
   purges of already-deleted threads) are not asked.
2. Decide whether the context should say who is deleting (a person, a
   plugin, an agent).
3. Decide whether this belongs in the asynchronous hook registry
   (`experimental_hooks.on`).

## Rename an open tab (`BbNavigate.experimental_renameTab`)

A plugin gives an open action tab a new title. bb finds the tab by plugin,
registration id and params (the same match `openTab` uses) and updates it in
as a fixed tab and in every thread panel opened in this window.

**Core callers.** `lib/fork-tab-titles.ts` does the work; core itself has
no caller, because core tabs take their titles from their own data.

**Audit before stabilizing.**

1. Thread panels not opened in this window keep the old title in the
   browser's storage until the tab is opened again there.
2. Consider deriving a tab's title at render time from the plugin (as
   `experimental_instanceIcon` does for icons) instead of storing it.

## Link handlers (`slots.experimental_linkHandler`)

A plugin opens some clicked links itself. bb's one function for opening a
URL by the user's preference asks the handlers first, in plugin-id order; the
first that returns true wins, and a handler that throws is skipped.

**Core callers.** `useOpenUrlByPreference` in `lib/url-open-routing.tsx`
calls `openUrlWithPlugin(url)` (`lib/fork-link-handlers.ts`), so chat
replies, previews and every other surface that routes through it are
covered. Clicks are asked with their modifiers by a capturing click listener
on the document that `fork-link-handlers.ts` installs while any plugin has a
handler: a click with ⌘, Ctrl or Shift on any `a[href]`, and a plain click on
a link to a bb route inside rendered Markdown (`[data-markdown-preview]`),
call `openUrlWithPlugin(href, { modifiers })`; a handler that takes it stops
the click before bb's own anchor handling. Synthetic clicks (bb's own
`openPathInSplit`) are not asked.

**Audit before stabilizing.**

1. The capture is DOM-level; decide whether bb's anchors (`RouteAnchor`,
   `MarkdownAnchor`, `PluginUrlLink`) should ask with the click instead.
2. Decide whether handlers should declare patterns, so bb can tell a link is
   handled before a click (for a tooltip or an icon).

## Interrupted turns and host daemons (`experimental_turn.interrupted`, `experimental_host.connected`, `experimental_host.disconnected`)

Three backend events. A turn that ends without finishing was already visible
as `thread.idle` or `thread.failed`, but without the reason; a plugin had to
query the thread's events to tell an interruption from a failure. Host
daemon connects and disconnects were not visible to backend plugins at all.

A fourth event, `experimental_thread.fileChanged`, lists the files an agent
just changed (`{ thread, changes: [{ itemId, path, kind, movePath? }] }`),
read from the thread's completed file-change items when new events are
appended; `ws/hub.ts` `notifyThread` triggers it. The first batch for a
thread after a server start only carries changes from the last ten seconds.

**Core callers.** `services/plugins/fork-plugin-events.ts` builds and emits
all of them through the plugin service's own `emitThreadEvent`.
`lifecycle-outcome.ts` calls `announceTurnInterrupted` through
`forkAfterLifecycle`, after `announceTurnFailed`; `ws/daemon-protocol.ts` emits the connect;
`internal/session-owner-side-effects.ts` emits the disconnect.

**Audit before stabilizing.**

1. A daemon that disconnects does not interrupt its threads until it opens a
   new session, so `experimental_turn.interrupted` can arrive long after
   `experimental_host.disconnected`.
2. A session replaced silently by a new one (`openSession` closing the old
   as replaced) emits no disconnect.
3. `restarted` is true on the first connect after a server start, because the
   server has not seen the daemon instance before.

## Approvals (`experimental_requestApproval`)

A plugin asks a person to approve something and waits for the answer. The
point is proof of a human: an approval counts only when it comes through a
channel an agent on the same machine cannot drive.

- **Desktop app.** The Electron main process makes an Ed25519 key pair at
  launch. The private key stays in its memory; the public key goes to the
  server in `BB_APPROVAL_PUBLIC_KEY`. The app asks the main process to answer
  an approval; the main process fetches the request from the server itself,
  shows a native dialog, signs the decision and posts it. The server checks
  the signature.
- **Browser or tailnet client.** The browser asks to be paired; that request
  is itself an approval that only the desktop dialog can grant. Once granted,
  the browser claims an HttpOnly, SameSite=Strict cookie. The server keeps
  only a hash of its value, in memory, so a browser pairs again after a
  server restart.
- **Everyone else** (agents, the CLI, plugin RPC) can create and list
  approvals but cannot resolve one.

**Core callers.** `services/fork-approvals/` on the server (registry, routes
under `/api/v1/fork/approvals`), `apps/desktop/src/fork-approvals.ts` in the
desktop main process, `components/fork/ForkApprovalHost.tsx` in the app.

**Audit before stabilizing.**

1. The native dialog allows or denies everything listed; per-item choice
   exists only in the browser dialog.
2. A desktop window pointed at another machine's server cannot sign for it;
   it falls back to the browser flow.
3. Whoever can replace the server process can replace its public key. That
   is outside what this protects against.
4. Pairings do not survive a server restart; decide whether to persist the
   hashes.

## Plugin windows (`slots.experimental_window`, `experimental_useWindows`)

A plugin registers a component bb can show in its own window, and opens,
toggles, closes and styles that window: size and position, transparent,
frameless, always on top and a system-wide hotkey. The window loads the bare route `/fork-window/<plugin>/<window>`,
which renders only the plugin's component.

**Core callers.** `apps/desktop/src/fork-windows.ts` (main process: creates
the window and hotkey; only loads the window route on the
calling page's own origin), `lib/fork-windows.ts` and
`components/fork/ForkWindowView.tsx` in the app. Core has no window of its
own on this path yet.

**Audit before stabilizing.**

1. Hotkeys live until the app quits or the plugin
   unregisters; nothing removes them when a plugin is disabled.
2. A hotkey another app holds is not registered, and the caller is not told.
3. Windows are not restored after the app restarts; the plugin registers
   them again when its frontend loads in the main window.
4. In a browser only a plain popup is possible.
5. Opening a window that is open with other `params` loads the new address
   in the same window (a page load, not an in-page navigation); the window
   keeps its bounds and nothing closes.

## `PluginFileOpenerRegistration.experimental_handleOpen` (`@get-bb/plugin-sdk/app`)

Lets a file opener claim an open without a file tab. Before BB opens a tab
that resolves to the opener through default resolution or the Settings → Files
pin, it calls `experimental_handleOpen({ path, source, lineRange })`. `true`
means the plugin showed the file itself (for example by focusing its own
panel tab) and BB opens no tab. `false`, a throw, or no answer within 3 seconds
opens the normal opener tab. One-off "Open with" choices and New Tab file
search (which fills the tab in place) skip the handler.
Core's file-open path (`useThreadFileTabs.openResolvedTab`, through `forkDeferUntilHandled` in `components/plugin/file-opener-handle.fork.ts`) is the only caller,
so links, the file tree and `bb thread open` share it.

Docs: `references/fork-api.md`.

**Audit before stabilizing.**

1. Decide whether the timeout and the async tab insert should be visible
   (pending state) or configurable.
2. Verify behaviour with several openers that claim the same extension and
   with plugins that reload while a handler is pending.
3. Confirm whether restored tabs and cross-client tab sync should ever call
   the handler.

## Rows in the context popover (`slots.experimental_contextCardRow`, `experimental_useContextCard`)

A plugin adds a row to bb's context popover and can open that popover from
its own control. bb draws the row (label, value, a quiet note, text actions)
so it matches the card; the plugin supplies data through a hook. Studio uses
it for the prompt cache, in place of a popover of its own.

**Core callers.** `ThreadContextWindowIndicator.tsx` renders
`ForkContextCardRows` in the card and ORs `useForkContextCardOpen` into the
popover's open state (`components/thread/timeline/ForkContextCard.tsx`).

**Audit before stabilizing.**

1. The popover is anchored at the context ring, also when a plugin control
   opened it; a thread with no usage yet has no ring and nothing opens.
2. One open flag serves every mounted ring; with two composers on screen
   both popovers open.
3. Decide whether rows should be data (as now) or components.

## Launcher items (`slots.experimental_launcherItem`, `experimental_useLauncherItems`)

Plugins offer apps and actions (id, title, icon, keywords, run) to a
launcher. bb draws no launcher itself: Studio draws one in a plugin window
(`center`, `hideOnBlur`, a global hotkey) and lists every plugin's items
through the hook. `run` executes in the launcher's window.

**Core callers.** `lib/fork-launcher-items.ts` (`usePluginLauncherItems`).
Nothing in core lists the items; if bb gets its own launcher or adds these
to the command palette, it must read them through the same hook.

**Audit before stabilizing.**

1. `run` executing in the launcher window means an item cannot touch the
   main window's state directly; decide whether bb should route runs to the
   main window.
2. Overlap with palette commands: decide whether a launcher item should
   just be a command with a flag.

## A row under each thread's header (`slots.experimental_threadBanner`)

A plugin draws a row in every thread view, under the thread's header and
above the transcript, with the thread id as a prop. Studio's worker status
line (state, repo tag, the conversation that owns the worker, started time)
is the caller. A component that returns null takes no room; one that throws
is hidden and the transcript stays.

**Core callers.** `components/fork/ForkThreadBanners.tsx` (`forkThreadBanner`),
drawn first in the thread window of `ThreadScreen.tsx`'s page presentation.

**Audit before stabilizing.**

1. Threads shown in a side panel tab (`ThreadChat`) get no banner; decide
   whether they should.
2. Several plugins' rows stack in plugin-id order with no priority or
   height limit.

## A notice under a model list failure (`slots.experimental_modelLoadNotice`)

A plugin draws a line under "Could not load models for …" in the model
picker, with the provider's label, the failure code and the server's message.
Studio's Accounts is the caller: when the model list failed through an
Account Pooler whose accounts are signed out, it states "Signed out" with
Sign in, instead of leaving only the pooler's HTTP 429.

**Core callers.** `components/fork/ForkModelLoadNotices.tsx`
(`forkModelLoadNotice`), drawn in `pickers/model-load-error-message.tsx`.

**Audit before stabilizing.**

1. The props carry the provider's label, not its id; decide whether the id
   should be passed.
2. The composer's send-blocking message (`formatModelLoadErrorText`) is text
   and draws no notice.

## The model picker's stand-in (`slots.experimental_modelPickerGate`)

A plugin's component is drawn wherever bb draws its model picker, with bb's
picker as `children` and `hasSelectedModel`. It returns `children` to keep
the picker or its own node instead. The first registration by plugin id,
then registration id, wins; one that throws falls back to bb's picker.
Studio is the caller: "Sign in", opening Accounts, while no agent provider
is ready.

**Core callers.** `components/fork/ForkModelPickerGate.tsx`
(`forkModelPickerGate`), around the picker in
`pickers/ModelReasoningPicker.tsx`.

**Audit before stabilizing.**

1. Every picker gets it, Settings' default-model pickers included; decide
   whether the gate should know where it is drawn.

## bb's first run (`slots.experimental_firstRun`)

A plugin takes over bb's first run, the setup screens shown while
`generalSettings.onboardingCompletedAt` is null. While it is null, bb holds
the screen blank until the plugin list has loaded and, when any enabled
plugin has an app, until plugin frontends settle. Then the first
registration in plugin-id order wins: its `component` is drawn full-window
with `finish()`, which sets `onboardingCompletedAt` as bb's own screens do;
a registration with no component is finished at once. A component that
crashes finishes too. With no registration bb's own screens show. Studio is
the caller: "Connect a model", provider sign-in cards with Skip for now; once a
provider is ready its onboarding makes the Assistant Bot and starts its first
chat on Main.

**Core callers.** `components/fork/ForkFirstRun.tsx` (`useForkFirstRun`,
`ForkFirstRun`), drawn by `onboarding/OnboardingGate.tsx`.

**Audit before stabilizing.**

1. The wait has no time limit of its own; it ends when plugin frontends
   settle, which has a 15 s floor.
2. Settings, "Replay setup guide" clears the setting and shows the plugin's
   first run again, not bb's.

## A thread header's title and a node after it (`slots.experimental_threadHeader`)

A plugin's `useDecoration({ threadId })` hook runs in every thread header
(main view and split panes). It returns null or `{ title?, after? }`:
`title` replaces the title text bb shows, `after` is drawn right after the
title in the same row. The first plugin by id, then registration id, that
returns a decoration wins. Renaming (double click, the ··· menu, the
shortcut) edits and saves the thread's real title; the decoration only
changes what is shown. Each hook runs in its own error boundary; one that
throws is dropped and bb's title stays. Studio is the caller: "Main · with
<Bot>" for a Bot's chat thread, and a worker's status pill and repo tag in
the row.

**Core callers.** `components/fork/ForkThreadHeader.tsx`
(`useForkThreadHeader`), called from `ThreadDetailHeader.tsx`, which draws
the returned title and `after` node.

**Audit before stabilizing.**

1. Other places that show the title (the sidebar, the palette, tab and
   window titles, pane drag labels) still show the real title; decide
   whether the decorated title belongs there too.
2. Only one decoration is shown; decide whether several plugins' `after`
   nodes should be combined.
3. The hooks report through a layout effect, so the header renders once
   with bb's title before the decoration; it is replaced before paint.

## Dragging items (`slots.experimental_itemDrop`, `experimental_writeDragItem`, `experimental_readDragItem`)

One drag payload for a thread, a plugin document, a side panel tab or a
file: JSON of `ExperimentalDragItem` under the MIME type
`application/x-bb-item`. A plugin makes its own elements sources with
`experimental_writeDragItem` and reads the item in its own targets with
`experimental_readDragItem`. bb's composer, side panel and main view are
targets: a document-level host resolves the zone from markup bb already has
(`[data-composer-box]`, the `aside` that holds
`thread-secondary-panel-top-chrome`, `[data-app-content-shell]`), asks the
`experimental_itemDrop` handlers `canDrop(item, target)` in plugin-id order,
outlines the zone (`data-fork-item-drop="over"`) and calls `drop` on the
first that accepts. Drags without the MIME type are ignored, so file drops
are untouched, and so is a drag a target inside the page already accepted.
During `dragover` browsers hide drag data, so the item of a drag that
started in this window is kept in a module variable; a drag from another
window is allowed when any handler exists and decided on drop.

bb's side panel tabs are native drag sources (11 Nov): the strip's tab
wrapper is `draggable`, and `usePanelTabNativeDrag` (`workbenchFork.tsx`)
writes the payload in `dragstart` through `beginPanelTabDrag`
(`lib/fork-tab-move.ts`). The item is `{ kind: "tab", id: key, title,
pluginId?, tab?, open? }`: `tab` for a plugin action tab, `open` (the
`ExperimentalWorkbench.open` spec, `tabOpenSpecNow`) for every tab another
window can show; a tab that cannot leave its window carries neither and the
drag also gets the type `application/x-bb-item-local`, which another
window's host refuses in `dragover`. The pointer sensor of dnd-kit is
replaced by an inert one, so the mouse never starts a dnd-kit sort and never
starts bb's pane drag (`onBeginTabDrag`); touch keeps dnd-kit's sensor, the
sort and `PanelTabItemDragSource`'s synthesized events.

A tab dropped on a side panel is bb's own move, decided before any handler
(`tabDropOutcome`): a tab of this window dropped on the panel it came from
(the drag source's `aside` is the zone's) is placed with
`workbenchSplitsFor(panelStateId).place` (reorder, the other pane, a pane's
body puts it last, the right edge of a single pane makes a new pane); a tab
from another panel or window with `open` is opened in the target panel's
workbench (`openTabSpecIn`, the drop's `pane` and `index`, then without
them) and the source window closes it when its `dragend` reports
`dropEffect` `"move"` (`endPanelTabDrag`); a same-window source closes once
the open resolved a key. The host sets `dropEffect` `"move"` on the
workbench and main zones and `"copy"` on the composer; a drop nothing took
is not cancelled, so the source sees `"none"`. `markDropTakenHere` keeps a
same-window drop a plugin handler took from also closing the source on
`"move"`. A workbench target also carries `open(spec, options)`, bound to
the panel the drop landed in and to the handler's plugin id
(`ItemDropEnvironment.openInPanel`), the one way a handler opens into a
popped-out window's panel.

**Core callers.** `components/fork/ForkItemDropHost.tsx`, mounted in
`AppLayout.tsx` and in each popped-out tab window (`ForkTabWindowPanel.tsx`,
with the window's thread id); `usePanelTabNativeDrag`, `InertMouseSensor`
and `PanelTabItemDragSource` in `components/secondary-panel/workbenchFork.tsx`,
a few lines in `SecondaryPanelTabStrip.tsx`; the rules are in
`lib/fork-item-drag.ts` and `lib/fork-tab-move.ts`. Core's mouse tab
reorder, pane drag and the pop-out all go through the payload now; its file
drops do not.

**Audit before stabilizing.**

1. The source learns of a cross-window drop only from `dragend`'s
   `dropEffect`; the target's open is asynchronous, so a tab whose open
   fails after the source closed is lost. Decide whether to confirm over a
   channel instead.
2. A drag from another window is sealed during `dragover`: the host accepts
   on the workbench zone whenever the drag is not local, and on the main and
   composer zones when any handler exists, then decides on drop. A bb file
   tab over another window's main view shows the move cursor and drops
   nothing.
3. The zone markers are test ids and data attributes that were not made for
   this; give each zone a named attribute.
4. `insertText`, `insertMention` and `insertThreadMention` find the
   composer by thread id, so two panes showing the same thread share the
   first composer. The two mention calls build the pill through the same
   composer handle `useComposer().insert` uses (`createComposerHandleBinding`
   with a detached controller for the accepting plugin), so a plugin pill
   resolves through that plugin's mention provider at send time; check this
   stays true if the handle grows lifecycle rules.
5. The thread of a zone comes from the split pane that contains it, else the
   focused pane, else the route (or the window's thread in a tab window).
6. `canDrop` runs on every `dragover`.
7. A side panel target's `pane` and `index` are read from markup
   (`[data-sidebar-split-tab-group]` rows sorted left to right, their
   `[data-tab-pill]` midpoints) and the right-edge rule is bb's `pickZone`
   on the panel, as for a tab drag. The insertion bar and the edge highlight
   are drawn by the host, copying the split drag overlay's style, not by the
   tab strip; core's tab reorder draws no bar of its own.
8. `index` from the markup counts every pill, Info and Diff included, and
   `place` resolves `before` from the pane's tab ids in the same order; a
   drop before a non-closable tab lands last in the pane.
9. Touch still reorders through dnd-kit; a touch drag cannot leave the
   window.

## Context at each turn start (`experimental_hooks.experimental_turnContext`)

`bb.experimental_hooks.experimental_turnContext(({ threadId }) => text)`
registers one provider per plugin. `buildThreadStartCommand` and
`prepareTurnSubmitCommandPayload` (for `target.mode === "start"` only, so
steers are left alone) pass their input through `withTurnContext`
(`services/threads/turn-context.fork.ts`): every provider runs in parallel with
the thread id, bb waits at most 500 ms in total, trims each answer and caps
it at 8000 characters, ignores throws, rejections, non-strings and late
answers, and appends one agent-only text item per plugin (plugin-id order)
to the command's `input` and to its last `inputGroups` group. The items go
to the provider in the existing `input` field (no protocol change) and are
not written to the thread's events, so each turn gets a fresh digest and
history does not fill with old ones. Studio uses it for the Bot's awareness
digest (what the other conversations and workers are doing).

**Core callers.** None. The nearest core paths are plugin mention context
(`appendPluginMentionContext`, agent-only items appended to the stored
input when a message is sent) and `contributeInstructions`/`configure`
instructions, which are evaluated per turn but only reach the provider when
a session is constructed.

**Audit before stabilizing.**

1. Decide whether the digest should be stored with the turn (as mention
   context is) so a transcript shows what the agent was told.
2. The 500 ms wait adds latency to every turn start while any provider is
   registered; decide on a per-plugin budget or a cached value.
3. Decide whether steers and queued drains should get it too.

## Fork point (`bb.experimental_hooks.experimental_threadForkPoint`)

`await bb.experimental_hooks.experimental_threadForkPoint(threadId)` returns `{
sourceThreadId, sourceTurnId, sourceSequence }` for a fork, else null.
bb already stores `sourceThreadId` and `originKind: "fork"` on the thread
(and they are on every `ThreadResponse`, including `thread.created`), but
not the point: `sourceSeqEnd` is rounded to a turn boundary while forking
and dropped. The fork's copied events keep the source's turn ids, so the
lookup (`services/threads/thread-fork-point.fork.ts`) is one indexed join: the fork's
latest `turn/completed` whose turn id also completed in the source, with
that source event's sequence. A fork with no copied history (hidden forks,
forks with no completed turn) returns null for both.

**Core callers.** None; core's fork UI does not show the point.

**Audit before stabilizing.**

1. Decide whether core should persist the fork point (a column) instead of
   deriving it, and whether to keep the requested `sourceSeqEnd`.
2. Decide whether it belongs on `ThreadResponse` instead of a lookup.

## Pop out a route (`BbNavigate.experimental_popOut`)

`useBbNavigate().experimental_popOut({ path, title?, width?, height? })`
opens any bb route in a window of its own. The path must start with `/`,
must not start with `//` or hold a backslash, and must resolve to a bb route
of the current origin (`resolveRouteHref`); bb adds `?bbBare=1`. In the
desktop app the request goes over the plugin window channel
(`experimental_window`, op `open`) with `titleBar: "hiddenInset"` and
`rememberBounds: true`, keyed by a hash of the path, so one path is one
window and its bounds are kept; the desktop main process accepts a
same-origin path only when it is a plugin window path or carries
`bbBare=1`. In a browser it is a named popup, focused when already open.
Sizes are clamped to 360 by 240 at least. A window loaded with
`bbBare=1` is bare for its whole life (`isBareWindow` in
`lib/fork-bare-window.ts`): `AppLayout` skips the sidebar (and with it the
rail), the sidebar trigger and bb's page header, the sidebar stays closed, and the opener's split layout is
dropped from the copied session storage. Every provider stays mounted, so a
thread, a plugin panel or settings work as in the main window.

**Core callers.** None yet; Studio pops out threads and its own panels.
Core's own "open in new window" does not exist.

**Audit before stabilizing.**

1. Links inside a bare window navigate in that window, still bare; decide
   whether some should go to the main window.
2. Decide whether bare should be a route-level layout rather than a query
   flag read once per window.
3. Desktop windows opened this way never unregister until the app quits.

## Items in a chat message's ··· menu (`slots.experimental_messageAction`)

A plugin adds an item to the ··· menu of chat messages: `{ id, title,
icon?, isAvailable?(message), run(message) }`. `message` is `{ threadId,
messageId, turnId, role, sourceSeqEnd }`; `sourceSeqEnd` is the anchor
`threads.fork` takes, so "Fork conversation from here" is
`useSdk().threads.fork({ sourceThreadId: message.threadId, sourceSeqEnd:
message.sourceSeqEnd })`. Items show in plugin-id order after Add to chat and
before bb's own Fork item, in the main thread view and in `ThreadChat`, never
as inline icons. Studio's "Fork conversation from here" is the caller. It
differs from upstream's `slots.messageAction`, which is an
inline icon in the main view only, has no availability rule, and also shows in
the text-selection menu.

**Core callers.** `ConversationRowContent` in `ThreadTimelineRows.tsx` adds
the items to the row's plugin actions through `withForkMessageMenu`, and
`MessageActionBar.tsx` takes them out of the inline candidates and puts them
in the menu (`forkInlineMessageActions`, `forkMenuMessageActions`); the rules
are in `components/thread/timeline/forkMessageActions.ts`. bb's own Fork item
is not registered through the slot. A registration with
`experimental_replaces: "thread.fork"` hides bb's "Fork into new thread" on
every message its `isAvailable` allows (`forkKeepsThreadFork`, one condition
in `MessageActionBar.tsx`); Studio sets it on "Fork conversation from here",
which is available in Bot conversations and workers only, so other threads
keep bb's item.

**Audit before stabilizing.**

1. Decide whether this should merge with `slots.messageAction` as a
   placement (`"inline" | "menu"`) rather than a second slot.
2. `isAvailable` runs for every registered item on every message render.
3. The text-selection menu takes no items from this slot.
4. bb's own Fork item should move onto the same registry if this ships.

## A thread list without bb's sidebar header (`PluginThreadListRegistration.experimental_hideSidebarHeader`)

While the sidebar's thread list is one that sets
`experimental_hideSidebarHeader: true`, bb draws no sidebar header row
contents: the navigation provider's header (bb's Rail puts its New thread button there) and
the back and forward buttons. In the browser layout with the rail, the row
itself goes; with the list placement or the macOS window chrome it stays,
empty, because it reserves room for the sidebar toggle or the traffic lights.
Back and forward then sit at the start of the main view's header row (the
header that owns the window's top left), keeping their shortcuts, which
`HistoryCommandHandlers` binds regardless. In the desktop app's framed title
bar layout they already sit in the title bar, so nothing moves there.
Studio's Bot sidebar is the caller; its "+ New conversation" is the one
create control.

**Core callers.** `SidebarTopReserveRow` in `SidebarChrome.tsx` asks
`useForkSidebarHeader`, and `AppPageHeader.tsx` draws
`ForkMainHistoryControls`; both are in
`components/sidebar/ForkSidebarHeader.tsx`. The registration collector
passes the flag through `withForkThreadListFields`.

**Audit before stabilizing.**

1. Pages with no `AppPageHeader` (the New thread screen) then have no back
   and forward buttons; only the shortcuts.
2. Decide whether the flag belongs on the thread list or on the navigation
   provider, which owns the header's contents.
3. Settings and other section sidebars follow the thread list's choice too.

## A conversation's workbench (`BbNavigate.experimental_workbench`)

Code outside a thread view (an agent tool's handler in an always-mounted
component) gets that thread's side panel: list every tab, open the caller's
action tab or bb's file, diff, in-app browser and terminal tabs (into pane 1,
pane 2 or a new pane, at an index in that pane's tab row), close or select
any tab, read and set the panel's layout (its panes and their widths
included), and tell whether the user is typing in the panel.

A plugin page's side panel is a workbench too, keyed by the page instead of a
thread: `experimental_workbench("page:<pluginId>/<panelId>")`
(`pageWorkbenchKey` in `lib/fork-workbench.ts`). `PluginPanelRightPanelHost`
mounts the same `ForkWorkbenchSurface` a thread view does, with the page's
panel state id, so pane placement runs through the one `workbenchFor` path.
Only the page's own plugin gets it, tabs open in the page's `nav-panel`
context, `arrange` declines the conversation's settings, `popOut` resolves
false, and a call with no argument still means a thread. Caller: Studio's link
router, which opens a Cmd-clicked Bot page row in the second pane. Stabilize
with the rest of the workbench API; decide then whether the key should be an
object instead of a string.

The side panel has one pane, or two side by side, each with its own tab row
and New Tab button: bb's own split code (`SidebarSplitContainer`,
`sidebarSplitLayout.ts`) with the rules in
`components/secondary-panel/workbenchSplitLimits.fork.ts` (at most two panes,
a tab drag splits only to the right of a single pane and otherwise drops into
the other pane, only a stored row of up to two panes is restored, bb's
left/right/top/bottom move menu is off). A pane that loses its last tab
closes (bb's reconcile). Pane sizes persist per conversation in bb's
`bb.thread.secondaryPanelSplitLayout` key; the panel's own width per
conversation in its width atom.

**Core callers.** Every call goes through the path core uses: the thread
view's `AppPanelController` (`openTab`, `selectTab`, `closeTab`, `close`,
`getTabs`, the same list the tab strip and `experimental_usePanelTabs`
read), the thread view's `openFilePreview` and `openTerminal` navigation
capabilities, the in-app browser opener the thread view gives
`UrlOpenRoutingProvider`, bb's diff tab reference (`GIT_DIFF_TAB_REFERENCE`,
as the timeline's "open file diff" uses it), and the thread's own width and
conversation-collapse atoms that the resize handle and collapse button
write. `components/fork/ForkWorkbenchSurface.tsx`, mounted with the thread
banners in the thread page, registers the view; `lib/fork-workbench.ts` does
the rest. Panes go through the split container's own operations: one hook
line in `SidebarSplitContainer.tsx` (`useWorkbenchSplits` in
`workbenchSplits.fork.ts`) registers its `moveTab`, `removeSplit`, `resize`
and `commitState` by panel state id (the thread id), the same calls its tab
drag, Remove split button and divider make; the tab menu's "Move to new
pane" and "Move to other pane" (`workbenchFork.tsx`) use that registration
too. Core edits: exporting `InAppBrowserUrlOpenContext` from
`lib/url-open-routing.tsx`, and the pane seam (`workbench-panes` in
`STUDIO_FORK.md`).

**Audit before stabilizing.**

1. `open` learns the new tab's key by waiting (up to three seconds) for the
   selected tab to match the request; give core's open paths a return value
   with the key instead.
2. `focus: false` opens and then selects the previous tab again (or closes
   the panel again), so the panel can flash; core should take a "background"
   flag.
3. Placement waits for the opened tab to reach the split state, then moves
   it with `moveTab` and reorders the pane's group; give core's open paths a
   target pane instead. `index` counts tabs as `layout().panes[n].tabs`
   lists them (fixed tabs first, then the pane's order), which the tab row
   draws the same way today. `arrange({ panes: 2 })` moves the selected
   tab, which may be Info; decide whether it should take the last tab.
   Pane numbers are positions, not ids, so they shift when pane 1 closes.
4. Only the thread page registers a workbench; a thread shown in a plugin
   page's `ThreadChat` has none. `isTyping` cannot see focus inside the
   desktop app's native browser view.

## New Tab items (`slots.experimental_newTabItems`)

A plugin adds its own items to the side panel's New Tab page: recent items
merged into bb's Recent list (newest first, with kind and time) and results
for the search box under the registration's title.

**Core callers.** None: core's Recent list holds only files the thread
opened (`threadRecentItems.ts`). The core edit in
`components/secondary-panel/NewTabFileSearch.tsx` adds a `fork` entry kind,
a `fork` section for search results, and merges and renders through
`NewTabFileSearch.fork.tsx`, so keyboard navigation, the Show more toggle
and the empty hint treat plugin rows as bb's own.

**Audit before stabilizing.**

1. Recent items have no shared store: each plugin keeps its own and bb only
   merges them. A stable API should let a plugin record "opened" events into
   bb's Recent list instead, so files and plugin items share one history.
2. Search results appear only while a file source is searchable (the page
   shows "No searchable source" otherwise).

## Action tabs off the New Tab page (`ExperimentalTabRegistration.experimental_showInNewTab`)

An action tab registered with `experimental_showInNewTab: false` is left out
of the side panel's New Tab page: its Actions list and the actions its
search box matches. The tab stays registered, so `openTab`, links, a fixed
tab and the rest of bb still open it. `useVisible` stays the switch for
hiding a tab from the whole panel. Studio's caller is its Bot, Side thread,
New thread, Todos and VS Code tabs, which open from its own controls.

**Core callers.** None: core lists every action tab whose `useVisible`
allows it. The core edit in `components/secondary-panel/NewTabFileSearch.tsx`
passes the page's actions through `useForkNewTabActions`
(`NewTabFileSearch.fork.tsx`), which drops entries for those tabs. The
registration collector takes the field through `forkTabFields`, which
rejects any value but `false`.

**Audit before stabilizing.**

1. The page's entries carry only bb's `plugin-action:<pluginId>:<tabId>`
   id, so the flag applies to every action registration of that tab id in
   the plugin (thread and plugin page alike), not per context.
2. Decide whether bb's own New Tab actions should take the same switch, and
   whether a user setting should override it.

## Draggable New Tab rows (`ExperimentalNewTabItem.experimental_dragItem`)

A New Tab item with `experimental_dragItem` makes its Recent or search row
draggable. On `dragstart` the row writes that item with the same
`writeDragItem` that backs `experimental_writeDragItem`, so the drag carries
the shared payload (`application/x-bb-item`) and bb's item drop zones (a
side panel pane, a composer, the main view) hand it to
`slots.experimental_itemDrop` handlers. The item is checked with
`parseDragItem` when the row is built; an invalid one leaves the row
undraggable.

**Core callers.** None: core's own Recent rows (files) are not draggable.
`ForkNewTabRow` in `components/secondary-panel/NewTabFileSearch.fork.tsx`
draws every plugin row, Recent and search alike, so no core file changed.

**Audit before stabilizing.**

1. Core's file rows could carry a `file` drag item through the same path;
   do that before stabilizing so plugin and core rows drag alike.
2. The row is a native HTML drag; the side panel's own tab drags are
   dnd-kit pointer drags. Decide on one.

## Grouped New Tab actions (`ExperimentalTabRegistration.experimental_newTabGroup`)

An action tab registered with `experimental_newTabGroup: "<heading>"` is
listed on the New Tab page under that heading instead of bb's Actions.
bb's Actions section comes first and keeps every action without a group;
the named sections follow in the order the plugin slot snapshot first
names them (plugin order, then registration order); an empty section is not
drawn. Each section is bb's own `NewTabActions` list, so drag to reorder
works within a section and writes bb's one stored order. The search box
still lists every matching action under Actions. Studio's caller groups its
tab kinds under "New" and "Open".

**Core callers.** None: core draws one Actions list. The core edits are a
`label` prop on `NewTabActions` (default "Actions") and one line in
`NewTabFileSearch.tsx` that draws a `NewTabActions` per group from
`useForkNewTabActionGroups` (`NewTabFileSearch.fork.tsx`). The registration
collector takes the field through `forkTabFields`, which requires a
non-empty string.

**Audit before stabilizing.**

1. Like `experimental_showInNewTab`, the group is matched by bb's
   `plugin-action:<pluginId>:<tabId>` id, so it applies to every action
   registration of that tab id in the plugin.
2. Two plugins that name the same heading share one section; decide whether
   sections should be per plugin.
3. Decide whether bb's own actions (Open browser, Start terminal) should
   join a "New" section, and whether search results should keep the
   headings.

## Opening another plugin's tab (`ExperimentalWorkbenchOpenSpec` `tab.pluginId`, `ExperimentalTabRegistration.experimental_openableByPlugins`)

`experimental_workbench(...).open({ kind: "tab", tab: { pluginId, id },
params?, title? })` opens another plugin's thread action tab, as that
plugin's `openTab` would: the same owner, params (JSON, persisted, and the
instance's identity) and title, and the same wait for the tab's key.

Permission rule: only a thread action tab registered with
`experimental_openableByPlugins: true` can be opened by another plugin.
Any other target (not marked, unknown tab id, unknown or empty plugin id, a
fixed tab, a plugin page tab) resolves null and opens nothing. A plugin id
equal to the caller's own is the same as leaving it out. The check reads the
plugin slot snapshot at the time of the call. The target tab gets the
opener's params, so it must validate them. Studio's callers open the
Workflows plugin's "workflow-run" tab (`{ runId }`), which carries the flag,
and Visual Chat's board tab, which needs it in Visual Chat's own
repository.

**Core callers.** The open goes through `createPluginPanelController(owner,
…).openTab`, the path the target plugin's own `openTab` uses, with the
owner swapped for the target plugin.
`workbenchTabOwner` in `lib/fork-workbench.ts` applies the rule. The
Workflows plugin's registration carries the flag (one line in
`plugins/workflows/src/app.tsx`).

**Audit before stabilizing.**

1. The flag is all or nothing: any plugin may open the tab with any params.
   Decide whether a tab should name the plugins it accepts, or declare a
   params schema bb checks.
2. Only the workbench's `open` takes another plugin's tab; `openTab` on a
   plugin's own panel controller does not. Decide whether it should.

## Replacing the quick palette (`slots.experimental_commandPalette`, `experimental_useAppCommands`)

`slots.experimental_commandPalette({ id, component })` puts one plugin's
component in bb's quick palette dialog in place of bb's command list and
thread search; the component gets `{ initialMode, close(then?),
experimental_onEscape(handler) }`.
`experimental_useAppCommands()` lists what bb's palette lists as commands,
`{ id, title, group, shortcut?, run }`. Studio draws one omnibar for Mod+K and
its own launcher window with them.

**Core callers.** Every entry point already ends in `CommandPalette`'s two
command handlers (`palette.open` and `thread.search`; the rail's Search
button and Mod+K dispatch `thread.search`), so the replacement is one
wrapper there: `ForkCommandPalette` (`components/commands/ForkCommandPalette.tsx`)
renders the first registration by plugin id, keyed by bb's open counter, or
bb's own body when there is none or the component crashed. bb's Escape mode
exit is skipped while a replacement is registered
(`forkCommandPaletteActive`), so Escape closes. Before that, the dialog's
`onEscapeKeyDown` asks the handler the component registered with
`experimental_onEscape` (`forkCommandPaletteEscape`); when it returns true
the key is prevented and the dialog stays open. Radix listens for Escape in
the capture phase on the document, so the handler runs before the
component's own key handlers; Studio's omnibar clears its query this way, as
its launcher window does. `close(then)` is bb's
`runAfterClose`. Inside the palette `experimental_useAppCommands()` reads the
actions `CommandPalette` built when it opened and runs them through bb's
`chooseAction` (record recent, close, run after focus returns); settings,
plugin pages and server switches are built with the builders
`CommandPaletteBody` uses (`buildSettingsPaletteActions`,
`buildPluginPagePaletteActions`, its server rows). Outside the palette the
hook builds the command actions with `CommandPalette`'s builders
(`buildAppCommandActions`, `buildPluginPaletteActions`,
`buildPluginComposerCommandActions`) against the current window.

**Audit before stabilizing.**

1. The composition of the command list is copied from `CommandPalette`'s
   `buildActions` and `CommandPaletteBody`'s settings, page and server rows;
   extract one shared builder that both bb's palette and the hook call.
2. Outside the palette availability is read with no target (no focused
   element) and refreshed on mount and window focus only; core has no
   change signal for command handlers.
3. bb has no keywords for its commands; `group` is bb's display heading,
   not a stable category.
4. Only one replacement can be active (first plugin id); decide whether bb
   should refuse a second registration instead.
5. `experimental_onEscape` keeps one handler per window, the last one
   registered. Decide whether it should be a prop callback bb calls instead
   of a registration, and whether bb's own palette body should leave search
   mode through the same path.

## Tabs in their own window (`ExperimentalWorkbench.popOut`)

`experimental_workbench(threadId).popOut(key)` and the tab menu's "Open in
new window" move a side panel tab into a popped-out window
(`/fork-window/_bb/tab?thread=…&win=…&spec=…&pane=…&from=…&title=…`, through
the pop-out window opener of `experimental_popOut`, one desktop window per
`win`) and close it in the panel. The window is a workbench panel of the
thread (`ForkTabWindowPanel.tsx`): bb's own `ThreadSecondaryPanel` with its
split container, under the panel state id `tab-window:<win>:<thread>`
(`lib/fork-tab-window-panel.ts`; `threadIdOfPanelState` reads the thread
back out, global fixed tabs do not apply), no server sync, no Info, Diff,
New Tab or terminals. The window seeds itself once from the address's
`spec` (a `sessionStorage` flag per `win`, so a reload does not reopen a tab
dragged away), registers a workbench surface for the thread with that panel
state id (so `experimental_workbench(threadId)` from a component mounted in
the window is the window's panel, and `workbenchSplitsFor` is keyed by the
surface's `panelStateId`), mounts the item drop host with the window's
thread id, follows the selected tab's label in `document.title` and its
bar, and closes itself (the desktop `close` op by window key, else
`window.close()`) once it has had a tab and has none. Tabs reach it by drag
and drop; its tabs reorder, split and drag out as in the main window. The
main window keeps no record of tabs living in windows: `list()` does not
include them. "Return to workbench" turns every tab into its `open` spec
and asks the window that popped the first one out (over the
`bb-fork-tab-window` BroadcastChannel, one message with a `tabs` list) to
open them again with `experimental_workbench(threadId).open(spec, { pane })`;
with one pane in the window every tab goes to the pane the first came from,
with two panes each goes to its own pane number. That window shows the
conversation first if it moved on. With no answer in 600 ms, any window
showing the conversation takes it.

**Core callers.** The tab menu item and `popOut` share
`popOutWorkbenchTab` (`lib/fork-tab-popout.ts`): the tab is read from the
panel's own tab state, turned into the `open` spec that recreates it, and
closed with the panel controller's `closeTab`, the close button's path. A
drop into the window goes through `ForkItemDropHost` and
`tabDropOutcome`/`openTabSpecIn` as in the main window. Reopening is
`workbenchFor(...).open`, the same as plugins call.

**Audit before stabilizing.**

1. Only tabs `open` can recreate pop out or drop into a window: plugin
   action tabs and workspace, host and thread storage file tabs. Terminals
   (closing the tab ends the terminal), in-app browser tabs (a native view
   of the main window), Info, Diff and fixed tabs (not closable), New Tab,
   attachment previews and file opener tabs stay. Each needs a way to move
   rather than close.
2. The tab window lives outside bb's layout and route, so `useBbContext()`
   reports no thread there; a tab reads its `threadId` prop. Plugin app
   overlays are not mounted there either, which is why a drop target
   carries its own `open`.
3. When several windows show the conversation and the opener is gone, each
   reopens the tabs.
4. Window bounds are remembered per window id, so every pop-out starts at
   the default size; the window's tab state stays in `localStorage` until
   bb's panel state prune removes it.
5. Closing the window with its close button drops its tabs; decide whether
   that should return them instead.

## The tab's own window (`experimental_useTabWindow`)

`experimental_useTabWindow()` returns `{ title, toolbar }` inside a popped-out
window and null elsewhere. The window's bar shows the selected tab's
`title`; `toolbar` is an element in the bar, before "Return to workbench"
and outside the window drag region, that the selected tab renders its
controls into with `createPortal` (null for a tab that is not selected).
Studio's page and item headers leave out their title row there and move
their actions to `toolbar`.

**Core callers.** `ForkTabWindowPanel` provides it (`lib/fork-tab-window.ts`)
around each tab's content, with the title the bar draws. No core view reads
it: bb's own file previews have no title row.

**Audit before stabilizing.**

1. Decide whether this should be one general "host draws the title" signal
   that also covers nav panel title bars and the workspace tab row, rather
   than one for tab windows.
2. `toolbar` hands out a DOM element; decide whether a slot component
   (children rendered into the bar) is the better contract.

## A backdrop behind the app (`slots.experimental_appBackdrop`)

`slots.experimental_appBackdrop({ id, component, useAppearance? })` draws one
plugin's component behind bb's main window and lets it restyle bb around it.
bb portals `component` into `<body>` in a fixed, full-window layer at
`z-index: -10` with no pointer events and marks `<html data-fork-backdrop>`.
`useAppearance()` runs in the plugin's scope and returns
`{ mode?, tokens?, surfaces? }`: `mode` overrides the window's resolved light
or dark, `tokens` are custom properties set inline on `<html>`, and
`surfaces` (`sidebar`, `main`, `composer`, `secondaryPanel`, `header`, each
`{ background?, backdropFilter?, edge? }`) become
`--fork-surface-<name>-background`, `-backdrop-filter` and `-edge` on
`<html>`, with `data-fork-surface-edge` listing the surfaces that set an
edge. Two more surface names, `panel` and `code`, paint what sits inside
the main view (`[data-sidebar="inset"]`) and the side panel `aside`, where
`fork.css` remaps bb's opaque fill tokens to translucent ones while a
backdrop shows: `--card` becomes `--fork-panel` (the `panel` background, or
`--canvas` at 32%), `--muted`, `--secondary` and `--accent` become their
`--ink` share over transparent instead of over `--canvas`, the `-solid`
surface tokens become their translucent twins, and `--surface-scrim` and
the pill gradients follow. `bg-background` there paints nothing (page roots,
fields), `--fork-panel` when the element also has a shadow (buttons,
selects), and `--fork-code` (the `code` background, or `--canvas` at 58%)
with the `code` backdrop-filter (default `blur(8px)`) when it is sticky,
absolute or fixed, so text does not scroll through a header. Code blocks
(a recessed surface with a `pre` child, or a `pre` with its own background)
get `--fork-code`. Left opaque without a card layout: popovers, menus,
dialogs, tooltips and toasts (portaled outside the main view, `--popover`).
Left opaque on purpose: state variants such as `data-[state=active]:bg-background`, semantic fills
(`bg-primary`, `bg-foreground`, `bg-destructive`, status dots), diff and
terminal renderers, and `bg-black` media stages.
`ForkAppBackdrop.surfaces.test.ts` scans `apps/app/src` and
`packages/shared-ui/src` for every unconditional background utility and
fails on one that is neither translucent, remapped, ruled nor listed as an
exception; `ForkAppBackdrop.layout.test.tsx` mounts a settings section, a skill page's markdown with a
code block, the new-thread home, a plugin page and a popover in the real
`AppLayout`. Values go through a `CSS.supports` check. Studio's theme engine is the caller: its
WebGL scene is the component and its theme's colors are the appearance.

**Core callers.** bb's own light and dark goes through the same path: the
override sits inside `getPreferredTheme` in `hooks/useTheme.ts`, so the
`.dark` class, `usePreferredTheme` (code, diff and terminal themes) and
`experimental_useAppTheme().mode` all follow it. `ForkAppBackdropHost`
(`components/fork/ForkAppBackdrop.tsx`) is mounted by `ForkLayoutHosts`,
renders the first registration by plugin id, skips bare windows, and puts
the component and the appearance probe under one `PluginSlotMount`, so a
crash in either removes both and every override. `fork.css` makes every
layer between the window and bb's content see-through while
`data-fork-backdrop` is set (the window, `#root`, the layout root, the
sidebar panel, the main inset and its framed `::before`, the thread window,
scroll viewports, the composer footer, background-toned fades, the side
panel) and paints each surface's variables on its root; inside the sidebar
and the side panel it does so by setting `--sidebar` to transparent. A test
walks every ancestor of the transcript, the composer and the thread list in
a real `AppLayout` with a real `ThreadScreen`, framed and unframed, and
fails on any background utility no rule clears.

**Card layout.** `useAppearance()` may also return
`layout: { cards: { gap, radius } }` (finite numbers, clamped to 0–24 and
0–28 px; anything else drops the layout). bb then sets `data-fork-cards`,
`--fork-cards-gap` and `--fork-cards-radius` on `<html>` and removes them
with the rest of the appearance. Under `html[data-fork-cards]`, `fork.css`
clears the fill, blur, border, `clip-path` and mask of the sidebar panel,
its inner sidebar, the collapsible bodies, the main inset (and its framed
`::before`, `::after` and edge) and the inset's header, so the scene shows
in the gutters; gives the inset the gap as margin and the card radius;
and paints as cards, each from its surface's variables with the card
radius, no border and `--fork-cards-shadow` (one soft, wide drop shadow
pulled in with a negative spread so it does not darken the gutters, and no
inner highlight or ring; a surface's `edge` is never drawn on a card, and
the buttons inside a header pill or the composer, settings cards, fields
and the user's message bubble lose their border color): the sidebar as one card, a
`::before` of the sidebar's grid that spans the column holding the content
and the footer and is hidden while the sidebar is collapsed to its rail
(`sidebar`), the header's `data-fork-header-group` rows and the
sidebar toggle as pills two pixels tighter than the cards
(`--fork-cards-control-radius`, `header`), each page thread's text column
(`main`: a sticky `::before` of the scroll content, `--fork-cards-column`
808px wide or the pane's width if narrower, centered like bb's 760px
column and as tall as the scroll area, which becomes a size container;
the thread window itself paints nothing, so the scene stays sharp on both
sides) with the composer box inside it (`composer`) over
`--fork-cards-composer-backing`, a fade to 84% `--canvas` under the
sticky footer that keeps the transcript from showing through, and the side panel
`aside` (`secondary-panel`), plus any `[data-fork-card="<surface>"]`
element outside the sidebar, the hook plugin content uses; inside the
sidebar such an element paints nothing, so the sidebar stays one card. The
rail `nav` and its settings cell paint nothing and get
`--fork-cards-icon-halo`, a drop-shadow from `--canvas`, so their icons
read on the scene. The core callers are bb's own surfaces: the same
card rules paint bb's sidebar, header groups, thread, composer and
side panel and plugin `data-fork-card` elements. Two upstream files carry
a one-attribute hook (`data-fork-header-group` in `AppPageHeader.tsx` and
`SidebarHistoryNavigationControls.tsx`). `ForkAppBackdrop.cards.test.tsx`
renders the real `AppSidebar` (rail and list, framed and not) with an
`AppPageHeader`, and `ForkAppBackdrop.layout.test.tsx` the real
`AppLayout` and `ThreadScreen`; both resolve `fork.css`'s cascade by
specificity (`test/fork-css-cascade.ts`) and check that every container
under the gutters paints nothing and every card gets its surface's paint
and radius, and that no card rule matches without `data-fork-cards`.

**Page column cards.** Outside a thread the main view paints nothing and
each page gets one `main` card on its content column, as tall as the page
area, with the scene clear on both sides. A static `PageShell` (Settings and
its subpages, project and machine settings, error states;
`[data-page-scroll-viewport].flex-1`) gets a sticky `::before` of its
`max-w` column, `--fork-cards-page-bleed` (40px: the column's 16px padding
plus 24px) wider on each side, so the 760px column's card is the thread's
808px; the scroller's parent becomes a size container, and a negative top
margin (`--fork-cards-page-lead`) cancels the column's top padding. The
`ToolsView` shells (Skills, Plugins and the marketplace: the fill-viewport
wrapper that holds a `[data-resource-collection-viewport]`; a skill's or
plugin's page: the `relative h-full overflow-hidden` wrapper of its
scroller) get an absolute `::before`, `--fork-cards-wide-column` (1032px:
the 984px content of `max-w-5xl` plus 24px each side) wide and centered,
shifted by `--fork-cards-scroll-gutter` where bb reserves `md:pr-3`. These
two are class selectors on upstream markup; the test reads the class
strings out of `ToolsView.tsx`. The new-thread page and the thread's own
card are not touched. Scrollers in the main view other than the thread's
hide their idle thumb. A plugin page marks its own column card with
`data-fork-card="main"`.

**Title rows in cards.** `layout.cards.titleRow: true` (only the boolean
`true`) sets `data-fork-title-rows` on `<html>` with the card layout.
`ForkHeaderTitle` (`ForkTitleHost.tsx`) wraps the title group in
`AppPageHeader.tsx`: it renders the group through a portal into one
`display: contents` box it owns and appends that box to the first
`[data-fork-title-host]` under the header's parent element, or to its own
place in the bar when the flag is off or there is no host. A
`MutationObserver` on that parent follows hosts that mount and unmount, so
the title's React subtree never remounts (a rename in progress survives)
and the box leaves a host when the header unmounts. bb's hosts are
`ForkTitleHost`: `kind="page"` as the first child of a static `PageShell`'s
column (sticky at the top of the scroller, the card's width and top
corners, the column's top padding removed, 12px above the content) and
`kind="tools"` as the first child of both `ToolsView` wrappers (a row above
the scroller, in the wide column's box). A page row's backing is a
`::before`: `--fork-title-row-background` (80% `--canvas`) with
`--fork-title-row-filter` (`blur(18px)`), 10px taller than the row and
masked to fade out below it, at opacity 0 until the scroller has moved
(a scroll-driven animation over the first 32px), so a card at rest has no
band and scrolled text does not show through. A plugin's host is any
element it marks; Studio marks one inside its thread row, which gives bb's
thread title, its double-click rename and its menu the card. The core
callers are bb's own Settings, Skills and Plugins headers and every thread
header: all go through `AppPageHeader`. `ForkTitleHost.test.tsx` covers the
move, the return and the scoping, framed and unframed, and the row's rules.

**Overlay scrollbars.** Under `data-fork-cards`,
`[data-page-scroll-viewport]`, `[data-resource-collection-viewport]`, the
`ToolsView` detail scroller and any `[data-fork-overlay-scroll]` element
get `scrollbar-width: none`, so a classic scrollbar reserves no gutter and
the gap beside a card is the card gap. `ForkOverlayScrollbarHost`
(`ForkLayoutHosts`) keeps one fixed `[data-fork-scroll-thumb]` on `<body>`:
it listens for `scroll` in the capture phase and `pointermove`, places the
thumb 2px inside the scroller's right edge, hides it 900ms after the last
scroll unless the pointer is over the scroller, and scrolls on drag. The
framed inset's 1px side padding is removed under cards, and its right
margin is the gap less the window lip. `ForkOverlayScrollbar.test.tsx`
covers the thumb's box, the selectors and the drag.

**Tables wider than the column.** bb lets a markdown table break out of the
760px column (`MarkdownTable` in `markdown-preview.tsx`: an outer `div` up to
1100px wide, centered on the column, holding the table's scroller). Under
cards the outer `div` gets two wings, `::before` and `::after`, painted like
the column card and only as wide as the part of the table outside the
808px column (`--md-content-w`, the table's measured width, minus
`--fork-cards-column`, halved), so the glass is not doubled where the table
overlaps the column. A start-aligned table in a nested group
(`[--md-table-start-offset:0px]`) is not centered on the column, so it gets
one backing under the whole table instead. Tables are the only breakout bb
has; code blocks, images and diff cards stay inside the column.

**Overlays.** With a card layout every overlay portaled to `<body>` outside
`#root` is dense glass from `surfaces.popover` (`--fork-popover`, default
`--canvas` at 76%, and `--fork-popover-filter`, default `blur(12px)`): any
`.bg-popover` (menus, context menus, popovers, select lists, hover cards,
toasts, cmdk), `[role="dialog"]` and `[role="alertdialog"]` (dialogs, the
command palette, sheets, drawers) and Radix tooltips
(`[data-radix-popper-content-wrapper] > .bg-primary`). They take the card
radius and `--fork-cards-shadow`, lose their border color, and inside them
`--state-hover`, `--accent` and `--state-active` are `--primary` at 24% and
34%, so hover and selection carry the theme's accent; a `bg-background` or
`bg-popover` inside one paints nothing (the palette's body, fields) and a
focused menu item draws no outline. Dialog scrims are not touched. A
plugin's portaled overlays that use the same classes or roles are painted
the same way. `ForkAppBackdrop.layout.test.tsx` opens a menu, a popover, a
tooltip and a dialog with an opaque body in the real `AppLayout`.

**Audit before stabilizing.**

1. The see-through rules name bb's DOM (`data-sidebar`, `data-promptbox`,
   `aside[data-surface-tone]`, `header`); a new opaque layer upstream breaks
   them silently outside the paths the test walks (pages other than a
   thread, the side panel's tab bodies).
2. With `--sidebar` transparent, the thread list's sticky section headers
   and the side panel's sticky rows no longer hide what scrolls under them.
3. On a framed macOS window the main inset has a `mask-image` and a
   `clip-path`, which the Filter Effects spec makes a backdrop root, so
   `backdropFilter` on the header, the side panel and the composer may blur
   only what bb draws inside the main card, not the backdrop (`main` and
   `sidebar` are painted on elements outside it). Check in a live window and
   decide whether bb should drop the mask while a backdrop shows.
4. The mode override wins over the user's Appearance setting with no sign
   of it in Settings, and the desktop window's native theme still follows
   the setting.
5. Only one backdrop is active (first plugin id); decide whether bb should
   refuse a second registration.
6. Card layout: the rules name bb's DOM (`nav[data-sidebar-navigation-placement]`
   and its sibling settings cell, the grid inside `[data-sidebar="sidebar"]`
   (found by `:has(> [data-sidebar="collapsible-body"])`),
   `[data-sidebar="trigger"]`, `[data-thread-window]`, `aside[data-surface-tone]`);
   check them in a live window, framed and unframed, with the rail and the
   list, a split thread and the side panel open. Pages other than threads
   get no `main` card; decide whether bb should mark the page body so it
   can paint one. The inset's margins change its box; check the compact
   drawer, the side panel shelf and the framed title bar band. Decide
   whether the gap and radius should be tokens of the theme rather than a
   layout option, and whether `data-fork-card` should become a public slot
   wrapper instead of an attribute. `data-fork-title-host` finds its host
   by the header's parent element; decide whether a header should name its
   host instead, and whether the overlay thumb should serve the side panel
   and plugin panels too. Stabilize once Studio's themes have
   shipped on it, both window kinds pass a live check, and the selectors
   are covered by an upstream-owned attribute.

## Hiding bb's own entries (`slots.experimental_hideHostEntries`)

A plugin lists bb's own sidebar navigation keys, pages and settings sections
to take out of the app. The sidebar leaves hidden rows out, a hidden page's
address goes to the home view, and a hidden settings section is neither drawn
nor offered by settings search. Registrations add up across plugins. BB Studio
hides the Skills row, the Skills page and General's "bb CLI skills".

**Core callers.** `components/fork/ForkHiddenHostEntries.tsx` reads the
registrations. `SidebarNavigationModel.tsx` filters its rows,
`ToolsView.tsx`'s `SkillsView` redirects, `CliSkillsSettingsSection.tsx`
draws nothing, and `useSettingsSearchConditions.ts` drops the `cliSkills`
search entry.

**Audit before stabilizing.**

1. Only one page (`skills`) and one settings section (`cli-skills`) are
   named. Decide whether pages and sections get stable ids bb maintains.
2. Hiding is UI only. Pair it with a server policy where the entry's routes
   matter (the skill registry has `experimental_skillsRegistryPolicy`).
3. The sidebar's stored order keeps a hidden key; it shows again where it
   was once the plugin is off.

## The skill registry policy (`experimental_skillsRegistryPolicy`)

A backend plugin registers one policy on `bb.experimental_hooks`. bb asks
every policy before it serves any `/skills-registry` request: `search` (the
list and search), `read` (an entry, its detail, its repository stars) and
`install` (installs and install jobs). One refusal answers 403
`skills_registry_refused` with its message, so the app, the CLI (`bb skill
search`, `bb skill registry detail`, `bb skill install`), the SDK and agents
all see the same message. A throw or no answer within 5 seconds refuses too.
BB Studio refuses all three until a person turns the registry on in Settings
(an approval only a person can answer).

**Core callers.** `services/skills/registry-policy.fork.ts` is the registry
and the middleware; `server.ts` mounts it before the registry routes.

**Audit before stabilizing.**

1. The policy is not told who is asking (the app, the CLI, an agent); decide
   whether it should be.
2. Skills installed outside bb (a harness's own installer, a shell command)
   are not covered.
