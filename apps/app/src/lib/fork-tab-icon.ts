import { parsePersistedPluginPanelParams } from "./plugin-json-value";
import { getPluginSlotSnapshot, type PluginTabSlot } from "./plugin-slots";

export function pluginTabInstanceIcon(
  tab: { pluginId: string; actionId: string; paramsJson?: string | null },
  registeredTabs?: readonly PluginTabSlot[],
): string | null {
  let tabs = registeredTabs;
  if (tabs === undefined) {
    try {
      tabs = getPluginSlotSnapshot().tabs;
    } catch {
      return null;
    }
  }
  const slot = tabs.find(
    (candidate) =>
      candidate.pluginId === tab.pluginId &&
      candidate.id === tab.actionId &&
      candidate.availability === "action" &&
      typeof candidate.experimental_instanceIcon === "function",
  );
  if (slot?.experimental_instanceIcon === undefined) return null;
  try {
    const icon = slot.experimental_instanceIcon(
      parsePersistedPluginPanelParams(tab.paramsJson ?? null),
    );
    return typeof icon === "string" && icon !== "" ? icon : null;
  } catch (error) {
    console.warn(
      `[plugin:${tab.pluginId}] tab "${tab.actionId}" instance icon failed`,
      error,
    );
    return null;
  }
}
