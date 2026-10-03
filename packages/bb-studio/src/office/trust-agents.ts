import type { BbPluginApi, JsonValue, PluginAgentToolContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ModuleServices } from "../modules/services";
import { taskList } from "./module-sources";
import { withOfficeTrust } from "./trust";

const reads = new Set([
  "studio_list_items", "studio_list_spaces", "feed_list", "feed_read", "tasks_boards", "tasks_list", "tasks_get",
  "tables_list", "tables_schema", "tables_query", "bots_views", "bots_view_read", "talk_list", "talk_read", "talk_search",
  "pages_list", "pages_read", "pages_comments", "artifacts_list", "artifacts_read", "excalidraw_list_drawings", "excalidraw_get_drawing",
]);
const progress = z.object({
  id: z.string().optional(), status: z.enum(["in_progress", "review"]).optional(), note: z.string().optional(),
  addLinks: z.array(z.object({ pluginId: z.string(), itemId: z.string(), label: z.string() })).optional(),
}).strict();

async function ownProgress(modules: ModuleServices, args: unknown, context: PluginAgentToolContext): Promise<boolean> {
  const input = progress.safeParse(args);
  if (!input.success || !modules.has("studio-tasks") || !modules.has("bot-teams")) return false;
  const profile = z.object({ botId: z.string().nullable() }).nullable().parse(await modules.call("bot-teams", "threadProfile", { threadId: context.threadId }));
  if (!profile?.botId) return false;
  const { tasks } = taskList.parse(await modules.call("studio-tasks", "board", {}));
  return tasks.some(task => (!input.data.id || task.id === input.data.id) && task.assignee === `bot:${profile.botId}` && task.handoff?.threadId === context.threadId && !task.archived && task.status !== "done");
}

/** Unknown/new tools default to approval for ask bots, so adding a mutation
 * cannot accidentally bypass trust. Reports and updates to one's own handed-off
 * task are part of doing assigned work; editing other work needs approval. */
export function officeTrustAgents(bb: BbPluginApi, modules: ModuleServices): BbPluginApi["agents"] {
  return { ...bb.agents, registerTool: ((tool: Parameters<BbPluginApi["agents"]["registerTool"]>[0]) => {
    bb.agents.registerTool({ ...tool, execute: async (args: never, context: PluginAgentToolContext) => {
      if (reads.has(tool.name) || tool.name === "feed_post" || (tool.name === "tasks_update" && await ownProgress(modules, args, context))) return tool.execute(args, context);
      return withOfficeTrust(bb, modules, context, tool.name, JSON.parse(JSON.stringify(args)) as JsonValue, () => tool.execute(args, context));
    } } as never);
  }) as BbPluginApi["agents"]["registerTool"] };
}
