// One rule for every link, card and "open" button in Studio: open in the
// container you're in.
// - In a thread (its workbench tabs, or a card in its transcript): a tab in
//   that thread's workbench, one per item (BB focuses the tab already open
//   for the same params).
// - In the Studio app: a tab in Studio's own workspace.
// - External URLs: BB's browser (openUrl), as before.
// - Mod-click (⌘ on a Mac, Ctrl elsewhere): the other place. From a thread,
//   the item opens in the Studio app; in Studio, in a split.
// - Threads open in BB's main view (a split with Mod), wherever you are.
// Kinds with no in-thread view (an add-on's own page) open in BB's main area:
// SDK 0.6.104 has no way to show another plugin's view in our tab.
import { experimental_useAppPanel, useBbNavigate, type ExperimentalPanelController, type JsonValue } from "@get-bb/plugin-sdk/app";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { openAppPath } from "../kit/app/nav";
import { openThreadTab, requestThreadTab, type ThreadTabOpen } from "../kit/app/thread-panel";
import { openWorkspaceItem } from "../kit/app/workspace";
import { builtinItemAt } from "../builtins";
import { itemParams, STUDIO_TAB, tabKind, type TabKind } from "./studio-tab/model";

/** Where the clicked thing lives. */
export type StudioContainer =
  | { kind: "thread"; threadId: string | null }
  | { kind: "studio" };

/** What a click opens: an item's in-app path, a thread, or an external URL. */
export type StudioRef =
  | { href: string; title?: string; icon?: string }
  | { threadId: string; title?: string }
  | { url: string };

export interface StudioOpenOptions {
  /** Mod-click: the other place (thread → Studio app, Studio → split). */
  alternate?: boolean;
}

/** One step the opener takes; pure, so the rule is testable without BB. */
export type OpenPlan =
  | { via: "workbench"; threadId: string | null; open: ThreadTabOpen; fallback: string }
  | { via: "studio"; href: string; title?: string; placement: "tab" | "right" }
  | { via: "main"; href: string }
  | { via: "thread"; threadId: string; split: boolean }
  | { via: "url"; url: string };

/** The Studio tab kind and id an item path shows, when the workbench can show it. */
export function workbenchItem(href: string): { kind: TabKind; id: string } | null {
  const found = builtinItemAt(href);
  if (!found) return null;
  // A sub-view (a page's chat, a recording's notes) has no tab of its own.
  if (found.href.split("/").length !== 6) return null;
  const info = tabKind(found.route.kind);
  return info?.isId(found.id) ? { kind: info.kind, id: found.id } : null;
}

/**
 * Where `ref` opens from `container` (null: not known, such as a reply card
 * outside any provider, which tries the workbench and falls back to the main
 * view, as cards always did).
 */
export function planOpen(ref: StudioRef, container: StudioContainer | null, options: StudioOpenOptions = {}): OpenPlan {
  const alternate = Boolean(options.alternate);
  if ("url" in ref) return { via: "url", url: ref.url };
  if ("threadId" in ref) return { via: "thread", threadId: ref.threadId, split: alternate };
  const { href, title } = ref;
  if (container?.kind === "studio") return { via: "studio", href, ...(title ? { title } : {}), placement: alternate ? "right" : "tab" };
  // In a thread, Mod-click is the way out to the Studio app.
  if (alternate) return container ? { via: "studio", href, ...(title ? { title } : {}), placement: "tab" } : { via: "main", href };
  const item = workbenchItem(href);
  if (!item) return { via: "main", href };
  return {
    via: "workbench",
    threadId: container?.threadId ?? null,
    open: { actionId: STUDIO_TAB, ...(title ? { title } : {}), params: itemParams(item.kind, item.id) as JsonValue },
    fallback: href,
  };
}

interface Deps {
  panel: Pick<ExperimentalPanelController, "openTab"> | null;
  navigate: Pick<ReturnType<typeof useBbNavigate>, "toThread" | "openUrl">;
}

/** Carries out a plan. Never throws; a declined workbench falls back to the main view. */
export function runPlan(plan: OpenPlan, { panel, navigate }: Deps): void {
  switch (plan.via) {
    case "url":
      if (!navigate.openUrl(plan.url)) window.open(plan.url, "_blank", "noopener");
      return;
    case "thread":
      navigate.toThread(plan.threadId, { split: plan.split });
      return;
    case "studio":
      if (!openWorkspaceItem({ href: plan.href, ...(plan.title ? { title: plan.title } : {}) }, plan.placement)) openAppPath(plan.href);
      return;
    case "main":
      openAppPath(plan.href);
      return;
    case "workbench":
      // Inside the thread's view its panel opens the tab at once; from
      // outside it (an overlay, a menu) the thread's composer takes a request.
      if (panel && openThreadTab(panel, plan.open)) return;
      if (plan.threadId) {
        void requestThreadTab(plan.threadId, plan.open).then((opened) => { if (!opened) openAppPath(plan.fallback); });
        return;
      }
      openAppPath(plan.fallback);
  }
}

const ContainerContext = createContext<StudioContainer | null>(null);

/** The DOM mark for a container, so app overlays (ItemGestures) can tell where a click was. */
export const CONTAINER_ATTR = "data-studio-container";
const CONTAINER_THREAD_ATTR = "data-studio-container-thread";

/** Wraps a surface that is a container: a thread's Studio tab, the Studio app. */
export function StudioContainerProvider({ value, children }: { value: StudioContainer; children: ReactNode }) {
  return (
    <ContainerContext.Provider value={value}>
      <div className="contents" {...{ [CONTAINER_ATTR]: value.kind, ...(value.kind === "thread" && value.threadId ? { [CONTAINER_THREAD_ATTR]: value.threadId } : {}) }}>
        {children}
      </div>
    </ContainerContext.Provider>
  );
}

/** The container marked around `element`, for code outside React's tree. */
export function containerAt(element: Element | null): StudioContainer | null {
  const marked = element?.closest(`[${CONTAINER_ATTR}]`);
  if (!marked) return null;
  if (marked.getAttribute(CONTAINER_ATTR) === "studio") return { kind: "studio" };
  return { kind: "thread", threadId: marked.getAttribute(CONTAINER_THREAD_ATTR) };
}

export function useStudioContainer(): StudioContainer | null {
  return useContext(ContainerContext);
}

/** Whether a click asks for the other place. */
export const wantsAlternate = (event?: { metaKey?: boolean; ctrlKey?: boolean } | null): boolean => Boolean(event?.metaKey || event?.ctrlKey);

/**
 * `open(ref, options)` by the rule above. `fallback` is the container when no
 * provider is around, such as a reply card, which knows its message's thread.
 */
export function useStudioOpen(fallback: StudioContainer | null = null): (ref: StudioRef, options?: StudioOpenOptions) => void {
  const container = useContext(ContainerContext) ?? fallback;
  const panel = experimental_useAppPanel();
  const navigate = useBbNavigate();
  const threadId = container?.kind === "thread" ? container.threadId : null;
  const kind = container?.kind ?? null;
  return useCallback(
    (ref, options) => runPlan(planOpen(ref, kind === null ? null : kind === "studio" ? { kind } : { kind, threadId }, options), { panel, navigate }),
    [kind, threadId, panel, navigate],
  );
}

/** For code outside a component (ItemGestures): opens `ref` from `container`, asking the thread for its tab. */
export function openFrom(container: StudioContainer | null, ref: StudioRef, options: StudioOpenOptions, navigate: Deps["navigate"]): void {
  runPlan(planOpen(ref, container, options), { panel: null, navigate });
}
