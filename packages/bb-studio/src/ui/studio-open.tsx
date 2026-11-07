// One rule for every link, card and "open" button in Studio: open in the
// container you're in.
// - In a thread (its workbench tabs, or a card in its transcript): a tab in
//   that thread's workbench, one per item (BB focuses the tab already open
//   for the same params).
// - In the Studio app: a tab in Studio's own workspace.
// - Web URLs: BB's browser (openUrl).
// - Mod-click (⌘ on a Mac, Ctrl elsewhere): the other place. From a thread,
//   the item opens in the Studio app; in Studio, in a split.
// - Threads open in BB's main view (a split with Mod), wherever you are.
// Kinds with no in-thread view (an add-on's own page, a Studio route such as
// the Bot page) open in BB's main area: SDK 0.6.104 has no way to show another
// plugin's view in our tab. The container comes from the kit's
// StudioContainerProvider (../kit/app/container.tsx).
import { experimental_useAppPanel, useBbNavigate, type ExperimentalPanelController, type JsonValue } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import { routeContainer, useStudioContainer, type StudioContainer } from "../kit/app/container";
import { openAppPath } from "../kit/app/nav";
import { threadLinkId } from "../kit/app/studio-item";
import { openThreadTab, requestThreadTab, type ThreadTabOpen } from "../kit/app/thread-panel";
import { openWorkspaceItem } from "../kit/app/workspace";
import { builtinItemAt } from "../builtins";
import { pagePath } from "../pages/constants";
import { itemParams, STUDIO_TAB, tabKind, type TabKind } from "./studio-tab/model";

export { containerAt, routeContainer, StudioContainerProvider, useStudioContainer, wantsAlternate, type StudioContainer } from "../kit/app/container";

/** What a click opens: an item's in-app path, a thread, or a web URL. */
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
 * What a link's href opens: `page:`/`thread:` references, in-app paths (also
 * as full URLs on this origin), and web URLs. Null for an empty or unsafe href.
 */
export function linkRef(href: string | null | undefined, origin: string = typeof window === "undefined" ? "" : window.location.origin): StudioRef | null {
  const value = href?.trim();
  if (!value) return null;
  const reference = /^(page|thread):([^\s/?#]+)$/.exec(value);
  if (reference) return reference[1] === "page" ? { href: pagePath(decodeURIComponent(reference[2]!)) } : { threadId: decodeURIComponent(reference[2]!) };
  let path = value.startsWith("/") && !value.startsWith("//") ? value : null;
  if (!path) {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (origin && url.origin === origin) path = `${url.pathname}${url.search}${url.hash}`;
    else return /^(https?|mailto|tel):$/.test(url.protocol) ? { url: url.href } : null;
  }
  const threadId = threadLinkId(path);
  return threadId ? { threadId } : { href: path };
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

export interface OpenDeps {
  panel: Pick<ExperimentalPanelController, "openTab"> | null;
  navigate: Pick<ReturnType<typeof useBbNavigate>, "toThread" | "openUrl">;
}

/** Carries out a plan. Never throws; a declined workbench falls back to the main view. */
export function runPlan(plan: OpenPlan, { panel, navigate }: OpenDeps): void {
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

/** Opens `ref` from `container`: for code outside a component, or a header action with its panel. */
export function openIn(container: StudioContainer | null, ref: StudioRef, options: StudioOpenOptions, deps: OpenDeps): void {
  runPlan(planOpen(ref, container, options), deps);
}

/** For code outside a component (ItemGestures, content scripts): asks the thread for its tab. */
export function openFrom(container: StudioContainer | null, ref: StudioRef, options: StudioOpenOptions, navigate: OpenDeps["navigate"]): void {
  openIn(container, ref, options, { panel: null, navigate });
}

/** BB's navigation for code with no SDK context (content scripts): threads by their address. */
const pathNavigate: OpenDeps["navigate"] = {
  toThread: (threadId) => openAppPath(`/threads/${encodeURIComponent(threadId)}`),
  openUrl: () => false,
};

/** Opens an in-app path by the rule from `container`, with no SDK context (a header action, a content script). */
export function openPathIn(container: StudioContainer | null, path: string, options: { title?: string; panel?: OpenDeps["panel"] } = {}): void {
  const ref = linkRef(path);
  if (!ref) return;
  openIn(container, "href" in ref && options.title ? { ...ref, title: options.title } : ref, {}, { panel: options.panel ?? null, navigate: pathNavigate });
}

/** Opens an in-app path by the rule, from the container the main view shows (content scripts). */
export function openPathFromRoute(path: string): void {
  const ref = linkRef(path);
  if (ref) openFrom(routeContainer(), ref, {}, pathNavigate);
}

/** Where a component outside any provider stands: a fixed container, or "route" for what the main view shows. */
export type ContainerFallback = StudioContainer | null | "route";

/**
 * `open(ref, options)` by the rule above. The container is the nearest
 * provider's; outside one, `fallback`: a reply card passes its message's
 * thread, a global surface "route" (decided at click time).
 */
export function useStudioOpen(fallback: ContainerFallback = null): (ref: StudioRef, options?: StudioOpenOptions) => void {
  const provided = useStudioContainer();
  const panel = experimental_useAppPanel();
  const navigate = useBbNavigate();
  const fixed = provided ?? (fallback === "route" ? null : fallback);
  const fromRoute = !provided && fallback === "route";
  const kind = fixed?.kind ?? null;
  const threadId = fixed?.kind === "thread" ? fixed.threadId : null;
  return useCallback((ref, options) => {
    const container = fromRoute ? routeContainer() : kind === null ? null : kind === "studio" ? { kind } : { kind, threadId };
    runPlan(planOpen(ref, container, options), { panel, navigate });
  }, [fromRoute, kind, threadId, panel, navigate]);
}
