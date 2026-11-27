// The one-time move of each conversation's desktop tabs to the server: BB
// keeps a conversation's side panel in this window's localStorage
// (`bb.thread.fixedPanelTabsState-<thread>-1`). Read once, best effort; a
// conversation the server already has is left as the server has it
// (workbench.import applies only at version 0). Conversations shown later
// sync through ui/sync.ts, which imports the same way on first sight.
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { refOfPluginTab, type WorkspaceTabRef } from "../workspace";

export const IMPORT_DONE_KEY = "studio.workspaceImport.v1";
const STATE_KEY = /^bb\.thread\.fixedPanelTabsState-(.+)-1$/u;

export interface StoredPanel { threadId: string; tabs: { ref: WorkspaceTabRef; title: string }[]; activeIndex: number | null; panelOpen: boolean | null }

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

function params(text: unknown): JsonValue | null {
  if (typeof text !== "string") return null;
  try { return JSON.parse(text) as JsonValue; } catch { return null; }
}

/** One stored tab as a Workspace tab; null for what stays local (Info, the diff, New Tab, fixed and detail tabs) or can't be read. */
function tabOf(raw: unknown): { id: string; ref: WorkspaceTabRef; title: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const tab = raw as Record<string, unknown>;
  const id = str(tab.id);
  if (!id) return null;
  const path = str(tab.path);
  switch (tab.kind) {
    case "plugin-panel": {
      const pluginId = str(tab.pluginId);
      const tabId = str(tab.actionId);
      return pluginId && tabId ? { id, ref: refOfPluginTab(pluginId, tabId, params(tab.paramsJson)), title: str(tab.title) ?? tabId } : null;
    }
    case "workspace-file-preview":
      return path ? { id, ref: { kind: "file", path, ...(str(tab.environmentId) ? { environmentId: str(tab.environmentId) } : {}) }, title: path.split("/").pop() ?? path } : null;
    case "host-file-preview":
      return path ? { id, ref: { kind: "file", path, ...(str(tab.hostId) ? { hostId: str(tab.hostId) } : {}) }, title: path.split("/").pop() ?? path } : null;
    case "browser": {
      const url = str(tab.url);
      return url && /^https?:\/\//i.test(url) ? { id, ref: { kind: "browser", url }, title: str(tab.title) ?? url } : null;
    }
    case "terminal": {
      const terminalId = str(tab.terminalId);
      return terminalId ? { id, ref: { kind: "terminal", terminalId }, title: "Terminal" } : null;
    }
    default: return null;
  }
}

/** Every conversation's stored side panel with at least one tab the Workspace keeps. */
export function storedPanels(storage: Pick<Storage, "length" | "key" | "getItem">): StoredPanel[] {
  const panels: StoredPanel[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    const match = key ? STATE_KEY.exec(key) : null;
    if (!key || !match) continue;
    let threadId: string;
    try { threadId = decodeURIComponent(match[1]!); } catch { continue; }
    let state: unknown;
    try { state = JSON.parse(storage.getItem(key) ?? "null"); } catch { continue; }
    const secondary = (state as { secondary?: { tabs?: unknown; activeTabId?: unknown; isOpen?: unknown } } | null)?.secondary;
    if (!secondary || !Array.isArray(secondary.tabs)) continue;
    const tabs = secondary.tabs.map(tabOf).filter((tab): tab is NonNullable<ReturnType<typeof tabOf>> => tab !== null);
    if (!tabs.length) continue;
    const active = tabs.findIndex((tab) => tab.id === secondary.activeTabId);
    panels.push({ threadId, tabs: tabs.map(({ ref, title }) => ({ ref, title })), activeIndex: active < 0 ? null : active, panelOpen: typeof secondary.isOpen === "boolean" ? secondary.isOpen : null });
  }
  return panels;
}

/**
 * Sends each stored panel to the server once. Answers whether the import is
 * done: true when the server took at least one call, or there was nothing to
 * send; false when every call failed (an older server, Studio reloading), so
 * the next load tries again.
 */
export async function importStoredPanels(storage: Pick<Storage, "length" | "key" | "getItem">, send: (panel: StoredPanel) => Promise<unknown>, stopped: () => boolean = () => false): Promise<boolean> {
  const panels = storedPanels(storage);
  let answered = 0;
  for (const panel of panels) {
    if (stopped()) return false;
    if (await send({ ...panel, tabs: panel.tabs.slice(0, 100) }).then(() => true, () => false)) answered++;
  }
  return answered > 0 || !panels.length;
}
