import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { StudioHub } from "../hub";
import type { ModuleServices } from "../modules/services";
import { officeContract, type OfficeOutput } from "./contract";
import { delegateOffice } from "./delegation";
import type { FolderService } from "./folders";
import type { OfficeSpaceStore } from "./space-store";

const rosterSchema = z.object({ bots: z.array(z.object({
  id: z.string(), handle: z.string(), projectId: z.string().nullable(), retired: z.boolean().optional(),
})) });

export async function startOffice(
  { spaceId, request }: z.output<typeof officeContract.office_start.input>,
  threads: Pick<BbPluginApi["sdk"]["threads"], "spawn">,
  spaces: OfficeSpaceStore,
  folders: Pick<FolderService, "ensureCatchAll" | "list">,
  hub: Pick<StudioHub, "overview">,
  modules?: ModuleServices,
): Promise<OfficeOutput<"office_start">> {
  spaces.get(spaceId);
  await folders.ensureCatchAll(spaceId);
  const space = spaces.get(spaceId);
  const projectId = space.projectIds.includes(request.projectId) ? request.projectId : space.defaultProjectId;
  if (!projectId) throw new Error("This Space needs a default folder before starting work.");
  const text = request.input.find(part => part.type === "text")?.text;
  const mention = typeof text === "string" ? /^@([a-zA-Z0-9_-]+)(?=\s|$)/.exec(text) : null;
  if (mention && modules?.has("bot-teams")) {
    const { bots } = rosterSchema.parse(await modules.call("bot-teams", "list", null));
    const bot = bots.find(bot => !bot.retired && bot.handle.toLowerCase() === mention[1]!.toLowerCase()
      && spaces.forProject(bot.projectId).id === spaceId);
    if (bot) {
      const brief = text!.slice(mention[0].length).trim();
      const input = officeContract.delegate.input.parse({ botId: bot.id, brief, folderId: projectId });
      const { taskId } = await delegateOffice(input, modules, spaces, folders, hub);
      return { taskId, botId: bot.id };
    }
  }
  const thread = await threads.spawn({ ...request, projectId });
  return { threadId: thread.id };
}
