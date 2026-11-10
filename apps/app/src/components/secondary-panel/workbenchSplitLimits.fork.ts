import type { SplitZone, ZoneDecision } from "@/lib/split-drag/zones";
import { countPanes, type LayoutNode } from "@/lib/split-layout";

export const WORKBENCH_MAX_PANES = 2;

export const WORKBENCH_MOVE_PANE_CONTROLS = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPaneNode(value: unknown): boolean {
  return isRecord(value) && value.type === "pane";
}

export function isWorkbenchRowLayout(root: LayoutNode): boolean {
  return (
    root.type === "pane" ||
    (root.dir === "row" &&
      root.children.length <= WORKBENCH_MAX_PANES &&
      root.children.every((child) => child.type === "pane"))
  );
}

export function restoresWorkbenchSplit(storedValue: string | null): boolean {
  if (storedValue === null) return true;
  let value: unknown;
  try {
    value = JSON.parse(storedValue);
  } catch {
    return true;
  }
  const root =
    isRecord(value) && isRecord(value.layout) ? value.layout.root : undefined;
  if (!isRecord(root) || root.type === "pane") return true;
  return (
    root.type === "split" &&
    root.dir === "row" &&
    Array.isArray(root.children) &&
    root.children.length <= WORKBENCH_MAX_PANES &&
    root.children.every(isPaneNode)
  );
}

type DropDecider = (paneId: string, zone: SplitZone) => ZoneDecision | null;

export function limitWorkbenchDrop(
  root: LayoutNode,
  sourcePaneId: string,
  decide: DropDecider,
): DropDecider {
  const paneCount = countPanes(root);
  return (targetPaneId, zone) => {
    if (paneCount > 1) {
      return targetPaneId === sourcePaneId
        ? null
        : decide(targetPaneId, "center");
    }
    return zone === "right" ? decide(targetPaneId, zone) : null;
  };
}

export function isPointInWorkbench(
  panel: HTMLElement,
  x: number,
  y: number,
): boolean {
  const bounds = panel.getBoundingClientRect();
  return (
    x >= bounds.left &&
    x <= bounds.right &&
    y >= bounds.top &&
    y <= bounds.bottom
  );
}
