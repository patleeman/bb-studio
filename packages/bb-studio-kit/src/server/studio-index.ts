// Every add-on's Studio items in one list, for embeds, mentions and relation
// pickers. Each add-on is asked through its Studio contract, so a new add-on
// shows up without changes here.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { StudioSchemas } from "../contract";
import { untitled } from "../format";
import { discoverProviders, fanOutProviders } from "./discovery";

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
  let cached: { at: number; items: Promise<StudioIndexItem[]> } | null = null;

  async function load(): Promise<StudioIndexItem[]> {
    const providers = await discoverProviders(sdk, { method: "studio_list", known: STUDIO_SUITE, exclude: ["studio", ...(options.exclude ?? [])] });
    const lists = await fanOutProviders(
      providers.map((plugin) => plugin.id),
      async (pluginId) => {
        const [{ items }, info] = await Promise.all([
          sdk.plugins.callRpc({ pluginId, method: "studio_list", input: null as never, outputSchema: studio.provider.studio_list.output }),
          sdk.plugins.callRpc({ pluginId, method: "studio_describe", input: null as never, outputSchema: studio.info }),
        ]);
        return items
          .filter((item) => !item.archived)
          .map((item) => indexItem(pluginId, item, info));
      },
      () => [],
    );
    return lists
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ITEMS);
  }

  return {
    items(): Promise<StudioIndexItem[]> {
      if (!cached || Date.now() - cached.at > FRESH_MS) {
        const items = load();
        cached = { at: Date.now(), items };
        items.catch(() => (cached = null));
      }
      return cached.items;
    },
    /** Drops the cache, so a just-made item is listed. */
    invalidate(): void {
      cached = null;
    },
  };
}
