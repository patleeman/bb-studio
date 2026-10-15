import { lazy, Suspense, useEffect, useLayoutEffect, type ComponentType } from "react";
import { StudioWorkspace, WorkspaceBridge } from "./src/ui/Workspace";
import { ChatOverlay } from "./src/chat/ui/ChatOverlay";
import { ItemGestures } from "./src/ui/ItemGestures";
import { ConversationPage } from "./src/chat/ui/ConversationComposer";
// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, project leads in
// the Setup page, and Studio search.
import { openAppPath, registerWorkspaceProvider, RetainedPanels, retainPanel, StudioBarSlot, usePathname, WORKSPACE_PATH } from "@bb-studio/kit/app";
import { BUILTIN_ROUTES, builtinSegment, CHATS_PATH, legacyChatPath, STUDIO_ROOT } from "./src/builtins";
import { ArtifactCard } from "./src/artifacts/ui/artifact-card";
import { isArtifactId } from "./src/artifacts/shared";
import { isDrawingId, PICKER_ID } from "./src/draw/shared";
import { DrawingDirective } from "./src/draw/ui/drawing-directive";
import { ExcalidrawPicker } from "./src/draw/ui/excalidraw-picker";
import { createExcalidrawComposerCustomization } from "./src/draw/ui/composer-registration";
import { isDesignId, QUESTIONS_RENDERER } from "./src/design/shared";
import { DesignCard } from "./src/design/ui/design-card";
import { isDashboardId } from "./src/dashboards/shared";
import { QuestionFormView } from "./src/design/ui/question-form";
import { isRecordingId, UNSENT_PATH } from "./src/talk/shared/format";
import { registerTalkApp } from "./src/talk/ui/register";
import { isPageId, PageCard } from "./src/pages/ui/PageCard";
import { aliasParams, enabledKinds, STUDIO_TAB, STUDIO_TAB_ICON } from "./src/ui/studio-tab/model";
import { ThreadPageLink } from "./src/pages/ui/ThreadPageLink";
import { ExpandToPage, NotesInProgress } from "./src/pages/ui/notes/composer";
import { TalkBridge } from "./src/pages/ui/talk-bridge";
import { registerExploreApp } from "./src/explore/app";
import { registerReactionsApp } from "./src/reactions/app";
import "./src/pages/ui/styles.css";
import "./src/dashboards/ui/dashboards.css";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { openCollection, StudioPanel } from "./src/ui/StudioPanel";
import { HealthFooter, HealthWatch, SETUP_SUBPATH, setHealthFooter } from "./src/ui/health/HealthViews";
import { SetupPage } from "./src/ui/setup/SetupPage";
import { BOT_SUBPATH } from "./src/ui/bot/BotHome";
import { BotInfoPanel, BotPanel } from "./src/ui/bot/BotTabs";
import { BotCacheBanner, BotCacheChip } from "./src/ui/bot/BotCache";
import { BOT_INFO_ACTION } from "./src/ui/bot/workspace";
import { BotThreadDirective, SIDE_THREAD_ACTION, SideThreadOpener, SideThreadPanel } from "./src/ui/bot/SideThreads";
import { BOT_THREAD_DIRECTIVE } from "./src/bot-side-threads";
import { mountSideThreadRows } from "./src/ui/bot/reply-in-thread";
import { BotThreadList, ThreadListSwitcher } from "./src/ui/bot/BotSidebar";
import { StudioThreadList } from "./src/ui/StudioSidebar";
import { BOT_LIST_ID, STUDIO_LIST_ID } from "./src/ui/bot/threadListSwitch";
import { registerThreadAutomations } from "./src/ui/automations/register";
import { readKindsSnapshot, whenOn } from "./src/ui/kinds-snapshot";

/**
 * An old address that showed the item list (`collection`, a kind such as
 * `page`) or the workspace: the workspace, with the list as a new tab
 * except for `workspace`. Retained, so it checks each time it's shown. In a
 * pane of its own, such as a restored BB split, it offers the move instead.
 */
