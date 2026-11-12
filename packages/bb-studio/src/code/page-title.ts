// VS Code as a page in BB's main view, Studio's nav panel `studio/vscode`
// ("VS Code" in BB's rail): its addresses, and what the page is called in
// BB's header, the window title and the page's own bar.
import { useSyncExternalStore } from "react";

/** The nav panel's id and path. */
export const VSCODE_PANEL = "vscode";
/** Studio's VS Code pages: `<root>` (the last workspace, or the picker), `<root>/<workspace id>`, and `<root>/choose` for the picker. */
export const WORKSPACES_PATH = `/plugins/studio/${VSCODE_PANEL}`;
/** In the place of a workspace id: the picker of workspaces and projects. */
export const CHOOSE_ID = "choose";
export const CHOOSE_PATH = `${WORKSPACES_PATH}/${CHOOSE_ID}`;
export const workspacePath = (id: string) => `${WORKSPACES_PATH}/${encodeURIComponent(id)}`;

/** "VS Code · <workspace or project name>"; "VS Code" alone until the name is known. */
export function codePageLabel(title: string | null | undefined): string {
  const name = title?.trim();
  return name ? `VS Code · ${name}` : "VS Code";
}

/** The workspace id (or `choose`) the VS Code panel's sub-path shows; null at its root or for anything else. */
export function codePageAt(subPath: string): string | null {
  const [id, ...rest] = subPath.replace(/^\/+|\/+$/g, "").split("/");
  if (!id || rest.length) return null;
  try { return decodeURIComponent(id); } catch { return null; }
}

// Workspace names as their pages last loaded them, for the title hook below.
const titles = new Map<string, string>();
const listeners = new Set<() => void>();

/** A workspace's page tells its name, once loaded and whenever it changes. */
export function noteWorkspaceTitle(id: string, title: string): void {
  if (titles.get(id) === title) return;
  titles.set(id, title);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/**
 * The VS Code panel's `experimental_usePageTitle`: BB's header and window are
 * titled "VS Code · <name>". Null at the panel's root, which keeps its own title.
 */
export function useCodePageTitle({ subPath }: { subPath: string }): { title: string; windowTitle: string } | null {
  const id = codePageAt(subPath);
  const name = useSyncExternalStore(subscribe, () => (id ? titles.get(id) ?? "" : ""), () => "");
  if (!id) return null;
  const label = codePageLabel(id === CHOOSE_ID ? "" : name);
  return { title: label, windowTitle: label };
}
