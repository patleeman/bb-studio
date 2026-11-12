// An item in a window of its own, on a BB with plugin windows
// (src/kit/app/windows.ts): the item's own page, the one the main view
// shows, from the window's params `{ kind, id }`. "Open in new window" in an
// item's menus opens it (src/kit/app/item-window.tsx).
//
// One window per item: opening an item that has a window brings that window
// forward. BB keeps one window per window id, so Studio offers a few ids
// with the same view and gives each open item one. Which id shows which item
// is kept in localStorage, which every window of this BB shares: a window
// writes its item there while it is open. With every id taken, the window
// opened longest ago is closed for the new item.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { BUILTIN_ROUTES, builtinItemAt, STUDIO_ROOT } from "../builtins";
import type { rpcContract } from "../contract";
import type { hudContract } from "../hud/contract";
import { StudioContainerProvider } from "../kit/app/container";
import { setItemWindowOpener } from "../kit/app/item-window";
import { setHostNavigator } from "../kit/app/nav";
import { LinksBridge } from "../links/open";
import { hostWindowId, registerHostWindow, windowParams, type HostWindowOptions, type HostWindows } from "../kit/app/windows";
import { setSharedItemViews, sharedItemView, type ItemViews } from "./global-workbench";
import { tabKind } from "./studio-tab/model";

export const ITEM_WINDOW_ID = "item";
/** How many items can have a window at once. */
export const ITEM_WINDOW_COUNT = 6;
export const ITEM_WINDOW_IDS: readonly string[] = Array.from({ length: ITEM_WINDOW_COUNT }, (_, index) => (index ? `${ITEM_WINDOW_ID}-${index + 1}` : ITEM_WINDOW_ID));
export const ITEM_WINDOW_SIZE = { width: 1040, height: 780 } as const;
const CLAIMS_KEY = "studio:item-windows";

export interface ItemWindowTarget { kind: string; id: string }
/** Which item each window id shows, and since when. */
export type ItemWindowClaims = Record<string, { key: string; at: number }>;

/** One window per item: its kind and id. */
export const itemWindowKey = (target: ItemWindowTarget) => `${target.kind}:${target.id}`;

/** The item a link opens, when it is one of Studio's built-in kinds. */
export function itemWindowTarget(href: string): ItemWindowTarget | null {
  const found = href.startsWith("/") ? builtinItemAt(href) : null;
  return found ? { kind: found.route.kind, id: found.id } : null;
}

/** The item a window's params name, or null when they name none. */
export function itemWindowTargetOf(params: Record<string, string>): ItemWindowTarget | null {
  const { kind, id } = params;
  const info = kind && id ? tabKind(kind, id) : null;
  return info && id && info.isId(id) ? { kind: info.kind, id } : null;
}

/** The item's address in the main view. */
export function itemWindowHref(target: ItemWindowTarget): string | null {
  const route = BUILTIN_ROUTES.find((each) => each.kind === target.kind);
  return route ? `${STUDIO_ROOT}/${route.segment}/${encodeURIComponent(target.id)}` : null;
}

/** The window an item opens in: its own, else a free one, else the one opened longest ago (`replace`). */
export function pickItemWindow(claims: ItemWindowClaims, key: string): { windowId: string; replace: boolean } {
  const own = ITEM_WINDOW_IDS.find((id) => claims[id]?.key === key);
  if (own) return { windowId: own, replace: false };
  const free = ITEM_WINDOW_IDS.find((id) => !claims[id]);
  if (free) return { windowId: free, replace: false };
  const oldest = [...ITEM_WINDOW_IDS].sort((a, b) => claims[a]!.at - claims[b]!.at)[0]!;
  return { windowId: oldest, replace: true };
}

export function itemWindowOptions(target: ItemWindowTarget, title?: string): HostWindowOptions {
  return { ...(title ? { title } : {}), ...ITEM_WINDOW_SIZE, params: { kind: target.kind, id: target.id } };
}

