// Navigation between Studio plugins. `useBbNavigate().toPluginPanel` only
// reaches the calling plugin's own panels. BB routes a click on an in-app
// link inside a plugin slot itself, as it does for links in chat, so opening
// another plugin's page clicks such a link. Changing the URL behind BB's back
// skips its own navigation, which left add-on panels blank in the desktop app.
import { STUDIO_PANEL_PATH, STUDIO_PLUGIN_ID } from "../contract";

interface RouterState {
  usr?: unknown;
  key?: string;
  idx?: number;
}

/** Canonical panel path for encoded and decoded subpaths alike. */
export function panelHref(pluginId: string, path: string, subPath = ""): string {
  const root = `/plugins/${pluginId}/${path}`;
  if (!subPath) return root;
  return `${root}/${subPath.split("/").map(segment => {
    try { return encodeURIComponent(decodeURIComponent(segment)); }
    catch { return encodeURIComponent(segment); }
  }).join("/")}`;
}

/**
 * Opens an in-app path such as /plugins/pages/pages/pg_x in the main view.
 * BB's links can't replace the current entry, so `replace` points it at the
 * same path first: back then skips the page being left.
 */
export function openAppPath(path: string, options: { replace?: boolean } = {}): void {
  if (!path.startsWith("/")) return;
  if (options.replace) window.history.replaceState(window.history.state, "", path);
  if (clickAppLink(path)) return;
  rewriteHistory(path, options);
}

/** Has BB route a click on a link to `path`; false when nothing took it. */
function clickAppLink(path: string): boolean {
  // A slot's own element, which BB listens on; retained views are portalled.
  const root = document.querySelector<HTMLElement>("[data-bb-plugin-root]:not([data-bb-portaled-overlay])");
  if (!root) return false;
  const link = document.createElement("a");
  link.href = path;
  link.hidden = true;
  let routed = false;
  let seen: Event | null = null;
  // Runs before BB's listener, so it sees the click even if BB stops it.
  const see = (event: Event) => { seen = event; };
  // Runs after BB's listener: keep the browser from loading the page itself.
  const settle = (event: Event) => {
    routed = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener("click", see, { capture: true, once: true });
  window.addEventListener("click", settle, { once: true });
  root.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.removeEventListener("click", see, true);
    window.removeEventListener("click", settle);
  }
  // BB's handler may stop propagation, so `settle` never ran; it still routed
  // the click if it prevented the default.
  return routed || (seen as Event | null)?.defaultPrevented === true;
}

/** Announces a URL change to BB's browser router, outside its navigation. */
function rewriteHistory(path: string, options: { replace?: boolean }): void {
  const current = (window.history.state ?? {}) as RouterState;
  const idx = typeof current.idx === "number" ? current.idx : 0;
  const state: RouterState = {
    usr: null,
    key: Math.random().toString(36).slice(2, 10),
    idx: options.replace ? idx : idx + 1,
  };
  if (options.replace) window.history.replaceState(state, "", path);
  else window.history.pushState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

/** The Studio collection, optionally filtered to one kind. */
export function studioPath(kind?: string | null): string {
  const root = `/plugins/${STUDIO_PLUGIN_ID}/${STUDIO_PANEL_PATH}`;
  return kind ? `${root}/${encodeURIComponent(kind)}` : root;
}
