import type { FixedPanelTab } from "./fixed-panel-tabs-state";
import { threadIdOfPanelState } from "./fork-global-panel-tabs";
import { parsePersistedPluginPanelParams } from "./plugin-json-value";

export interface PanelTabTarget {
  pluginId: string;
  tabId: string;
  params: Record<string, unknown> | undefined;
  title: string;
  threadId: string | null;
}

export function panelTabActionTarget(
  tab: FixedPanelTab,
  panelStateId: string | null,
): PanelTabTarget | null {
  if (tab.kind !== "plugin-panel" || tab.fileOpenerOwner !== undefined) {
    return null;
  }
  const params = parsePersistedPluginPanelParams(tab.paramsJson);
  return {
    pluginId: tab.pluginId,
    tabId: tab.actionId,
    params:
      typeof params === "object" && params !== null && !Array.isArray(params)
        ? params
        : undefined,
    title: tab.title,
    threadId: panelStateId === null ? null : threadIdOfPanelState(panelStateId),
  };
}
