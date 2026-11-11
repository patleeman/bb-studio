# Fork API to audit

Experimental plugin API added by the BB Studio fork. Same rules as
`docs/api_to_audit.md`: each entry says what the member does, which core
callers use the same path, and what to check before stabilizing it. Kept in
its own file so upstream changes to `docs/api_to_audit.md` never conflict.

## Composer footer (`ComposerCustomization.experimental_footer`)

`app.composer.customize({ id, scopes: ["thread"], experimental_footer: [{
id, component }] })` places a small status item in the row under an
existing thread's input, before the session-options, permission and
context-window controls. A component returning null takes no space. Other
scopes have no footer row and ignore the field.

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

## Fixed workbench tabs (`experimental_global`, `experimental_useGlobalTabs`, `experimental_closeFixedTab`, `experimental_compactWhenFixed`)

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
does. A registration with `experimental_compactWhenFixed: true` is drawn as
its icon alone while fixed, with the title as tooltip and accessible name.

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

## Items in a side panel tab's menu (`slots.experimental_panelTabAction`)

A plugin adds an item to the right-click menu of plugin action tabs in the
side panel's tab strip: `{ id, title, icon?, isAvailable?(tab), run(tab) }`.
`tab` is `{ pluginId, tabId, params, title, threadId }`; `threadId` is the
thread whose side panel holds the tab and null on a plugin page. Items show
on any plugin's action tab, in plugin-id order, before bb's Close items.
bb's own file, diff, terminal and browser tabs, and file opener tabs, get
none. Studio's "Open as main tab" is the caller.

**Core callers.** `PanelTabActionMenuItems` in
`components/secondary-panel/workbenchFork.tsx`, one line in the tab's
context menu in `SecondaryPanelTabStrip.tsx`; the rules are in
`lib/fork-panel-tab-actions.ts`. Core's own Close items are not
registered through the slot.

**Audit before stabilizing.**

1. The menu is a context menu, which compact viewports turn off; the mobile
   tab pager has no place for these items.
2. `isAvailable` runs for every registered action each time a menu renders.
3. Decide whether bb's own tabs (files, terminals) should take items too,
   with a tab description that covers them.
4. Core's Close items should move onto the same registry if this ships.

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

## The project menu (`experimental_ProjectActionsMenu`, `experimental_ProjectActionsContextMenu`)

Two host components that give a plugin bb's own project menu, as a "more"
button and as a context menu, for a plugin that draws its own project rows.

**Core callers.** Both render core's `ProjectActionsMenu` and
`ProjectActionsMenuItems` (`components/project/ProjectActionsMenu.tsx`), the
same components the app header and the stock sidebar use, so the actions and
their dialogs are core's.

**Audit before stabilizing.**

1. Match the shape of `experimental_ThreadActionsContextMenu` (trigger
   props, extra actions) before these are made stable.
2. The project is looked up in the sidebar navigation query; a project that
   query does not list renders no menu.

## Link handlers (`slots.experimental_linkHandler`)

A plugin opens some clicked links itself. bb's one function for opening a
URL by the user's preference asks the handlers first, in plugin-id order; the
first that returns true wins, and a handler that throws is skipped.

**Core callers.** `useOpenUrlByPreference` in `lib/url-open-routing.tsx`
calls `openUrlWithPlugin` (`lib/fork-link-handlers.ts`), so chat replies,
previews and every other surface that routes through it are covered.

**Audit before stabilizing.**

1. A modifier-click is left to the browser and is not asked; decide whether
   handlers should see it with the modifier.
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
frameless, always on top, click-through, a system-wide hotkey and a menu bar
entry. The window loads the bare route `/fork-window/<plugin>/<window>`,
which renders only the plugin's component.

**Core callers.** `apps/desktop/src/fork-windows.ts` (main process: creates
the window, hotkey and menu bar entry; only loads the window route on the
calling page's own origin), `lib/fork-windows.ts` and
`components/fork/ForkWindowView.tsx` in the app. Core has no window of its
own on this path yet.

**Audit before stabilizing.**

1. Hotkeys and menu bar entries live until the app quits or the plugin
   unregisters; nothing removes them when a plugin is disabled.
2. A hotkey another app holds is not registered, and the caller is not told.
3. Windows are not restored after the app restarts; the plugin registers
   them again when its frontend loads in the main window.
4. In a browser only a plain popup is possible.

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

## A row above the main view (`slots.experimental_mainHeader`)

A plugin draws a row above the main view, across the view and its side
panel. Studio's main tab strip is the caller. bb only stacks the rows; what
a tab is, which are open and where they are stored is the plugin's.

**Core callers.** `components/fork/ForkMainHeader.tsx`, the first child of
the content shell in `AppLayout.tsx`.

**Audit before stabilizing.**

1. The row is above bb's own header, so on macOS with the sidebar folded it
   shares the line with the traffic lights; the plugin has no inset to read.
2. Split panes share one row; decide whether a row belongs to each pane.

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

bb's side panel tabs are dragged with dnd-kit's pointer sensors, not the
browser's drag and drop. `PanelTabItemDragSource` watches that drag and, for
a plugin action tab, dispatches `dragenter`, `dragover`, `dragleave` and
`drop` events that carry the payload to the element under the pointer,
outside the strip the tab came from. Plugin targets and bb's own zones get
the same events as from a browser drag.

**Core callers.** `components/fork/ForkItemDropHost.tsx`, mounted in
`AppLayout.tsx`; `PanelTabItemDragSource` in
`components/secondary-panel/workbenchFork.tsx`, one line in
`SecondaryPanelTabStrip.tsx`; the rules are in `lib/fork-item-drag.ts`.
Core has no item drag of its own: its file drops and tab reordering do not
go through the payload.

**Audit before stabilizing.**

1. Tab drags are synthesized events: no drag image beyond dnd-kit's
   overlay, no drop effect cursor, and they cannot leave the window. Decide
   whether tabs should use the browser's drag and drop.
2. A tab dropped outside its strip is still reordered by dnd-kit when the
   pointer ends nearest another tab.
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
   focused pane, else the route.
6. `canDrop` runs on every `dragover`.

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
rail), the sidebar trigger and bb's page header, `ForkMainHeader` draws no
plugin rows, the sidebar stays closed, and the opener's split layout is
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

