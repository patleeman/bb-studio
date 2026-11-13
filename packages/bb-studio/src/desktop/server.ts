import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { desktopHudEnabled } from "./gate";
import { decodePinMention, PIN_MENTION_PROVIDER, pinMentionContext } from "./pins";

function member(source: object, name: string): unknown {
  return Object.entries(source).find(([key]) => key === name)?.[1];
}

export type DesktopTool =
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

export interface DesktopCall {
  threadId: string;
  agent: string;
  tool: DesktopTool;
  args?: Record<string, unknown>;
  caption?: string;
}

export interface DesktopResult {
  ok: boolean;
  text?: string;
  images?: { data: string; mimeType: string }[];
  error?: string;
}

export type DesktopCaller = (call: DesktopCall) => Promise<DesktopResult>;

export function desktopCallerOf(bb: object): DesktopCaller | null {
  const hooks = member(bb, "experimental_hooks");
  if (typeof hooks !== "object" || hooks === null) return null;
  const call = member(hooks, "experimental_desktopControl");
  return typeof call === "function" ? (request) => (call as DesktopCaller).call(hooks, request) : null;
}

export function toolResult(result: DesktopResult) {
  if (!result.ok) return { content: [{ type: "text" as const, text: result.error ?? "Desktop control refused." }], isError: true };
  const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
    { type: "text", text: result.text ?? "Done." },
  ];
  for (const image of result.images ?? []) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  return { content };
}

const target = {
  pid: z.number().int().describe("Process id, from desktop_windows or a pin"),
  window_id: z.number().int().describe("Window id, from desktop_windows or a pin"),
};
const caption = z.string().max(80).optional().describe("A few words for the ghost cursor's caption, e.g. \"opening Pro plan details\"");
const foreground = z
  .boolean()
  .optional()
  .describe("Use the user's real cursor and keyboard. Only when a background action did nothing; BB Studio asks the user first.");
const elementToken = z.string().max(80).optional().describe("element_token from desktop_look, e.g. s0000002a:11 (preferred)");
const point = {
  x: z.number().optional().describe("X in desktop_look screenshot pixels, when there is no element"),
  y: z.number().optional().describe("Y in desktop_look screenshot pixels"),
};

function delivery(value: boolean | undefined) {
  return value === true ? { delivery_mode: "foreground" } : {};
}

