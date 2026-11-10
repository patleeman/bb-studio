import { atom, type SetStateAction, type WritableAtom } from "jotai";
import { createSyncedPreferenceAtom } from "./ui-preferences/synced-preference-atom";
import { atomFamily } from "jotai-family";
import { atomWithStorage } from "jotai/utils";
import { isSecondaryFileTab } from "@bb/client-core";
import { createLocalStorageSyncStorage } from "./browser-storage";
import type {
  FixedPanelTab,
  FixedPanelTabsState,
} from "./fixed-panel-tabs-state";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
  type PluginSlotSnapshot,
} from "./plugin-slots";

export const GLOBAL_PANEL_TABS_STORAGE_KEY = "bb.globalPanelTabs.v1";
const PLUGIN_PAGE_STATE_PREFIX = "plugin-panel:";
const ROOT_COMPOSE_STATE_ID = "root-compose";
const PLUGINS_BROWSE_STATE_ID = "plugins-browse";

export function threadIdOfPanelState(panelStateId: string): string | null {
  return panelStateId === ROOT_COMPOSE_STATE_ID ||
    panelStateId === PLUGINS_BROWSE_STATE_ID ||
    panelStateId.startsWith(PLUGIN_PAGE_STATE_PREFIX)
    ? null
    : panelStateId;
}

export type GlobalPanelTab = Extract<FixedPanelTab, { kind: "plugin-panel" }>;

export function canBeGlobalPanelTab(tab: FixedPanelTab): tab is GlobalPanelTab {
  return tab.kind === "plugin-panel";
}

function parseGlobalPanelTabs(storedValue: string | null): GlobalPanelTab[] {
  if (storedValue === null) return [];
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) return [];
    const tabs: GlobalPanelTab[] = [];
    const seen = new Set<string>();
    for (const value of parsed as readonly unknown[]) {
      if (typeof value !== "object" || value === null) continue;
      const { id, actionId, pluginId, title, paramsJson } = value as Record<
        string,
        unknown
      >;
      if (
        typeof id !== "string" ||
        typeof actionId !== "string" ||
        typeof pluginId !== "string" ||
        typeof title !== "string" ||
        (paramsJson !== null && typeof paramsJson !== "string") ||
        seen.has(id)
      ) {
        continue;
      }
      seen.add(id);
      tabs.push({
        id,
        actionId,
        pluginId,
        title,
        paramsJson,
        kind: "plugin-panel",
      });
    }
    return tabs;
  } catch {
    return [];
  }
}

const EMPTY_GLOBAL_PANEL_TABS: readonly GlobalPanelTab[] = [];

const GLOBAL_TAB_ITEM_MAX_LENGTH = 1_024;

function readLastKnownGlobalTabs(): string[] | null {
  try {
    const stored = globalThis.localStorage?.getItem(
      GLOBAL_PANEL_TABS_STORAGE_KEY,
    );
    return stored === null || stored === undefined
      ? null
      : serializeGlobalPanelTabs(parseGlobalPanelTabs(stored));
  } catch {
    return null;
  }
}

function serializeGlobalPanelTabs(tabs: readonly GlobalPanelTab[]): string[] {
  return tabs
    .map((tab) => JSON.stringify(tab))
    .filter((item) => item.length <= GLOBAL_TAB_ITEM_MAX_LENGTH);
}

const syncedGlobalPanelTabsAtom = createSyncedPreferenceAtom(
  "workbench.globalTabs",
  {
    read: readLastKnownGlobalTabs,
    write: (items) => {
      try {
        globalThis.localStorage?.setItem(
          GLOBAL_PANEL_TABS_STORAGE_KEY,
          `[${items.join(",")}]`,
        );
      } catch {
        return;
      }
    },
  },
);

const parsedGlobalPanelTabsAtom = atom((get) => {
  const items = get(syncedGlobalPanelTabsAtom);
  return items.length === 0
    ? EMPTY_GLOBAL_PANEL_TABS
    : parseGlobalPanelTabs(`[${items.join(",")}]`);
});

export const globalPanelTabsAtom = atom(
  (get) => get(parsedGlobalPanelTabsAtom),
  (get, set, update: SetStateAction<readonly GlobalPanelTab[]>) => {
    const previous = get(parsedGlobalPanelTabsAtom);
    const next = typeof update === "function" ? update(previous) : update;
    set(syncedGlobalPanelTabsAtom, serializeGlobalPanelTabs(next));
  },
);

const pluginSlotsRevisionAtom = atom(0);
pluginSlotsRevisionAtom.onMount = (set) =>
  subscribePluginSlots(() => set((revision) => revision + 1));

export const globalPanelTabSlotsAtom = atom((get): PluginSlotSnapshot => {
  get(pluginSlotsRevisionAtom);
  return getPluginSlotSnapshot();
});

