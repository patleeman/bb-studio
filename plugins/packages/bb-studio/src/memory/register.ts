// Memory's RPC (./contract.ts), kept for the phone app's Memory page. The
// memory records it served are retired (nothing reads or writes
// memory_records), so:
// - memory.overview and memory.profile answer from the Bot's always-on
//   skills (src/core-skill.ts): the "core profile" is their text and budget;
// - memory.list and memory.get find no records;
// - memory.add, memory.update and memory.archive refuse, saying where
//   things go now.
// There are no memory agent tools any more.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { memoryRpcContract } from "./contract";

/** What the RPC needs of Studio's Bots. */
export interface MemoryRpcDeps {
  /** A Studio Bot by id, or the primary; throws for an external Bot or none. */
  bot(botId?: string | null): { id: string; name: string };
  alwaysOn(botId: string): { name: string; body: string; updatedAt: number }[];
  budget(botId: string): { chars: number; cap: number; over: boolean };
  /** The Bot's old core profile page, when it still exists (the phone's Edit link opens it as a page). */
  oldPage(botId: string): string | null;
}

export const RECORDS_RETIRED = "Memory records are retired. Standing rules go in the Bot's always-on skill (Memory → Core), procedures in a skill, and what happened stays in the conversation history.";

export function registerMemory(bb: Pick<BbPluginApi, "rpc">, deps: MemoryRpcDeps): void {
  const profile = (botId: string) => {
    const skills = deps.alwaysOn(botId);
    if (!skills.length) return null;
    const budget = deps.budget(botId);
    return {
      pageId: deps.oldPage(botId) ?? "", title: "Always on", updatedAt: Math.max(...skills.map((skill) => skill.updatedAt)),
      chars: budget.chars, cap: budget.cap, over: budget.over,
      markdown: skills.map((skill) => skill.body.trim()).join("\n\n"),
    };
  };
  const refuse = () => { throw new Error(RECORDS_RETIRED); };
  bb.rpc.register(memoryRpcContract, {
    "memory.overview": ({ botId }) => {
      const bot = deps.bot(botId);
      const core = profile(bot.id);
      return {
        bot: { id: bot.id, name: bot.name },
        profile: core ? { pageId: core.pageId, title: core.title, updatedAt: core.updatedAt, chars: core.chars, cap: core.cap, over: core.over } : null,
        split: { state: "none" as const, legacyPageId: null, legacyTitle: null, splitAt: null },
        counts: { current: 0, replaced: 0, archived: 0 },
        topics: [],
      };
    },
    "memory.list": ({ botId }) => { deps.bot(botId); return { records: [], total: 0 }; },
    "memory.get": () => ({ record: null }),
    "memory.add": refuse,
    "memory.update": refuse,
    "memory.archive": refuse,
    "memory.profile": ({ botId }) => ({ profile: profile(deps.bot(botId).id) }),
  });
}
