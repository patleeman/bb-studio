import { lazy, Suspense, useEffect, useLayoutEffect, type ComponentType } from "react";
import { StudioWorkspace, WorkspaceBridge } from "./src/ui/Workspace";
import { ChatOverlay } from "./src/chat/ui/ChatOverlay";
import { ItemGestures } from "./src/ui/ItemGestures";
import { ConversationPage } from "./src/chat/ui/ConversationComposer";
// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, project leads in
// the Setup page, and Studio search.
import { openAppPath, registerWorkspaceProvider, RetainedPanels, retainPanel, StudioBarSlot, usePathname, WORKSPACE_PATH } from "@bb-studio/kit/app";
import { BUILTIN_ROUTES, builtinSegment, STUDIO_ROOT } from "./src/builtins";
import { ArtifactCard } from "./src/artifacts/ui/artifact-card";
import { SavePicker } from "./src/artifacts/ui/save-picker";
import { ARTIFACTS_TAB, isArtifactId, SAVE_ICON } from "./src/artifacts/shared";
import { DRAW_ICON, DRAWINGS_TAB, isDrawingId, PICKER_ID } from "./src/draw/shared";
import { DrawingDirective } from "./src/draw/ui/drawing-directive";
import { ExcalidrawPicker } from "./src/draw/ui/excalidraw-picker";
import { createExcalidrawComposerCustomization } from "./src/draw/ui/composer-registration";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { openCollection, StudioPanel } from "./src/ui/StudioPanel";
import { HealthFooter, HealthWatch, SETUP_SUBPATH, setHealthFooter } from "./src/ui/health/HealthViews";
import { SetupPage } from "./src/ui/setup/SetupPage";
import { registerThreadAutomations } from "./src/ui/automations/register";

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
const BUILTIN_VIEWS: Record<string, { isId(id: string): boolean; View: ComponentType<{ id: string }> }> = {
  artifacts: { isId: isArtifactId, View: lazy(() => import("./src/artifacts/ui/route")) },
  // Excalidraw is big: it loads when a drawing first opens, not with Studio.
  drawings: { isId: isDrawingId, View: lazy(() => import("./src/draw/ui/route")) },
};

/** The thread's Drawings tab; it brings Excalidraw, so it loads when first opened. */
const DrawingsTab = lazy(() => import("./src/draw/ui/drawings-tab"));

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  // Studio opens on its tabbed workspace; the item list is only its new tab page.
  if (path === "") return <StudioWorkspace />;
  if (path === "browse") return <StudioPanel />;
  if (path === SETUP_SUBPATH) return <SetupPage />;
  // A built-in kind: <segment>/<id> is one item; <segment> alone is the
  // library filtered to the kind, like any add-on's kind.
  const builtin = builtinSegment(path);
  if (builtin) {
    const view = BUILTIN_VIEWS[builtin.route.segment];
    const id = decodeSegment(builtin.rest.split("/")[0] ?? "");
    if (view && view.isId(id)) return <Suspense fallback={null}><view.View id={id} /></Suspense>;
    return <ToWorkspace path={builtin.route.segment} kind={builtin.route.kind} />;
  }
  return <ToWorkspace path={path} />;
}

/**
 * Lets the workspace open built-in kinds' items as tabs, from their Studio
 * address and from the address their old add-on had (links and bookmarks
 * made before the merge), which it rewrites.
 */
function BuiltinRoutes() {
  useLayoutEffect(() => {
    const disposers = BUILTIN_ROUTES.flatMap((route) => [registerWorkspaceProvider(`${STUDIO_ROOT}/${route.segment}`), registerWorkspaceProvider(route.legacyRoot)]);
    return () => disposers.forEach((dispose) => dispose());
  }, []);
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "workspace-bridge", component: WorkspaceBridge });
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  // Right-click and Mod-click on Studio items and threads anywhere on screen.
  app.slots.experimental_appOverlay({ id: "item-gestures", component: ItemGestures });
  app.slots.navPanel({ id: "chats", path: "chats", title: "Chat", icon: "MessageSquare", component: retainPanel("chats", ConversationPage), headerContent: StudioBarSlot });
  app.slots.experimental_appOverlay({ id: "retained-chats", component: () => <RetainedPanels path="chats" render={subPath => <ConversationPage subPath={subPath} />} /> });
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: retainPanel("studio", StudioRoot), headerContent: StudioBarSlot });
  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path="studio" render={(subPath) => <StudioRoot subPath={subPath} />} /> });
  app.slots.experimental_appOverlay({ id: "builtin-routes", component: BuiltinRoutes });
  // Artifacts (built in; docs/merging-add-ons.md): the thread panel that saves
  // a reply's files, and the `::artifact{id="art_…"}` card in replies.
  app.slots.threadPanelAction({ id: ARTIFACTS_TAB, title: "Artifacts", icon: SAVE_ICON, layout: "flush", component: SavePicker });
  app.slots.messageDirective({ id: "artifact", component: ArtifactCard });
  // Drawings (built in): the thread's Drawings tab, the `::drawing{id="…"}`
  // card, and the composer's `+` → Drawing, which attaches one as a PNG.
  app.slots.threadPanelAction({
    id: DRAWINGS_TAB,
    title: "Drawings",
    icon: DRAW_ICON,
    layout: "flush",
    run: async ({ openPanel }) => { await openPanel({ title: "Drawings" }); },
    component: (props) => <Suspense fallback={null}><DrawingsTab {...props} /></Suspense>,
  });
  app.slots.messageDirective({ id: "drawing", component: DrawingDirective });
  app.slots.pendingInteraction({ id: PICKER_ID, component: ExcalidrawPicker });
  app.composer.customize(createExcalidrawComposerCustomization((scope) => {
    void import("./src/draw/ui/attach").then(({ attachFromComposer }) => attachFromComposer(scope));
  }));
  app.slots.experimental_appOverlay({ id: "quick-open", component: QuickOpen });
  // Plugin health: a footer item that opens itself when a plugin needs setup or breaks.
  setHealthFooter(app.experimental_sidebarFooter.register({ kind: "disclosure", id: "health", label: "Plugin health", icon: "ElectricPlugs", component: HealthFooter }));
  app.slots.experimental_appOverlay({ id: "health-watch", component: HealthWatch });
  // The thread panel's Automations tab and the header's clock badge.
  registerThreadAutomations(app);
  app.commands.register({
    id: "search",
    title: "Studio: Search everything",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
});
