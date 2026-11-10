import { useMemo } from "react";
import { getDefaultStore, useAtomValue } from "jotai";
import type {
  JsonValue,
  ExperimentalGlobalTab,
  ExperimentalOpenTabOptions,
} from "@get-bb/plugin-sdk";
import { createPluginPanelFixedPanelTab } from "./fixed-panel-tabs-state";
import {
  globalPanelTabSelectionsAtom,
  globalPanelTabsAtom,
} from "./fork-global-panel-tabs";
import {
  parsePersistedPluginPanelParams,
  serializePluginPanelParams,
} from "./plugin-json-value";
import { getPluginSlotSnapshot } from "./plugin-slots";

type ActionTabOpenOptions = Extract<
  ExperimentalOpenTabOptions,
  { experimental_global?: boolean }
>;

function opensInGlobal(
  options: ExperimentalOpenTabOptions,
): options is ActionTabOpenOptions {
  return (
    options.tab.availability === "action" &&
    "experimental_global" in options &&
    options.experimental_global === true
  );
}

export function withGlobalPlacement(
  pluginId: string,
  options: ExperimentalOpenTabOptions,
): ExperimentalOpenTabOptions {
  if (opensInGlobal(options)) placePluginTabInGlobal(pluginId, options);
  return options;
}

export function placePluginTabInGlobal(
  pluginId: string,
  options: Extract<
    ExperimentalOpenTabOptions,
    { experimental_global?: boolean }
  >,
): void {
  const registration = getPluginSlotSnapshot().tabs.find(
    (slot) =>
      slot.pluginId === pluginId &&
      slot.id === options.tab.id &&
      slot.availability === "action",
  );
  if (registration === undefined || registration.availability !== "action") {
    return;
  }
  let paramsJson: string | null;
  try {
    paramsJson = serializePluginPanelParams(
      options.params === undefined ? registration.params : options.params,
    );
  } catch {
    return;
  }
  const tab = createPluginPanelFixedPanelTab({
    pluginId,
    actionId: options.tab.id,
    paramsJson,
    title: options.title ?? registration.title,
  });
  const store = getDefaultStore();
  const globalTabs = store.get(globalPanelTabsAtom);
  if (globalTabs.some((candidate) => candidate.id === tab.id)) return;
  store.set(globalPanelTabsAtom, [...globalTabs, tab]);
}

export function closePluginFixedTab(
  pluginId: string,
  options: { tabId: string; params?: JsonValue },
): boolean {
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
  const store = getDefaultStore();
  const globalTabs = store.get(globalPanelTabsAtom);
  const kept = globalTabs.filter(
    (tab) =>
      tab.pluginId !== pluginId ||
      tab.actionId !== options.tabId ||
      tab.paramsJson !== paramsJson,
  );
  if (kept.length === globalTabs.length) return false;
  const keptIds = new Set(kept.map((tab) => tab.id));
  const closedIds = new Set(
    globalTabs.filter((tab) => !keptIds.has(tab.id)).map((tab) => tab.id),
  );
  store.set(globalPanelTabsAtom, kept);
  const selections = store.get(globalPanelTabSelectionsAtom);
  const keptSelections = Object.fromEntries(
    Object.entries(selections).filter(
      ([, selection]) => !closedIds.has(selection.tabId),
    ),
  );
  if (Object.keys(keptSelections).length !== Object.keys(selections).length) {
    store.set(globalPanelTabSelectionsAtom, keptSelections);
  }
  return true;
}

export function usePluginGlobalTabs(): readonly ExperimentalGlobalTab[] {
  const globalTabs = useAtomValue(globalPanelTabsAtom);
  return useMemo(
    () =>
      globalTabs.map((tab) => ({
        pluginId: tab.pluginId,
        tabId: tab.actionId,
        title: tab.title,
        params: parsePersistedPluginPanelParams(tab.paramsJson),
      })),
    [globalTabs],
  );
}
