// Navigation between Studio plugins. `useBbNavigate().toPluginPanel` only
// reaches the calling plugin's own panels, so opening another plugin's page
// goes through the app's router directly: BB uses a browser router, which
// follows history changes announced with `popstate`.
import { STUDIO_PANEL_PATH, STUDIO_PLUGIN_ID } from "../contract";
import { navigateFromFloat } from "./float-registry";

interface RouterState {
  usr?: unknown;
  key?: string;
  idx?: number;
}

/**
 * Opens an in-app path such as /plugins/pages/pages/pg_x. Clicked from inside
 * a floating tab, the tab goes there instead, as a browser tab would; `main`
 * opens it in the main view regardless.
 */
export function openAppPath(path: string, options: { replace?: boolean; main?: boolean } = {}): void {
  if (!path.startsWith("/")) return;
  if (!options.main && navigateFromFloat({ kind: "path", path })) return;
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
