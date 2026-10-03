// Floating windows (see float-registry.ts for how content reaches them).
//
// Anything that can open a window calls `openFloat`, and offers it only while
// `useFloatAvailable()` says the Float plugin is running. A plugin whose panel
// can show in a window renders <FloatPanels> from an `experimental_appOverlay`;
// its panel then renders in its own React tree, portalled into the window.
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  floatBodies,
  mainBodies,
  publishMainBody,
  floatTransfers,
  requestFloatTransfer,
  type FloatAnchor,
  type MainAnchor,
  floatDock,
  floatHost,
  floatLeading,
  floatPanelFor,
  floatRevision,
  registerFloatPanel,
  subscribeFloat,
  type FloatOpenOptions,
  type FloatTarget,
} from "./float-registry";

function useFloatRevision(): number {
  return useSyncExternalStore(subscribeFloat, floatRevision, floatRevision);
}

/** Opens a window; false when the Float plugin isn't running. */
export function openFloat(target: FloatTarget, options?: FloatOpenOptions): boolean {
  const host = floatHost();
  if (!host) return false;
  if (!options?.minimized && target.kind === "path") requestFloatTransfer(target);
  host.open(target, options);
  return true;
}

/** Whether windows can open: the Float plugin is running. */
export function useFloatAvailable(): boolean {
  useFloatRevision();
  return floatHost() !== null;
}

/** Whether `target` can open in a window: threads always, paths when a panel shows them. */
export function useCanFloat(target: FloatTarget | null): boolean {
  useFloatRevision();
  if (!target || !floatHost()) return false;
  return target.kind === "thread" || floatPanelFor(target.path) !== null;
}

const InFloatContext = createContext(false);
const CompanionKeyContext = createContext<string | null>(null);

/** Navigates the current companion, including after an asynchronous action. */
export function useCompanionNavigate(): (target: FloatTarget) => boolean {
  const key = useContext(CompanionKeyContext);
  return (target) => {
    const host = floatHost();
    if (!key || !host?.navigate || (target.kind === "path" && !floatPanelFor(target.path))) return false;
    host.navigate(key, target);
    return true;
  };
}

/**
 * True inside a window. A view rendered there skips what only makes sense on
 * its own screen, such as handing its chat to a window or moving the dock.
 */
export const useInFloat = (): boolean => useContext(InFloatContext);

/** Wrap a nav panel so its first move carries the already-mounted view. */
export function retainPanel(path: string, Component: ComponentType<{ subPath: string }>): ComponentType<{ subPath: string }> {
  return function RetainedNavPanel({ subPath }) {
    return <MainPanel path={path} subPath={subPath}><Component subPath={subPath} /></MainPanel>;
  };
}

function MainPanel({ path, subPath, children }: { path: string; subPath: string; children: ReactNode }) {
  const pluginId = experimental_usePluginId();
  const [id] = useState(() => crypto.randomUUID());
  const [moved, setMoved] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const root = `/plugins/${pluginId}/${path}`;
  const href = subPath ? `${root}/${subPath.split("/").map(encodeURIComponent).join("/")}` : root;
  useFloatRevision();
  const ready = floatPanelFor(root)?.path === path;
  useLayoutEffect(() => {
    if (!element.current) return;
    return publishMainBody({ id, target: { kind: "path", path: href }, element: element.current, setMoved });
  }, [id, href]);
  return <div ref={element} data-studio-main-view={href} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
    {!ready ? children : moved ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      <p>This view is open in a companion.</p>
      <button type="button" className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-state-hover" onClick={() => openFloat({ kind: "path", path: href })}>Show companion</button>
    </div> : null}
  </div>;
}

