import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { excerpt, type SearchHit } from "./search-index";

/** Live sources stay in their owner; Studio never copies thread or channel messages. */
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
  const views = allow("view") && options.projectId === undefined ? bb.sdk.plugins.callRpc({pluginId:"bot-teams",method:"views",input:{} as never,outputSchema:z.array(z.object({id:z.string(),name:z.string(),updatedAt:z.number(),archived:z.boolean()}))}).then(rows=>rows.filter(v=>!v.archived && v.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(v=>({ref:{pluginId:"bot-teams",id:v.id},kind:"view",title:v.name,snippet:excerpt(v.name,words),href:`/plugins/bot-teams/views/${v.id}`,projectId:null,updatedAt:v.updatedAt,score:6}))) : Promise.resolve([] as SearchHit[]);
  const results = await Promise.all([threads.catch(()=>[] as SearchHit[]),views.catch(()=>[] as SearchHit[])]);
  return results.flat();
}