function readClaims(): ItemWindowClaims {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(CLAIMS_KEY) ?? "{}");
    if (typeof stored !== "object" || stored === null) return {};
    const claims: ItemWindowClaims = {};
    for (const id of ITEM_WINDOW_IDS) {
      const claim = (stored as Record<string, { key?: unknown; at?: unknown } | undefined>)[id];
      if (claim && typeof claim.key === "string" && typeof claim.at === "number") claims[id] = { key: claim.key, at: claim.at };
    }
    return claims;
  } catch {
    return {};
  }
}

function writeClaim(windowId: string, claim: { key: string; at: number } | null): void {
  try {
    const claims = readClaims();
    if (claim) claims[windowId] = claim;
    else delete claims[windowId];
    window.localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
  } catch { /* storage off: every open takes the first window */ }
}

/** Opens the item's window, or brings the one it has forward. */
export async function openItemWindow(windows: HostWindows, target: ItemWindowTarget, title?: string, now: number = Date.now()): Promise<boolean> {
  const key = itemWindowKey(target);
  const claims = readClaims();
  const { windowId, replace } = pickItemWindow(claims, key);
  if (replace) await windows.close(windowId);
  const opened = await windows.open(windowId, itemWindowOptions(target, title));
  if (opened) writeClaim(windowId, { key, at: claims[windowId]?.key === key ? claims[windowId]!.at : now });
  return opened;
}

/** The window's view: the item's page, titled for the item. */
function ItemWindow() {
  const target = itemWindowTargetOf(windowParams());
  const href = target ? itemWindowHref(target) : null;
  const rpc = useRpc<typeof rpcContract>();
  const relay = useRpc<typeof hudContract>();
  const [title, setTitle] = useState<string | null>(null);
  // The window's item, for as long as it is open.
  useEffect(() => {
    const windowId = hostWindowId();
    if (!target || !windowId) return;
    const key = itemWindowKey(target);
    const claim = () => writeClaim(windowId, { key, at: readClaims()[windowId]?.at ?? Date.now() });
    const release = () => { if (readClaims()[windowId]?.key === key) writeClaim(windowId, null); };
    claim();
    window.addEventListener("focus", claim);
    window.addEventListener("pagehide", release);
    return () => { window.removeEventListener("focus", claim); window.removeEventListener("pagehide", release); };
  }, [target?.kind, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A window has no main view: what the item opens goes to BB's main window.
  useEffect(() => {
    const toMain = (path: string) => { void relay.call("window.openInMain", { path }).catch(() => {}); return true; };
    setHostNavigator(toMain);
    return () => setHostNavigator(null);
  }, [relay]);
  // Named for its item, and renamed with it. Opening it here counts as opening it anywhere.
  useEffect(() => {
    if (!href) return;
    let live = true;
    const load = () => void rpc.call("visitTab", { path: href }).then(({ tab }) => { if (live && tab?.title) setTitle(tab.title); }, () => {});
    load();
    const poll = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    return () => { live = false; clearInterval(poll); };
  }, [rpc, href]);
  useEffect(() => {
    if (!title) return;
    // After BB names the window for the slot.
    const timer = setTimeout(() => { document.title = title; }, 0);
    return () => clearTimeout(timer);
  }, [title]);
  const view = target ? sharedItemView(target.kind, target.id) : null;
  if (!view) return <p className="p-4 text-sm text-muted-foreground">This item can’t be shown in a window.</p>;
  return (
    <StudioContainerProvider value={{ kind: "studio" }}>
      <LinksBridge />
      <div className="studio-root flex min-h-0 flex-col bg-background text-foreground" style={{ height: "100dvh" }} data-studio-item-window={itemWindowKey(target!)}>{view}</div>
    </StudioContainerProvider>
  );
}

/**
 * Offers the item windows and lends the kit's menu entry its opener. False,
 * having done nothing, on a BB without plugin windows.
 */
export function registerItemWindows(slots: object, views: ItemViews): boolean {
  let registered = false;
  for (const id of ITEM_WINDOW_IDS) registered = registerHostWindow(slots, { id, title: "Studio", component: ItemWindow }) || registered;
  if (!registered) return false;
  setSharedItemViews(views);
  setItemWindowOpener({
    canOpen: (href) => itemWindowTarget(href) !== null,
    open: (windows, item) => {
      const target = itemWindowTarget(item.href);
      return target ? openItemWindow(windows, target, item.title) : Promise.resolve(false);
    },
  });
  return true;
}
