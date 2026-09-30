// Items from the other Studio add-ons, for embeds and mentions. Pages asks
// each add-on through its Studio contract, so a new add-on shows up without
// changes here.
import type { StudioSchemas } from "@bb-studio/kit/contract";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PLUGIN_ID, type StudioEmbedItem } from "./contract";

const SUITE = ["excalidraw", "artifacts", "talk", "studio-tasks"];
const FRESH_MS = 5_000;
const MAX_TEXT = 20_000;

const artifactSchema = z.object({
  artifact: z
    .object({
      id: z.string(),
      version: z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(["image", "html", "markdown", "code", "text", "pdf", "other"]),
      }),
    })
    .nullable(),
});
const textSchema = z.object({ text: z.string().nullable(), truncated: z.boolean() });

type Sdk = BbPluginApi["sdk"];

export function studioEmbeds(sdk: Sdk, studio: StudioSchemas) {
  let cached: { at: number; items: Promise<StudioEmbedItem[]> } | null = null;

  async function providers(): Promise<string[]> {
    const [{ plugins }, discovered] = await Promise.all([
      sdk.plugins.list(),
      sdk.plugins.experimental_discoverRpc({ method: "studio_list" }).then(
        (methods) => methods.map((method) => method.pluginId),
        () => [] as string[],
      ),
    ]);
    const ids = [...new Set([...SUITE, ...discovered])].filter((id) => id !== PLUGIN_ID && id !== "studio");
    return ids.filter((id) => plugins.some((plugin) => plugin.id === id && plugin.enabled));
  }

  async function load(): Promise<StudioEmbedItem[]> {
    const lists = await Promise.all(
      (await providers()).map(async (pluginId) => {
        try {
          const [{ items }, info] = await Promise.all([
            sdk.plugins.callRpc({ pluginId, method: "studio_list", input: null as never, outputSchema: studio.provider.studio_list.output }),
            sdk.plugins.callRpc({ pluginId, method: "studio_describe", input: null as never, outputSchema: studio.info }),
          ]);
          return items
            .filter((item) => !item.archived)
            .map((item): StudioEmbedItem => {
              const kind = info.kinds.find((each) => each.id === item.kind);
              return {
                pluginId,
                id: item.id,
                kind: item.kind,
                kindLabel: kind?.label ?? item.kind,
                kindIcon: kind?.icon ?? "File",
                title: item.title || "Untitled",
                icon: item.icon,
                preview: item.preview,
                facts: item.facts.map((fact) => fact.value).filter(Boolean),
                badge: item.badge?.label ?? null,
                thumbnailUrl: item.thumbnailUrl,
                href: item.href,
                updatedAt: item.updatedAt,
              };
            });
        } catch {
          // Not installed, disabled, or not a Studio add-on yet.
          return [];
        }
      }),
    );
    return lists
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 500);
  }

  return {
    items(): Promise<StudioEmbedItem[]> {
      if (!cached || Date.now() - cached.at > FRESH_MS) {
        const items = load();
        cached = { at: Date.now(), items };
        items.catch(() => (cached = null));
      }
      return cached.items;
    },
    async artifactView(id: string) {
      const { artifact } = await sdk.plugins.callRpc({ pluginId: "artifacts", method: "get", input: { id } as never, outputSchema: artifactSchema });
      if (!artifact) return null;
      const { version } = artifact;
      let text: string | null = null;
      if (version.type === "markdown" || version.type === "code" || version.type === "text") {
        const result = await sdk.plugins.callRpc({
          pluginId: "artifacts",
          method: "text",
          input: { id, versionId: version.id } as never,
          outputSchema: textSchema,
        });
        text = result.text === null ? null : result.text.slice(0, MAX_TEXT) + (result.truncated || result.text.length > MAX_TEXT ? "\n…" : "");
      }
      const query = `artifact=${encodeURIComponent(artifact.id)}&version=${encodeURIComponent(version.id)}`;
      return { type: version.type, name: version.name, url: `/api/v1/plugins/artifacts/http/content?${query}`, text };
    },
  };
}
