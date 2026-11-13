import type { DesktopPin, DesktopRect } from "./fork-desktop-control-ipc.js";

export interface InspectResult {
  found?: unknown;
  pid?: unknown;
  windowId?: unknown;
  app?: unknown;
  bundleId?: unknown;
  title?: unknown;
  url?: unknown;
  bounds?: unknown;
  element?: unknown;
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

export function readRect(value: unknown): DesktopRect | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const width = record.width ?? record.w;
  const height = record.height ?? record.h;
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return null;
  }
  return { x: record.x, y: record.y, width, height };
}

export interface PinTarget {
  app: string | null;
  bundleId: string | null;
  pid: number | null;
  windowId: number | null;
  windowTitle: string | null;
  windowBounds: DesktopRect | null;
  url: string | null;
  role: string | null;
  label: string | null;
  elementFrame: DesktopRect | null;
  secure: boolean;
}

export const EMPTY_TARGET: PinTarget = {
  app: null,
  bundleId: null,
  pid: null,
  windowId: null,
  windowTitle: null,
  windowBounds: null,
  url: null,
  role: null,
  label: null,
  elementFrame: null,
  secure: false,
};

export function targetFromInspect(result: InspectResult | null): PinTarget {
  if (result === null || result.found !== true) return EMPTY_TARGET;
  const element =
    typeof result.element === "object" && result.element !== null
      ? (result.element as Record<string, unknown>)
      : null;
  const secure = element?.secure === true;
  return {
    app: text(result.app, 80),
    bundleId: text(result.bundleId, 200),
    pid: int(result.pid),
    windowId: int(result.windowId),
    windowTitle: text(result.title, 160),
    windowBounds: readRect(result.bounds),
    url: text(result.url, 2000),
    role:
      text(element?.roleDescription, 60) ?? roleName(text(element?.role, 60)),
    label: secure ? null : text(element?.label, 160),
    elementFrame: readRect(element?.frame),
    secure,
  };
}

export function roleName(role: string | null): string | null {
  if (role === null) return null;
  const bare = role.startsWith("AX") ? role.slice(2) : role;
  const spaced = bare.replace(/([a-z])([A-Z])/gu, "$1 $2").toLowerCase();
  return spaced.length === 0 ? null : spaced;
}

export function shortUrl(url: string | null, max = 48): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      const name = parsed.pathname.split("/").pop() ?? "";
      return name.length > 0 ? name.slice(0, max) : null;
    }
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const short = `${parsed.host.replace(/^www\./u, "")}${path}`;
    return short.length > max ? `${short.slice(0, max - 1)}…` : short;
  } catch {
    return url.slice(0, max);
  }
}

export function pinChipLabel(
  pin: Pick<DesktopPin, "app" | "label" | "role" | "url" | "windowTitle">,
): string {
  const element =
    pin.label !== null
      ? `“${pin.label.length > 40 ? `${pin.label.slice(0, 39)}…` : pin.label}”`
      : pin.role;
  const parts = [
    pin.app,
    element,
    shortUrl(pin.url) ?? (pin.label === null ? pin.windowTitle : null),
  ];
  const label = parts
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");
  return label.length > 0 ? label : "Screen";
}

export function pinAgentText(pin: DesktopPin): string {
  const lines = [`Pin ${String(pin.number)}: ${pinChipLabel(pin)}`];
  if (pin.app !== null)
    lines.push(
      `App: ${pin.app}${pin.bundleId === null ? "" : ` (${pin.bundleId})`}`,
    );
  if (pin.windowTitle !== null) lines.push(`Window: ${pin.windowTitle}`);
  if (pin.pid !== null && pin.windowId !== null) {
    lines.push(`pid ${String(pin.pid)}, window_id ${String(pin.windowId)}`);
  }
  if (pin.url !== null) lines.push(`URL: ${pin.url}`);
  if (pin.role !== null || pin.label !== null) {
    lines.push(
      `Element: ${[pin.role, pin.label === null ? null : `“${pin.label}”`].filter(Boolean).join(" ")}`,
    );
  }
  if (pin.secure) lines.push("Element: a password field (off-limits)");
  lines.push(
    `Screen point: ${String(Math.round(pin.x))}, ${String(Math.round(pin.y))}`,
  );
  if (pin.windowBounds !== null) {
    lines.push(
      `In the window at: ${String(Math.round(pin.x - pin.windowBounds.x))}, ${String(Math.round(pin.y - pin.windowBounds.y))} (points)`,
    );
  }
  if (pin.imagePath !== null)
    lines.push("A screenshot of the window is attached.");
  return lines.join("\n");
}

export class PinBoard {
  private pins: DesktopPin[] = [];
  private counter = 0;

  list(): DesktopPin[] {
    return this.pins;
  }

  get(id: string): DesktopPin | null {
    return this.pins.find((pin) => pin.id === id) ?? null;
  }

  add(input: {
    id: string;
    threadId: string | null;
    x: number;
    y: number;
    at: number;
    target: PinTarget;
    placed: boolean;
  }): DesktopPin {
    this.counter += 1;
    const pin: DesktopPin = {
      id: input.id,
      number: this.counter,
      threadId: input.threadId,
      createdAt: input.at,
      x: input.x,
      y: input.y,
      ...input.target,
      imagePath: null,
      thumbnail: null,
      placed: input.placed,
      taken: false,
    };
    this.pins = [...this.pins, pin];
    return pin;
  }

  update(
    id: string,
    patch: Partial<Omit<DesktopPin, "id" | "number">>,
  ): DesktopPin | null {
    let updated: DesktopPin | null = null;
    this.pins = this.pins.map((pin) => {
      if (pin.id !== id) return pin;
      updated = { ...pin, ...patch };
      return updated;
    });
    return updated;
  }

  take(ids: readonly string[]): void {
    const wanted = new Set(ids);
    this.pins = this.pins.map((pin) =>
      wanted.has(pin.id) ? { ...pin, taken: true } : pin,
    );
  }

  remove(id: string): void {
    this.pins = this.pins.filter((pin) => pin.id !== id);
  }

  clear(): void {
    this.pins = [];
    this.counter = 0;
  }
}
