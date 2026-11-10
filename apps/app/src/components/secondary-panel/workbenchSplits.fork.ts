import { useLayoutEffect, useRef } from "react";
import type { SplitDropTarget } from "@/lib/split-drag";
import {
  computePaneRects,
  countPanes,
  listPanes,
  type SplitPath,
} from "@/lib/split-layout";
import {
  getSidebarGroupForPane,
  sidebarPaneGroupId,
  type SidebarSplitState,
} from "./sidebarSplitLayout";

export {
  isPointInWorkbench,
  limitWorkbenchDrop,
  restoresWorkbenchSplit,
  WORKBENCH_MAX_PANES,
  WORKBENCH_MOVE_PANE_CONTROLS,
} from "./workbenchSplitLimits.fork";

export const WORKBENCH_PLACEMENT_TIMEOUT_MS = 3000;

export interface WorkbenchSplitPane {
  paneId: string;
  tabIds: readonly string[];
  widthPercent: number;
}

export type WorkbenchPlacement =
  | { pane: 1 | 2; before?: string | null }
  | { pane: "new" };

export interface WorkbenchSplits {
  panes(): WorkbenchSplitPane[];
  moveToNewPane(tabId: string): boolean;
  moveToOtherPane(tabId: string): boolean;
  place(tabId: string, placement: WorkbenchPlacement): Promise<boolean>;
  setPaneCount(count: 1 | 2): boolean;
  setPaneWidths(widths: readonly [number, number]): boolean;
}

type CommitState = (
  update: (current: SidebarSplitState) => SidebarSplitState,
  activateFocusedTab?: boolean,
) => SidebarSplitState;

export interface WorkbenchSplitsArgs {
  panelStateId: string;
  state: SidebarSplitState;
  fixedTabIds: readonly string[];
  commitState: CommitState;
  moveTab: (
    sourcePaneId: string,
    tabId: string,
    target: SplitDropTarget,
  ) => void;
  removeSplit: (paneId: string) => void;
  resize: (path: SplitPath, childIndex: number, fraction: number) => void;
}

const registry = new Map<string, WorkbenchSplits>();

export function workbenchSplitsFor(
  panelStateId: string,
): WorkbenchSplits | null {
  return registry.get(panelStateId) ?? null;
}

function registerWorkbenchSplits(
  panelStateId: string,
  splits: WorkbenchSplits,
): () => void {
  registry.set(panelStateId, splits);
  return () => {
    if (registry.get(panelStateId) === splits) registry.delete(panelStateId);
  };
}

export function workbenchPanes(
  state: SidebarSplitState,
  fixedTabIds: readonly string[],
): WorkbenchSplitPane[] {
  const rects = computePaneRects(state.layout.root);
  return listPanes(state.layout.root)
    .map((pane) => ({ pane, rect: rects.get(pane.paneId) }))
    .sort((a, b) => (a.rect?.x ?? 0) - (b.rect?.x ?? 0))
    .flatMap(({ pane, rect }) => {
      const group = getSidebarGroupForPane(state, pane.paneId);
      if (group === null) return [];
      return [
        {
          paneId: pane.paneId,
          tabIds: [
            ...fixedTabIds.filter((id) => group.tabIds.includes(id)),
            ...group.tabIds.filter((id) => !fixedTabIds.includes(id)),
          ],
          widthPercent: Math.round((rect?.w ?? 1) * 10000) / 100,
        },
      ];
    });
}

export function placeTabBefore(
  state: SidebarSplitState,
  paneId: string,
  tabId: string,
  before: string | null,
): SidebarSplitState {
  const pane = listPanes(state.layout.root).find(
    (candidate) => candidate.paneId === paneId,
  );
  const groupId = pane === undefined ? null : sidebarPaneGroupId(pane);
  const group = groupId === null ? undefined : state.groups[groupId];
  if (groupId === null || group === undefined) return state;
  if (!group.tabIds.includes(tabId)) return state;
  const tabIds = group.tabIds.filter((id) => id !== tabId);
  const at = before === null ? -1 : tabIds.indexOf(before);
  tabIds.splice(at === -1 ? tabIds.length : at, 0, tabId);
  if (tabIds.every((id, index) => group.tabIds[index] === id)) return state;
  return {
    ...state,
    groups: { ...state.groups, [groupId]: { ...group, tabIds } },
  };
}

type PlacementResult = "done" | "failed" | "wait";