export type GlobalPanelTabApplies = (tab: GlobalPanelTab) => boolean;

export function globalPanelTabAppliesTo(
  panelStateId: string,
  slots: Pick<PluginSlotSnapshot, "tabs" | "navPanels">,
): GlobalPanelTabApplies {
  if (
    panelStateId === ROOT_COMPOSE_STATE_ID ||
    panelStateId === PLUGINS_BROWSE_STATE_ID
  ) {
    return () => false;
  }
  if (panelStateId.startsWith(PLUGIN_PAGE_STATE_PREFIX)) {
    const [pluginId, panelPath] = panelStateId
      .slice(PLUGIN_PAGE_STATE_PREFIX.length)
      .split(":");
    const panel = slots.navPanels.find(
      (candidate) =>
        candidate.pluginId === pluginId && candidate.path === panelPath,
    );
    if (panel === undefined) return () => false;
    return (tab) =>
      slots.tabs.some(
        (slot) =>
          slot.pluginId === tab.pluginId &&
          slot.id === tab.actionId &&
          slot.availability === "action" &&
          slot.context.kind === "nav-panel" &&
          slot.pluginId === pluginId &&
          slot.context.panelId === panel.id,
      );
  }
  return (tab) =>
    slots.tabs.some(
      (slot) =>
        slot.pluginId === tab.pluginId &&
        slot.id === tab.actionId &&
        slot.availability === "action" &&
        slot.context.kind === "thread",
    );
}

export interface GlobalPanelTabSelection {
  tabId: string;
  isOpen: boolean;
}

export type GlobalPanelTabSelections = Readonly<
  Record<string, GlobalPanelTabSelection>
>;

export const GLOBAL_PANEL_TAB_SELECTIONS_STORAGE_KEY =
  "bb.globalPanelTabs.selections.v1";

function parseSelections(storedValue: string | null): GlobalPanelTabSelections {
  if (storedValue === null) return {};
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (typeof parsed !== "object" || parsed === null) return {};
    const selections: Record<string, GlobalPanelTabSelection> = {};
    for (const [panelStateId, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const { tabId, isOpen } = value as Record<string, unknown>;
      if (typeof tabId === "string" && typeof isOpen === "boolean") {
        selections[panelStateId] = { tabId, isOpen };
      }
    }
    return selections;
  } catch {
    return {};
  }
}

const EMPTY_SELECTIONS: GlobalPanelTabSelections = {};

export const globalPanelTabSelectionsAtom =
  atomWithStorage<GlobalPanelTabSelections>(
    GLOBAL_PANEL_TAB_SELECTIONS_STORAGE_KEY,
    EMPTY_SELECTIONS,
    createLocalStorageSyncStorage<GlobalPanelTabSelections>({
      parse: (storedValue) => parseSelections(storedValue),
      serialize: (selections) => JSON.stringify(selections),
    }),
    { getOnInit: true },
  );

export function mergeGlobalPanelTabs(
  local: FixedPanelTabsState,
  globalTabs: readonly GlobalPanelTab[],
  applies: GlobalPanelTabApplies,
  selection: GlobalPanelTabSelection | null,
): FixedPanelTabsState {
  const shown = globalTabs.filter(applies);
  if (shown.length === 0) return local;
  const shownIds = new Set(shown.map((tab) => tab.id));
  const selected = selection !== null && shownIds.has(selection.tabId);
  const own = local.secondary.tabs.filter((tab) => !shownIds.has(tab.id));
  return {
    ...local,
    secondary: {
      ...local.secondary,
      tabs: [
        ...own.filter((tab) => !isSecondaryFileTab(tab)),
        ...shown,
        ...own.filter((tab) => isSecondaryFileTab(tab)),
      ],
      ...(selected
        ? { activeTabId: selection.tabId, isOpen: selection.isOpen }
        : {}),
    },
  };
}

