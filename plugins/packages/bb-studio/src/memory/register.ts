// Memory's RPC (./contract.ts) and agent tools: memory_search, memory_add
// and memory_update. The tools act for the Bot of the calling thread
// (MemoryService.caller); a new record's source defaults to that thread.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { memoryRpcContract, memorySourceInput, type MemoryRecordView } from "./contract";
import type { MemoryService } from "./service";

/** A record as the tools return it: compact, with an ISO date. */
export function toolRecord(record: MemoryRecordView) {
  return {
    id: record.id,
    topic: record.topic,
    date: new Date(record.createdAt).toISOString().slice(0, 10),
    source: { kind: record.source.kind, id: record.source.id, title: record.source.title, ...(record.source.section ? { section: record.source.section } : {}), ...(record.sourceState === "finished" ? { finished: true } : {}) },
    text: record.text,
    replaced: !!record.replacedById,
    ...(record.replacedById ? { replacedBy: record.replacedById } : {}),
    ...(record.replacesId ? { replaces: record.replacesId } : {}),
    ...(record.archived ? { archived: true } : {}),
  };
}

export const memorySearchParams = z.object({
  query: z.string().max(500).describe("Words to find in records' topic and text; empty lists the newest"),
  topic: z.string().trim().min(1).max(60).optional().describe("Only this topic"),
  limit: z.number().int().min(1).max(50).optional().describe("At most this many records (default 10)"),
});
export const memoryAddParams = z.object({
  topic: z.string().trim().min(1).max(60).describe("A short topic, reused across records (\"Launch\", \"homelab\", \"Preferences\")"),
  text: z.string().trim().min(1).max(4000).describe("The fact, decision or note, written to stand on its own"),
  source: memorySourceInput.optional().describe("Where it came from; default this thread. A finished conversation's summary: { kind: \"conversation\", id: <its thread id>, title: <its title> }"),
});
export const memoryUpdateParams = z.object({
  id: z.string().min(1).describe("The record to correct (mem_…); it must be current, not already replaced"),
  text: z.string().trim().min(1).max(4000).describe("The corrected text, complete"),
  topic: z.string().trim().min(1).max(60).optional().describe("A new topic; default the old record's"),
});

/** What the user did in the Memory view: the source of their records. */
const BY_YOU = { kind: "manual" as const, title: "Added by you" };
const EDITED_BY_YOU = { kind: "manual" as const, id: null, title: "Edited by you", section: null };

export function registerMemory(bb: Pick<BbPluginApi, "rpc" | "agents">, memory: MemoryService): void {
  bb.rpc.register(memoryRpcContract, {
    "memory.overview": ({ botId }) => memory.overview(botId),
    "memory.list": (input) => memory.list(input),
    "memory.get": async ({ id }) => {
      const record = memory.store.get(id);
      return { record: record ? (await memory.views([record]))[0] ?? null : null };
    },
    "memory.add": async ({ botId, topic, text, source }) => {
      const bot = memory.bot(botId);
      const record = memory.store.add({ botId: bot.id, topic, text, source: await memory.source(source ?? BY_YOU) });
      return { record: (await memory.views([record]))[0]! };
    },
    "memory.update": async ({ botId, id, text, topic }) => {
      const bot = memory.bot(botId);
      const result = memory.store.replace(bot.id, id, { text, ...(topic ? { topic } : {}), source: EDITED_BY_YOU });
      const [record, replaced] = await memory.views([result.record, result.replaced]);
      return { record: record!, replaced: replaced! };
    },
    "memory.archive": async ({ botId, id, archived }) => {
      const bot = memory.bot(botId);
      return { record: (await memory.views([memory.store.archive(bot.id, id, archived)]))[0]! };
    },
    "memory.profile": ({ botId }) => ({ profile: memory.profileInfo(memory.bot(botId).id) }),
  });

  bb.agents.registerTool({
    name: "memory_search",
    description: "Search your memory records (facts, decisions and notes shared by all your conversations) by words, optionally in one topic. Current records come first; replaced ones are marked replaced. Search before you rely on what you remember.",
    parameters: memorySearchParams,
    execute: async ({ query, topic, limit }, ctx) => {
      const { botId } = await memory.caller(ctx.threadId);
      const result = await memory.list({ botId, query, ...(topic ? { topic } : {}), limit: limit ?? 10, sort: query.trim() ? "relevance" : "newest" });
      return JSON.stringify({ total: result.total, records: result.records.map(toolRecord), ...(result.total ? {} : { note: "No records match. Try other words, or no topic." }) });
    },
  });
  bb.agents.registerTool({
    name: "memory_add",
    description: "Save a fact, decision or note to your memory records, under a topic. Its source is this thread unless you give one. Search first; to correct an existing record use memory_update.",
    parameters: memoryAddParams,
    execute: async ({ topic, text, source }, ctx) => {
      const caller = await memory.caller(ctx.threadId);
      const record = memory.store.add({ botId: caller.botId, topic, text, source: source ? await memory.source(source) : caller.source });
      const [view] = await memory.views([record]);
      return `Saved memory record ${record.id} (${record.topic}). ${JSON.stringify(toolRecord(view!))}`;
    },
  });
  bb.agents.registerTool({
    name: "memory_update",
    description: "Correct a memory record: saves a NEW record that replaces it (the old one stays as history, marked replaced). Give the complete new text.",
    parameters: memoryUpdateParams,
    execute: async ({ id, text, topic }, ctx) => {
      const caller = await memory.caller(ctx.threadId);
      const { record } = memory.store.replace(caller.botId, id, { text, ...(topic ? { topic } : {}), source: caller.source });
      const [view] = await memory.views([record]);
      return `Saved memory record ${record.id}; it replaces ${id}, kept as history. ${JSON.stringify(toolRecord(view!))}`;
    },
  });
}
