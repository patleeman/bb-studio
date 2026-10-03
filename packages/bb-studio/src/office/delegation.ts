import { z } from "zod";
import type { ModuleServices } from "../modules/services";
import type { StudioHub } from "../hub";
import type { OfficeInput, OfficeOutput } from "./contract";
import type { OfficeSpaceStore } from "./space-store";
import type { FolderService } from "./folders";
import { taskList } from "./module-sources";
import { officeTask } from "./task";

const botResult = z.object({ bot: z.object({ id: z.string(), projectId: z.string().nullable(), retired: z.boolean().optional() }) });
const createdTask = z.object({ task: z.object({ id: z.string() }) });
const taskResult = z.object({ task: taskList.shape.tasks.element });

export async function delegateOffice(input: OfficeInput<"delegate">, modules: ModuleServices, spaces: OfficeSpaceStore, folders: Pick<FolderService, "ensureCatchAll" | "list">, hub: Pick<StudioHub, "overview">): Promise<OfficeOutput<"delegate">> {
  if (!modules.has("bot-teams") || !modules.has("studio-tasks")) throw new Error("Teams and Tasks must finish loading before delegating work.");
  const { bot } = botResult.parse(await modules.call("bot-teams", "get", { id: input.botId }));
  if (bot.retired) throw new Error("Restore this bot before assigning work.");
  const { items, providers } = await hub.overview();
  const context = (input.context ?? []).map(ref => {
    const item = items.find(i => `${i.pluginId}:${i.id}` === ref);
    if (!item || item.archived) throw new Error(`Context item is unavailable: ${ref}`);
    return item;
  });
  if (context.length && providers.some(p => p.state !== "ready")) throw new Error("Wait for context item providers to finish loading.");
  await folders.ensureCatchAll(spaces.defaultSpace().id);
  const projectId = input.folderId ?? context.find(i => i.projectId)?.projectId ?? bot.projectId ?? spaces.defaultSpace().defaultProjectId!;
  const folder = (await folders.list(spaces.forProject(projectId).id)).find(f => f.id === projectId && !f.archived);
  if (!folder) throw new Error("Choose an available folder for this task.");
  // Link all context before assignment starts the bot. A failed start leaves the
  // task and links available for retry through handOffBot.
  const { task } = createdTask.parse(await modules.call("studio-tasks", "create", {
    title: input.brief.split("\n").find(line => line.trim())!.slice(0, 300), description: input.brief, projectId,
  }));
  try {
    for (const item of context) await modules.call("studio-tasks", "link", { id: task.id, link: {
      target: "item", pluginId: item.pluginId, itemId: item.id, label: item.title, href: item.href,
    } });
    if (input.schedule) await modules.call("studio-tasks", "scheduleBot", { id: task.id, botId: bot.id, schedule: input.schedule });
    else await modules.call("studio-tasks", "update", { id: task.id, assignee: `bot:${bot.id}` });
  } catch (error) { throw new Error(`Task ${task.id} was saved. Delegation could not finish: ${String(error)}`); }
  return { taskId: task.id, task: officeTask(taskResult.parse(await modules.call("studio-tasks", "get", { id: task.id })).task) };
}
