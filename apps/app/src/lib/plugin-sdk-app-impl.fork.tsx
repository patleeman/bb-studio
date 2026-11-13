import type { ForkPluginSdkApp } from "@get-bb/plugin-sdk";
import { usePluginLauncherItems } from "@/lib/fork-launcher-items";
import { usePluginContextCard } from "@/components/thread/timeline/ForkContextCard";
import { usePluginWindows } from "@/lib/fork-windows";
import { usePluginDesktopControl } from "@/lib/fork-desktop-control";
import { readDragItem, writeDragItem } from "@/lib/fork-item-drag";
import { usePluginAppCommands } from "@/components/commands/ForkCommandPalette";
import { useAppPanes } from "./fork-app-panes";
import { usePluginTabWindow } from "./fork-tab-window";
import { usePluginAppTheme } from "./fork-app-theme";
import { usePluginGlobalTabs } from "./fork-plugin-global-tabs";
import { useAppRoute } from "./plugin-navigation.fork";

export const forkPluginSdkAppImplementation = {
  experimental_useAppRoute: useAppRoute,
  experimental_useAppPanes: useAppPanes,
  experimental_useAppCommands: usePluginAppCommands,
  experimental_useAppTheme: usePluginAppTheme,
  experimental_useGlobalTabs: usePluginGlobalTabs,
  experimental_useWindows: usePluginWindows,
  experimental_useDesktopControl: usePluginDesktopControl,
  experimental_useTabWindow: usePluginTabWindow,
  experimental_useLauncherItems: usePluginLauncherItems,
  experimental_useContextCard: usePluginContextCard,
  experimental_writeDragItem: writeDragItem,
  experimental_readDragItem: readDragItem,
} satisfies ForkPluginSdkApp;
