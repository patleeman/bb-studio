// What on screen is a Studio item, so a right-click anywhere can offer to
// float it or open it in a split. Float's item menu reads the marks; every
// plugin bundles its own kit, so they're plain data attributes on the element
// you click to open the item. A link to a plugin view counts without a mark.

/** An item as its opener knows it: where it opens, and how a tab labels it. */
export interface StudioItemLink {
  href: string;
  title?: string;
  /** An emoji or icon name for the tab. */
  icon?: string;
}

const HREF = "data-studio-item";
const TITLE = "data-studio-item-title";
const ICON = "data-studio-item-icon";

/** Spread onto the element that opens `item`. Nothing for a missing item or one outside a plugin. */
export function studioItemProps(item: StudioItemLink | null | undefined): Record<string, string> {
  if (!item || !pluginViewPath(item.href)) return {};
  return {
    [HREF]: item.href,
    ...(item.title ? { [TITLE]: item.title } : {}),
    ...(item.icon ? { [ICON]: item.icon } : {}),
  };
}

/** A link's in-app path when it opens a view inside a plugin: /plugins/<id>/<panel>/<more>. */
export function pluginViewPath(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const parts = path.split("/");
  return parts[1] === "plugins" && parts.length >= 5 && parts.slice(2).every(Boolean) ? href : null;
}

/** The item at `element`: the nearest mark, else the nearest link into a plugin view. */
export function studioItemAt(element: Element | null): StudioItemLink | null {
  const marked = element?.closest(`[${HREF}]`);
  if (marked) {
    const href = marked.getAttribute(HREF)!;
    const title = marked.getAttribute(TITLE) ?? undefined;
    const icon = marked.getAttribute(ICON) ?? undefined;
    return { href, ...(title ? { title } : {}), ...(icon ? { icon } : {}) };
  }
  const anchor = element?.closest("a[href]");
  const href = anchor ? pluginViewPath(anchor.getAttribute("href") ?? "") : null;
  if (!anchor || !href) return null;
  const text = anchor.textContent?.trim() ?? "";
  const title = anchor.getAttribute("title") || (text.length <= 80 ? text : "");
  return { href, ...(title ? { title } : {}) };
}

/**
 * Opens `path` in a split pane. BB opens a Mod-clicked link in a split when
 * the link is inside the clicking plugin's own tree, so this clicks `anchor`
 * (one the calling plugin renders) pointed at `path`. False when BB didn't
 * take it: splits are off, or the screen is too small.
 */
export function openPathInSplit(anchor: HTMLAnchorElement | null, path: string): boolean {
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
