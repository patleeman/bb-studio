import { useStudioPageTitle } from "./src/ui/page-bar";
import { ApprovalCard } from "./src/ui/conversations/ApprovalCard";
import { registerCodeApp } from "./src/code/register";
import { registerSettingsApp } from "./src/settings/ui/sections";
import { lazy, Suspense, useEffect, useLayoutEffect, type ComponentType } from "react";
import { StudioWorkspace, WorkspaceBridge } from "./src/ui/Workspace";
import { forkOnly, hasGlobalWorkbench, registerCommandPalette, registerFirstRun, registerModelPickerGate, registerNewTabItems, registerPaletteSearch, registerSidebarSection } from "./src/kit/app/host-sdk";
import { WelcomeLanding } from "./src/ui/bot/WelcomeMessage";
import { ConnectModel } from "./src/ui/onboarding/ConnectModel";
import { SignInGate } from "./src/ui/onboarding/SignInGate";
import { EditSpaceHost } from "./src/ui/conversations/EditSpaceHost";
import { NewTabBridge, STUDIO_NEW_TAB_ITEMS } from "./src/ui/newtab-items";
import { OpenedTabsRecorder } from "./src/ui/opened-tabs";
import { EntryView, registerTabKindTabs } from "./src/ui/tab-kind-tabs";
import { newTabFields, newTabTitle } from "./src/tab-kinds";
import { WorkbenchAgentBridge } from "./src/workbench-agent/ui/bridge";
import { GlobalItemOpener, studioPageItemTab, studioPageTab } from "./src/ui/global-workbench";
import { registerWorkbenchTabs } from "./src/ui/workbench-tabs";
import { PaletteSearchBridge, searchStudioItems } from "./src/ui/palette-search";
import { OpenedItemsBridge } from "./src/ui/opened-items-bridge";
import { registerStudioLinkHandler } from "./src/ui/link-handler";
import { LinksBridge } from "./src/links/open";
import { NotFoundTab } from "./src/links/NotFoundTab";
import { NOT_FOUND_TAB, NOT_FOUND_TITLE } from "./src/links/router";
import { registerQuietReplyClassifier } from "./src/kit/quiet-turns";
import { NewMenuBridge } from "./src/ui/new-menu";
import { BotSidebarList } from "./src/ui/conversations/BotSidebarList";
import { showBot } from "./src/ui/conversations/show-bot";
import { hideBbSkills } from "./src/ui/skills/hide-bb-skills";
import { hideBbChrome } from "./src/ui/footer/hide-bb-chrome";
import { openBugReport, REPORT_BUG_FOOTER_ID } from "./src/ui/footer/report-bug";
import { askAboutItemHandler } from "./src/ui/ask-about-item";
import { setAskAboutItem } from "./src/kit/app/item-header";
import { registerReadOnlyComposer } from "./src/ui/conversations/ReadOnlyComposer";
import { FinishedCard } from "./src/ui/conversations/finish";
import { finishThreadAction } from "./src/ui/conversations/finish-action";
import { OLDER_SUBPATH, olderBotFromPath } from "./src/ui/conversations/model";
import { SKILLS_SUBPATH, skillsBotFromPath } from "./src/ui/skills/paths";
import { newConversationRoute } from "./src/ui/conversations/new-conversation";
import { NewConversationPage } from "./src/ui/conversations/NewConversation";
import { LibraryPage } from "./src/ui/library/LibraryPage";
import { post } from "./src/code/file-opener";
import { registerItemDrops } from "./src/ui/item-drop";
import { withPageTabs } from "./src/ui/page-tab-requests";
import { RetireFixedBotTabs } from "./src/ui/bot/retire-fixed-tabs";
import { ITEM_TAB_ICON } from "./src/ui/item-icons";
import { registerItemWindows } from "./src/ui/item-window";
import { registerHostWindow } from "./src/kit/app/windows";
import { WindowsBridge } from "./src/windows/ui/WindowsBridge";
import { ThemeLayer } from "./src/theme/ui/ThemeLayer";
import { PresenceCheckHost } from "./src/presence/ui/PresenceBridge";
import { THEME_FOOTER_ID, THEME_FOOTER_LABEL, ThemeQuickHost } from "./src/theme/ui/ThemePopover";
import { themeCommandRegistrations, toggleThemePopover } from "./src/theme/ui/quick";
import { registerThemeBackdrop } from "./src/theme/backdrop";
import { registerLauncherItems } from "./src/launcher/items";
import { LAUNCHER_WINDOW_ID } from "./src/launcher/shared";
import { LauncherWindow } from "./src/launcher/ui/Launcher";
import { StudioCommandPalette } from "./src/launcher/ui/CommandPalette";
import { ChatOverlay } from "./src/chat/ui/ChatOverlay";
import { ReloginHost } from "./src/auth/ui/ReloginDialog";
import { registerAccountsApp } from "./src/accounts/ui/register";
import { StarHost } from "./src/ui/StarHost";
import { ItemGestures } from "./src/ui/ItemGestures";
import { ConversationPage } from "./src/chat/ui/ConversationComposer";
// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, project leads in
// the Setup page, and Studio search.
import { HostRouteBridge, openAppPath, registerWorkspaceProvider, RetainedPanels, retainPanel, StudioBarSlot, usePathname, WORKSPACE_PATH } from "./src/kit/app/index";
import { BUILTIN_ROUTES, builtinSegment, CHATS_PATH, legacyChatPath, STUDIO_ROOT } from "./src/builtins";
import { MEMORY_SUBPATH, memoryBotFromPath } from "./src/memory/shared";

