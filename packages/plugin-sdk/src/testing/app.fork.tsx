import { createElement } from "react";
import type {
  ExperimentalAppBackdropRegistration,
  ExperimentalAppCommand,
  ExperimentalCloseFallbackRegistration,
  ExperimentalCommandPaletteRegistration,
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
  ExperimentalNewTabItemsRegistration,
  ExperimentalThreadBannerRegistration,
  ExperimentalModelLoadNoticeRegistration,
  ExperimentalThreadHeaderRegistration,
  ExperimentalReplyClassifierRegistration,
  ExperimentalSidebarNewItem,
  ExperimentalSidebarNewItemRegistration,
  ExperimentalSidebarSectionRegistration,
  ExperimentalSkillSourceRegistration,
  ExperimentalTabWindow,
  ExperimentalWindowRegistration,
  ExperimentalWorkbench,
  ExperimentalWorkbenchArrangement,
  ExperimentalWorkbenchLayout,
  ExperimentalWorkbenchOpenSpec,
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
  | { method: "experimental_workbench"; threadId?: string }
  | {
      method: "experimental_workbench.open";
      threadId: string;
      spec: ExperimentalWorkbenchOpenSpec;
      focus: boolean;
      pane?: 1 | 2 | "new";
      index?: number;
    }
  | { method: "experimental_workbench.close"; threadId: string; key: string }
  | { method: "experimental_workbench.focus"; threadId: string; key: string }
  | { method: "experimental_workbench.popOut"; threadId: string; key: string }
  | {
      method: "experimental_workbench.arrange";
      threadId: string;
      layout: ExperimentalWorkbenchArrangement;
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
  appCommands: readonly ExperimentalAppCommand[];
  tabWindow: ExperimentalTabWindow | null;
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
  modelLoadNotices: ExperimentalModelLoadNoticeRegistration[];
  threadHeaders: ExperimentalThreadHeaderRegistration[];
  forkMessageActions: ExperimentalMessageActionRegistration[];
  panelTabActions: ExperimentalPanelTabActionRegistration[];
  launcherItems: ExperimentalLauncherItemRegistration[];
  itemDrops: ExperimentalItemDropRegistration[];
  closeFallbacks: ExperimentalCloseFallbackRegistration[];
  skillSources: ExperimentalSkillSourceRegistration[];
  newTabItems: ExperimentalNewTabItemsRegistration[];
  commandPalettes: ExperimentalCommandPaletteRegistration[];
  appBackdrops: ExperimentalAppBackdropRegistration[];
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
  /** `experimental_useAppCommands()` value; defaults to none. */
  appCommands?: readonly ExperimentalAppCommand[];
  /** `experimental_useTabWindow()` value; defaults to null (not in a tab's own window). */
  tabWindow?: ExperimentalTabWindow | null;
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
    experimental_useAppCommands() {
      return useSlotEnv("experimental_useAppCommands").appCommands;
    },
    experimental_useTabWindow() {
      return useSlotEnv("experimental_useTabWindow").tabWindow;
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

const TEST_WORKBENCH_THREAD_ID = "thr_test";

function recordingWorkbench(
  threadId: string,
  record: (call: ForkNavigateCall) => void,
): ExperimentalWorkbench {
  let layout: ExperimentalWorkbenchLayout = {
    panel: "closed",
    widthPercent: 50,
    conversation: "shown",
    panes: [{ tabs: [], widthPercent: 100 }],
  };
  return {
    threadId,
    list: () => ({
      open: layout.panel === "open",
      selectedKey: null,
      tabs: [],
    }),
    open(spec, options) {
      record({
        method: "experimental_workbench.open",
        threadId,
        spec,
        focus: options?.focus ?? true,
        ...(options?.pane === undefined ? {} : { pane: options.pane }),
        ...(options?.index === undefined ? {} : { index: options.index }),
      });
      return Promise.resolve(null);
    },
    close(key) {
      record({ method: "experimental_workbench.close", threadId, key });
      return false;
    },
    focus(key) {
      record({ method: "experimental_workbench.focus", threadId, key });
      return false;
    },
    layout: () => layout,
    arrange(next) {
      record({
        method: "experimental_workbench.arrange",
        threadId,
        layout: next,
      });
      const { panes, paneWidths, ...rest } = next;
      const count = panes ?? layout.panes.length;
      if (paneWidths !== undefined && count !== 2) return false;
      const [left, right] = paneWidths ?? [1, 1];
      layout = {
        ...layout,
        ...rest,
        panes:
          count === 1
            ? [{ tabs: [], widthPercent: 100 }]
            : paneWidths === undefined && layout.panes.length === 2
              ? layout.panes
              : [
                  { tabs: [], widthPercent: (100 * left) / (left + right) },
                  { tabs: [], widthPercent: (100 * right) / (left + right) },
                ],
      };
      return true;
    },
    isTyping: () => false,
    popOut(key) {
      record({ method: "experimental_workbench.popOut", threadId, key });
      return Promise.resolve(false);
    },
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
    experimental_workbench(threadId) {
      record({
        method: "experimental_workbench",
        ...(threadId === undefined ? {} : { threadId }),
      });
      return recordingWorkbench(threadId ?? TEST_WORKBENCH_THREAD_ID, record);
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
    appCommands: options.appCommands ?? [],
    tabWindow: options.tabWindow ?? null,
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
