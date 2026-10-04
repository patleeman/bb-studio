import { parseStudioMentionReference, studioTextReferences, type ReferenceOptions, type ReferenceProvider } from "@bb-studio/kit/contract";
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

/** Item references in the first composer input of a new thread. */
export function firstThreadItemRefs(events: readonly InputEvent[], options: ReferenceOptions = {}): Ref[] | null {
  const first = firstInput(events);
  if (!first) return null;
  const found = new Map<string, Ref>();
  const add = (pluginId: string, id: string) => {
    if (!pluginId || !id || pluginId === "studio") return;
    found.set(JSON.stringify([pluginId, id]), { pluginId, id });
  };
  for (const part of first) {
    if (part.type !== "text") continue;
    if (typeof part.text === "string") {
      for (const { ref } of studioTextReferences(part.text, options)) add(ref.pluginId, ref.id);
    }
    if (Array.isArray(part.mentions)) for (const mention of part.mentions) {
      const resource = (mention as { resource?: { kind?: string; pluginId?: string; itemId?: string } })?.resource;
      if (resource?.kind === "plugin" && typeof resource.pluginId === "string" && typeof resource.itemId === "string") {
        const ref = parseStudioMentionReference(resource.pluginId, resource.itemId, options.providers);
        if (ref) add(ref.pluginId, ref.id);
      }
    }
  }
  return [...found.values()];
}

/** Only selected mention providers need descriptions; no unrelated add-on fanout. */
export function firstThreadMentionPlugins(events: readonly InputEvent[]): string[] {
  return [...new Set((firstInput(events) ?? []).flatMap((part) => part.type === "text" && Array.isArray(part.mentions) ? part.mentions.flatMap((mention) => {
    const resource = mention?.resource;
    return resource?.kind === "plugin" && typeof resource.pluginId === "string" && resource.pluginId !== "studio-chat" && typeof resource.itemId === "string" && resource.itemId.includes(":") && parseStudioMentionReference(resource.pluginId, resource.itemId)?.id === resource.itemId ? [resource.pluginId] : [];
  }) : []))];
}

/** Coalesces selected-provider descriptions and bounds even transports that ignore abort. */
export function mentionProviderLookup(load: (pluginId: string, signal: AbortSignal) => Promise<ReferenceProvider>, timeoutMs = 1_500) {
  const cache = new Map<string, { until: number; value: Promise<ReferenceProvider | null> }>();
  return async (pluginIds: readonly string[]): Promise<ReferenceProvider[]> => {
    const providers = await Promise.all([...new Set(pluginIds)].filter((id) => /^[a-z0-9-]+$/.test(id)).map((pluginId) => {
      const cached = cache.get(pluginId);
      if (cached && cached.until > Date.now()) return cached.value;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
      const request = Promise.resolve().then(() => load(pluginId, controller.signal)).then((provider) => provider.pluginId === pluginId ? provider : null, () => null);
      const value = Promise.race([request, timeout]).finally(() => clearTimeout(timer));
      const entry = { until: Date.now() + 30_000, value };
      cache.set(pluginId, entry);
      void value.then((provider) => { if (!provider) entry.until = Date.now() + 1_500; });
      return value;
    }));
    return providers.filter((provider): provider is ReferenceProvider => provider !== null);
  };
}
