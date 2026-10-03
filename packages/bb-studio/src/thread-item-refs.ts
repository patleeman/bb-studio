import type { Ref } from "./services";
import { linkedSpaceIds } from "./spaces";

interface InputPart {
  type?: unknown;
  text?: unknown;
  mentions?: unknown;
}
interface InputEvent {
  type: string;
  data: unknown;
}

/** Known mention namespaces; unknown add-ons may have colons in their item IDs. */
const ITEM_MENTION_PROVIDERS: Record<string, readonly string[]> = {
  pages: ["page"],
  excalidraw: ["drawing"],
  artifacts: ["artifact"],
  talk: ["recordings"],
  "studio-tasks": ["task"],
  "studio-tables": ["table"],
  "bot-teams": ["bot", "views"],
};

function mentionRef(pluginId: string, wireId: string): Ref | null {
  if (pluginId === "studio-chat") {
    const match = /^item:([a-z0-9-]+):(.+)$/.exec(wireId);
    return match ? { pluginId: match[1]!, id: match[2]! } : null;
  }
  const prefix = ITEM_MENTION_PROVIDERS[pluginId]?.find((provider) => wireId.startsWith(`${provider}:`));
  return { pluginId, id: prefix ? wireId.slice(prefix.length + 1) : wireId };
}

/** The first composer input of a new thread, or null before it's saved. */
function firstInput(events: readonly InputEvent[]): InputPart[] | null {
  return events.map((event) => {
    if (event.type !== "client/thread/start" && event.type !== "client/turn/requested" && event.type !== "client/turn/start") return null;
    const data = event.data as { input?: unknown; request?: { params?: { input?: unknown; prompt?: unknown } } } | null;
    const input = data?.input ?? data?.request?.params?.input;
    return Array.isArray(input) && input.length ? input as InputPart[] : typeof data?.request?.params?.prompt === "string" && data.request.params.prompt
      ? [{ type: "text", text: data.request.params.prompt }] as InputPart[] : null;
  }).find((parts) => parts !== null) ?? null;
}

/** Spaces linked in the first composer input of a new thread. */
export function firstThreadSpaceIds(events: readonly InputEvent[]): string[] | null {
  const first = firstInput(events);
  if (!first) return null;
  return [...new Set(first.flatMap((part) => part.type === "text" && typeof part.text === "string" ? linkedSpaceIds(part.text) : []))];
}

/** Item references in the first composer input of a new thread. */
export function firstThreadItemRefs(events: readonly InputEvent[]): Ref[] | null {
  const first = firstInput(events);
  if (!first) return null;
  const found = new Map<string, Ref>();
  const add = (pluginId: string, id: string) => {
    if (!pluginId || !id || pluginId === "studio") return;
    try {
      const ref = { pluginId, id: decodeURIComponent(id) };
      found.set(`${ref.pluginId}:${ref.id}`, ref);
    } catch { /* An invalid escape is not an item ref. */ }
  };
  for (const part of first) {
    if (part.type !== "text") continue;
    if (typeof part.text === "string") {
      for (const match of part.text.matchAll(/\/plugins\/([a-z0-9-]+)\/[a-z0-9-]+\/([A-Za-z0-9_%~-]+)/g)) add(match[1]!, match[2]!);
      for (const match of part.text.matchAll(/item:([a-z0-9-]+):([A-Za-z0-9_-]+)/g)) add(match[1]!, match[2]!);
    }
    if (Array.isArray(part.mentions)) for (const mention of part.mentions) {
      const resource = (mention as { resource?: { kind?: string; pluginId?: string; itemId?: string } })?.resource;
      if (resource?.kind === "plugin" && typeof resource.pluginId === "string" && typeof resource.itemId === "string") {
        const ref = mentionRef(resource.pluginId, resource.itemId);
        if (ref) add(ref.pluginId, ref.id);
      }
    }
  }
  return [...found.values()];
}
