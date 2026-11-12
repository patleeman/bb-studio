// Opening one of Studio's workbench tabs beside what is on screen: a thread's
// own side panel in a thread, the Studio page's beside a Studio page. Nothing
// is fixed in every workbench. The tabs themselves are registered in src/ui/workbench-tabs.tsx;
// the ids live here so kit pieces such as the item header can ask for them.
import type { ExperimentalPanelController, JsonValue } from "@get-bb/plugin-sdk/app";
import { STUDIO_PANEL_PATH } from "../contract";
import type { StudioContainer } from "./container";
import { openThreadTab } from "./thread-panel";

/** A thread as a workbench tab: `{ threadId }`. */
export const THREAD_TAB = "thread";
/** A new thread about an item, as a workbench tab: `{ pluginId, id }`. It becomes the thread's tab once sent. */
export const ITEM_THREAD_TAB = "item-thread";

/** The reference `openTab` takes for a tab in the Studio page's side panel. */
export const pageTab = (id: string, panelId: string = STUDIO_PANEL_PATH) => ({ id, context: { kind: "nav-panel" as const, panelId }, availability: "action" as const });

export interface WorkbenchOpen { tabId: string; params: JsonValue; title: string }

/** Opens `open` in the Studio page's side panel. False when BB declined. */
export function openPageTab(panel: Pick<ExperimentalPanelController, "openTab">, open: WorkbenchOpen, panelId: string = STUDIO_PANEL_PATH): boolean {
  const options = { tab: pageTab(open.tabId, panelId), params: open.params, title: open.title };
  try {
    return panel.openTab(options);
  } catch {
    return false;
  }
}

/**
 * Opens `open` in the workbench beside the caller: the thread's in a thread,
 * else the Studio page's. False where there is no workbench to open it in
 * (stable BB's Studio page), so the caller can fall back.
 */
export function openBeside(panel: Pick<ExperimentalPanelController, "openTab">, container: StudioContainer | null, open: WorkbenchOpen): boolean {
  const beside = () => openThreadTab(panel, { actionId: open.tabId, params: open.params, title: open.title });
  if (container?.kind === "thread") return beside();
  return openPageTab(panel, open) || beside();
}