## The close command's fallback (`slots.experimental_closeFallback`)

`{ id, close(): boolean }`. On the close command (Mod+W), when keyboard
focus is outside the side panel or the panel has no closable selected tab,
bb asks the handlers in plugin-id order; the first that returns true wins
and bb does nothing else. Otherwise, and when none takes it, bb behaves as
before. Studio closes its main tab with it.

**Core callers.** `closeFallbackHandled` in `lib/fork-close-fallback.ts`.
`useWorkbenchForkCommands` registers it ahead of bb's `panel.close`
handlers and as a desktop close-window listener (for routes where bb has
none). The desktop menu accelerator calls every close-window listener, so
bb's own listeners consult it too: `getBbDesktopInfo` (`lib/bb-desktop.ts`)
hands out the desktop API through `withForkCloseGuard`
(`lib/bb-desktop.fork.ts`), which wraps every `onCloseWindowRequest`
listener so it runs only when the fallback did not take the close. The
answer is kept for the rest of the tick, so plugins are asked once per key
press.

**Audit before stabilizing.**

1. Focus and the closable selected tab are read from the DOM (`aside`,
   `[data-tab-pill]`, `aria-pressed`, `[data-tab-pill-close]`); pass the
   panel state instead.
2. Clicking a side panel tab focuses it, so Mod+W right after still closes
   the side tab; clicking in the thread moves Mod+W to the plugin. Decide
   whether that is what people expect.
3. A new upstream close-window listener would not consult the fallback.

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

## A tinted sidebar (`PluginThreadListRegistration.experimental_useSidebarStyle`)

While the sidebar's thread list is one that sets
`experimental_useSidebarStyle`, bb runs the hook in the plugin's scope and
puts the result on its sidebar panel as `--fork-sidebar-background` and
`--fork-sidebar-accent`, each with a `data-fork-sidebar-*` attribute.
`fork.css` paints the background on the sidebar's collapsible bodies (the
thread list area and, with the rail, the footer body; the rail keeps bb's)
and sets bb's `--sidebar-accent` to the accent inside them, so bb's own
selected and hovered rows use it. bb applies nothing else, text colors
included; the plugin chooses readable colors. A value `CSS.supports` rejects
is dropped, and a throwing hook applies nothing. Studio's Bot space sidebar
is the caller.

**Core callers.** `AppSidebar.tsx` spreads `useForkSidebarStyle()` onto
bb's `Sidebar`; `ForkSidebarStyleHost`, mounted by `ForkLayoutHosts`, runs
the hook. Both are in `components/sidebar/ForkSidebarStyle.tsx`. The
registration collector passes the hook through `withForkThreadListFields`.

**Audit before stabilizing.**

1. With the rail, a gradient is drawn twice: once on the thread list body
   and once on the footer body.
2. Section sidebars (Settings, a page's `experimental_sidebar`) share the
   body, so they are tinted too.
3. Decide whether the style belongs on the thread list or on a separate
   sidebar slot, and whether bb should derive a readable foreground.

## Skills on bb's Skills page (`slots.experimental_skillSource`)

Each source's skills are listed under bb's own on the Skills page's library
view, one section per source with its `label` as the heading, in plugin-id
order. The filter menu gets a Source group with one option per source.
Sources join bb's Type and Provider filters as a union: choosing sources
lists only theirs unless bb's filters are also set, which adds bb's matching
skills; bb's filters alone list no source. The search matches name,
description and label. A row opens with the skill's `onOpen`, or opens
`path` in the preferred editor. Studio lists each Bot's own skills.

**Core callers.** `SkillsOverview` in `SkillsCollection.tsx` calls
`useForkSkillSources` (`components/tools/ForkSkillSources.tsx`) for the
filter group and wraps its list body with it. Rows use bb's `ResourceRow`.

**Audit before stabilizing.**

1. Plugin skills do not take part in bb's sort, pagination or skill detail
   page.
2. Decide whether sources should be options of bb's Type group instead of a
   group of their own.
3. bb's built-in skills have no source, so they cannot be chosen alongside
   a source except through bb's Type filter.
