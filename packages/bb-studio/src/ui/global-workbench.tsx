// Items in the Studio page's workbench, on the BB Studio fork: an item opened
// where there is no thread, such as from the Studio view, becomes a tab
// beside that view. This file is the Studio page's side of it: the tab that
// renders an item there, and the opener that takes requests from code
// outside the page.
import { Suspense, useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { experimental_useAppPanel, useBbNavigate, useRpc, type JsonValue } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { useLive } from "./live";
import { noteOpened } from "./opened-items";
import { globalItemsRevision, subscribeGlobalItems, waitingGlobalItems, type GlobalItem } from "./global-item-requests";

export { requestGlobalItem, resetGlobalItemRequests, type GlobalItem } from "./global-item-requests";
import { BUILTIN_ROUTES } from "../builtins";
import { renameTabOf } from "../kit/app/host-sdk";
import { requestPageTab } from "./page-tab-requests";
import { STUDIO_PANEL_PATH } from "../kit/contract";
import { StudioContainerProvider } from "../kit/app/container";
import { itemParams, STUDIO_TAB, tabKind } from "./studio-tab/model";

export type ItemViews = Record<string, { isId(id: string): boolean; View: ComponentType<{ id: string; rest?: string }> } | undefined>;

/** The Studio tab as the Studio page registers it, for the page's own side panel. */
export const studioPageTab = { id: STUDIO_TAB, context: { kind: "nav-panel", panelId: STUDIO_PANEL_PATH }, availability: "action" } as const;

/** Mounted in the Studio page: opens each requested item as a tab beside it. */
export function GlobalItemOpener() {
  const panel = experimental_useAppPanel();
  const rpc = useRpc<typeof rpcContract>();
  const pending = useSyncExternalStore(subscribeGlobalItems, globalItemsRevision, () => 0);
  useEffect(() => {
    const open = (item: GlobalItem, title: string | undefined) => {
      // An ordinary tab of the Studio page's workbench: only a Bot is fixed in every workbench.
      void requestPageTab({ tabId: STUDIO_TAB, params: itemParams(item.kind, item.id) as JsonValue, title: title || "Studio" });
    };
    while (waitingGlobalItems.length) {
      const item = waitingGlobalItems.shift()!;
      if (!item.href) { open(item, item.title); continue; }
      if (item.title) { void noteOpened(item.href); open(item, item.title); continue; }
      // The tab is named for the item, as Studio's own tabs are.
      void rpc.call("visitTab", { path: item.href }).then(({ tab }) => open(item, tab?.title), () => open(item, undefined));
    }
  }, [panel, pending, rpc]);
  return null;
}

/** `{ kind, id }` from a tab's params, or null. */
export function globalItemOf(params: JsonValue | null): GlobalItem | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const { kind, id } = params;
  const info = typeof kind === "string" ? tabKind(kind, typeof id === "string" ? id : undefined) : null;
  return info && typeof id === "string" && info.isId(id) ? { kind: info.kind, id } : null;
}

let sharedViews: ItemViews = {};

/** Lends the item pages to sharedItemView, for a surface that is not the Studio page's tab (an item's window). */
export function setSharedItemViews(views: ItemViews): void {
  sharedViews = views;
}

/**
 * The item's own page, the one the main view shows, for a workbench tab: one
 * view and so one header wherever the item is open. Null when the kind has
 * no such page.
 */
export function sharedItemView(kind: string, id: string): ReactNode {
  const route = BUILTIN_ROUTES.find((each) => each.kind === kind);
  const view = route ? sharedViews[route.segment] : undefined;
  if (!view || !view.isId(id)) return null;
  // In a tab no title bar lends the header a place, so it is drawn in the
  // view; here it leads the view, as the title bar does in the main view.
  return (
    <div data-studio-shared-tab="" className="flex h-full min-h-0 flex-col">
      <style>{"[data-studio-shared-tab] :has(> [data-studio-item-header]){order:-1}"}</style>
      <Suspense fallback={null}><view.View key={id} id={id} /></Suspense>
    </div>
  );
}

/** The title an item's workbench tab should carry: the item's current title among Studio's open tabs, or null. */
export function currentTabTitle(tabs: readonly { href: string; title: string }[], segment: string, id: string): string | null {
  const suffix = `/${segment}/${id}`;
  const title = tabs.find((each) => each.href.split(/[?#]/)[0]!.endsWith(suffix))?.title.trim();
  return title ? title : null;
}

/** Keeps the workbench tab named for its item: when the item is renamed, the open tab follows (on a BB that can rename a tab). */
function TabTitleSync({ item, segment }: { item: GlobalItem; segment: string }) {
  const navigate = useBbNavigate();
  const tabs = useLive("tabs", null, { pollMs: 15_000 }).data?.tabs;
  const title = tabs ? currentTabTitle(tabs, segment, item.id) : null;
  useEffect(() => {
    if (title === null) return;
    renameTabOf(navigate)?.({ tab: { id: STUDIO_TAB }, params: itemParams(item.kind, item.id), title });
  }, [navigate, title, item.kind, item.id]);
  return null;
}

/** The Studio tab in the Studio page's side panel: the item's own page. */
export function studioPageItemTab(views: ItemViews): (props: { params: JsonValue | null }) => ReactNode {
  sharedViews = views;
  return function StudioPageItemTab({ params }) {
    const item = globalItemOf(params);
    const route = item ? BUILTIN_ROUTES.find((each) => each.kind === item.kind) : undefined;
    const view = route ? views[route.segment] : undefined;
    if (!item || !view || !view.isId(item.id)) return <p className="p-4 text-sm text-muted-foreground">This item can’t be shown here.</p>;
    return (
      <StudioContainerProvider value={{ kind: "studio" }}>
        <TabTitleSync item={item} segment={route!.segment} />
        {sharedItemView(item.kind, item.id)}
      </StudioContainerProvider>
    );
  };
}
