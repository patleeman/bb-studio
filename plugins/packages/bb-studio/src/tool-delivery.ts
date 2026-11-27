// Tool delivery, per provider: how a session gets Studio's on-demand tools.
// "all" loads every tool, "defer" sends them deferred (where BB supports it),
// "trio" reaches them through studio_tool_search/_describe/_call. "default"
// (no entry) keeps the built-in choice: all for Claude Code, defer for Codex,
// trio for the rest (src/tool-scope.ts). Lean context always gets the trio.
// Set from the CLI (`bbs studio tool-delivery <provider> <mode>`) while the
// choice for a new provider isn't made yet.
import type { ToolDeliveryMode } from "./tool-scope";

export const TOOL_DELIVERY_KEY = "studio.toolDelivery";
export const TOOL_DELIVERY_MODES: readonly ToolDeliveryMode[] = ["default", "all", "defer", "trio"];

interface Kv { get(key: string): Promise<unknown> | unknown; set(key: string, value: unknown): Promise<void> | void }

export const isToolDeliveryMode = (value: unknown): value is ToolDeliveryMode => TOOL_DELIVERY_MODES.includes(value as ToolDeliveryMode);

export class ToolDeliveryStore {
  current: Record<string, Exclude<ToolDeliveryMode, "default">> = {};
  constructor(private readonly kv: Kv) {}

  async load(): Promise<void> {
    this.current = parse(await this.kv.get(TOOL_DELIVERY_KEY));
  }

  modeFor(providerId: string): ToolDeliveryMode {
    return this.current[providerId] ?? "default";
  }

  async set(providerId: string, mode: ToolDeliveryMode): Promise<Record<string, ToolDeliveryMode>> {
    const next = { ...this.current };
    if (mode === "default") delete next[providerId];
    else next[providerId] = mode;
    await this.kv.set(TOOL_DELIVERY_KEY, next);
    this.current = next;
    return next;
  }
}

function parse(value: unknown): Record<string, Exclude<ToolDeliveryMode, "default">> {
  let raw = value;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, Exclude<ToolDeliveryMode, "default">] => entry[1] === "all" || entry[1] === "defer" || entry[1] === "trio"));
}
