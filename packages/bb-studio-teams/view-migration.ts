import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Store } from "./store";
import { missingThread, type Runtime } from "./mission-runtime";
import type { ThreadProfiles } from "./thread-profiles";
import type { ThreadViews } from "./thread-views";

const automation = z.object({ id: z.string(), execution: z.object({ mode: z.string(), env: z.record(z.string(), z.string()).optional() }).passthrough() }).passthrough();
const metadata = z.object({ channelId: z.string(), botId: z.string(), prompt: z.string() });

/** Resumable migration. No owner messages or old replies enter the new threads. */
export async function migrateViews(bb: BbPluginApi, store: Store, runtime: Runtime, profiles: ThreadProfiles, views: ThreadViews) {
  for (const room of store.rooms()) {
    if (store.db.prepare("SELECT 1 FROM view_migrations WHERE room_id=?").get(room.id)) continue;
    const members = room.memberIds.filter(id => { const b = store.findBot(id); return b && !b.retired; });
    let view = views.all(true).find(v => v.id === room.id);
    if (!view) {
      view = await views.create(room.name, members.map(id => ({ kind: "bot", id })), room.id);
      views.put({ ...view, archived: !!room.archived });
    }
    if (members.length === 1 && !(await views.threads(view)).length) {
      const c = await profiles.newThread(store.get(members[0]!));
      views.addThread(view.id, c.threadId, c.botId);
    }
    const projectId = members.length ? store.get(members[0]!).projectId : store.all()[0]?.projectId;
    if (projectId) {
      const rows = await bb.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_list", input: { projectId } as never, outputSchema: z.array(z.unknown()) });
      for (const row of rows) {
        const result = automation.safeParse(row);
        if (!result.success) continue;
        let meta;
        try { meta = metadata.parse(JSON.parse(result.data.execution.env?.BB_BOTS_CHANNEL_AUTOMATION ?? "")); } catch { continue; }
        if (meta.channelId !== room.id) continue;
        const bot = store.findBot(meta.botId);
        if (!bot || bot.retired) {
          await bb.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_pause", input: { projectId, automationId: result.data.id } as never, outputSchema: z.unknown() });
          continue;
        }
        let thread = (await views.threads(view)).filter(t => t.botId === bot.id && !t.parentThreadId).sort((a,b) => b.updatedAt - a.updatedAt)[0];
        if (!thread) { const c = await profiles.newThread(bot); views.addThread(view.id, c.threadId, bot.id); thread = { id: c.threadId } as typeof thread; }
        await bb.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_update", input: { projectId, automationId: result.data.id, execution: {
          mode: "agent", providerId: bot.providerId, model: bot.model || (await bb.sdk.threads.defaultExecutionOptions({ threadId: thread!.id }))?.model || "", reasoningLevel: bot.reasoningLevel, permissionMode: bot.permissionMode,
          targetThreadId: thread!.id, environment: { type: "host", hostId: bot.hostId, workspace: { type: "personal" } },
          prompt: [meta.prompt, "Report useful findings with feed_post. Use a stable story key and update existing stories. Post nothing when there is nothing new or your result is [PASS]. This is scheduled work; do not create or run more automations. If the owner must answer, ask in this normal thread."].join("\n\n"),
        } } as never, outputSchema: z.unknown() });
      }
    }
    for (const job of store.all().flatMap(bot => store.work(bot.id)).filter(j => j.roomId === room.id && ["queued", "dispatching", "running"].includes(j.status))) await runtime.cancel(job, "Channels were replaced by thread views.");
    const oldThreads = store.db.prepare("SELECT thread_id FROM channel_threads WHERE room_id=?").all(room.id) as { thread_id: string }[];
    for (const bot of store.all()) for (const c of store.conversations(bot.id).filter(c => c.kind === "group" && c.key.startsWith(`group:${room.id}`))) oldThreads.push({ thread_id: c.threadId });
    for (const { thread_id: threadId } of oldThreads) {
      try { await bb.sdk.threads.stop({ threadId }); await bb.sdk.threads.archive({ threadId }); }
      catch (cause) { if (missingThread(cause)) continue; bb.log.warn(`Could not archive retired channel thread ${threadId}: ${String(cause)}`); throw cause; }
    }
    store.db.prepare("INSERT OR IGNORE INTO view_migrations VALUES (?,?)").run(room.id, Date.now());
    views.changed();
  }
}
