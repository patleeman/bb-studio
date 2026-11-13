import type { DesktopRect } from "./fork-desktop-control-ipc.js";
import { readRect } from "./fork-desktop-pins.js";

export type DesktopAgentTool =
  | "status"
  | "pins"
  | "windows"
  | "look"
  | "click"
  | "type"
  | "key"
  | "hotkey"
  | "scroll"
  | "set_value"
  | "request_control";

export const DESKTOP_AGENT_TOOLS: readonly DesktopAgentTool[] = [
  "status",
  "pins",
  "windows",
  "look",
  "click",
  "type",
  "key",
  "hotkey",
  "scroll",
  "set_value",
  "request_control",
];

export const DESKTOP_ACTION_TOOLS: ReadonlySet<DesktopAgentTool> = new Set([
  "click",
  "type",
  "key",
  "hotkey",
  "scroll",
  "set_value",
]);

const KEYBOARD_TOOLS: ReadonlySet<DesktopAgentTool> = new Set([
  "type",
  "key",
  "hotkey",
  "set_value",
]);

const DRIVER_TOOL: Record<DesktopAgentTool, string | null> = {
  status: null,
  pins: null,
  windows: "list_windows",
  look: "get_window_state",
  click: "click",
  type: "type_text",
  key: "press_key",
  hotkey: "hotkey",
  scroll: "scroll",
  set_value: "set_value",
  request_control: null,
};

const ALLOWED_ARGS: Record<DesktopAgentTool, readonly string[]> = {
  status: [],
  pins: [],
  request_control: ["reason", "app"],
  windows: ["app", "pid"],
  look: ["pid", "window_id", "query"],
  click: [
    "pid",
    "window_id",
    "element_token",
    "x",
    "y",
    "button",
    "count",
    "action",
    "modifier",
    "delivery_mode",
  ],
  type: [
    "pid",
    "window_id",
    "element_token",
    "x",
    "y",
    "text",
    "delivery_mode",
  ],
  key: [
    "pid",
    "window_id",
    "element_token",
    "key",
    "modifiers",
    "delivery_mode",
  ],
  hotkey: ["pid", "window_id", "element_token", "keys", "delivery_mode"],
  scroll: [
    "pid",
    "window_id",
    "element_token",
    "x",
    "y",
    "direction",
    "amount",
    "by",
    "delivery_mode",
  ],
  set_value: ["pid", "window_id", "element_token", "value"],
};

export function isDesktopAgentTool(value: unknown): value is DesktopAgentTool {
  return (
    typeof value === "string" &&
    (DESKTOP_AGENT_TOOLS as readonly string[]).includes(value)
  );
}

export function driverToolFor(tool: DesktopAgentTool): string | null {
  return DRIVER_TOOL[tool];
}

export function isKeyboardTool(tool: DesktopAgentTool): boolean {
  return KEYBOARD_TOOLS.has(tool);
}

export type SanitizedArgs = Record<string, unknown>;

export function sanitizeArgs(
  tool: DesktopAgentTool,
  args: unknown,
): SanitizedArgs {
  const source =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : {};
  const out: SanitizedArgs = {};
  for (const key of ALLOWED_ARGS[tool]) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  if (out.delivery_mode !== undefined && out.delivery_mode !== "foreground") {
    out.delivery_mode = "background";
  }
  if (DESKTOP_ACTION_TOOLS.has(tool) && out.delivery_mode === undefined) {
    out.delivery_mode = "background";
  }
  if (tool === "set_value") delete out.delivery_mode;
  return out;
}

export function needsForeground(args: SanitizedArgs): boolean {
  return args.delivery_mode === "foreground";
}

export interface SnapshotElement {
  role: string | null;
  subrole: string | null;
  label: string | null;
  frame: DesktopRect | null;
}

export interface WindowSnapshot {
  id: string;
  pid: number;
  windowId: number;
  bounds: DesktopRect | null;
  scale: number;
  app: string | null;
  title: string | null;
  elements: Map<number, SnapshotElement>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readSnapshot(
  structured: unknown,
  request: { pid: number; windowId: number },
): WindowSnapshot | null {
  if (typeof structured !== "object" || structured === null) return null;
  const record = structured as Record<string, unknown>;
  const id = str(record.snapshot_id);
  if (id === null) return null;
  const elements = new Map<number, SnapshotElement>();
  if (Array.isArray(record.elements)) {
    for (const entry of record.elements) {
      if (typeof entry !== "object" || entry === null) continue;
      const element = entry as Record<string, unknown>;
      if (typeof element.element_index !== "number") continue;
      elements.set(element.element_index, {
        role: str(element.role),
        subrole: str(element.subrole),
        label: str(element.label),
        frame: readRect(element.frame),
      });
    }
  }
  const scale =
    typeof record.screenshot_scale === "number" && record.screenshot_scale > 0
      ? record.screenshot_scale
      : 1;
  return {
    id,
    pid: request.pid,
    windowId: request.windowId,
    bounds: readRect(record.window_bounds),
    scale,
    app: str(record.app_name) ?? str(record.app),
    title: str(record.window_title),
    elements,
  };
}

export function parseElementToken(
  token: unknown,
): { snapshot: string; row: number } | null {
  if (typeof token !== "string") return null;
  const match = /^([A-Za-z0-9_-]+):(\d+)$/u.exec(token);
  if (match === null) return null;
  return { snapshot: match[1] ?? "", row: Number(match[2]) };
}

export class SnapshotCache {
  private readonly byId = new Map<string, WindowSnapshot>();
  private readonly latest = new Map<string, WindowSnapshot>();

