import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { excerpt, type SearchHit } from "./search-index";

const roomsSchema = z.object({ rooms: z.array(z.object({ id: z.string(), name: z.string(), projectId: z.string().nullable().optional(), updatedAt: z.number(), archived: z.boolean().optional() })) });
const historySchema = z.object({ messages: z.array(z.object({ id: z.string(), text: z.string(), createdAt: z.number() })) });

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
  const channels = allow("channel") ? (async () => {
    const listed = await bb.sdk.plugins.callRpc({ pluginId: "bot-teams", method: "list", input: null as never, outputSchema: roomsSchema });
    const rooms = listed.rooms.filter((room) => !room.archived && (options.projectId === undefined || room.projectId === options.projectId));
    const results = await Promise.all(rooms.map(async (room): Promise<SearchHit[]> => {
      const named = room.name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
      const history = await bb.sdk.plugins.callRpc({ pluginId: "bot-teams", method: "history", input: { id: room.id, query, limit: 3 } as never, outputSchema: historySchema }).catch(() => ({ messages: [] }));
      return [
        ...(named ? [{ ref: { pluginId: "bot-teams", id: room.id }, kind: "channel", title: room.name, snippet: excerpt(room.name, words), href: `/plugins/bot-teams/channels/${room.id}`, projectId: room.projectId ?? null, updatedAt: room.updatedAt, score: 6 }] : []),
        ...history.messages.map((message) => ({ ref: { pluginId: "bot-teams", id: message.id }, kind: "channel", title: room.name, snippet: excerpt(message.text, words), href: `/plugins/bot-teams/channels/${room.id}`, projectId: room.projectId ?? null, updatedAt: message.createdAt, score: 1 })),
      ];
    }));
    return results.flat();
  })().catch(() => [] as SearchHit[]) : Promise.resolve([] as SearchHit[]);
  const [threadHits, channelHits] = await Promise.all([threads.catch(() => [] as SearchHit[]), channels]);
  return [...threadHits, ...channelHits];
}
