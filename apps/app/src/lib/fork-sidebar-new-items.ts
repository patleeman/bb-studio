import { useMemo } from "react";
import type { ExperimentalSidebarNewItem } from "@get-bb/plugin-sdk";
import { usePluginSlots } from "./plugin-slots";

export function usePluginSidebarNewItems(): readonly ExperimentalSidebarNewItem[] {
  const { sidebarNewItems } = usePluginSlots();
  return useMemo(
    () =>
      sidebarNewItems.map((slot) => ({
        key: `${slot.pluginId}/${slot.id}`,
        pluginId: slot.pluginId,
        id: slot.id,
        title: slot.title,
        icon: slot.icon,
        group: slot.group ?? null,
        run: slot.run,
      })),
    [sidebarNewItems],
  );
}
