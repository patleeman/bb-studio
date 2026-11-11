import { useMemo } from "react";
import type { ExperimentalLauncherItem } from "@get-bb/plugin-sdk";
import { usePluginSlots } from "./plugin-slots";

export function usePluginLauncherItems(): readonly ExperimentalLauncherItem[] {
  const { launcherItems } = usePluginSlots();
  return useMemo(
    () =>
      [...launcherItems]
        .sort(
          (a, b) =>
            (a.section === b.section ? 0 : a.section === "apps" ? -1 : 1) ||
            (a.order ?? Number.POSITIVE_INFINITY) -
              (b.order ?? Number.POSITIVE_INFINITY) ||
            a.pluginId.localeCompare(b.pluginId) ||
            a.id.localeCompare(b.id),
        )
        .map((slot) => ({
          key: `${slot.pluginId}/${slot.id}`,
          pluginId: slot.pluginId,
          id: slot.id,
          title: slot.title,
          icon: slot.icon,
          section: slot.section,
          keywords: slot.keywords,
          order: slot.order,
          run: slot.run,
        })),
    [launcherItems],
  );
}
