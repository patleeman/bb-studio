import type { createStore } from "jotai";
import type {
  ExperimentalPanelTab,
  ExperimentalPanelTabs,
  ExperimentalWorkbench,
  ExperimentalWorkbenchArrangement,
  ExperimentalWorkbenchLayout,
  ExperimentalWorkbenchOpenOptions,
  ExperimentalWorkbenchOpenSpec,
  ExperimentalWorkbenchPane,
} from "@get-bb/plugin-sdk";
import type { TerminalSession } from "@bb/server-contract";
import { GIT_PLUGIN_ID } from "@bb/domain";
import { GIT_DIFF_TAB_ID } from "bb-plugin-bb--git/contract";
import {
  getThreadConversationCollapsedAtom,
  getThreadSecondaryPanelWidthPercentAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  workbenchSplitsFor,
  type WorkbenchSplitPane,
  type WorkbenchSplits,
} from "@/components/secondary-panel/workbenchSplits.fork";
import type { AppPanelController } from "./app-fixed-tab-navigation";
import type { AppFilePreviewIntent } from "./app-navigation-host";
import { isDesktopBrowserAvailable } from "./bb-desktop";
import { GIT_DIFF_TAB_REFERENCE } from "./git-diff-tab";
import { normalizeExperimentalFilePreviewOptions } from "./live-file-navigation";
import { createPluginPanelController } from "./plugin-panel-controller";
import { getPluginSlotSnapshot, isThreadTab } from "./plugin-slots";
import { popOutWorkbenchTab } from "./fork-tab-popout";
import { BbHttpError, sdk } from "./sdk";

type JotaiStore = ReturnType<typeof createStore>;

export interface WorkbenchSurface {
  threadId: string;
  panelStateId: string;
  panel: AppPanelController;
  openFilePreview(intent: AppFilePreviewIntent): boolean;
  openTerminal(session: TerminalSession): boolean;
  openInAppBrowser: ((url: string) => void) | null;
  store: JotaiStore;
}

export const WORKBENCH_OPEN_TIMEOUT_MS = 3000;
export const WORKBENCH_MIN_WIDTH_PERCENT = 20;
export const WORKBENCH_MAX_WIDTH_PERCENT = 80;

const PANEL_TAB_GROUP_SELECTOR =
  '[data-sidebar-split-tab-group], [data-testid="secondary-panel-tab-strip"], [data-testid="thread-secondary-panel-top-chrome"]';
const PANEL_DRAWER_SELECTOR = '[data-testid="secondary-panel-shelf"]';

const surfaces: (() => WorkbenchSurface | null)[] = [];

export function registerWorkbenchSurface(
  read: () => WorkbenchSurface | null,
): () => void {
  surfaces.push(read);
  return () => {
    const index = surfaces.lastIndexOf(read);
    if (index !== -1) surfaces.splice(index, 1);
  };
}

export function resetWorkbenchSurfacesForTest(): void {
  surfaces.length = 0;
}

