// Every add-on's Studio items in one list, for embeds, mentions and relation
// pickers. Each add-on is asked through its Studio contract, so a new add-on
// shows up without changes here.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { StudioSchemas } from "../contract";
import { untitled } from "../format";
import { discoverProviderSnapshot, fanOutProviders, loadProviderItems } from "./discovery";

/** The Studio add-ons, in the order their items are offered. */
export const STUDIO_SUITE = ["studio-tasks", "excalidraw", "artifacts", "talk", "pages", "studio-tables"];
const FRESH_MS = 5_000;
const MAX_ITEMS = 500;

export interface StudioIndexItem {
  pluginId: string;
  id: string;
  kind: string;
  kindLabel: string;
  kindIcon: string;
  title: string;
  icon: string | null;
  preview: string | null;
  facts: string[];
  badge: string | null;
  thumbnailUrl: string | null;
  href: string;
  updatedAt: number;
}

type ProviderItem = z.infer<StudioSchemas["provider"]["studio_list"]["output"]>["items"][number];

/** An add-on's item as the index lists it, labelled with its kind. */
export function indexItem(pluginId: string, item: ProviderItem, info: z.infer<StudioSchemas["info"]>): StudioIndexItem {
  const kind = info.kinds.find((each) => each.id === item.kind);
  return {
    pluginId,
    id: item.id,
    kind: item.kind,
    kindLabel: kind?.label ?? item.kind,
    kindIcon: kind?.icon ?? "File",
    title: untitled(item.title),
    icon: item.icon,
    preview: item.preview,
    facts: item.facts.map((fact) => fact.value).filter(Boolean),
    badge: item.badge?.label ?? null,
    thumbnailUrl: item.thumbnailUrl,
    href: item.href,
    updatedAt: item.updatedAt,
  };
}

/** The newest live items across add-ons, cached for a few seconds. */
export function studioIndex(sdk: BbPluginApi["sdk"], studio: StudioSchemas, options: { exclude?: readonly string[] } = {}) {
  type Snapshot = { items: StudioIndexItem[]; complete: boolean };
  let cached: { at: number; snapshot: Promise<Snapshot> } | null = null;
  const previous = new Map<string, StudioIndexItem[]>();

  async function load(): Promise<Snapshot> {
    const discovery = await discoverProviderSnapshot(sdk, { method: "studio_list", known: STUDIO_SUITE, exclude: ["studio", ...(options.exclude ?? [])] });
    const installed = new Set(discovery.installed.map((plugin) => plugin.id));
    const discovered = new Set(discovery.providers.map((plugin) => plugin.id));
    for (const id of previous.keys()) if (!installed.has(id) || (discovery.complete && !discovered.has(id))) previous.delete(id);
    let complete = discovery.complete;
    await fanOutProviders(discovery.providers, async (plugin) => {
      if (!["running", "starting", "degraded"].includes(plugin.status)) { complete = false; return; }
      const result = await loadProviderItems(async () => {
        const [listed, info] = await Promise.all([
          sdk.plugins.callRpc({ pluginId: plugin.id, method: "studio_list", input: null as never, outputSchema: studio.provider.studio_list.output, signal: AbortSignal.timeout(10_000) }),
          sdk.plugins.callRpc({ pluginId: plugin.id, method: "studio_describe", input: null as never, outputSchema: studio.info, signal: AbortSignal.timeout(10_000) }),
        ]);
        return { items: listed.items.map((item) => ({ ...indexItem(plugin.id, item, info), archived: item.archived })), truncated: listed.truncated };
      });
      if (result.status !== "ready") { complete = false; return; }
      const seen = new Set(result.items.map((item) => item.id));
      const retained = result.complete ? [] : (previous.get(plugin.id) ?? []).filter((item) => !seen.has(item.id));
      previous.set(plugin.id, [...retained, ...result.items.filter((item) => !item.archived).map(({ archived: _archived, ...item }) => item)]);
      if (!result.complete) complete = false;
    }, () => { complete = false; });
    return { items: [...previous.values()].flat().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ITEMS), complete };
  }

  const snapshot = (): Promise<Snapshot> => {
    if (!cached || Date.now() - cached.at > FRESH_MS) {
      const pending = load();
      cached = { at: Date.now(), snapshot: pending };
      pending.catch(() => { if (cached?.snapshot === pending) cached = null; });
    }
    return cached.snapshot;
  };

  return {
    items: () => snapshot().then((result) => result.items),
    snapshot,
    /** Drops the cache, so a just-made item is listed. */
    invalidate(): void {
      cached = null;
    },
  };
}