export function splitGlobalPanelTabs(
  next: FixedPanelTabsState,
  globalTabs: readonly GlobalPanelTab[],
  applies: GlobalPanelTabApplies,
  previousLocal: FixedPanelTabsState,
): {
  local: FixedPanelTabsState;
  globalTabs: readonly GlobalPanelTab[];
  selection: GlobalPanelTabSelection | null;
} {
  const shownIds = new Set(globalTabs.filter(applies).map((tab) => tab.id));
  if (shownIds.size === 0) return { local: next, globalTabs, selection: null };
  const nextById = new Map(next.secondary.tabs.map((tab) => [tab.id, tab]));
  let changed = false;
  const nextGlobal = globalTabs.flatMap((tab) => {
    if (!shownIds.has(tab.id)) return [tab];
    const updated = nextById.get(tab.id);
    if (updated === undefined || !canBeGlobalPanelTab(updated)) return [tab];
    if (updated === tab) return [tab];
    if (JSON.stringify(updated) === JSON.stringify(tab)) return [tab];
    changed = true;
    return [updated];
  });
  const activeTabId = next.secondary.activeTabId;
  const globalIsActive =
    activeTabId !== null &&
    shownIds.has(activeTabId) &&
    nextById.has(activeTabId);
  const localTabs = next.secondary.tabs.filter((tab) => !shownIds.has(tab.id));
  const previousActiveTabId = previousLocal.secondary.activeTabId;
  return {
    local: {
      ...next,
      secondary: {
        ...next.secondary,
        tabs: localTabs,
        ...(globalIsActive
          ? {
              activeTabId: localTabs.some(
                (tab) => tab.id === previousActiveTabId,
              )
                ? previousActiveTabId
                : (localTabs.at(-1)?.id ?? null),
              isOpen: next.secondary.isOpen && localTabs.length > 0,
            }
          : {}),
      },
    },
    globalTabs: changed ? nextGlobal : globalTabs,
    selection: globalIsActive
      ? { tabId: activeTabId, isOpen: next.secondary.isOpen }
      : null,
  };
}

export function dropsSelectedGlobalPanelTab(
  next: FixedPanelTabsState,
  globalTabs: readonly GlobalPanelTab[],
  applies: GlobalPanelTabApplies,
  selection: GlobalPanelTabSelection | null,
): boolean {
  if (selection === null) return false;
  return (
    globalTabs.some((tab) => tab.id === selection.tabId && applies(tab)) &&
    !next.secondary.tabs.some((tab) => tab.id === selection.tabId)
  );
}

export const GLOBAL_PANEL_OPEN_STORAGE_KEY = "bb.globalPanelTabs.open.v1";

export const globalPanelOpenAtom = atomWithStorage<boolean>(
  GLOBAL_PANEL_OPEN_STORAGE_KEY,
  true,
  createLocalStorageSyncStorage<boolean>({
    parse: (storedValue) => storedValue !== "false",
    serialize: (isOpen) => String(isOpen),
  }),
  { getOnInit: true },
);

export function withGlobalPanelTabs(
  localFamily: (
    panelStateId: string,
  ) => WritableAtom<FixedPanelTabsState, [FixedPanelTabsState], void>,
) {
  return atomFamily((panelStateId: string) =>
    atom(
      (get) => {
        const local = get(localFamily(panelStateId));
        const globalTabs = get(globalPanelTabsAtom);
        if (globalTabs.length === 0) return local;
        const merged = mergeGlobalPanelTabs(
          local,
          globalTabs,
          globalPanelTabAppliesTo(panelStateId, get(globalPanelTabSlotsAtom)),
          get(globalPanelTabSelectionsAtom)[panelStateId] ?? null,
        );
        if (merged === local) return local;
        const isOpen = get(globalPanelOpenAtom);
        return merged.secondary.isOpen === isOpen
          ? merged
          : { ...merged, secondary: { ...merged.secondary, isOpen } };
      },
      (get, set, next: FixedPanelTabsState) => {
        const globalTabs = get(globalPanelTabsAtom);
        if (globalTabs.length === 0) {
          set(localFamily(panelStateId), next);
          return;
        }
        const applies = globalPanelTabAppliesTo(
          panelStateId,
          get(globalPanelTabSlotsAtom),
        );
        const selections = get(globalPanelTabSelectionsAtom);
        const previous = selections[panelStateId];
        if (
          dropsSelectedGlobalPanelTab(
            next,
            globalTabs,
            applies,
            previous ?? null,
          )
        ) {
          return;
        }
        const currentLocal = get(localFamily(panelStateId));
        const split = splitGlobalPanelTabs(
          next,
          globalTabs,
          applies,
          currentLocal,
        );
        if (
          globalTabs.some(applies) &&
          get(globalPanelOpenAtom) !== next.secondary.isOpen
        ) {
          set(globalPanelOpenAtom, next.secondary.isOpen);
        }
        if (JSON.stringify(split.local) !== JSON.stringify(currentLocal)) {
          set(localFamily(panelStateId), split.local);
        }
        if (split.globalTabs !== globalTabs) {
          set(globalPanelTabsAtom, split.globalTabs);
        }
        const selection =
          split.selection !== null && previous?.tabId !== split.selection.tabId
            ? { ...split.selection, isOpen: true }
            : split.selection;
        if (selection !== null && selection !== split.selection) {
          set(globalPanelOpenAtom, true);
        }
        if (
          previous?.tabId !== selection?.tabId ||
          previous?.isOpen !== selection?.isOpen
        ) {
          const { [panelStateId]: _dropped, ...rest } = selections;
          set(
            globalPanelTabSelectionsAtom,
            selection === null ? rest : { ...rest, [panelStateId]: selection },
          );
        }
      },
    ),
  );
}