  constructor(private readonly limit = 30) {}

  remember(snapshot: WindowSnapshot): void {
    this.byId.set(snapshot.id, snapshot);
    this.latest.set(
      `${String(snapshot.pid)}:${String(snapshot.windowId)}`,
      snapshot,
    );
    while (this.byId.size > this.limit) {
      const oldest = this.byId.keys().next().value;
      if (oldest === undefined) break;
      this.byId.delete(oldest);
    }
  }

  forToken(
    token: unknown,
  ): { snapshot: WindowSnapshot; element: SnapshotElement | null } | null {
    const parsed = parseElementToken(token);
    if (parsed === null) return null;
    const snapshot = this.byId.get(parsed.snapshot);
    if (snapshot === undefined) return null;
    return { snapshot, element: snapshot.elements.get(parsed.row) ?? null };
  }

  forWindow(pid: unknown, windowId: unknown): WindowSnapshot | null {
    if (typeof pid !== "number" || typeof windowId !== "number") return null;
    return this.latest.get(`${String(pid)}:${String(windowId)}`) ?? null;
  }
}

export function isSecureElement(
  element: { role?: string | null; subrole?: string | null } | null,
): boolean {
  if (element === null) return false;
  return [element.role, element.subrole].some(
    (value) =>
      typeof value === "string" &&
      /securetextfield|secure text field/iu.test(value),
  );
}

export interface FocusedProbe {
  secureInput?: unknown;
  element?: unknown;
  pid?: unknown;
}

export const SECURE_REFUSAL =
  "Refused: that is a password or secure field, and BB Studio does not let agents touch those.";

export function secureRefusal(input: {
  tool: DesktopAgentTool;
  element: SnapshotElement | null;
  pointElement: { secure?: unknown } | null;
  focused: FocusedProbe | null;
  targetPid: number | null;
  usesElementToken: boolean;
}): string | null {
  if (isSecureElement(input.element)) return SECURE_REFUSAL;
  if (input.pointElement?.secure === true) return SECURE_REFUSAL;
  if (!isKeyboardTool(input.tool) || input.usesElementToken) return null;
  const focused = input.focused;
  if (focused === null) return null;
  if (focused.secureInput === true) return SECURE_REFUSAL;
  const element =
    typeof focused.element === "object" && focused.element !== null
      ? (focused.element as Record<string, unknown>)
      : null;
  const samePid = input.targetPid === null || focused.pid === input.targetPid;
  if (samePid && element?.secure === true) return SECURE_REFUSAL;
  return null;
}

export function screenPoint(
  args: SanitizedArgs,
  token: { snapshot: WindowSnapshot; element: SnapshotElement | null } | null,
  window: WindowSnapshot | null,
): { x: number; y: number } | null {
  const frame = token?.element?.frame ?? null;
  if (frame !== null) {
    return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  }
  const snapshot = token?.snapshot ?? window;
  if (
    snapshot?.bounds &&
    typeof args.x === "number" &&
    typeof args.y === "number"
  ) {
    return {
      x: snapshot.bounds.x + args.x / snapshot.scale,
      y: snapshot.bounds.y + args.y / snapshot.scale,
    };
  }
  if (snapshot?.bounds) {
    return {
      x: snapshot.bounds.x + snapshot.bounds.width / 2,
      y: snapshot.bounds.y + snapshot.bounds.height / 2,
    };
  }
  return null;
}

export function defaultCaption(
  tool: DesktopAgentTool,
  args: SanitizedArgs,
  element: SnapshotElement | null,
): string {
  const name = element?.label ? `“${element.label.slice(0, 40)}”` : null;
  switch (tool) {
    case "click":
      return name === null ? "clicking" : `clicking ${name}`;
    case "type":
      return name === null ? "typing" : `typing in ${name}`;
    case "set_value":
      return name === null ? "setting a value" : `setting ${name}`;
    case "key":
      return typeof args.key === "string"
        ? `pressing ${args.key}`
        : "pressing a key";
    case "hotkey":
      return Array.isArray(args.keys)
        ? `pressing ${args.keys.join("+")}`
        : "pressing keys";
    case "scroll":
      return typeof args.direction === "string"
        ? `scrolling ${args.direction}`
        : "scrolling";
    default:
      return "looking";
  }
}
