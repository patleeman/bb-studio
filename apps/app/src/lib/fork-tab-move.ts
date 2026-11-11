import type {
  ExperimentalDragItem,
  ExperimentalWorkbenchOpenOptions,
  ExperimentalWorkbenchOpenSpec,
} from "@get-bb/plugin-sdk";
import { workbenchSplitsFor } from "@/components/secondary-panel/workbenchSplits.fork";
import {
  ITEM_DRAG_LOCAL_TYPE,
  paneUnderPoint,
  wasDropTakenHere,
  writeDragItem,
  type ItemDropZone,
  type TabDropOutcome,
} from "./fork-item-drag";
import { workbenchFor } from "./fork-workbench";

export interface PanelTabDragSource {
  panelStateId: string;
  key: string;
  panel: HTMLElement | null;
  close(): void;
}

let source: PanelTabDragSource | null = null;

export function beginPanelTabDrag(
  dataTransfer: DataTransfer,
  item: ExperimentalDragItem,
  from: PanelTabDragSource,
): void {
  dataTransfer.effectAllowed = "all";
  writeDragItem(dataTransfer, item);
  if (item.open === undefined) dataTransfer.setData(ITEM_DRAG_LOCAL_TYPE, "1");
  source = from;
}

export function endPanelTabDrag(dropEffect: string | undefined): void {
  const from = source;
  source = null;
  if (from === null) return;
  if (dropEffect === "move" && !wasDropTakenHere()) from.close();
}

export function getPanelTabDragSource(): PanelTabDragSource | null {
  return source;
}

export function resetPanelTabDragForTest(): void {
  source = null;
}

interface TabPlace {
  pane: 1 | 2 | "new";
  index?: number;
}

function placeOf(zone: ItemDropZone): TabPlace | null {
  const place = zone.place;
  if (place !== undefined) {
    return place.pane === "new"
      ? { pane: "new" }
      : { pane: place.pane, index: place.index };
  }
  if (zone.point === undefined) return null;
  const pane = paneUnderPoint(zone.element, zone.point.x);
  return pane === null ? null : { pane };
}

function moveWithinPanel(
  from: PanelTabDragSource,
  place: TabPlace,
  commit: boolean,
): TabDropOutcome {
  const splits = workbenchSplitsFor(from.panelStateId);
  if (splits === null) return null;
  const panes = splits.panes();
  const own = panes.find((pane) => pane.tabIds.includes(from.key));
  if (own === undefined) return null;
  if (place.pane === "new") {
    if (panes.length !== 1 || own.tabIds.length < 2) return null;
    if (commit) void splits.place(from.key, { pane: "new" });
    return "moved";
  }
  const target = panes[place.pane - 1];
  if (target === undefined) return null;
  if (commit) {
    const order = target.tabIds.filter((id) => id !== from.key);
    const before =
      place.index === undefined ? null : (order[place.index] ?? null);
    void splits.place(from.key, { pane: place.pane, before });
  }
  return "moved";
}

export function specOwner(spec: ExperimentalWorkbenchOpenSpec): string {
  return spec.kind === "tab" && spec.tab.pluginId !== undefined
    ? spec.tab.pluginId
    : "bb";
}

export async function openTabSpecIn(
  pluginId: string,
  threadId: string,
  spec: ExperimentalWorkbenchOpenSpec,
  options: ExperimentalWorkbenchOpenOptions | undefined,
): Promise<string | null> {
  const workbench = workbenchFor(pluginId, threadId);
  if (workbench === null) return null;
  const key = await workbench.open(spec, options);
  if (key !== null || options === undefined) return key;
  const { pane, index, ...rest } = options;
  return pane === undefined && index === undefined
    ? null
    : workbench.open(spec, rest);
}

function openInOtherPanel(
  item: ExperimentalDragItem,
  from: PanelTabDragSource | null,
  threadId: string | null,
  place: TabPlace,
  commit: boolean,
): TabDropOutcome {
  const spec = item.open;
  if (spec === undefined || threadId === null) return null;
  const owner = specOwner(spec);
  if (workbenchFor(owner, threadId) === null) return null;
  if (commit) {
    void openTabSpecIn(owner, threadId, spec, {
      pane: place.pane,
      ...(place.index === undefined ? {} : { index: place.index }),
    }).then((key) => {
      if (key !== null) from?.close();
    });
  }
  return "opened";
}

export function tabDropOutcome(
  item: ExperimentalDragItem,
  zone: ItemDropZone,
  commit: boolean,
  threadIdOf: (element: HTMLElement) => string | null,
): TabDropOutcome {
  if (item.kind !== "tab" || zone.zone !== "workbench") return null;
  const place = placeOf(zone);
  if (place === null) return null;
  const from = source !== null && source.key === item.id ? source : null;
  if (from !== null && from.panel === zone.element) {
    return moveWithinPanel(from, place, commit);
  }
  return openInOtherPanel(item, from, threadIdOf(zone.element), place, commit);
}