/** The apps family's segment: /plugins/studio/studio/apps/<id> opens any app type. */
const APPS_SEGMENT = "apps";
import { ArtifactCard } from "./src/artifacts/ui/artifact-card";
import { isArtifactId } from "./src/artifacts/shared";
import { isDrawingId } from "./src/draw/shared";
import { DrawingDirective } from "./src/draw/ui/drawing-directive";
import { isDesignId, QUESTIONS_RENDERER } from "./src/design/shared";
import { DesignCard } from "./src/design/ui/design-card";
import { isMiniId } from "./src/minis/shared";
import { MiniCard } from "./src/minis/ui/mini-card";
import { QuestionFormView } from "./src/design/ui/question-form";
import { isRecordingId, UNSENT_PATH } from "./src/talk/shared/format";
import { registerTalkApp } from "./src/talk/ui/register";
import { isPageId, PageCard } from "./src/pages/ui/PageCard";
import { enabledKinds, STUDIO_TAB, STUDIO_TAB_ICON } from "./src/ui/studio-tab/model";
import { ExpandToPage, NotesInProgress } from "./src/pages/ui/notes/composer";
import { TalkBridge } from "./src/pages/ui/talk-bridge";
import { registerExploreApp } from "./src/explore/app";
import { registerReactionsApp } from "./src/reactions/app";
import "./src/pages/ui/styles.css";
import "./src/ui/bot/timeline.css";
import "./src/dashboards/ui/dashboards.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { openCollection, showLibrary, StudioPanel } from "./src/ui/StudioPanel";
import { HealthFooter, HealthWatch, SETUP_SUBPATH, setHealthFooter } from "./src/ui/health/HealthViews";
import { SetupPage } from "./src/ui/setup/SetupPage";
import { HandsFreeComposerButton, HandsFreePill, startHandsFree } from "./src/voice/live/ui/HandsFree";
import { BOT_SUBPATH } from "./src/ui/bot/BotHome";
import { BotPanel } from "./src/ui/bot/BotTabs";
import { BotCacheBanner } from "./src/ui/bot/BotCache";
import { BotThreadDirective, openThreadBeside, ReplyInThreadAction, SIDE_THREAD_ACTION, SideThreadPanel, ThreadIndicators } from "./src/ui/bot/SideThreads";
import { BOT_THREAD_DIRECTIVE } from "./src/bot-side-threads";
import { registerForkFromHere } from "./src/ui/conversations/fork-from-here";
import { canShowBot, openThreadVia, showBotNumber } from "./src/ui/conversations/state";
import { BotsSidebarSection, BotThreadList, ThreadListSwitcher } from "./src/ui/bot/BotSidebar";
import { StudioThreadList } from "./src/ui/StudioSidebar";
import { BOT_LIST_ID, STUDIO_LIST_ID } from "./src/ui/bot/threadListSwitch";
import { registerThreadAutomations } from "./src/ui/automations/register";
import { AUTOMATIONS_PANEL, AutomationsPanel } from "./src/ui/automations/AutomationsPanel";
import { useCodePageTitle, VSCODE_PANEL } from "./src/code/page-title";
import { CODE_ICON } from "./src/code/shared";
import { isCodePageId, OldCodeAddress, VsCodePanel, VsCodeRetainedView } from "./src/code/vscode-panel";
import { runVsCode } from "./src/code/open-vscode";
import { onMainWindowPath } from "./src/launcher/main-actions";
import { VSCODE_MAIN_PATH } from "./src/launcher/shared";
import { readKindsSnapshot, whenOn } from "./src/ui/kinds-snapshot";
import { LoopDirective, LoopsDirective } from "./src/loops/ui/LoopCard";
import { WorkDirective } from "./src/work/ui/WorkCard";
import { InFlightBanner } from "./src/work/ui/InFlight";
import "./src/work/ui/work.css";
import { LOOPS_PANE, LoopsPane } from "./src/loops/ui/LoopsPane";
import { TodosTabName } from "./src/loops/ui/tab-name";
import { OFF_NEW_TAB, onThreadTabOpen, registerThreadTab, ThreadTabReceiver } from "./src/kit/app/thread-panel";
import { forgetView } from "./src/ui/studio-tab/view-state";
import { registerThreadHeader } from "./src/ui/thread-header";
import { registerThreadContext } from "./src/ui/thread-context";
import { openPathFromRoute, StudioContainerProvider } from "./src/ui/studio-open";

