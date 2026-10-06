// Main views that outlive their route. A plugin wraps its nav panel in
// `retainPanel` and renders <RetainedPanels> from an `experimental_appOverlay`,
// which BB keeps mounted. The panel's React tree then lives in the overlay and
// is portalled into whichever main pane shows its route: a split that
// remounts the pane, or a trip to a thread and back, returns the same editor
// with its state, focus, selection and scroll instead of loading it again.
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { panelHref } from "./nav";

/** A main pane showing a retained panel's route. */
interface MainAnchor {
  id: string;
  path: string;
  element: HTMLElement;
}

const MAIN_REMOVING_EVENT = "bb-studio-main-removing";
/** Main views kept alive after their route leaves, per panel, most recent first. */
const PARKED_LIMIT = 3;

// Each plugin bundles its own kit, so this state is the plugin's own.
const mains = new Map<string, MainAnchor>();
const panels = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
let parkSequence = 0;

function changed(): void {
  revision += 1;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const useRevision = (): number => useSyncExternalStore(subscribe, () => revision, () => revision);
const viewPath = (path: string) => path.split(/[?#]/)[0]!.replace(/\/$/, "");

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function publishMain(anchor: MainAnchor): () => void {
  mains.set(anchor.id, anchor);
  changed();
  return () => {
    anchor.element.dispatchEvent(new Event(MAIN_REMOVING_EVENT));
    if (mains.get(anchor.id) !== anchor) return;
    queueMicrotask(() => {
      if (mains.get(anchor.id) !== anchor) return;
      mains.delete(anchor.id);
      changed();
    });
  };
}

/** Wrap a nav panel so its view outlives its route; render <RetainedPanels> for the same path. */
export function retainPanel(path: string, Component: ComponentType<{ subPath: string }>): ComponentType<{ subPath: string }> {
  return function RetainedNavPanel({ subPath }) {
    return <MainPanel path={path} subPath={subPath}><Component subPath={subPath} /></MainPanel>;
  };
}

// crypto.randomUUID exists only in secure contexts; BB opened over plain
// HTTP from another device isn't one. The id only has to be unique here.
let nextPanelId = 0;

function MainPanel({ path, subPath, children }: { path: string; subPath: string; children: ReactNode }) {
  const pluginId = experimental_usePluginId();
  const [id] = useState(() => `retained-${++nextPanelId}`);
  const element = useRef<HTMLDivElement>(null);
  const href = panelHref(pluginId, path, subPath);
  useRevision();
  // Without the overlay, the view renders here and goes with its route.
  const retained = panels.has(`${pluginId}/${path}`);
  useLayoutEffect(() => {
    if (!element.current) return;
    return publishMain({ id, path: href, element: element.current });
  }, [id, href]);
  return <div ref={element} data-studio-main-view={href} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
    {retained ? null : children}
  </div>;
}

type PanelView = {
  id: string;
  path: string;
  mainId: string;
  element: HTMLElement;
  /** Set while the view waits hidden for its route to come back. */
  parkedAt?: number;
};

function placePanels(previous: PanelView[], anchors: MainAnchor[], parking: HTMLElement | null): PanelView[] {
  const next: PanelView[] = [];
  const used = new Set<string>();
  const take = (view: PanelView) => { used.add(view.id); next.push(view); };
  for (const main of anchors) {
    const same = (view: PanelView) => !used.has(view.id) && viewPath(view.path) === viewPath(main.path);
    // The pane's own view, else one whose pane went away, such as a parked one.
    const existing = previous.find(view => same(view) && view.mainId === main.id)
      ?? previous.find(view => same(view) && !anchors.some(anchor => anchor.id === view.mainId));
    take({ id: existing?.id ?? `main:${main.id}:${viewPath(main.path)}`, mainId: main.id, path: main.path, element: main.element });
  }
  // A view whose route left stays parked, so switching back and forth
  // returns the same editor instead of loading the page again.
  if (parking) {
    previous
      .filter(view => !used.has(view.id) && !next.some(other => viewPath(other.path) === viewPath(view.path)))
      .map(view => view.parkedAt !== undefined ? view : { ...view, element: parking, parkedAt: ++parkSequence })
      .sort((a, b) => b.parkedAt! - a.parkedAt!)
      .slice(0, PARKED_LIMIT)
      .forEach(take);
  }
  return next;
}

function moveElement(element: HTMLElement, destination: HTMLElement) {
  if (element.parentElement === destination) return;
  if (element.isConnected && destination.isConnected && "moveBefore" in destination && typeof destination.moveBefore === "function") destination.moveBefore(element, null);
  else destination.append(element);
}

type ScrollPosition = { node: HTMLElement; top: number; left: number };
const scrollPositions = (element: HTMLElement): ScrollPosition[] => [element, ...element.querySelectorAll<HTMLElement>("*")]
  .filter(node => node.scrollTop || node.scrollLeft).map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));

function RetainedPanel({ view, pluginId, parking, children }: { view: PanelView; pluginId: string; parking: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [element] = useState(() => document.createElement("div"));
  // Scroll resets inside the hidden parking spot, so it's read before parking.
  const parkedScroll = useRef<ScrollPosition[] | null>(null);
  useLayoutEffect(() => {
    const park = () => {
      if (!parking.current || element.parentElement !== view.element) return;
      parkedScroll.current = scrollPositions(element);
      moveElement(element, parking.current);
    };
    view.element.addEventListener(MAIN_REMOVING_EVENT, park);
    return () => view.element.removeEventListener(MAIN_REMOVING_EVENT, park);
  }, [element, parking, view.element]);
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
    const scroll = element.parentElement === parking.current ? parkedScroll.current ?? [] : scrollPositions(element);
    parkedScroll.current = null;
    moveElement(element, view.element);
    scroll.forEach(({ node, top, left }) => { node.scrollTop = top; node.scrollLeft = left; });
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (range && selection) selection.setBaseAndExtent(range.anchor, range.anchorOffset, range.focus, range.focusOffset);
  }, [element, parking, pluginId, view.element]);
  useLayoutEffect(() => () => element.remove(), [element]);
  return createPortal(children, element, view.id);
}

/** Owns this plugin's retained views of the panel at `path`, from its persistent overlay. */
export function RetainedPanels({ path, render }: { path: string; render(subPath: string): ReactNode }) {
  const pluginId = experimental_usePluginId();
  const parking = useRef<HTMLDivElement>(null);
  const root = `/plugins/${pluginId}/${path}`;
  useLayoutEffect(() => {
    const key = `${pluginId}/${path}`;
    panels.add(key);
    changed();
    return () => { panels.delete(key); changed(); };
  }, [pluginId, path]);
  const current = useRevision();
  const anchors = [...mains.values()].filter(anchor => anchor.element.isConnected && (viewPath(anchor.path) === root || viewPath(anchor.path).startsWith(`${root}/`)));
  const [snapshot, setSnapshot] = useState<{ revision: number; root: string; views: PanelView[] }>({ revision: -1, root, views: [] });
  const views = snapshot.revision === current && snapshot.root === root ? snapshot.views
    : placePanels(snapshot.root === root ? snapshot.views : [], anchors, parking.current);
  if (views !== snapshot.views) setSnapshot({ revision: current, root, views });
  return <><div ref={parking} hidden data-studio-retained-parking="" />{views.map(view => <RetainedPanel key={`${view.id}:${viewPath(view.path)}`} view={view} pluginId={pluginId} parking={parking}>
    {render(safeDecode(viewPath(view.path).slice(root.length + 1)))}
  </RetainedPanel>)}</>;
}
