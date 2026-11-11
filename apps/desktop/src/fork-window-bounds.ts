import { readFileSync, writeFileSync } from "node:fs";

export interface ForkWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId: number | null;
}

export interface ForkDisplayArea {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseForkWindowBounds(raw: unknown): ForkWindowBounds | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { x, y, width, height, displayId } = raw as Record<string, unknown>;
  if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    displayId: isNumber(displayId) ? displayId : null,
  };
}

export function placeForkWindow(
  stored: ForkWindowBounds,
  displays: readonly ForkDisplayArea[],
  primary: ForkDisplayArea,
  minimum: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const home = displays.find((display) => display.id === stored.displayId);
  const area = home ?? primary;
  const width = Math.min(area.width, Math.max(minimum.width, stored.width));
  const height = Math.min(area.height, Math.max(minimum.height, stored.height));
  const x =
    home === undefined
      ? area.x + area.width - width - Math.min(24, area.width - width)
      : stored.x;
  const y =
    home === undefined
      ? area.y + area.height - height - Math.min(24, area.height - height)
      : stored.y;
  return {
    width,
    height,
    x: Math.min(area.x + area.width - width, Math.max(area.x, x)),
    y: Math.min(area.y + area.height - height, Math.max(area.y, y)),
  };
}

export function readForkWindowBounds(
  filePath: string,
): Record<string, ForkWindowBounds> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const all: Record<string, ForkWindowBounds> = {};
  for (const [key, value] of Object.entries(raw)) {
    const bounds = parseForkWindowBounds(value);
    if (bounds !== null) all[key] = bounds;
  }
  return all;
}

export function writeForkWindowBounds(
  filePath: string,
  all: Record<string, ForkWindowBounds>,
): void {
  try {
    writeFileSync(filePath, `${JSON.stringify(all)}\n`);
  } catch {
    return;
  }
}