function ToWorkspace({ path, kind }: { path: string; kind?: string }) {
  const pathname = usePathname();
  const go = (replace: boolean) => {
    if (path !== "workspace") openCollection(kind ?? (path === "collection" ? null : decodeSegment(path)));
    openAppPath(WORKSPACE_PATH, { replace });
  };
  // Either side may be percent-encoded; compare them decoded.
  const here = decodeSegment(pathname.replace(/\/+$/, "")) === decodeSegment(`${WORKSPACE_PATH}/${path}`);
  useEffect(() => { if (here) go(true); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  if (here) return null;
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
    <p>Studio's item list now opens as a new tab in Studio.</p>
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
  pages: { isId: isPageId, View: lazy(() => import("./src/pages/ui/route")) },
  artifacts: { isId: isArtifactId, View: lazy(() => import("./src/artifacts/ui/route")) },
  // Excalidraw is big: it loads when a drawing first opens, not with Studio.
  drawings: { isId: isDrawingId, View: lazy(() => import("./src/draw/ui/route")) },
  designs: { isId: isDesignId, View: lazy(() => import("./src/design/ui/route")) },
  // A recording's page, and the audio this device kept (`recordings/unsent`).
  recordings: { isId: (id) => isRecordingId(id) || id === UNSENT_PATH, View: lazy(() => import("./src/talk/ui/route")) },
  // The grid (react-grid-layout) and the charts load when a dashboard first opens.
  dashboards: { isId: isDashboardId, View: lazy(() => import("./src/dashboards/ui/route")) },
};

/** The thread's Studio tab; its kinds' editors load when an item opens. */
const StudioTab = lazy(() => import("./src/ui/studio-tab/StudioTab"));

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  // Studio opens on its tabbed workspace; the item list is only its new tab page.
  if (path === "") return <StudioWorkspace />;
  if (path === "browse") return <StudioPanel />;
  if (path === SETUP_SUBPATH) return <SetupPage />;
  // The Bot page: the selected Bot's Info, or the create flow; its chat and
  // threads open as BB threads, with the Bots list in BB's sidebar.
  if (path === BOT_SUBPATH || path.startsWith(`${BOT_SUBPATH}/`)) return <BotPanel />;
  // Conversations about items: chats/item/…, chats/choose/…, chats/quote/….
  if (path === CHATS_PATH || path.startsWith(`${CHATS_PATH}/`)) return <ConversationPage subPath={path.slice(CHATS_PATH.length + 1)} />;
  // A built-in kind: <segment>/<id> is one item; <segment> alone is the
  // library filtered to the kind, like any add-on's kind.
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
    const disposers = BUILTIN_ROUTES.flatMap((route) => [`${STUDIO_ROOT}/${route.segment}`, ...(route.legacyRoot ? [route.legacyRoot] : [])].map((root) => registerWorkspaceProvider(root)));
    return () => disposers.forEach((dispose) => dispose());
  }, []);
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "workspace-bridge", component: WorkspaceBridge });
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  // Right-click and Mod-click on Studio items and threads anywhere on screen.
  app.slots.experimental_appOverlay({ id: "item-gestures", component: ItemGestures });
  app.slots.experimental_appOverlay({ id: "legacy-chats", component: LegacyChats });
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: retainPanel("studio", StudioRoot), headerContent: StudioBarSlot });
  // Beside a Bot's thread, the "Bot info" panel action shows the Bot page's Info.
  app.slots.threadPanelAction({ id: BOT_INFO_ACTION, title: "Bot info", icon: "Bot", layout: "flush", component: BotInfoPanel });
  // Side threads on a Bot's replies (src/bot-side-threads.ts): the side thread
  // in a tab beside the chat. Replies the Bot wrote before Studio drew the rows
  // itself may end with the directive, which now draws nothing.
  app.slots.messageDirective({ id: BOT_THREAD_DIRECTIVE, component: BotThreadDirective });
  app.slots.threadPanelAction({ id: SIDE_THREAD_ACTION, title: "Side thread", icon: "MessageSquare", layout: "flush", component: SideThreadPanel });
  // "2 replies · 5m" under each Bot reply with side threads, and what its click
  // opens them through: a header action, since only components inside the thread
  // view can open a tab beside it (BB declines openThreadPanel from an overlay).
  app.contentScripts.register({ id: "bot-reply-in-thread", mount: ({ signal }) => mountSideThreadRows(signal) });
  app.slots.experimental_threadHeaderAction({ id: "side-thread-opener", title: "Side threads", component: SideThreadOpener });
  // A Bot chat's prompt cache (src/bot-cache.ts): "Warm · 42m" in its header,
  // and a banner in its composer when the cache expired on a big chat.
  app.slots.experimental_threadHeaderAction({ id: "bot-cache", title: "Prompt cache", component: BotCacheChip });
  app.composer.customize({ id: "bot-cache", banners: [{ id: "cold", chrome: "bare", component: BotCacheBanner }] });
  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path="studio" render={(subPath) => <StudioRoot subPath={subPath} />} /> });
  app.slots.experimental_appOverlay({ id: "builtin-routes", component: BuiltinRoutes });
  // Setup → Kinds: a kind turned off registers no thread tab or composer
  // entry and its reply cards render nothing; a kind whose New goes to
  // another provider drops its composer entry. Read once per window load.
  const kinds = readKindsSnapshot();
  const on = (kind: string) => !kinds.off.has(kind);
  // The thread's Studio tab: one workbench tab for every kind that opens
  // beside the chat (src/ui/studio-tab). Reply cards open it with
  // `{ kind, id }`; its collection lists only the kinds that are on.
  const tabKinds = enabledKinds(kinds.off);
  if (tabKinds.length) {
    app.slots.threadPanelAction({
      id: STUDIO_TAB,
      title: "Studio",
      icon: STUDIO_TAB_ICON,
      layout: "flush",
      run: async ({ openPanel }) => { await openPanel({ title: "Studio" }); },
      component: (props) => <Suspense fallback={null}><StudioTab {...props} /></Suspense>,
    });
    // The old per-kind tabs (page, excalidraw, design, dashboards,
    // save-to-studio). BB persists open panel tabs by action id and its SDK
    // can't hide an action from the launcher, so they stay registered as thin
    // redirects: a restored tab shows the Studio tab on the item it had, or on
    // that kind (Artifacts: the save picker). Drop these once old tabs are gone.
    for (const info of tabKinds) {
      app.slots.threadPanelAction({
        id: info.legacyAction,
        title: info.plural,
        icon: info.icon,
        layout: "flush",
        component: (props) => <Suspense fallback={null}><StudioTab {...props} initial={aliasParams(info.legacyAction, props.params)} /></Suspense>,
      });
    }
  }
  // Pages (built in; docs/merging-add-ons.md): the Studio tab's pages, the
  // `::page{id="pg_…"}` card in replies, the header link back to a page a
  // thread was started from, and opening a page Talk dictated into.
  if (on("page")) {
    app.slots.experimental_threadHeaderAction({ id: "page-link", title: "Page", component: ThreadPageLink });
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
  app.slots.messageDirective({ id: "page", component: whenOn(kinds, "page", PageCard) });
  // Explore (built in, as it was in Pages): the Next row and "along the way" findings.
  registerExploreApp(app);
  // Artifacts (built in; docs/merging-add-ons.md): in the Studio tab, and its
  // save picker for a reply's files; and the `::artifact{id="art_…"}` card in replies.
  app.slots.messageDirective({ id: "artifact", component: whenOn(kinds, "artifact", ArtifactCard) });
  // Drawings (built in): in the Studio tab, the `::drawing{id="…"}`
  // card, and the composer's `+` → Drawing, which attaches one as a PNG.
  if (on("drawing")) {
    if (!kinds.routedAway.has("drawing")) {
      app.composer.customize(createExcalidrawComposerCustomization((scope) => {
        void import("./src/draw/ui/attach").then(({ attachFromComposer }) => attachFromComposer(scope));
      }));
    }
  }
  app.slots.messageDirective({ id: "drawing", component: whenOn(kinds, "drawing", DrawingDirective) });
  // Kept while off, so a picker an agent opened earlier can still be answered.
  app.slots.pendingInteraction({ id: PICKER_ID, component: ExcalidrawPicker });
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
  app.slots.experimental_appOverlay({ id: "quick-open", component: QuickOpen });
  // Plugin health: a footer item that opens itself when a plugin needs setup or breaks.
  setHealthFooter(app.experimental_sidebarFooter.register({ kind: "disclosure", id: "health", label: "Plugin health", icon: "ElectricPlugs", component: HealthFooter }));
  app.slots.experimental_appOverlay({ id: "health-watch", component: HealthWatch });
  // The Studio list replaces BB's thread list on the Studio page, the Bots list (Bots, then every thread) everywhere else (src/ui/bot/threadListSwitch.ts).
  app.slots.experimental_threadList({ id: STUDIO_LIST_ID, title: "Studio (Studio)", description: "Studio's kinds, saved views, tags and recent items. Studio switches to it on the Studio page.", component: StudioThreadList });
  app.slots.experimental_threadList({ id: BOT_LIST_ID, title: "Bot (Studio)", description: "Bots and their threads, then every thread as a two-line row. Studio shows it on every page but the Studio panel.", component: BotThreadList });
  app.slots.experimental_appOverlay({ id: "bot-list-switch", component: ThreadListSwitcher });
  // The thread panel's Automations tab and the header's clock badge.
  registerThreadAutomations(app);
  app.commands.register({
    id: "search",
    title: "Studio: Search everything",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
});
