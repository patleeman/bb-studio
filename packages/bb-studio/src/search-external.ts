import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { excerpt, type SearchHit } from "./search-index";

/** Threads stay in their owner; Studio items use the provider index. */
export async function externalResults(bb: BbPluginApi, query: string, options: { kinds?: string[]; projectId?: string | null; limit: number }): Promise<SearchHit[]> {
  const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const allow = (kind: string) => !options.kinds?.length || options.kinds.includes(kind);
  const threads = allow("thread") && query.trim().length >= 2
    ? bb.sdk.threads.search({ query, limitPerGroup: String(Math.min(options.limit, 50)) }).then((found) =>
      [...found.active.results, ...found.archived.results].filter(({ thread }) => options.projectId === undefined || thread.projectId === options.projectId).map(({ thread, matches }) => ({
        ref: { pluginId: "__bb__", id: thread.id }, kind: "thread", title: thread.title ?? thread.titleFallback ?? "Untitled thread",
        snippet: excerpt(matches[0]?.text ?? "", words), href: `/threads/${thread.id}`, projectId: thread.projectId,
        updatedAt: thread.updatedAt, score: matches[0]?.sourceKind === "title" ? 8 : 1,
      }))) : Promise.resolve([] as SearchHit[]);
  return threads.catch(() => [] as SearchHit[]);
}
