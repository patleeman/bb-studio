import type { ExperimentalPanelTabActionTab } from "@get-bb/plugin-sdk";
import type { FixedPanelTab } from "./fixed-panel-tabs-state";
import type { PluginPanelTabActionSlot } from "./fork-slots";
import { threadIdOfPanelState } from "./fork-global-panel-tabs";
import { parsePersistedPluginPanelParams } from "./plugin-json-value";

export function panelTabActionTarget(
  tab: FixedPanelTab,
  panelStateId: string | null,
): ExperimentalPanelTabActionTab | null {
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

export function availablePanelTabActions(
  actions: readonly PluginPanelTabActionSlot[],
  target: ExperimentalPanelTabActionTab,
): PluginPanelTabActionSlot[] {
  return actions
    .filter((action) => {
      if (action.isAvailable === undefined) return true;
      try {
        return action.isAvailable(target) === true;
      } catch (error) {
        console.warn(
          `[plugin:${action.pluginId}] panel tab action "${action.id}" isAvailable failed`,
          error,
        );
        return false;
      }
    })
    .sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
    );
}

export function runPanelTabAction(
  action: PluginPanelTabActionSlot,
  target: ExperimentalPanelTabActionTab,
): void {
  const report = (error: unknown) =>
    console.warn(
      `[plugin:${action.pluginId}] panel tab action "${action.id}" failed`,
      error,
    );
  try {
    void Promise.resolve(action.run(target)).catch(report);
  } catch (error) {
    report(error);
  }
}