/**
 * An old address that showed the item list (`collection`, a kind such as
 * `page`) or the workspace: the workspace, with the list as a new tab
 * except for `workspace`. Retained, so it checks each time it's shown. In a
 * pane of its own, such as a restored BB split, it offers the move instead.
 */
function ToWorkspace({ path, kind, query }: { path: string; kind?: string; query?: string }) {
  const pathname = usePathname();
  const go = (replace: boolean) => {
    if (query) showLibrary(query);
    else if (path !== "workspace") openCollection(kind ?? (path === "collection" ? null : decodeSegment(path)));
    openAppPath(WORKSPACE_PATH, { replace });
  };
  // Either side may be percent-encoded; compare them decoded.
  const here = decodeSegment(pathname.replace(/\/+$/, "")) === decodeSegment(`${WORKSPACE_PATH}/${path}`);
  useEffect(() => { if (here) go(true); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  if (here) return null;
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
    <button type="button" className="rounded-md border px-3 py-1.5 text-foreground hover:bg-state-hover" onClick={() => go(false)}>Open in Studio</button>
  </div>;
}

/** A path segment, or "" for a malformed one like `100%`. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

/** Built-in kinds' item pages, each loaded the first time one opens. */
const BUILTIN_VIEWS: Record<string, { isId(id: string): boolean; View: ComponentType<{ id: string; rest?: string }> }> = {
  // The editor (BlockNote, Yjs, Mermaid, Shiki, Recharts) loads when a page first opens.
  // Old addresses of a workspace's VS Code and the picker: VS Code has its own nav panel now (src/code/vscode-panel.tsx).
  workspaces: { isId: isCodePageId, View: OldCodeAddress },
  pages: { isId: isPageId, View: lazy(() => import("./src/pages/ui/route")) },
  artifacts: { isId: isArtifactId, View: lazy(() => import("./src/artifacts/ui/route")) },
  // Excalidraw is big: it loads when a drawing first opens, not with Studio.
  drawings: { isId: isDrawingId, View: lazy(() => import("./src/draw/ui/route")) },
  designs: { isId: isDesignId, View: lazy(() => import("./src/design/ui/route")) },
  // A recording's page, and the audio this device kept (`recordings/unsent`).
  recordings: { isId: (id) => isRecordingId(id) || id === UNSENT_PATH, View: lazy(() => import("./src/talk/ui/route")) },
  // The app's frame loads its own libraries (the shelf); this is the host around it.
  minis: { isId: isMiniId, View: lazy(() => import("./src/minis/ui/route")) },
};

/** The thread's Studio tab; its kinds' editors load when an item opens. */
const StudioTab = lazy(() => import("./src/ui/studio-tab/StudioTab"));
/** One Bot's memory (src/memory/ui), loaded when it first opens. */
const MemoryView = lazy(() => import("./src/memory/ui/MemoryView"));
/** What the Bot sidebar leaves out, and finished conversations (src/ui/conversations/OlderPage.tsx). */
const OlderPage = lazy(() => import("./src/ui/conversations/OlderPage"));
const SkillsPage = lazy(() => import("./src/ui/skills/SkillsPage"));

/** The Studio app: links in it open as Studio tabs (src/ui/studio-open.tsx). */
function StudioRoot({ subPath }: { subPath: string }) {
  return <StudioContainerProvider value={{ kind: "studio" }}><StudioRootView subPath={subPath} /></StudioContainerProvider>;
}

function StudioRootView({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  // The Library: the Bot's files (src/ui/library). Item addresses under it open the item as before.
  if (path === "") return <LibraryPage />;
  if (path === "browse") return hasGlobalWorkbench ? <><GlobalItemOpener /><StudioPanel /></> : <StudioWorkspace />;
  if (path === SETUP_SUBPATH) return <SetupPage />;
  // The Bot page: the selected Bot's Info, or the create flow; its chat and
  // threads open as BB threads, with the Bots list in BB's sidebar.
  if (path === BOT_SUBPATH || path.startsWith(`${BOT_SUBPATH}/`)) return <BotPanel />;
  // Memory: `memory` (the Bot last picked, else the primary) or `memory/<botId>`.
  if (path === MEMORY_SUBPATH || path.startsWith(`${MEMORY_SUBPATH}/`)) return <Suspense fallback={null}><MemoryView botId={memoryBotFromPath(path)} /></Suspense>;
  // The Bot sidebar's "N older conversations" and "N older workers": `conversations` or `conversations/<botId>`.
  if (path === OLDER_SUBPATH || path.startsWith(`${OLDER_SUBPATH}/`)) return <Suspense fallback={null}><OlderPage botId={olderBotFromPath(path)} /></Suspense>;
  if (path === SKILLS_SUBPATH || path.startsWith(`${SKILLS_SUBPATH}/`)) return <Suspense fallback={null}><SkillsPage botId={skillsBotFromPath(path)} /></Suspense>;
  const entry = /^(automation|todo|record)\/([^/]+)$/.exec(path);
  if (entry) return <EntryView kind={entry[1] as "automation" | "todo" | "record"} id={decodeSegment(entry[2]!)} />;
  // A Bot's + New: BB's new-thread composer on its default model (`new-conversation/<botId>[/<projectId>]`).
  const fresh = newConversationRoute(path);
  if (fresh) return <NewConversationPage botId={fresh.botId} projectId={fresh.projectId} />;
  // Conversations about items: chats/item/…, chats/choose/…, chats/quote/….
  if (path === CHATS_PATH || path.startsWith(`${CHATS_PATH}/`)) return <ConversationPage subPath={path.slice(CHATS_PATH.length + 1)} />;
  // A built-in kind: <segment>/<id> is one item; <segment> alone is the
  // library filtered to the kind, like any add-on's kind.
  // Every app type, as `pages` alone lists pages. `apps/<id>` and
  // `pages/<id>` show the id's own type (builtinSegment).
  if (path === APPS_SEGMENT) return <ToWorkspace path={APPS_SEGMENT} query="family:app" />;
  const builtin = builtinSegment(path);
  if (builtin) {
    const view = BUILTIN_VIEWS[builtin.route.segment];
    const [first = "", ...rest] = builtin.rest.split("/");
    const id = decodeSegment(first);
    if (view && view.isId(id)) return <Suspense fallback={null}><view.View id={id} rest={rest.join("/")} /></Suspense>;
    return <ToWorkspace path={builtin.route.segment} kind={builtin.route.kind} />;
  }
  return <ToWorkspace path={path} />;
}

/** Sends links to the retired Chat panel (/plugins/studio/chats/…) to Studio's. */
function LegacyChats() {
  const pathname = usePathname();
  const target = legacyChatPath(pathname);
  useEffect(() => { if (target) openAppPath(target, { replace: true }); }, [target]);
  return null;
}

/**
 * Lets the workspace open built-in kinds' items as tabs, from their Studio
 * address and from the address their old add-on had (links and bookmarks
 * made before the merge), which it rewrites.
 */
function BuiltinRoutes() {
  useLayoutEffect(() => {
    const roots = [...BUILTIN_ROUTES.flatMap((route) => [`${STUDIO_ROOT}/${route.segment}`, ...(route.legacyRoot ? [route.legacyRoot] : [])]), `${STUDIO_ROOT}/${APPS_SEGMENT}`];
    const disposers = roots.map((root) => registerWorkspaceProvider(root));
    return () => disposers.forEach((dispose) => dispose());
  }, []);
  return null;
}

/** The Studio view's sidebar (the Library and Studio's pages): the Bot sidebar, as everywhere. */
function StudioViewSidebar() {
  return <BotSidebarList onNavigate={() => {}} activeThreadId={null} />;
}

/** The unified sidebar as a thread list: `studio/everything`. */
const UNIFIED_LIST_ID = "everything";

/**
 * BB's `experimental_hideFromNavigation: true` (round 7): a page with a route
 * and no rail icon, More entry, Customize row or command palette entry. The
 * Bot sidebar's page rows open Studio's pages. Only the fork gets the field:
 * stock BB refuses a panel with a field it doesn't know, and shows them on its
 * rail.
 */
const OFF_RAIL: object = forkOnly({ experimental_hideFromNavigation: true });

export default definePluginApp((app) => {
  // Studio's settings sections (src/settings/ui), first so they keep their
  // order after BB's API key fields; and push status on BB's Mobile page.
  registerSettingsApp(app);
  hideBbSkills(app.slots);
  hideBbChrome(app.slots);
  registerCodeApp(app);
  // First, so the overlays below read BB's own route from their first render.
  registerQuietReplyClassifier(app.slots);
  registerStudioLinkHandler(app.slots);
  app.slots.experimental_appOverlay({ id: "links", component: LinksBridge });
  registerThreadTab(app, { id: NOT_FOUND_TAB, title: NOT_FOUND_TITLE, icon: "Unavailable", layout: "flush", component: NotFoundTab, ...OFF_NEW_TAB });
  app.slots.experimental_appOverlay({ id: "host-route", component: HostRouteBridge });
  app.slots.experimental_appOverlay({ id: "opened-items", component: OpenedItemsBridge });
  app.slots.experimental_appOverlay({ id: "workspace-bridge", component: WorkspaceBridge });
  // One search: Studio's items join BB's own palette where it takes plugin results.
  if (registerPaletteSearch(app.slots, { id: "items", title: "Studio", search: searchStudioItems })) {
    app.slots.experimental_appOverlay({ id: "palette-search", component: PaletteSearchBridge });
  }
  const omnibar = registerCommandPalette(app.slots, { id: "omnibar", component: StudioCommandPalette });
  // Recent Studio items, boards and Bot threads on the side panel's New Tab page, and in its search (src/ui/newtab-items.tsx).
  if (STUDIO_NEW_TAB_ITEMS.map((registration) => registerNewTabItems(app.slots, registration)).every(Boolean)) app.slots.experimental_appOverlay({ id: "newtab-items", component: NewTabBridge });
  // This window's last-opened Bot pages and VS Code, for the New Tab page's Recent (src/ui/opened-tabs.ts).
  app.slots.experimental_appOverlay({ id: "opened-tabs", component: OpenedTabsRecorder });
  // The workbench tools' side in the window (src/workbench-agent): runs an agent's call on the conversation on screen.
  app.slots.experimental_appOverlay({ id: "workbench-agent", component: WorkbenchAgentBridge });
  // Windows of Studio's own, on a BB that has them (src/kit/app/windows.ts):
  // the launcher (src/launcher) and any item popped out into a window
  // (src/ui/item-window.tsx). The bridge in the main window sets up the
  // launcher's hotkey and opens what a window asks to show in BB.
  const hostWindows = registerHostWindow(app.slots, { id: LAUNCHER_WINDOW_ID, title: "BB Studio Launcher", component: LauncherWindow });
  // Studio's apps and actions in BB's launcher slot.
  registerLauncherItems(app.slots);
  if (hostWindows) {
    registerItemWindows(app.slots, BUILTIN_VIEWS);
    app.slots.experimental_appOverlay({ id: "windows", component: WindowsBridge });
  }
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  app.slots.experimental_appOverlay({ id: "relogin", component: ReloginHost });
  registerAccountsApp(app);
  registerFirstRun(app.slots, { id: "connect-model", component: ConnectModel });
  registerModelPickerGate(app.slots, { id: "sign-in", component: SignInGate });
  app.slots.experimental_appOverlay({ id: "welcome-landing", component: WelcomeLanding });
  app.slots.experimental_appOverlay({ id: "edit-space", component: EditSpaceHost });
  app.slots.experimental_appOverlay({ id: "theme", component: ThemeLayer });
  app.slots.experimental_appOverlay({ id: "theme-quick", component: ThemeQuickHost });
  app.slots.experimental_appOverlay({ id: "presence-check", component: PresenceCheckHost });
  app.experimental_sidebarFooter.register({ kind: "action", id: THEME_FOOTER_ID, label: THEME_FOOTER_LABEL, icon: "Palette", onActivate: toggleThemePopover });
  for (const command of themeCommandRegistrations()) app.commands.register(command);
  registerThemeBackdrop(app.slots);
  // Which items are starred, for every item header's star (src/ui/StarHost.tsx).
  app.slots.experimental_appOverlay({ id: "stars", component: StarHost });
  // Right-click and Mod-click on Studio items and threads anywhere on screen.
  app.slots.experimental_appOverlay({ id: "item-gestures", component: ItemGestures });
  app.slots.experimental_appOverlay({ id: "legacy-chats", component: LegacyChats });
  // Where BB lets a plugin add a section to its sidebar, the Bots list is one
  // and the Studio panel brings its own sidebar; BB's thread list and the
  // user's choice of it are left alone. Elsewhere Studio replaces the list
  // (below) and switches the preference to show it.
  app.slots.experimental_appOverlay({ id: "new-menu", component: NewMenuBridge });
  const sidebarSections = registerSidebarSection(app.slots, { id: "bots", title: "Bots", component: BotsSidebarSection });
  // The Bot sidebar (src/ui/conversations): a thread list the user picks
  // (Settings, or `bb thread-list`): one Bot's conversations and workers, and
  // its space dots. BB shows it on its home and thread pages.
  if (sidebarSections) {
    const spaces = async () => (await post("bot_spaces", {})) as { bots: { id: string; mainThreadId: string | null }[]; currentBotId: string | null };
    // A file's header asks the Bot in the current conversation about it, not a new thread (src/ui/ask-about-item.ts).
    setAskAboutItem(askAboutItemHandler(spaces));
    // The Bot header is the top of the sidebar: the fork's experimental_hideSidebarHeader drops BB's "New conversation"
    // row (the Bot's + New is beside Conversations). In the desktop app's title bar layout the traffic lights, back,
    // forward and the sidebar toggle stay in the title bar; in the browser layout back and forward move to the start
    // of the main view's header and the toggle stays.
    const sidebarStyle: object = { experimental_hideSidebarHeader: true };
    app.slots.experimental_threadList({ id: UNIFIED_LIST_ID, title: "Bot (Studio)", component: BotSidebarList, ...sidebarStyle });
  }
  // The Library (the Bot's files) is Studio's nav panel; item addresses under it open items.
  app.slots.navPanel({ id: "studio", title: "Library", icon: "studio/library", path: "studio", component: withPageTabs(retainPanel("studio", StudioRoot)), headerContent: StudioBarSlot, experimental_usePageTitle: useStudioPageTitle, // Where items open in BB's main view, the Studio view keeps BB's own sidebar (its New button and footer).
    ...(sidebarSections && !hasGlobalWorkbench ? { experimental_sidebar: StudioViewSidebar } : {}), ...OFF_RAIL });
  // A worker (and a mirrored thread) is read-only, with "Ask the Bot about
  // this worker…" where the composer goes; a conversation shows its workers
  // above its composer (src/ui/conversations/ReadOnlyComposer.tsx).
  registerReadOnlyComposer(app);
  // Finishing a conversation (src/bot-finish.ts): "Finish conversation" in its
  // thread menus (the sidebar row's and the header's ···), and the card the
  // Bot posts in Main, `::finished{thread="thr_…"}`.
  app.slots.experimental_threadAction(finishThreadAction);
  app.slots.messageDirective({ id: "finished", component: FinishedCard });
  // A worker's approval, as a card in the conversation that owns it (src/worker-approvals.ts):
  // `::approval{thread="thr_…" id="…"}`, Approve / Deny through BB's own resolution.
  app.slots.messageDirective({ id: "approval", component: ApprovalCard });
  // Drag and drop (src/kit/app/item-drag.ts): BB's own helpers, and its
  // workbench, composer and main view as drop targets (src/ui/item-drop.ts).
  registerItemDrops(app.slots);
  // Main tabs kept each Bot as a fixed workbench tab; those close once.
  app.slots.experimental_appOverlay({ id: "retire-fixed-tabs", component: RetireFixedBotTabs });
  app.slots.experimental_appOverlay({ id: "todos-tab-name", component: TodosTabName });
  // Automations, its own page in BB's rail (`studio/automations`): everything
  // on a schedule across Bots (src/ui/automations/AutomationsPanel.tsx).
  // Its title row is the page's own, in BB's title bar (headerContent), as the Library's is: one row, not two.
  app.slots.navPanel({ id: AUTOMATIONS_PANEL, title: "Automations", icon: "Clock", path: AUTOMATIONS_PANEL, component: withPageTabs(AutomationsPanel, AUTOMATIONS_PANEL), headerContent: StudioBarSlot, ...OFF_RAIL });
  // VS Code, its own page in BB's rail (`studio/vscode`): the workspace used
  // last, else the picker (src/code/vscode-panel.tsx).
  app.slots.navPanel({ id: VSCODE_PANEL, title: "VS Code", icon: CODE_ICON, path: VSCODE_PANEL, component: VsCodePanel, headerContent: StudioBarSlot, experimental_usePageTitle: useCodePageTitle, ...OFF_RAIL });
  app.slots.experimental_appOverlay({ id: "retained-vscode", component: () => <RetainedPanels path={VSCODE_PANEL} render={(subPath) => <VsCodeRetainedView subPath={subPath} />} /> });
  // The launcher's VS Code row asks the main window for VS Code where it is (src/code/open-vscode.ts).
  onMainWindowPath(VSCODE_MAIN_PATH, runVsCode);
  // Studio's tabs beside a thread (src/kit/app/thread-panel.tsx). Code
  // outside the thread view (the sidebar, content scripts) asks the thread to
  // open one; this bare banner in every thread's composer takes the request.
  app.composer.customize({ id: "thread-tabs", scopes: ["thread"], banners: [{ id: "requests", chrome: "bare", component: ThreadTabReceiver }] });
  app.slots.messageDirective({ id: BOT_THREAD_DIRECTIVE, component: BotThreadDirective });
  // Todos (docs/attention-router/backend.md): `::loop{id="loop_…"}`
  // is a todo's card, `row="1"` its morning row; `::loops{more="3"}` and
  // `::loops{open="pane"}` open the Todos pane beside the chat. Quiet
  // placeholders while the loopsEnabled setting is off.
  app.slots.messageDirective({ id: "loop", component: LoopDirective });
  app.slots.messageDirective({ id: "loops", component: LoopsDirective });
  app.slots.messageDirective({ id: "work", component: WorkDirective });
  app.composer.customize({ id: "in-flight", scopes: ["thread"], banners: [{ id: "in-flight", component: InFlightBanner }] });
  // The Todos pane: the todo list in a tab beside the chat.
  registerThreadTab(app, { id: LOOPS_PANE, title: newTabTitle(LOOPS_PANE) ?? "Todos", icon: "ListTodo", layout: "flush", component: LoopsPane, ...newTabFields(LOOPS_PANE) });
  // The Bot's other pages as tabs (Memory, Library, Automations, the Archive) and the New Tab page's "New …" actions (src/tab-kinds.ts).
  registerTabKindTabs(app);
  // Hands-free voice (src/voice/live/ui): a session is its own thread. Its
  // composer button is registered below, after Notes' Expand; its pill floats
  // over every page and thread until End.
  app.slots.experimental_appOverlay({ id: "handsfree", component: HandsFreePill });
  registerThreadTab(app, { id: SIDE_THREAD_ACTION, title: "Side thread", icon: "MessageSquare", layout: "flush", component: SideThreadPanel, ...OFF_NEW_TAB });
  registerForkFromHere(app.slots, {
    call: async (method, input) => (await post(method, input)) as { threadId: string },
    open: (threadId, sourceThreadId) => { void openThreadBeside(sourceThreadId, threadId, openThreadVia((id) => openPathFromRoute(`/threads/${encodeURIComponent(id)}`))); },
  });
  app.slots.experimental_messageMetadata({ id: "reply-in-thread", placement: "actionRow", component: ReplyInThreadAction });
  app.slots.experimental_appOverlay({ id: "thread-indicators", component: ThreadIndicators });
  // A Bot chat's prompt cache (src/bot-cache.ts): a banner in its composer
  // when the cache expired on a big chat.
  app.composer.customize({ id: "bot-cache", banners: [{ id: "cold", chrome: "bare", component: BotCacheBanner }] });
  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path="studio" render={(subPath) => <StudioRoot subPath={subPath} />} /> });
  app.slots.experimental_appOverlay({ id: "builtin-routes", component: BuiltinRoutes });
  // Setup → Kinds: a kind turned off registers no thread tab or composer
  // entry and its reply cards render nothing; a kind whose New goes to
  // another provider drops its composer entry. Read once per window load.
  const kinds = readKindsSnapshot();
  const on = (kind: string) => !kinds.off.has(kind);
  // Header buttons: Bot info on a Bot's chat, and the page a thread
  // works on (SDK 0.6.104 header actions; src/ui/thread-header.tsx).
  registerThreadHeader(app, { pages: on("page") });
  // The facts the header used to draw: a Bot chat's prompt cache and a
  // thread's automations in the context row above the composer, and the
  // thread's Bot in the Info tab (src/ui/thread-context.tsx).
  registerThreadContext(app);
  // The thread's Studio tab: one workbench tab for every kind that opens
  // beside the chat (src/ui/studio-tab). Reply cards open it with
  // `{ kind, id }`; its collection lists only the kinds that are on.
  const tabKinds = enabledKinds(kinds.off);
  if (tabKinds.length) {
    registerThreadTab(app, {
      id: STUDIO_TAB,
      // Opened bare from the New Tab page it lists the items: "Page" under "Open" (src/tab-kinds.ts).
      title: newTabTitle(STUDIO_TAB) ?? "Studio",
      ...newTabFields(STUDIO_TAB),
      icon: STUDIO_TAB_ICON,
      layout: "flush",
      component: (props) => <Suspense fallback={null}><StudioTab {...props} /></Suspense>,
      ...ITEM_TAB_ICON,
    });
    // The same tab in the Studio page's own side panel, for items in the
    // workbench's Global section (src/ui/global-workbench.tsx).
    if (hasGlobalWorkbench) {
      app.slots.experimental_tab({ ...studioPageTab, title: newTabTitle(STUDIO_TAB) ?? "Studio", ...newTabFields(STUDIO_TAB), icon: STUDIO_TAB_ICON, layout: "flush", component: studioPageItemTab(BUILTIN_VIEWS), ...ITEM_TAB_ICON });
    }
    // Threads and Bots as workbench tabs, and the picker in the + page that
    // opens any thread, Bot or item as one (src/ui/workbench-tabs.tsx).
    registerWorkbenchTabs(app, { page: hasGlobalWorkbench });
    // The tab comes back where it was left; a card opening it on an item shows that item.
    onThreadTabOpen((open) => { if (open.actionId === STUDIO_TAB && open.params != null) forgetView(open.params); });
  }
  // Pages (built in; docs/merging-add-ons.md): the Studio tab's pages, the
  // `::page{id="pg_…"}` card in replies, the header link back to a page a
  // thread was started from, and opening a page Talk dictated into.
  if (on("page")) {
    app.slots.experimental_appOverlay({ id: "talk-bridge", component: TalkBridge });
    // Notes (src/pages/notes.ts): the composer's Expand to page, which moves
    // the draft into a temp page beside the thread, and the "Notes in
    // progress" chip that reopens it.
    app.composer.customize({
      id: "notes",
      scopes: ["thread"],
      actions: [{ id: "expand", component: ExpandToPage }],
      banners: [{ id: "in-progress", chrome: "bare", component: NotesInProgress }],
    });
  }
  // The waveform button. BB puts a plugin's composer actions just before its
  // mic, in registration order (no order or priority field, SDK 0.6.37 or
  // 0.6.104), so it's Studio's last action: Expand, waveform, mic, send. It
  // starts a session; right-click for its quick settings.
  app.composer.customize({ id: "handsfree", scopes: ["thread"], actions: [{ id: "handsfree", component: HandsFreeComposerButton }] });
  app.slots.messageDirective({ id: "page", component: whenOn(kinds, "page", PageCard) });
  // Explore (built in, as it was in Pages): the Next row and "along the way" findings.
  registerExploreApp(app);
  // Artifacts (built in; docs/merging-add-ons.md): in the Studio tab, and its
  // save picker for a reply's files; and the `::artifact{id="art_…"}` card in replies.
  app.slots.messageDirective({ id: "artifact", component: whenOn(kinds, "artifact", ArtifactCard) });
  // Mini apps (built in): `::mini{id="mini_…"}` in a reply is the app itself, live.
  app.slots.messageDirective({ id: "mini", component: whenOn(kinds, "mini", MiniCard) });
  // Whiteboards (drawings, built in): the read-only `::drawing{id="…"}` card
  // older replies carry. New replies link the page the whiteboard is in.
  app.slots.messageDirective({ id: "drawing", component: whenOn(kinds, "drawing", DrawingDirective) });
  // Designs (built in): in the Studio tab, the `::design{id="dsn_…"}`
  // card, and the question form design_ask opens in the composer.
  app.slots.messageDirective({ id: "design", component: whenOn(kinds, "design", DesignCard) });
  app.slots.pendingInteraction({ id: QUESTIONS_RENDERER, component: QuestionFormView });
  // Recordings (built in): the recorder overlay and pill, the composer's
  // microphone, hold-to-talk, dictation into other plugins' fields, the
  // `::recording{id="rec_…"}` card, Talk's commands and its Models settings.
  if (on("recording")) registerTalkApp(app);
  // Off: the `::recording` line still renders, as nothing.
  else app.slots.messageDirective({ id: "recording", component: () => null });
  // Reactions (built in; was Studio Reactions): emoji message actions that
  // draft a reply, the old `::reactions` line, and their settings preview.
  registerReactionsApp(app);
  if (!omnibar) app.slots.experimental_appOverlay({ id: "quick-open", component: QuickOpen });
  // Plugin health: a footer item that opens itself when a plugin needs setup or breaks.
  setHealthFooter(app.experimental_sidebarFooter.register({ kind: "disclosure", id: "health", label: "Plugin health", icon: "ElectricPlugs", component: HealthFooter }));
  app.slots.experimental_appOverlay({ id: "health-watch", component: HealthWatch });
  app.experimental_sidebarFooter.register({ kind: "action", id: REPORT_BUG_FOOTER_ID, label: "Report a bug", icon: "Bug", onActivate: () => { void openBugReport(); } });
  // The Studio list replaces BB's thread list on the Studio page, the Bots list (Bots, then every thread) everywhere else (src/ui/bot/threadListSwitch.ts).
  if (!sidebarSections) {
  app.slots.experimental_threadList({ id: STUDIO_LIST_ID, title: "Studio (Studio)", component: StudioThreadList });
  app.slots.experimental_threadList({ id: BOT_LIST_ID, title: "Bot (Studio)", component: BotThreadList });
  app.slots.experimental_appOverlay({ id: "bot-list-switch", component: ThreadListSwitcher });
  }
  // The thread panel's Automations tab and the header's clock badge.
  registerThreadAutomations(app);
  if (!omnibar) app.commands.register({
    id: "search",
    title: "Studio: Search everything",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
  // Show Bot <n>: the sidebar's nth Bot, as a click on its icon does (src/ui/conversations/BotSidebarPanel.tsx).
  // Ctrl+Option, since BB binds Ctrl+1…9 to its own "Open thread <n>" and a conflicting default stays unbound.
  if (sidebarSections) for (let index = 1; index <= 9; index++) {
    app.commands.register({ id: `show-bot-${index}`, title: `Studio: Show Bot ${index}`, defaultShortcut: { key: String(index), control: true, alt: true }, isAvailable: () => canShowBot(index), run: () => { showBotNumber(index); } });
  }
  // The Bot's last conversation, with BB's sidebar unfolded (src/ui/conversations/show-bot.ts).
  if (sidebarSections) app.commands.register({ id: "show-bot", title: "Studio: Show the Bot", defaultShortcut: { key: "0", control: true }, run: () => showBot(async () => (await post("bot_spaces", {})) as { bots: { id: string; mainThreadId: string | null }[]; currentBotId: string | null }) });
  app.commands.register({ id: "handsfree", title: "Studio: Hands-free voice", run: () => startHandsFree() });
});
