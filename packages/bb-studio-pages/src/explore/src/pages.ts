// Where explainers are saved: Pages, over cross-plugin RPC (create, read,
// replace with a version), tagged Explore in Studio. Studio is optional, so
// tagging is best effort.
import type { JsonValue } from "@get-bb/plugin-sdk";
import { STUDIO_PLUGIN_ID, studioTagSchemas } from "@bb-studio/kit/contract";
import { z } from "zod";
import { PAGES_PLUGIN_ID } from "./constants";
import { EXPLORE_TAG } from "./shared";

const MAX_TITLE = 200;
const MAX_SNAPSHOT_NAME = 120;
const TIMEOUT_MS = 30_000;

export interface ExplorePages {
  create(input: { projectId: string | null; parentId: string | null; title: string; icon?: string; markdown: string }): Promise<{ id: string }>;
  /** Saves the current content as a version named `snapshotName` first. */
  replaceMarkdown(id: string, markdown: string, snapshotName: string): Promise<{ id: string }>;
  /** Null when the page is gone; throws when Pages can't be reached. */
  get(id: string): Promise<{ id: string; archived: boolean } | null>;
  markdown(id: string): Promise<string>;
  /** Tags a page `Explore` in Studio; false when that didn't work. */
  tag(pageId: string): Promise<boolean>;
}

export interface CallRpc {
  callRpc<T>(args: { pluginId: string; method: string; input?: JsonValue; outputSchema: z.ZodType<T>; signal?: AbortSignal }): Promise<T>;
}

const tagSchemas = studioTagSchemas(z);
// The part of Pages' contract (bb-studio-pages/src/contract.ts) Explore reads.
const page = z.object({ id: z.string(), archived: z.boolean() });
const pageOutput = z.object({ page });

export function explorePages(plugins: CallRpc): ExplorePages {
  const pages = <T>(method: string, input: JsonValue, outputSchema: z.ZodType<T>) =>
    plugins.callRpc({ pluginId: PAGES_PLUGIN_ID, method, input, outputSchema, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return {
    async create({ projectId, parentId, title, icon, markdown }) {
      const input = { projectId, parentId, title: title.slice(0, MAX_TITLE), markdown, ...(icon ? { icon } : {}) };
      return (await pages("create", input, pageOutput)).page;
    },
    async replaceMarkdown(id, markdown, snapshotName) {
      return (await pages("replaceMarkdown", { id, markdown, snapshotName: snapshotName.slice(0, MAX_SNAPSHOT_NAME) }, pageOutput)).page;
    },
    async get(id) {
      return (await pages("get", { id }, z.object({ page: page.nullable() }))).page;
    },
    async markdown(id) {
      return (await pages("markdown", { id }, z.object({ markdown: z.string() }))).markdown;
    },
    async tag(pageId) {
      try {
        const { tag } = await plugins.callRpc({ pluginId: STUDIO_PLUGIN_ID, method: "createTag", input: { name: EXPLORE_TAG }, outputSchema: tagSchemas.createTag.output });
        await plugins.callRpc({
          pluginId: STUDIO_PLUGIN_ID,
          method: "tagItems",
          input: { items: [{ pluginId: PAGES_PLUGIN_ID, id: pageId }], add: [tag.id], remove: [] },
          outputSchema: tagSchemas.tagItems.output,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