export function findSurface(
  threadId: string | undefined,
): WorkbenchSurface | null {
  for (let index = surfaces.length - 1; index >= 0; index -= 1) {
    const surface = surfaces[index]?.() ?? null;
    if (
      surface !== null &&
      (threadId === undefined || surface.threadId === threadId)
    ) {
      return surface;
    }
  }
  return null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function samePath(tabPath: string, wanted: string): boolean {
  const trim = (path: string) => path.replace(/^\.?\/+/u, "");
  const left = trim(tabPath);
  const right = trim(wanted);
  return (
    left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
  );
}

export function workbenchTabOwner(
  callerPluginId: string,
  spec: ExperimentalWorkbenchOpenSpec,
): string | null {
  if (spec.kind !== "tab") return callerPluginId;
  const owner = spec.tab.pluginId ?? callerPluginId;
  if (owner === callerPluginId) return owner;
  if (typeof owner !== "string" || owner === "") return null;
  const openable = getPluginSlotSnapshot().tabs.some(
    (tab) =>
      tab.pluginId === owner &&
      tab.id === spec.tab.id &&
      isThreadTab(tab) &&
      tab.availability === "action" &&
      tab.experimental_openableByPlugins === true,
  );
  return openable ? owner : null;
}

function tabMatcher(
  pluginId: string,
  spec: ExperimentalWorkbenchOpenSpec,
  keysBefore: ReadonlySet<string>,
): (tab: ExperimentalPanelTab) => boolean {
  return ({ key, detail }) => {
    switch (spec.kind) {
      case "tab":
        return (
          detail.kind === "plugin" &&
          detail.pluginId === pluginId &&
          detail.tab.id === spec.tab.id &&
          sameJson(detail.params, spec.params)
        );
      case "file":
        return (
          detail.kind === "file" && samePath(detail.path, spec.target.path)
        );
      case "diff":
        return (
          detail.kind === "plugin" &&
          detail.pluginId === GIT_PLUGIN_ID &&
          detail.tab.id === GIT_DIFF_TAB_ID
        );
      case "url":
        return (
          detail.kind === "browser" &&
          (detail.url === spec.url || !keysBefore.has(key))
        );
      case "terminal":
        return (
          detail.kind === "terminal" && detail.terminalId === spec.terminalId
        );
    }
  };
}

export function waitForSelectedTab(
  panel: Pick<AppPanelController, "getTabs" | "subscribeTabs">,
  match: (tab: ExperimentalPanelTab) => boolean,
  timeoutMs = WORKBENCH_OPEN_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (key: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(key);
    };
    const check = () => {
      const { selectedKey, tabs } = panel.getTabs();
      const selected = tabs.find((tab) => tab.key === selectedKey);
      if (selected !== undefined && match(selected)) finish(selected.key);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    unsubscribe = panel.subscribeTabs(check);
    check();
  });
}

async function startOpen(
  pluginId: string,
  surface: WorkbenchSurface,
  spec: ExperimentalWorkbenchOpenSpec,
): Promise<boolean> {
  switch (spec.kind) {
    case "tab":
      return createPluginPanelController(pluginId, () => surface.panel).openTab(
        {
          tab: {
            id: spec.tab.id,
            context: { kind: "thread" },
            availability: "action",
          },
          ...(spec.params === undefined ? {} : { params: spec.params }),
          ...(spec.title === undefined ? {} : { title: spec.title }),
        },
      );
    case "file": {
      const normalized = normalizeExperimentalFilePreviewOptions({
        target: spec.target,
        location: spec.location ?? null,
      });
      return normalized !== null && surface.openFilePreview(normalized.options);
    }
    case "diff":
      return (
        spec.path.length > 0 &&
        surface.panel.openTab({
          tab: GIT_DIFF_TAB_REFERENCE,
          availability: "fixed",
          target: { kind: "file", path: spec.path },
        })
      );
    case "url":
      if (
        surface.openInAppBrowser === null ||
        !isDesktopBrowserAvailable() ||
        !isHttpUrl(spec.url)
      ) {
        return false;
      }
      surface.openInAppBrowser(spec.url);
      return true;
    case "terminal": {
      const session = await sdk.terminals
        .get({ terminalId: spec.terminalId })
        .catch((error: unknown) => {
          if (error instanceof BbHttpError && error.status === 404) return null;
          throw error;
        });
      return session !== null && surface.openTerminal(session);
    }
  }
}

function isEditable(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) {
    return (
      !element.readOnly &&
      ![
        "button",
        "checkbox",
        "radio",
        "submit",
        "reset",
        "range",
        "color",
        "file",
        "image",
      ].includes(element.type)
    );
  }
  if (element instanceof HTMLSelectElement) return true;
  if (element.tagName === "IFRAME" || element.tagName === "WEBVIEW")
    return true;
  if (!(element instanceof HTMLElement)) return false;
  const editable = element.getAttribute("contenteditable");
  return (
    element.isContentEditable || (editable !== null && editable !== "false")
  );
}