type PanelView = {
  id: string;
  target: Extract<FloatTarget, { kind: "path" }>;
  mainId?: string;
  windowKey?: string;
  element: HTMLElement;
  placement?: FloatAnchor["placement"];
};
const viewPath = (path: string) => path.split(/[?#]/)[0]!.replace(/\/$/, "");

function placePanels(previous: PanelView[], mains: MainAnchor[], floats: FloatAnchor[], transfers: FloatTarget[]): PanelView[] {
  const next: PanelView[] = [];
  const used = new Set<string>();
  const take = (view: PanelView) => { used.add(view.id); next.push(view); };
  for (const anchor of floats) {
    if (anchor.target.kind !== "path") continue;
    const target = anchor.target;
    const same = (view: PanelView) => !used.has(view.id) && viewPath(view.target.path) === viewPath(target.path);
    const candidates = mains.filter(main => viewPath(main.target.path) === viewPath(target.path));
    const main = candidates.find(main => main.element.contains(document.activeElement))
      ?? candidates.sort((a, b) => (b.focusOrder ?? 0) - (a.focusOrder ?? 0))[0];
    const existing = previous.find(view => same(view) && view.windowKey === anchor.windowKey)
      ?? previous.find(view => same(view) && view.mainId === main?.id)
      ?? (!main ? previous.find(view => same(view) && view.windowKey === undefined) : undefined);
    take({ id: existing?.id ?? (main ? `main:${main.id}:${viewPath(target.path)}` : `float:${anchor.windowKey}:${viewPath(target.path)}`), target,
      mainId: candidates.some(candidate => candidate.id === existing?.mainId) ? existing?.mainId : main?.id,
      windowKey: anchor.windowKey, element: anchor.element, placement: anchor.placement });
  }
  for (const target of transfers) {
    if (target.kind !== "path" || next.some(view => viewPath(view.target.path) === viewPath(target.path)) || mains.some(main => viewPath(main.target.path) === viewPath(target.path))) continue;
    const existing = previous.find(view => !used.has(view.id) && viewPath(view.target.path) === viewPath(target.path));
    if (existing) take(existing);
  }
  for (const main of mains) {
    if (next.some(view => view.mainId === main.id && viewPath(view.target.path) === viewPath(main.target.path))) continue;
    const same = (view: PanelView) => !used.has(view.id) && viewPath(view.target.path) === viewPath(main.target.path);
    const existing = previous.find(view => same(view) && view.mainId === main.id)
      ?? previous.find(view => same(view) && view.windowKey !== undefined)
      ?? previous.find(view => same(view) && !mains.some(anchor => anchor.id === view.mainId));
    take({ id: existing?.id ?? `main:${main.id}:${viewPath(main.target.path)}`, mainId: main.id, target: main.target, element: main.element, placement: "main" });
  }
  return next;
}

function RetainedPanel({ view, pluginId, children }: { view: PanelView; pluginId: string; children: ReactNode }) {
  const [element] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    element.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col";
    element.dataset.bbPortaledOverlay = "";
    element.dataset.bbPluginRoot = "";
    element.dataset.bbPlugin = pluginId;
    if (element.parentElement === view.element) return;
    const focused = element.contains(document.activeElement) ? document.activeElement : null;
    const selection = window.getSelection();
    const range = selection?.rangeCount && element.contains(selection.anchorNode) && element.contains(selection.focusNode)
      ? { anchor: selection.anchorNode!, anchorOffset: selection.anchorOffset, focus: selection.focusNode!, focusOffset: selection.focusOffset } : null;
    const scroll = [element, ...element.querySelectorAll<HTMLElement>("*")].filter(node => node.scrollTop || node.scrollLeft)
      .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    view.element.append(element);
    scroll.forEach(({ node, top, left }) => { node.scrollTop = top; node.scrollLeft = left; });
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (range && selection) selection.setBaseAndExtent(range.anchor, range.anchorOffset, range.focus, range.focusOffset);
  }, [element, pluginId, view.element]);
  useLayoutEffect(() => () => element.remove(), [element]);
  return createPortal(<CompanionKeyContext.Provider value={view.windowKey ?? null}>
    <InFloatContext.Provider value={view.windowKey !== undefined && view.placement !== "main"}>{children}</InFloatContext.Provider>
  </CompanionKeyContext.Provider>, element, view.id);
}

/** Owns each main or companion panel in this plugin's persistent overlay. */
export function FloatPanels({ path, render }: { path: string; render(subPath: string, context: { companion: boolean }): ReactNode }) {
  const pluginId = experimental_usePluginId();
  useLayoutEffect(() => registerFloatPanel({ pluginId, path }), [pluginId, path]);
  const revision = useFloatRevision();
  const matches = (target: FloatTarget) => {
    if (target.kind !== "path") return false;
    const panel = floatPanelFor(viewPath(target.path));
    return panel?.pluginId === pluginId && panel.path === path;
  };
  const mains = mainBodies().filter(anchor => anchor.element.isConnected && matches(anchor.target));
  const [snapshot, setSnapshot] = useState<{ revision: number; pluginId: string; path: string; views: PanelView[] }>({ revision: -1, pluginId, path, views: [] });
  const views = snapshot.revision === revision && snapshot.pluginId === pluginId && snapshot.path === path ? snapshot.views
    : placePanels(snapshot.pluginId === pluginId && snapshot.path === path ? snapshot.views : [], mains, floatBodies().filter(anchor => matches(anchor.target)), floatTransfers().filter(matches));
  if (views !== snapshot.views) setSnapshot({ revision, pluginId, path, views });
  useLayoutEffect(() => {
    mains.forEach(main => main.setMoved(views.some(view => view.mainId === main.id && viewPath(view.target.path) === viewPath(main.target.path) && view.windowKey !== undefined)));
  }, [views]);
  return <>{views.map(view => <RetainedPanel key={`${view.id}:${viewPath(view.target.path)}`} view={view} pluginId={pluginId}>
    {render(floatPanelFor(viewPath(view.target.path))!.subPath, { companion: view.windowKey !== undefined })}
  </RetainedPanel>)}</>;
}

/** Renders `render(threadId)` above the messages of every thread window. */
export function FloatThreadLeading({ render }: { render(threadId: string): ReactNode }) {
  const pluginId = experimental_usePluginId();
  useFloatRevision();
  return (
    <>
      {floatLeading().map(({ windowKey, target, element }) =>
        target.kind === "thread"
          ? createPortal(
              <div data-bb-portaled-overlay="" data-bb-plugin-root="" data-bb-plugin={pluginId}>
                {render(target.threadId)}
              </div>,
              element,
              windowKey,
            )
          : null,
      )}
    </>
  );
}

/** Renders `children` in Float's bottom-right corner; null without Float. */
export function FloatDockPortal({ children }: { children: ReactNode }) {
  const pluginId = experimental_usePluginId();
  useFloatRevision();
  const dock = floatDock();
  if (!dock) return null;
  return createPortal(
    <div data-bb-portaled-overlay="" data-bb-plugin-root="" data-bb-plugin={pluginId} className="pointer-events-auto">
      {children}
    </div>,
    dock,
    "dock",
  );
}
