import { createElement } from "react";
import type {
  ExperimentalCloseFallbackRegistration,
  ExperimentalContextCardRowRegistration,
  ExperimentalDragItem,
  ExperimentalItemDropRegistration,
  ExperimentalAppPane,
  ExperimentalAppPanes,
  ExperimentalAppRoute,
  ExperimentalAppTheme,
  ExperimentalGlobalTab,
  ExperimentalLinkHandlerRegistration,
  ExperimentalPaletteSearchRegistration,
  ExperimentalPanelTabActionRegistration,
  ExperimentalLauncherItem,
  ExperimentalLauncherItemRegistration,
  ExperimentalMainHeaderRegistration,
  ExperimentalMessageActionRegistration,
  ExperimentalThreadBannerRegistration,
  ExperimentalThreadHeaderRegistration,
  ExperimentalReplyClassifierRegistration,
  ExperimentalSidebarNewItem,
  ExperimentalSidebarNewItemRegistration,
  ExperimentalSidebarSectionRegistration,
  ExperimentalSkillSourceRegistration,
  ExperimentalWindowRegistration,
  ForkBbNavigate,
  ForkPluginSdkApp,
} from "../app-contract.fork.js";
import type { JsonValue } from "../json-value.js";

export type ForkNavigateCall =
  | {
      method: "experimental_toAppPath";
      path: string;
      options?: { replace?: boolean; split?: boolean };
    }
  | {
      method: "experimental_renameTab";
      tabId: string;
      title: string;
      params?: JsonValue;
    }
  | {
      method: "experimental_closeFixedTab";
      tabId: string;
      params?: JsonValue;
    }
  | {
      method: "experimental_popOut";
      path: string;
      title?: string;
      width?: number;
      height?: number;
    }
  | { method: "experimental_useAppPanes.focus"; paneId: string }
  | { method: "experimental_useAppPanes.close"; paneId: string };

export interface ForkSlotEnv {
  appRoute: ExperimentalAppRoute;
  appPanes: ExperimentalAppPanes;
  appTheme: ExperimentalAppTheme;
  globalTabs: readonly ExperimentalGlobalTab[];
  sidebarNewItems: readonly ExperimentalSidebarNewItem[];
  launcherItems: readonly ExperimentalLauncherItem[];
}

export interface ForkCapturedPluginApp {
  paletteSearches: ExperimentalPaletteSearchRegistration[];
  sidebarSections: ExperimentalSidebarSectionRegistration[];
  sidebarNewItems: ExperimentalSidebarNewItemRegistration[];
  replyClassifiers: ExperimentalReplyClassifierRegistration[];
  linkHandlers: ExperimentalLinkHandlerRegistration[];
  windows: ExperimentalWindowRegistration[];
  contextCardRows: ExperimentalContextCardRowRegistration[];
  mainHeaders: ExperimentalMainHeaderRegistration[];
  threadBanners: ExperimentalThreadBannerRegistration[];
  threadHeaders: ExperimentalThreadHeaderRegistration[];
  forkMessageActions: ExperimentalMessageActionRegistration[];
  panelTabActions: ExperimentalPanelTabActionRegistration[];
  launcherItems: ExperimentalLauncherItemRegistration[];
  itemDrops: ExperimentalItemDropRegistration[];
  closeFallbacks: ExperimentalCloseFallbackRegistration[];
  skillSources: ExperimentalSkillSourceRegistration[];
}

export interface ForkRenderSlotOptions {
  /** `experimental_useAppRoute()` value; defaults to `/` with no query or hash. */
  appRoute?: Partial<ExperimentalAppRoute>;
  /**
   * `experimental_useAppPanes().panes`; defaults to none. `focus` and
   * `close` are recorded in `navigateCalls` and return whether the pane is
   * listed; the list itself does not change.
   */
  appPanes?: readonly ExperimentalAppPane[];
  /** `experimental_useAppTheme()` value; defaults to light, epoch 0. */
  appTheme?: Partial<ExperimentalAppTheme>;
  /** `experimental_useGlobalTabs()` value; defaults to none. */
  globalTabs?: readonly ExperimentalGlobalTab[];
  /** `experimental_useSidebarNewItems()` value; defaults to none. */
  sidebarNewItems?: readonly ExperimentalSidebarNewItem[];
  /** `experimental_useLauncherItems()` value; defaults to none. */
  launcherItems?: readonly ExperimentalLauncherItem[];
}

