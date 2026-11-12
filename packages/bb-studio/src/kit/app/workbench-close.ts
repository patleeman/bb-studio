// Closing one of Studio's workbench tabs from outside its side panel: a tab
// dragged to the main view moves there, so the
// workbench tab it came from closes. Only code inside a side panel can close
// its tabs, so the same receivers that open tabs on request (a thread's
// ThreadTabReceiver, the Studio page's PageTabReceiver) take this request
// too. It is answered at once: true when a receiver found the tab and closed it.
import { experimental_useAppPanel, type ExperimentalPanelController, type ExperimentalPanelTab, type ExperimentalPanelTabs } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";

/** A workbench tab: whose it is, which registration, its params, and the thread whose side panel holds it (null: the Studio page's). */
export interface WorkbenchTabRef {
  pluginId: string;
  tabId: string;
  params: Record<string, unknown> | undefined | null;
  threadId: string | null;
}

const REQUEST_EVENT = "studio:workbench-tab-close";
interface CloseRequest { ref: WorkbenchTabRef; closed: boolean }

/** The same JSON whatever order the keys were written in. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The open tab `ref` names: the plugin's action tab with the same params, if it can be closed. */
export function findWorkbenchTab(tabs: Pick<ExperimentalPanelTabs, "tabs">, ref: WorkbenchTabRef): ExperimentalPanelTab | null {
  const params = stable(ref.params ?? null);
  return tabs.tabs.find((tab) => tab.closable && tab.detail.kind === "plugin" && tab.detail.pluginId === ref.pluginId && tab.detail.tab.id === ref.tabId && stable(tab.detail.params ?? null) === params) ?? null;
}

/** Asks the side panel that holds `ref` to close it. False when that panel isn't on screen, or the tab isn't open or can't be closed. */
export function requestCloseWorkbenchTab(ref: WorkbenchTabRef): boolean {
  if (typeof window === "undefined") return false;
  const detail: CloseRequest = { ref, closed: false };
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail }));
  return detail.closed;
}

/** Closes `ref` in `panel` when it is this panel's. */
export function closeWorkbenchTab(panel: Pick<ExperimentalPanelController, "getTabs" | "closeTab">, ref: WorkbenchTabRef): boolean {
  try {
    const tab = findWorkbenchTab(panel.getTabs(), ref);
    return tab ? panel.closeTab(tab.key) : false;
  } catch {
    return false;
  }
}

/** In a side panel's receiver: closes the tabs asked for in this panel (`threadId` null: the Studio page's). */
export function useWorkbenchCloseRequests(threadId: string | null, enabled = true): void {
  const panel = experimental_useAppPanel();
  useEffect(() => {
    if (!enabled) return;
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<CloseRequest>).detail;
      if (!request || request.closed || request.ref.threadId !== threadId) return;
      request.closed = closeWorkbenchTab(panel, request.ref);
    };
    window.addEventListener(REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_EVENT, onRequest);
  }, [panel, threadId, enabled]);
}