export function isTypingInSidePanel(doc: Document = document): boolean {
  const active = doc.activeElement;
  if (active === null || active === doc.body || !doc.hasFocus()) return false;
  if (!isEditable(active)) return false;
  if (active.closest(PANEL_DRAWER_SELECTOR) !== null) return true;
  return (
    active.closest("aside")?.querySelector(PANEL_TAB_GROUP_SELECTOR) != null
  );
}

function paneTabs(
  pane: WorkbenchSplitPane,
  tabs: ExperimentalPanelTabs,
): string[] {
  const closable = new Map(tabs.tabs.map((tab) => [tab.key, tab.closable]));
  const keys = pane.tabIds.filter((key) => closable.has(key));
  return [
    ...keys.filter((key) => closable.get(key) === false),
    ...keys.filter((key) => closable.get(key) === true),
  ];
}

export function readWorkbenchPanes(
  splits: WorkbenchSplits | null,
  tabs: ExperimentalPanelTabs,
): ExperimentalWorkbenchPane[] {
  if (splits === null) {
    return [{ tabs: tabs.tabs.map((tab) => tab.key), widthPercent: 100 }];
  }
  return splits.panes().map((pane) => ({
    tabs: paneTabs(pane, tabs),
    widthPercent: pane.widthPercent,
  }));
}

function readLayout(surface: WorkbenchSurface): ExperimentalWorkbenchLayout {
  const tabs = surface.panel.getTabs();
  return {
    panes: readWorkbenchPanes(workbenchSplitsFor(surface.panelStateId), tabs),
    panel: tabs.open ? "open" : "closed",
    widthPercent: surface.store.get(
      getThreadSecondaryPanelWidthPercentAtom(surface.threadId),
    ),
    conversation: surface.store.get(
      getThreadConversationCollapsedAtom(surface.threadId),
    )
      ? "collapsed"
      : "shown",
  };
}

function isPaneWidths(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (width) =>
        typeof width === "number" && Number.isFinite(width) && width > 0,
    )
  );
}

function arrangePanes(
  splits: WorkbenchSplits | null,
  panes: 1 | 2 | undefined,
  paneWidths: [number, number] | undefined,
): boolean {
  const count = splits === null ? 1 : splits.panes().length;
  const target = panes ?? (count === 2 ? 2 : 1);
  if (paneWidths !== undefined && target !== 2) return false;
  if (target !== count && (splits === null || !splits.setPaneCount(target))) {
    return false;
  }
  return paneWidths === undefined || splits?.setPaneWidths(paneWidths) === true;
}

function arrange(
  surface: WorkbenchSurface,
  layout: ExperimentalWorkbenchArrangement,
): boolean {
  const { panel, widthPercent, conversation, panes, paneWidths } = layout;
  if (
    (widthPercent !== undefined && !Number.isFinite(widthPercent)) ||
    (panel !== undefined && panel !== "open" && panel !== "closed") ||
    (conversation !== undefined &&
      conversation !== "shown" &&
      conversation !== "collapsed") ||
    (panes !== undefined && panes !== 1 && panes !== 2) ||
    (paneWidths !== undefined && !isPaneWidths(paneWidths))
  ) {
    return false;
  }
  if (
    (panes !== undefined || paneWidths !== undefined) &&
    !arrangePanes(workbenchSplitsFor(surface.panelStateId), panes, paneWidths)
  ) {
    return false;
  }
  if (widthPercent !== undefined) {
    surface.store.set(
      getThreadSecondaryPanelWidthPercentAtom(surface.threadId),
      Math.min(
        WORKBENCH_MAX_WIDTH_PERCENT,
        Math.max(WORKBENCH_MIN_WIDTH_PERCENT, widthPercent),
      ),
    );
  }
  if (conversation !== undefined) {
    surface.store.set(
      getThreadConversationCollapsedAtom(surface.threadId),
      conversation === "collapsed",
    );
  }
  if (panel === "closed") return surface.panel.close();
  if (panel === "open") {
    const { open, selectedKey, tabs } = surface.panel.getTabs();
    if (open) return true;
    const key = selectedKey ?? tabs[0]?.key;
    return key !== undefined && surface.panel.selectTab(key);
  }
  return true;
}

