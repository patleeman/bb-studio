import type { StudioHub } from "../hub";
import type { ModuleServices } from "../modules/services";
import type { OfficeOutput } from "./contract";
import type { Inbox } from "./inbox";
import type { OfficeSpaceStore } from "./space-store";
import { taskList } from "./module-sources";
import { officeTask } from "./task";

export async function officeHome(spaceId: string, inbox: Inbox, spaces: OfficeSpaceStore, hub: StudioHub, modules?: ModuleServices): Promise<OfficeOutput<"home">> {
  if (spaceId !== "all") spaces.get(spaceId);
  const belongs = (projectId: string | null) => spaceId === "all" || spaces.forProject(projectId).id === spaceId;
  const [events, { items, providers }, taskData] = await Promise.all([
    inbox.events(), hub.overview(), modules?.has("studio-tasks") ? modules.call("studio-tasks", "board", {}).then(value => taskList.parse(value)) : null,
  ]);
  const visible = events.filter(e => e.doneAt === null && (spaceId === "all" || e.spaceId === spaceId));
  const hidden = new Set(providers.flatMap(p => p.kinds.filter(k => k.background).map(k => `${p.pluginId}:${k.id}`)));
  return {
    needsYou: visible.filter(e => e.type === "request").slice(0, 50),
    reports: visible.filter(e => e.type === "report").slice(0, 20),
    recent: items.filter(i => !i.archived && belongs(i.projectId) && !["space", "bot", "view"].includes(i.kind) && !hidden.has(`${i.pluginId}:${i.kind}`))
      .sort((a,b) => b.updatedAt - a.updatedAt).slice(0, 20).map(i => ({
        id: i.id, pluginId: i.pluginId, kind: i.kind, title: i.title, href: i.href, projectId: i.projectId, updatedAt: i.updatedAt,
        authorBotId: (i as typeof i & { authorBotId?: string }).authorBotId ?? null,
      })),
    working: (taskData?.tasks ?? []).filter(t => !t.archived && t.status !== "done" && t.assignee?.startsWith("bot:") && belongs(t.projectId)).map(officeTask),
  };
}
