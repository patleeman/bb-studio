import { z } from "zod";
import type { ModuleServices } from "../modules/services";
import type { OfficeOutput } from "./contract";
import type { Inbox } from "./inbox";
import type { OfficeSpaceStore } from "./space-store";
import { taskList } from "./module-sources";

const rosterSchema = z.object({
  bots: z.array(z.object({
    id: z.string(), name: z.string(), avatar: z.string().nullable(), description: z.string(),
    projectId: z.string().nullable(), model: z.string(), trust: z.enum(["ask", "act"]).default("ask"),
    providerId: z.string().default("codex"),
    working: z.boolean(), retired: z.boolean().optional(),
  })),
  directConversations: z.record(z.string(), z.array(z.object({ threadId: z.string() }))).default({}),
});

/** Reads the module registry at request time: modules register after office
 * startup and remain the owners of bot execution and task handoffs. */
export async function officeTeam(spaceId: string, spaces: OfficeSpaceStore, inbox: Inbox, modules?: ModuleServices): Promise<OfficeOutput<"team_list">> {
  if (spaceId !== "all") spaces.get(spaceId);
  if (!modules?.has("bot-teams")) return { bots: [] };
  const [roster, taskData, events] = await Promise.all([
    modules.call("bot-teams", "list", null).then(value => rosterSchema.parse(value)),
    modules.has("studio-tasks") ? modules.call("studio-tasks", "board", {}).then(value => taskList.parse(value)) : null,
    inbox.events(),
  ]);
  return { bots: roster.bots.filter(bot => !bot.retired && (spaceId === "all" || spaces.forProject(bot.projectId).id === spaceId)).map(bot => {
    const tasks = (taskData?.tasks ?? []).filter(task => !task.archived && task.status !== "done" && task.assignee === `bot:${bot.id}`);
    const threads = new Set([...(roster.directConversations[bot.id] ?? []).map(c => c.threadId), ...tasks.flatMap(t => t.handoff ? [t.handoff.threadId] : [])]);
    const needsYou = events.some(event => event.type === "request" && event.doneAt === null && (event.botId === bot.id || (event.threadId !== null && threads.has(event.threadId))));
    return {
      id: bot.id, name: bot.name, avatar: bot.avatar, role: bot.description || null,
      spaceId: spaces.forProject(bot.projectId).id, model: bot.model || null, trust: bot.trust, providerId: bot.providerId,
      state: needsYou ? "needs_you" : bot.working ? "working" : "idle", activeTaskCount: tasks.length,
    };
  }) };
}
