// A versioned bridge between separately bundled Studio add-ons. Editors stay
// in their owning plugin's React tree (and SDK context); Studio supplies slots.
export interface WorkspaceAnchor { id: string; path: string; element: HTMLElement }
export interface WorkspaceItem { href: string; title?: string }
export type WorkspacePlacement = "tab" | "left" | "right" | "top" | "bottom";
interface Bridge {
  revision: number;
  providers: Map<string, symbol>;
  anchors: Map<string, WorkspaceAnchor>;
  active?: string | null;
  close?: (href: string) => void;
  open?: (item: WorkspaceItem, placement: WorkspacePlacement) => void;
}
const KEY = "__bbStudioWorkspace_v1";
const EVENT = "bb-studio-workspace-change";
/** Studio's landing page is its workspace. */
export const WORKSPACE_PATH = "/plugins/studio/studio";
export const WORKSPACE_DRAG = "application/x-bb-studio-item";
function bridge(): Bridge {
  const scope = window as unknown as Record<string, Bridge>;
  return scope[KEY] ??= { revision: 0, providers: new Map(), anchors: new Map() };
}
function changed() { bridge().revision++; window.dispatchEvent(new Event(EVENT)); }
export function workspaceRevision() { return bridge().revision; }
export function subscribeWorkspace(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
export function registerWorkspaceProvider(root: string) {
  const token = Symbol();
  bridge().providers.set(root, token); changed();
  return () => { if (bridge().providers.get(root) === token) { bridge().providers.delete(root); changed(); } };
}
export function workspaceItemPath(href: string): string | null {
  if (!/^\/plugins\/[^/?#]+\/[^/?#]+\/[^?#]+/.test(href)) return null;
  return href.split(/[?#]/)[0]!.replace(/\/+$/, "");
}
export function canOpenWorkspaceItem(href: string) {
  const path = workspaceItemPath(href);
  return !!path && [...bridge().providers.keys()].some(root => path.startsWith(`${root}/`));
}
export function registerWorkspaceOpener(open: NonNullable<Bridge["open"]>) {
  bridge().open = open;
  return () => { if (bridge().open === open) delete bridge().open; };
}
export function openWorkspaceItem(item: WorkspaceItem, placement: WorkspacePlacement = "tab"): boolean {
  if (!bridge().open || !canOpenWorkspaceItem(item.href)) return false;
  bridge().open!(item, placement);
  return true;
}
export function publishWorkspaceAnchor(anchor: WorkspaceAnchor) {
  bridge().anchors.set(anchor.id, anchor); changed();
  return () => {
    // Park the editor before React detaches its old container.
    anchor.element.dispatchEvent(new Event("bb-studio-main-removing"));
    if (bridge().anchors.get(anchor.id) === anchor) { bridge().anchors.delete(anchor.id); changed(); }
  };
}
export function workspaceAnchors(root: string) {
  return [...bridge().anchors.values()].filter(anchor => anchor.element.isConnected && anchor.path.startsWith(`${root}/`));
}

export function setWorkspaceActive(href: string | null) {
  if (bridge().active === href) return;
  bridge().active = href; changed();
}
export function workspaceActivePath() { return bridge().active ?? null; }
export function registerWorkspaceCloser(close: (href: string) => void) {
  bridge().close = close;
  return () => { if (bridge().close === close) delete bridge().close; };
}
export function closeWorkspaceItem(href: string) { bridge().close?.(href); }