function applyPlacement(
  args: WorkbenchSplitsArgs,
  tabId: string,
  placement: WorkbenchPlacement,
): PlacementResult {
  const state = args.commitState((current) => current);
  const panes = workbenchPanes(state, args.fixedTabIds);
  const source = panes.find((pane) => pane.tabIds.includes(tabId));
  if (source === undefined) return "wait";
  if (placement.pane === "new") {
    if (panes.length !== 1 || source.tabIds.length < 2) return "failed";
    args.moveTab(source.paneId, tabId, {
      paneId: source.paneId,
      zone: "right",
    });
    return "done";
  }
  const target = panes[placement.pane - 1];
  if (target === undefined) return "failed";
  if (target.paneId !== source.paneId) {
    args.moveTab(source.paneId, tabId, {
      paneId: target.paneId,
      zone: "center",
    });
  }
  const before = placement.before;
  if (before !== undefined) {
    args.commitState((current) =>
      placeTabBefore(current, target.paneId, tabId, before),
    );
  }
  return "done";
}

interface PendingPlacement {
  placement: WorkbenchPlacement;
  settle(placed: boolean): void;
}

function createWorkbenchSplits(
  read: () => WorkbenchSplitsArgs,
  pending: Map<string, PendingPlacement>,
): WorkbenchSplits {
  const current = () => {
    const args = read();
    return { args, state: args.commitState((state) => state) };
  };
  return {
    panes: () => {
      const { args, state } = current();
      return workbenchPanes(state, args.fixedTabIds);
    },
    moveToNewPane(tabId) {
      const { args, state } = current();
      const [pane, ...rest] = workbenchPanes(state, args.fixedTabIds);
      if (pane === undefined || rest.length > 0) return false;
      if (!pane.tabIds.includes(tabId) || pane.tabIds.length < 2) return false;
      args.moveTab(pane.paneId, tabId, { paneId: pane.paneId, zone: "right" });
      return true;
    },
    moveToOtherPane(tabId) {
      const { args, state } = current();
      const panes = workbenchPanes(state, args.fixedTabIds);
      if (panes.length !== 2) return false;
      const source = panes.find((pane) => pane.tabIds.includes(tabId));
      const target = panes.find((pane) => pane !== source);
      if (source === undefined || target === undefined) return false;
      args.moveTab(source.paneId, tabId, {
        paneId: target.paneId,
        zone: "center",
      });
      return true;
    },
    place(tabId, placement) {
      pending.get(tabId)?.settle(false);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(
          () => entry.settle(false),
          WORKBENCH_PLACEMENT_TIMEOUT_MS,
        );
        const entry: PendingPlacement = {
          placement,
          settle(placed) {
            clearTimeout(timer);
            if (pending.get(tabId) === entry) pending.delete(tabId);
            resolve(placed);
          },
        };
        pending.set(tabId, entry);
        flushPlacements(read(), pending);
      });
    },
    setPaneCount(count) {
      const { args, state } = current();
      const panes = workbenchPanes(state, args.fixedTabIds);
      if (panes.length === count) return true;
      const [first, second] = panes;
      if (count === 1) {
        if (second === undefined) return false;
        args.removeSplit(second.paneId);
        return true;
      }
      const group =
        first === undefined
          ? null
          : getSidebarGroupForPane(state, first.paneId);
      if (first === undefined || group === null || group.tabIds.length < 2) {
        return false;
      }
      args.moveTab(first.paneId, group.activeTabId, {
        paneId: first.paneId,
        zone: "right",
      });
      return true;
    },
    setPaneWidths([left, right]) {
      const { args, state } = current();
      if (countPanes(state.layout.root) !== 2) return false;
      if (!(left > 0 && right > 0 && Number.isFinite(left + right))) {
        return false;
      }
      args.resize([], 0, left / (left + right));
      return true;
    },
  };
}

function flushPlacements(
  args: WorkbenchSplitsArgs,
  pending: Map<string, PendingPlacement>,
): void {
  for (const [tabId, entry] of [...pending]) {
    const result = applyPlacement(args, tabId, entry.placement);
    if (result !== "wait") entry.settle(result === "done");
  }
}

export function useWorkbenchSplits(args: WorkbenchSplitsArgs): void {
  const latest = useRef(args);
  const pending = useRef(new Map<string, PendingPlacement>());
  useLayoutEffect(() => {
    latest.current = args;
  });
  const { panelStateId, state } = args;
  useLayoutEffect(() => {
    const placements = pending.current;
    const unregister = registerWorkbenchSplits(
      panelStateId,
      createWorkbenchSplits(() => latest.current, placements),
    );
    return () => {
      unregister();
      for (const entry of [...placements.values()]) entry.settle(false);
    };
  }, [panelStateId]);
  useLayoutEffect(() => {
    if (pending.current.size > 0)
      flushPlacements(latest.current, pending.current);
  }, [state]);
}
