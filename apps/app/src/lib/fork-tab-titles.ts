import { getDefaultStore } from "jotai";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { forkFixedPanelTabs } from "./fixed-panel-tabs";
import type { FixedPanelTab } from "./fixed-panel-tabs-state";
import { globalPanelTabsAtom } from "./fork-global-panel-tabs";
import { serializePluginPanelParams } from "./plugin-json-value";
import { getPluginSlotSnapshot } from "./plugin-slots";

export interface RenamePluginTabOptions {
  tabId: string;
  params?: JsonValue;
  title: string;
}

export function renamePluginTabs(
  pluginId: string,
  options: RenamePluginTabOptions,
): boolean {
  const title = options.title.trim();
  if (title.length === 0) return false;
  const registration = getPluginSlotSnapshot().tabs.find(
    (slot) => slot.pluginId === pluginId && slot.id === options.tabId,
  );
  let paramsJson: string | null;
  try {
    paramsJson = serializePluginPanelParams(
      options.params === undefined
        ? registration?.availability === "action"
          ? registration.params
          : undefined
        : options.params,
    );
  } catch {
    return false;
  }
  const matches = (tab: FixedPanelTab): boolean =>
    tab.kind === "plugin-panel" &&
    tab.pluginId === pluginId &&
    tab.actionId === options.tabId &&
    tab.paramsJson === paramsJson &&
    tab.title !== title;
  const store = getDefaultStore();
  let renamed = false;
  const globalTabs = store.get(globalPanelTabsAtom);
  if (globalTabs.some(matches)) {
    store.set(
      globalPanelTabsAtom,
      globalTabs.map((tab) => (matches(tab) ? { ...tab, title } : tab)),
    );
    renamed = true;
  }
  for (const stateId of forkFixedPanelTabs.ids()) {
    const stateAtom = forkFixedPanelTabs.owned(stateId);
    const state = store.get(stateAtom);
    if (!state.secondary.tabs.some(matches)) continue;
    store.set(stateAtom, {
      ...state,
      secondary: {
        ...state.secondary,
        tabs: state.secondary.tabs.map((tab) =>
          matches(tab) ? { ...tab, title } : tab,
        ),
      },
    });
    renamed = true;
  }
  return renamed;
}
