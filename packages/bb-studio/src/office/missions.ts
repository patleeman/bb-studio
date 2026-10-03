import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Bot } from "../modules/teams/contract";
import { document, type Store } from "../modules/teams/store";
import { recurringTaskContract } from "./recurring-contract";

/** Keep intervalMinutes as the clock; the task is its durable owner-facing
 * representation. Read the mission verbatim and never overwrite it on disk. */
export function missionTasks(bb: BbPluginApi, store: Store) {
  return async (bot: Bot, threadId?: string) => {
    const mission = await document(bot.home, "MISSION.md");
    const current = threadId ?? store.conversations(bot.id).filter(c => c.kind === "mission" && !c.archivedAt).sort((a,b) => b.createdAt-a.createdAt)[0]?.threadId ?? null;
    return bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "office_syncRecurring", input: {
      projectId: bot.projectId, title: "Standing duty", description: mission.text,
      botId: bot.id, threadId: current, enabled: !bot.retired && !!bot.intervalMinutes,
      source: { kind: "mission", botId: bot.id, intervalMinutes: bot.intervalMinutes ?? 0 },
    }, outputSchema: recurringTaskContract.office_syncRecurring.output });
  };
}
