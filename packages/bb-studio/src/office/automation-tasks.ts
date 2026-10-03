import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Store } from "../modules/teams/store";
import type { ThreadProfiles } from "../modules/teams/thread-profiles";
import { recurringTaskContract } from "./recurring-contract";
import { permissionForTrust } from "./trust";

const automation = z.object({ id: z.string(), name: z.string(), enabled: z.boolean(),
  trigger: z.object({ triggerType: z.literal("schedule"), cron: z.string(), timezone: z.string() }),
  execution: z.object({ mode: z.literal("agent"), targetThreadId: z.string(), prompt: z.string(), permissionMode: z.string() }).passthrough(),
});

/** Convert presentation, not scheduling. Each imported automation receives a
 * dedicated ordinary bot thread so two schedules never claim one task handoff.
 * The old conversation and its history remain intact. */
export function automationTasks(bb: BbPluginApi, store: Store, profiles: ThreadProfiles) {
  store.db.exec("CREATE TABLE IF NOT EXISTS office_automation_threads (automation_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL)");
  return async () => {
    for (const project of await bb.sdk.projects.list({ includePersonal: true })) {
      const values = await bb.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_list", input: { projectId: project.id }, outputSchema: z.array(z.unknown()) });
      for (const value of values) {
        const parsed = automation.safeParse(value);
        if (!parsed.success) continue;
        const current = parsed.data;
        const botId = store.byThread(current.execution.targetThreadId)?.botId;
        if (!botId) continue;
        const bot = store.get(botId);
        const lookup = await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "office_recurringLookup", input: { automationId: current.id }, outputSchema: recurringTaskContract.office_recurringLookup.output });
        if (lookup.suppressed) continue;
        let threadId = lookup.threadId;
        if (!lookup.managed) {
          threadId ??= (store.db.prepare("SELECT thread_id FROM office_automation_threads WHERE automation_id=?").get(current.id) as { thread_id: string } | undefined)?.thread_id ?? null;
          if (!threadId) {
            threadId = (await profiles.newThread(bot, project.id)).threadId;
            store.db.prepare("INSERT INTO office_automation_threads VALUES (?,?)").run(current.id, threadId);
          }
        }
        threadId ??= current.execution.targetThreadId;
        const permissionMode = permissionForTrust(bot.trust ?? "ask");
        if (threadId !== current.execution.targetThreadId || permissionMode !== current.execution.permissionMode) {
          await bb.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_update", input: { projectId: project.id, automationId: current.id,
            agent: { target: { type: "target-thread", threadId }, permissionMode } }, outputSchema: z.unknown() });
        }
        if (lookup.managed) continue;
        await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "office_syncRecurring", input: {
          projectId: project.id, title: current.name, description: current.execution.prompt, botId, threadId,
          enabled: current.enabled, source: { kind: "automation", automationId: current.id, schedule: `${current.trigger.cron} (${current.trigger.timezone})` },
        }, outputSchema: recurringTaskContract.office_syncRecurring.output });
      }
    }
  };
}
