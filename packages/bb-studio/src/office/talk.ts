import { z } from "zod";
import type { ModuleServices } from "../modules/services";
import type { OfficeOutput } from "./contract";
import type { OfficeSpaceStore } from "./space-store";
import type { Inbox } from "./inbox";
import { officeTeamServiceContract } from "./team-service-contract";
import { officeTeam } from "./team";
import { taskList } from "./module-sources";
import { officeTask } from "./task";

export async function officeTalk(spaceId: string, modules: ModuleServices, spaces: OfficeSpaceStore): Promise<OfficeOutput<"talk_list">> {
  if (spaceId !== "all") spaces.get(spaceId);
  if (!modules.has("bot-teams")) return { conversations: [] };
  const { conversations } = await modules.client("bot-teams", officeTeamServiceContract).call("office_talk", {});
  return { conversations: conversations.filter(c => spaceId === "all" || spaces.forProject(c.projectId).id === spaceId) };
}

export async function officeBotDesk(botId: string, modules: ModuleServices, spaces: OfficeSpaceStore, inbox: Inbox): Promise<OfficeOutput<"bot_desk">> {
  const bot = (await officeTeam("all", spaces, inbox, modules)).bots.find(b => b.id === botId);
  if (!bot) throw new Error("This teammate is unavailable.");
  const doc = async (file: string) => z.object({ text: z.string() }).parse(await modules.call("bot-teams", "document", { id: botId, file })).text;
  const [taskData, direct, mission, memory] = await Promise.all([
    modules.has("studio-tasks") ? modules.call("studio-tasks", "board", {}).then(v => taskList.parse(v)) : null,
    modules.client("bot-teams", officeTeamServiceContract).call("office_direct", { botId }),
    doc("MISSION.md"), doc("MEMORY.md"),
  ]);
  return { bot, tasks: (taskData?.tasks ?? []).filter(t => !t.archived && t.assignee === `bot:${botId}`).map(officeTask),
    directConversationId: direct.conversationId, directThreadId: direct.threadId,
    profileHref: `/plugins/studio/bots/${botId}`, memory: { mission, memory } };
}