export function registerDesktopTools(bb: BbPluginApi, agentName: (threadId: string) => Promise<string>): boolean {
  const call = desktopCallerOf(bb);
  if (call === null) return false;
  const run = async (threadId: string, tool: DesktopTool, args: Record<string, unknown>, label?: string) =>
    toolResult(await call({ threadId, agent: await agentName(threadId).catch(() => "Agent"), tool, args, ...(label ? { caption: label } : {}) }));

  bb.ui.registerMentionProvider({
    id: PIN_MENTION_PROVIDER,
    label: "Pins",
    search: () => [],
    resolve: (id: string) => {
      const pin = decodePinMention(id);
      if (pin === null) throw new Error("Pin not found.");
      return { context: pinMentionContext(pin) };
    },
  });

  bb.agents.registerTool({
    name: "desktop_status",
    description: "BB Studio desktop control: whether the HUD is open on this conversation, the macOS permissions, whether you hold the user's cursor and keyboard, and how many pins the user dropped. Desktop tools work only while the user has the HUD open on this conversation.",
    parameters: z.object({}),
    execute: (_input, ctx) => run(ctx.threadId, "status", {}),
  });
  bb.agents.registerTool({
    name: "desktop_pins",
    description: "The spots the user pointed at with the HUD (numbered pins): app, window, element, URL, pid and window_id.",
    parameters: z.object({}),
    execute: (_input, ctx) => run(ctx.threadId, "pins", {}),
  });
  bb.agents.registerTool({
    name: "desktop_windows",
    description: "List on-screen windows of other apps (pid, window_id, title). Filter with app.",
    parameters: z.object({ app: z.string().max(100).optional().describe("App name or bundle id") }),
    execute: (input, ctx) => run(ctx.threadId, "windows", input),
  });
  bb.agents.registerTool({
    name: "desktop_look",
    description: "Read a window in the background: its accessibility tree (rows [N], addressed as element_token <snapshot_id>:N) and a screenshot. Read again after acting.",
    parameters: z.object({ ...target, query: z.string().max(200).optional().describe("Only rows containing this text, plus their ancestors"), caption }),
    execute: ({ caption: label, ...input }, ctx) => run(ctx.threadId, "look", input, label),
  });
  bb.agents.registerTool({
    name: "desktop_click",
    description: "Click in another app's window, in the background by default (no real cursor). BB Studio shows a ghost cursor. Password fields are refused.",
    parameters: z.object({ ...target, element_token: elementToken, ...point, button: z.enum(["left", "right"]).optional(), count: z.number().int().min(1).max(3).optional(), foreground, caption }),
    execute: ({ caption: label, foreground: fg, ...input }, ctx) => run(ctx.threadId, "click", { ...input, ...delivery(fg) }, label),
  });
  bb.agents.registerTool({
    name: "desktop_type",
    description: "Type text into an element (or the window's focused field), in the background by default. Password and secure fields are refused.",
    parameters: z.object({ ...target, text: z.string().max(4000), element_token: elementToken, ...point, foreground, caption }),
    execute: ({ caption: label, foreground: fg, ...input }, ctx) => run(ctx.threadId, "type", { ...input, ...delivery(fg) }, label),
  });
  bb.agents.registerTool({
    name: "desktop_key",
    description: "Press one key (Return, Escape, Tab, arrows…) with optional modifiers, in the background by default.",
    parameters: z.object({ ...target, key: z.string().max(40), modifiers: z.array(z.enum(["cmd", "shift", "option", "ctrl"])).max(4).optional(), element_token: elementToken, foreground, caption }),
    execute: ({ caption: label, foreground: fg, ...input }, ctx) => run(ctx.threadId, "key", { ...input, ...delivery(fg) }, label),
  });
  bb.agents.registerTool({
    name: "desktop_hotkey",
    description: "Press a key combination such as [\"cmd\", \"c\"], in the background by default.",
    parameters: z.object({ ...target, keys: z.array(z.string().max(20)).min(2).max(5), foreground, caption }),
    execute: ({ caption: label, foreground: fg, ...input }, ctx) => run(ctx.threadId, "hotkey", { ...input, ...delivery(fg) }, label),
  });
  bb.agents.registerTool({
    name: "desktop_scroll",
    description: "Scroll a window or an element, in the background by default.",
    parameters: z.object({ ...target, direction: z.enum(["up", "down", "left", "right"]), amount: z.number().int().min(1).max(20).optional(), element_token: elementToken, ...point, foreground, caption }),
    execute: ({ caption: label, foreground: fg, ...input }, ctx) => run(ctx.threadId, "scroll", { ...input, ...delivery(fg) }, label),
  });
  bb.agents.registerTool({
    name: "desktop_set_value",
    description: "Set an element's value (a field, popup or slider) by element_token, in the background. Password fields are refused.",
    parameters: z.object({ element_token: z.string().max(80), value: z.string().max(4000), caption }),
    execute: ({ caption: label, ...input }, ctx) => run(ctx.threadId, "set_value", input, label),
  });
  bb.agents.registerTool({
    name: "desktop_request_control",
    description: "Ask the user for their real cursor and keyboard (for a surface that ignores background input, such as a canvas). The HUD asks: this session, just once, or no. Moving the mouse takes it back.",
    parameters: z.object({ reason: z.string().min(1).max(300).describe("Why, in one sentence the user reads"), app: z.string().max(80).optional() }),
    execute: (input, ctx) => run(ctx.threadId, "request_control", input),
  });
  return true;
}

export function registerDesktopToolsIfEnabled(
  bb: BbPluginApi,
  env: Readonly<Record<string, string | undefined>>,
  agentName: (threadId: string) => Promise<string>,
): boolean {
  return desktopHudEnabled(env) && registerDesktopTools(bb, agentName);
}
