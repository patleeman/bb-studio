import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { ModuleServices } from "../modules/services";
import { botSchema } from "../modules/teams/contract";
import type { OfficeProjects } from "./projects";

const schedule = z.object({ id: z.string(), enabled: z.boolean(), trigger: z.object({ cron: z.string().optional() }).passthrough(), execution: z.object({ targetThreadId: z.string().optional() }).passthrough() });
const chief = (bot: { name: string; handle: string }) => /^(chief[- ]of[- ]staff|chief of staff)$/i.test(bot.name.trim()) || bot.handle === "chief-of-staff";
export class BotProjects {
  private pending = new Map<string, Promise<unknown>>();
  constructor(private db: Database.Database, private sdk: BbPluginApi["sdk"], private projects: OfficeProjects, private modules: ModuleServices | undefined, private changed: () => void) {}
  private call(method: string, input: unknown) {
    if (!this.modules?.has("bot-teams")) throw new Error("Bots are unavailable.");
    return this.modules.call("bot-teams", method, input);
  }
  private async details(botId: string) {
    const { bot } = z.object({ bot: botSchema }).parse(await this.call("get", { id: botId }));
    const doc = async (file: string) => z.object({ text: z.string() }).parse(await this.call("document", { id: botId, file })).text;
    const [mission, memory, threads] = await Promise.all([doc("MISSION.md"), doc("MEMORY.md"), this.call("profileThreads", { id: botId }).then(v => z.array(z.object({ threadId: z.string() })).parse(v))]);
    const ids = new Set(threads.map(t => t.threadId));
    const schedules = [];
    for (const project of await this.sdk.projects.list({ includePersonal: true })) {
      const values = await this.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_list", input: { projectId: project.id }, outputSchema: z.array(z.unknown()) });
      for (const value of values) {
        const parsed = schedule.safeParse(value);
        if (parsed.success && parsed.data.execution.targetThreadId && ids.has(parsed.data.execution.targetThreadId)) schedules.push({ ...parsed.data, projectId: project.id });
      }
    }
    return { bot, mission, memory, schedules };
  }
  async overview() {
    if (!this.modules?.has("bot-teams")) return { bots: [] };
    const roster = z.object({ bots: z.array(z.object({ id: z.string() })) }).parse(await this.call("list", null));
    return { bots: await Promise.all(roster.bots.map(async ({ id }) => {
      const { bot, mission, memory, schedules } = await this.details(id);
      return { id, name: bot.name, avatar: bot.avatar || null, providerId: bot.providerId, projectId: bot.projectId, mission, hasMemory: !!memory.trim(), schedules: schedules.length + (bot.intervalMinutes > 0 ? 1 : 0), suggestion: bot.retired ? "retire" as const : chief(bot) ? "chief-of-staff" as const : "project" as const };
    })) };
  }
  migrate(input: { botId: string; projectId?: string | null }) {
    const previous = this.pending.get(input.botId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.import(input));
    this.pending.set(input.botId, next);
    void next.finally(() => { if (this.pending.get(input.botId) === next) this.pending.delete(input.botId); }).catch(() => {});
    return next;
  }
  private async import({ botId, projectId }: { botId: string; projectId?: string | null }) {
    const { bot, mission, memory, schedules } = await this.details(botId);
    const saved = this.db.prepare("SELECT project_id FROM office_bot_projects WHERE bot_id=?").get(botId) as { project_id: string } | undefined;
    if (chief(bot)) {
      projectId = (await this.sdk.projects.list({ includePersonal: true })).find(p => p.kind === "personal")?.id;
      if (!projectId) throw new Error("Personal project unavailable.");
    }
    if (saved && projectId && projectId !== saved.project_id) throw new Error("This bot has already been imported into another project.");
    projectId = saved?.project_id ?? projectId;
    if (!projectId) {
      // A bot's existing home is a safe existing directory on its known host.
      const project = await this.sdk.projects.create({ name: bot.name, source: { type: "local_path", hostId: bot.hostId, path: bot.home } });
      projectId = project.id;
    }
    await this.sdk.projects.get({ projectId });
    this.db.prepare("INSERT OR IGNORE INTO office_bot_projects(bot_id,project_id) VALUES (?,?)").run(botId, projectId);
    const direct = z.object({ threadId: z.string().nullable() }).parse(await this.call("office_direct", { botId }));
    const result = await this.projects.importBot(projectId, { id: botId, name: bot.name, mission, memory, threadId: direct.threadId });
    const active = schedules.filter(a => a.enabled);
    if (bot.intervalMinutes > 0 || active.length) {
      const cron = active[0]?.trigger.cron;
      const parts = cron?.split(/\s+/);
      const supported = parts?.length === 5 && /^(?:[0-5]?\d)$/.test(parts[0]!)
        && /^(?:\*|[01]?\d|2[0-3])$/.test(parts[1]!) && parts[2] === "*" && parts[3] === "*" && ["*", "1-5"].includes(parts[4]!);
      const cadence = supported ? parts[4] === "1-5" ? "weekdays" : parts[1] === "*" ? "hourly" : "daily"
        : !cron && bot.intervalMinutes > 0 && bot.intervalMinutes <= 60 ? "hourly" : "daily";
      const time = supported ? `${parts[1] === "*" ? "09" : parts[1]!.padStart(2, "0")}:${parts[0]!.padStart(2, "0")}` : "09:00";
      // One project heartbeat replaces the bot's active schedules. Preserve old
      // schedules as paused history; do not let both engines keep running.
      await this.projects.runs.set(projectId, result.leadThreadId, result.run?.enabled ? result.run : { enabled: true, cadence, time });
      for (const a of active) await this.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_pause", input: { projectId: a.projectId, automationId: a.id }, outputSchema: z.unknown() });
      if (bot.intervalMinutes > 0) await this.call("update", { id: botId, intervalMinutes: 0 });
    }
    if (direct.threadId && result.leadThreadId === direct.threadId) await this.call("setThreadProfile", { threadId: direct.threadId, botId: null });
    this.changed();
    return this.projects.get(projectId);
  }
  async retire(botId: string) {
    await this.call("retire", { id: botId, retired: true });
    this.changed(); return { ok: true as const };
  }
}