const TEST_ITEM_DRAG_TYPE = "application/x-bb-item";

export function forkTestHooks(
  useSlotEnv: (hook: string) => ForkSlotEnv,
): ForkPluginSdkApp {
  return {
    experimental_useAppRoute() {
      return useSlotEnv("experimental_useAppRoute").appRoute;
    },
    experimental_useSidebarNewItems() {
      return useSlotEnv("experimental_useSidebarNewItems").sidebarNewItems;
    },
    experimental_useGlobalTabs() {
      return useSlotEnv("experimental_useGlobalTabs").globalTabs;
    },
    experimental_useAppTheme() {
      return useSlotEnv("experimental_useAppTheme").appTheme;
    },
    experimental_useAppPanes() {
      return useSlotEnv("experimental_useAppPanes").appPanes;
    },
    experimental_writeDragItem(dataTransfer, item) {
      dataTransfer.setData(TEST_ITEM_DRAG_TYPE, JSON.stringify(item));
    },
    experimental_readDragItem(dataTransfer) {
      const raw = dataTransfer.getData(TEST_ITEM_DRAG_TYPE);
      if (raw === "") return null;
      try {
        return JSON.parse(raw) as ExperimentalDragItem;
      } catch {
        return null;
      }
    },
    experimental_useContextCard: () => ({ available: false, open: () => {} }),
    experimental_useLauncherItems() {
      return useSlotEnv("experimental_useLauncherItems").launcherItems;
    },
    experimental_useWindows: () => ({
      native: false,
      register: () => Promise.resolve(false),
      open: () => Promise.resolve(false),
      toggle: () => Promise.resolve(false),
      close: () => Promise.resolve(false),
      hotkeyRegistered: () => Promise.resolve(false),
      setClickThrough: () => Promise.resolve(false),
    }),
    experimental_ProjectActionsMenu: ({ projectId }) =>
      createElement("button", {
        type: "button",
        "data-test-project-actions": projectId,
        "aria-label": "Project actions",
      }),
    experimental_ProjectActionsContextMenu: ({ projectId, children }) =>
      createElement(
        "div",
        { "data-test-project-context-menu": projectId },
        children,
      ),
  };
}

export function forkNavigate(
  record: (call: ForkNavigateCall) => void,
): ForkBbNavigate {
  return {
    experimental_toAppPath(path, pathOptions) {
      record({
        method: "experimental_toAppPath",
        path,
        ...(pathOptions !== undefined ? { options: pathOptions } : {}),
      });
      return path.startsWith("/") && !path.startsWith("//");
    },
    experimental_renameTab(options) {
      record({
        method: "experimental_renameTab",
        tabId: options.tab.id,
        title: options.title,
        ...(options.params === undefined ? {} : { params: options.params }),
      });
      return true;
    },
    experimental_closeFixedTab(options) {
      record({
        method: "experimental_closeFixedTab",
        tabId: options.tab.id,
        ...(options.params === undefined ? {} : { params: options.params }),
      });
      return true;
    },
    experimental_popOut(options) {
      record({ method: "experimental_popOut", ...options });
      return Promise.resolve(
        options.path.startsWith("/") && !options.path.startsWith("//"),
      );
    },
  };
}

export function forkSlotEnv(
  options: ForkRenderSlotOptions,
  record: (call: ForkNavigateCall) => void,
): ForkSlotEnv {
  const panes = options.appPanes ?? [];
  return {
    appRoute: { pathname: "/", search: "", hash: "", ...options.appRoute },
    appTheme: { mode: "light", epoch: 0, ...options.appTheme },
    globalTabs: options.globalTabs ?? [],
    sidebarNewItems: options.sidebarNewItems ?? [],
    launcherItems: options.launcherItems ?? [],
    appPanes: {
      panes,
      focus(paneId) {
        record({ method: "experimental_useAppPanes.focus", paneId });
        return panes.some((pane) => pane.id === paneId);
      },
      close(paneId) {
        record({ method: "experimental_useAppPanes.close", paneId });
        return panes.some((pane) => pane.id === paneId);
      },
    },
  };
}
