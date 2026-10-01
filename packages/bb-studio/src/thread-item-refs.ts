import type { Ref } from "./services";

interface InputPart {
  type?: unknown;
  text?: unknown;
  mentions?: unknown;
}
interface InputEvent {
  type: string;
  data: unknown;
}

/** Item references in the first composer input of a new thread. */
export function firstThreadItemRefs(events: readonly InputEvent[]): Ref[] | null {
  const first = events.find((event) => event.type === "client/turn/requested" || event.type === "client/turn/start");
  if (!first) return null;
  const data = first.data as { input?: unknown; request?: { params?: { input?: unknown; prompt?: unknown } } } | null;
  const input = data?.input ?? data?.request?.params?.input;
  const parts: InputPart[] = Array.isArray(input) ? input : typeof data?.request?.params?.prompt === "string" ? [{ type: "text", text: data.request.params.prompt }] : [];
  const found = new Map<string, Ref>();
  const add = (pluginId: string, id: string) => {
    if (!pluginId || !id || pluginId === "studio") return;
    try {
      const ref = { pluginId, id: decodeURIComponent(id) };
      found.set(`${ref.pluginId}:${ref.id}`, ref);
    } catch { /* An invalid escape is not an item ref. */ }
  };
  for (const part of parts) {
    if (part.type !== "text") continue;
    if (typeof part.text === "string") {
      for (const match of part.text.matchAll(/\/plugins\/([a-z0-9-]+)\/[a-z0-9-]+\/([A-Za-z0-9_%~-]+)/g)) add(match[1]!, match[2]!);
      for (const match of part.text.matchAll(/item:([a-z0-9-]+):([A-Za-z0-9_-]+)/g)) add(match[1]!, match[2]!);
    }
    if (Array.isArray(part.mentions)) for (const mention of part.mentions) {
      const resource = (mention as { resource?: { kind?: string; pluginId?: string; itemId?: string } })?.resource;
      if (resource?.kind === "plugin" && resource.pluginId && resource.itemId) add(resource.pluginId, resource.itemId);
    }
  }
  return [...found.values()];
}
