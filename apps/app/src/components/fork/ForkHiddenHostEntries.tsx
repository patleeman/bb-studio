import type {
  ExperimentalHostPage,
  ExperimentalHostSetting,
} from "@get-bb/plugin-sdk/app";
import { useMemo, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { getPluginNavPanelKey } from "@/components/plugin/pluginNavSidebarOrder";
import type { SidebarNavigationRow } from "@/components/sidebar/sidebarNavigationItems";
import { usePluginSlots } from "@/lib/plugin-slots";

interface HiddenHostEntries {
  navigation: ReadonlySet<string>;
  pages: ReadonlySet<string>;
  settings: ReadonlySet<string>;
}

export function useForkHiddenHostEntries(): HiddenHostEntries {
  const registrations = usePluginSlots().hiddenHostEntries;
  return useMemo(() => {
    const entries = registrations ?? [];
    return {
      navigation: new Set(entries.flatMap((entry) => entry.navigation ?? [])),
      pages: new Set(entries.flatMap((entry) => entry.pages ?? [])),
      settings: new Set(entries.flatMap((entry) => entry.settings ?? [])),
    };
  }, [registrations]);
}

export function useForkVisibleNavigationRows(
  rows: SidebarNavigationRow[],
): SidebarNavigationRow[] {
  const { navigation } = useForkHiddenHostEntries();
  return useMemo(
    () =>
      navigation.size === 0
        ? rows
        : rows.filter((row) => !navigation.has(getPluginNavPanelKey(row))),
    [navigation, rows],
  );
}

export function useForkHostPageHidden(page: ExperimentalHostPage): boolean {
  return useForkHiddenHostEntries().pages.has(page);
}

export function useForkHostSettingHidden(
  setting: ExperimentalHostSetting,
): boolean {
  return useForkHiddenHostEntries().settings.has(setting);
}

export function useForkHiddenHostPage(
  page: ExperimentalHostPage,
): ReactElement | null {
  return useForkHostPageHidden(page) ? <Navigate to="/" replace /> : null;
}