type OpenPlacement = {
  pane: 1 | 2 | "new" | undefined;
  index: number | undefined;
};

function readOpenPlacement(
  options: ExperimentalWorkbenchOpenOptions | undefined,
): OpenPlacement | null {
  const pane = options?.pane;
  const index = options?.index;
  if (pane !== undefined && pane !== 1 && pane !== 2 && pane !== "new") {
    return null;
  }
  if (index !== undefined && !(Number.isInteger(index) && index >= 0)) {
    return null;
  }
  return { pane, index };
}

function placementFits(
  splits: WorkbenchSplits | null,
  { pane }: OpenPlacement,
): boolean {
  const count = splits === null ? 1 : splits.panes().length;
  return pane === "new" ? count === 1 : pane !== 2 || count === 2;
}

async function placeOpenedTab(
  splits: WorkbenchSplits,
  tabs: ExperimentalPanelTabs,
  key: string,
  { pane, index }: OpenPlacement,
): Promise<void> {
  if (pane === "new") {
    await splits.place(key, { pane });
    return;
  }
  const panes = splits.panes();
  const found = panes.findIndex((candidate) => candidate.tabIds.includes(key));
  const target = pane ?? (found === 0 ? 1 : found === 1 ? 2 : null);
  if (target === null) return;
  const targetPane = panes[target - 1];
  if (index === undefined || targetPane === undefined) {
    await splits.place(key, { pane: target });
    return;
  }
  const order = paneTabs(targetPane, tabs).filter((tabKey) => tabKey !== key);
  await splits.place(key, { pane: target, before: order[index] ?? null });
}

export function workbenchFor(
  pluginId: string,
  threadId: string | undefined,
): ExperimentalWorkbench | null {
  const found = findSurface(threadId);
  if (found === null) return null;
  const current = () => findSurface(found.threadId) ?? found;
  return {
    threadId: found.threadId,
    list: () => current().panel.getTabs(),
    async open(spec, options) {
      const surface = current();
      const placement = readOpenPlacement(options);
      const splits = workbenchSplitsFor(surface.panelStateId);
      const owner = workbenchTabOwner(pluginId, spec);
      if (
        owner === null ||
        placement === null ||
        !placementFits(splits, placement)
      ) {
        return null;
      }
      const before = surface.panel.getTabs();
      const keysBefore = new Set(before.tabs.map((tab) => tab.key));
      if (!(await startOpen(owner, surface, spec).catch(() => false))) {
        return null;
      }
      const key = await waitForSelectedTab(
        surface.panel,
        tabMatcher(owner, spec, keysBefore),
      );
      if (
        key !== null &&
        splits !== null &&
        (placement.pane !== undefined || placement.index !== undefined)
      ) {
        await placeOpenedTab(splits, surface.panel.getTabs(), key, placement);
      }
      if (key === null || options?.focus !== false) return key;
      if (!before.open) {
        surface.panel.close();
      } else if (before.selectedKey !== null && before.selectedKey !== key) {
        surface.panel.selectTab(before.selectedKey);
      }
      return key;
    },
    close: (key) => current().panel.closeTab(key),
    focus: (key) => current().panel.selectTab(key),
    layout: () => readLayout(current()),
    arrange: (layout) => arrange(current(), layout),
    isTyping: () => isTypingInSidePanel(),
    popOut: (key) => popOutWorkbenchTab(current(), key),
  };
}
