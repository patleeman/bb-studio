// What on screen is a Studio item or a thread, so it opens the same way
// anywhere: right-click for a menu, Mod-click for a split. Studio reads the
// marks; every plugin bundles its own kit, so they're plain data attributes
// on the element you click to open the item. Links to a plugin view or a
// thread count without a mark.
import { openWorkspaceItem } from "./workspace";
import type { OpenTarget } from "./move";

/** An item as its opener knows it: where it opens, and how a tab labels it. */
export interface StudioItemLink {
  href: string;
  title?: string;
  /** An icon name for the tab. */
  icon?: string;
}

const HREF = "data-studio-item";
const THREAD = "data-studio-thread";
const TITLE = "data-studio-item-title";
const ICON = "data-studio-item-icon";
/** Set on an element whose Mod- and Shift-clicks mean something of its own, such as extending a selection. */
export const STUDIO_ITEM_CLICKS_OFF = "data-studio-item-clicks-off";
/** Spread onto the element that opens `item`. Nothing for a missing item or one outside a plugin. */
export function studioItemProps(item: StudioItemLink | null | undefined): Record<string, string> {
  if (!item || !pluginViewPath(item.href)) return {};
  return {
    [HREF]: item.href,
    ...(item.title ? { [TITLE]: item.title } : {}),
    ...(item.icon ? { [ICON]: item.icon } : {}),
  };
}

/** Spread onto the element that opens a thread. */
export function studioThreadProps(threadId: string | null | undefined, title?: string): Record<string, string> {
  if (!threadId) return {};
  return { [THREAD]: threadId, ...(title ? { [TITLE]: title } : {}) };
}

/** A link's in-app path when it opens a view inside a plugin: /plugins/<id>/<panel>/<more>. */
export function pluginViewPath(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const parts = path.split("/");
  return parts[1] === "plugins" && parts.length >= 5 && parts.slice(2).every(Boolean) ? href : null;
}

/** The thread a link opens: /threads/<id> or /projects/<project>/threads/<id>. */
export function threadLinkId(href: string): string | null {
  const match = /^\/(?:projects\/[^/?#]+\/)?threads\/([^/?#]+)\/?(?:[?#].*)?$/.exec(href);
  return match ? decodeURIComponent(match[1]!) : null;
}

function linkTitle(anchor: Element): string | undefined {
  const text = anchor.textContent?.trim() ?? "";
  return anchor.getAttribute("title") || (text && text.length <= 80 ? text : undefined);
}

/** What `element` opens: the nearest mark, else the nearest link into a plugin view or a thread. */
export function studioTargetAt(element: Element | null): OpenTarget | null {
  const marked = element?.closest(`[${HREF}], [${THREAD}]`);
  if (marked) {
    const title = marked.getAttribute(TITLE) ?? undefined;
    const threadId = marked.getAttribute(THREAD);
    if (threadId) return { kind: "thread", threadId, ...(title ? { title } : {}) };
    const icon = marked.getAttribute(ICON) ?? undefined;
    return { kind: "path", path: marked.getAttribute(HREF)!, ...(title ? { title } : {}), ...(icon ? { icon } : {}) };
  }
  const anchor = element?.closest("a[href]");
  if (!anchor) return null;
  const href = anchor.getAttribute("href") ?? "";
  const title = linkTitle(anchor);
  const threadId = threadLinkId(href);
  if (threadId) return { kind: "thread", threadId, ...(title ? { title } : {}) };
  const path = pluginViewPath(href);
  return path ? { kind: "path", path, ...(title ? { title } : {}) } : null;
}

/** The in-app link to a target, for copying or a new thread's mention. */
export const targetHref = (target: OpenTarget): string =>
  target.kind === "path" ? target.path : `/threads/${encodeURIComponent(target.threadId)}`;

/**
 * Opens `path` in a split pane. BB opens a Mod-clicked link in a split when
 * the link is inside the clicking plugin's own tree, so this clicks `anchor`
 * (one the calling plugin renders) pointed at `path`. False when BB didn't
 * take it: splits are off, or the screen is too small.
 */
export function openPathInSplit(anchor: HTMLAnchorElement | null, path: string): boolean {
  if (openWorkspaceItem({ href: path }, "right")) return true;
  if (!anchor) return false;
  const href = anchor.getAttribute("href");
  anchor.setAttribute("href", path);
  let handled = false;
  // BB's handler runs on the way up and cancels the click it takes; this
  // runs last and keeps the browser from following the link either way.
  const settle = (event: MouseEvent) => {
    handled = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener("click", settle, { once: true });
  try {
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, view: window }));
  } finally {
    window.removeEventListener("click", settle);
    if (href === null) anchor.removeAttribute("href");
    else anchor.setAttribute("href", href);
  }
  return handled;
}
