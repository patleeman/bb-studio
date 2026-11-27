import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Automations } from "../automations";
import type { Bots } from "../bot";
import { errorText } from "../hub";
import { callText, clipLine, nextLine, pageItems, staleCursor } from "../paging";
import { RunnerPreflightError } from "../runner-machines";
import { alertBot, type Runners } from "../runners";
import { parseDuration, type Schedule } from "../schedule";

const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const toolSchedule = z.object({
  times: z.array(hhmm).max(24).optional().describe('HH:MM times, e.g. ["08:00"]'),
  every: z.string().regex(/^\d+\s*(m|min|minutes?|h|hours?)$/).optional().describe("Interval, e.g. 15m or 2h"),
  from: hhmm.optional(),
  to: hhmm.optional(),
  days: z.array(z.number().int().min(0).max(6)).optional().describe("0=Sun..6=Sat"),
  quiet: z.object({ from: hhmm, to: hhmm }).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cron: z.string().max(100).optional(),
  timezone: z.string().max(100).optional(),
  at: z.string().max(60).optional().describe("ISO date-time"),
  in: z.string().max(20).optional().describe("Delay, e.g. 30m, 2h"),
});

function toSchedule(input: z.infer<typeof toolSchedule>): Schedule {
  if (input.at || input.in) {
    const at = input.at ? Date.parse(input.at) : Date.now() + parseDuration(input.in!);
    if (!Number.isFinite(at)) throw new Error(`"${input.at}" isn't a date-time.`);
    return { type: "once", at };
  }
  const common = { ...(input.timezone ? { timezone: input.timezone } : {}), ...(input.quiet ? { quiet: input.quiet } : {}), ...(input.until ? { until: input.until } : {}) };
  const days = (input.days ?? [0, 1, 2, 3, 4, 5, 6]) as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  if (input.cron) return { type: "cron", cron: input.cron, ...common };
  if (input.every) {
    const [, n, unit] = /^(\d+)\s*(\w+)$/.exec(input.every)!;
    return { type: "interval", every: Number(n), unit: unit!.startsWith("h") ? "hours" : "minutes", days, ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}), ...common };
  }
  if (!input.times?.length) throw new Error("Give times, every, cron, at or in.");
  return { type: "times", days, times: input.times, ...common };
}

const automationFields = {
  instruction: z.string().trim().max(2000).optional(),
  schedule: toolSchedule.optional(),
  model: z.string().max(200).optional(),
  reasoning: z.string().max(40).optional(),
  script: z.string().max(262_144).optional().describe("Watcher script (stdout wakes you)"),
  interpreter: z.enum(["bash", "sh", "node", "python3"]).optional(),
  target: z.string().max(200).optional().describe('"main" or runner id/name'),
  machine: z.string().nullable().optional().describe("Runner host id/name, or null for server"),
  confirm: z.boolean().optional().describe("Runner preflight confirm"),
};

type AutomationToolInput = {
  name?: string;
  instruction?: string;
  schedule?: z.infer<typeof toolSchedule>;
  model?: string;
  reasoning?: string;
  script?: string;
  interpreter?: "bash" | "sh" | "node" | "python3";
  target?: string;
  machine?: string | null;
  confirm?: boolean;
};

const automationChanges = (input: AutomationToolInput) => ({
  ...(input.name ? { name: input.name } : {}),
  ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
  ...(input.schedule ? { schedule: toSchedule(input.schedule) } : {}),
  ...(input.model || input.reasoning ? { model: { model: input.model ?? null, reasoning: input.reasoning ?? null } } : {}),
  ...(input.script ? { script: { body: input.script, interpreter: input.interpreter ?? "bash" } } : {}),
  ...(input.target ? { target: input.target } : {}),
  ...(input.machine !== undefined ? { machine: input.machine } : {}),
  ...(input.confirm !== undefined ? { confirm: input.confirm } : {}),
});

/** Schedule changes made in a conversation other than Main are noted in Main, quietly. */
const SCHEDULE_CHANGES = new Set(["runner_migrate", "automation_create", "automation_update", "automation_pause", "automation_resume", "automation_delete"]);

export interface ScheduleToolsDeps {
  bb: BbPluginApi;
  bots: Bots;
  runners: Runners;
  automations: Automations;
  getThreadRecord: (threadId: string) => { kind?: string; title?: string | null } | null;
  ownBot: (threadId: string | undefined) => string;
}

export type RunnerDispatch = (context: { thread: { id: string } }) => Promise<{ action: "reject"; message: string } | null>;

/** Registers the Bot's runner, automation, and history-search tools, and returns the runner dispatch guard. */
export function registerScheduleTools({ bb, bots, runners, automations, getThreadRecord, ownBot }: ScheduleToolsDeps): { runnerDispatch: RunnerDispatch } {
  let machineCheckTimer: ReturnType<typeof setTimeout> | null = null;
  bb.onDispose(() => { if (machineCheckTimer) clearTimeout(machineCheckTimer); });

  const runnerDispatch: RunnerDispatch = async (context) => {
    if (runners.isMovingThread(context.thread.id)) return { action: "reject", message: "Runner is moving to another machine; this run was skipped." };
    const runner = runners.forThread(context.thread.id);
    if (runner && !await runners.available(runner.id, false)) {
      // Leave core's admission lock before pausing the automation or alerting the Bot.
      if (!machineCheckTimer) machineCheckTimer = setTimeout(() => {
        machineCheckTimer = null;
        void runners.checkMachines().catch((error) => bb.log.warn(`Runner machines: ${errorText(error)}`));
      }, 0);
      return { action: "reject", message: "Machine offline; this runner run was skipped." };
    }
    return null;
  };

  const describeRunner = (runner: Awaited<ReturnType<typeof runners.list>>[number]) =>
    `- ${runner.name} (${runner.id}, ${runner.state}${runner.machineName ? `, ${runner.machineName}${runner.machineOffline ? " — machine offline" : ""}` : ""}${runner.adopted ? ", adopted" : ""}): ${runner.schedule.cadence}${runner.schedule.cadence === "custom" ? ` ${runner.schedule.cron}` : ` at ${runner.schedule.time}`}${runner.nextRunAt ? `, next ${new Date(runner.nextRunAt).toLocaleString()}` : ""}. Job: ${runner.job}${runner.lastReport ? `\n  Last report (${runner.lastLevel}): ${runner.lastReport}` : ""}${runner.threadId ? `\n  Thread: /threads/${runner.threadId}` : ""}`;

  const describeAutomation = (each: Awaited<ReturnType<typeof automations.list>>[number]) =>
    `- ${each.name} (${each.kind}, ${each.id}, ${each.state}): ${each.scheduleText}${each.nextRunAt ? `, next ${new Date(each.nextRunAt).toLocaleString()}` : ""}${each.kind === "watcher" ? ` → wakes ${each.targetName}` : ""}. ${each.kind === "watcher" ? `Script (${each.script?.interpreter})` : each.instruction}${each.model?.model ? ` [${each.model.model}${each.model.reasoning ? `/${each.model.reasoning}` : ""}]` : ""}${each.lastOutcome ? `\n  Last: ${each.lastOutcome}` : ""}`;

  const noteScheduleChange = async (name: string, threadId: string | undefined, botId: string, result: string) => {
    const main = bots.stored(botId)?.threadId;
    const rec = threadId ? getThreadRecord(threadId) : null;
    if (!main || !threadId || threadId === main || rec?.kind !== "conversation") return;
    const title = (rec.title ?? (await bb.sdk.threads.get({ threadId }).then((thread) => (thread as { title?: string | null }).title ?? null, () => null)) ?? "another conversation").replace(/[[\]]/g, "");
    const first = result.split("\n").find((line) => line.trim() && !/^Made/.test(line)) ?? result;
    await alertBot(bb.sdk, {
      botThreadId: main,
      line: `🗓 ${name.replace(/_/g, " ")} from [${title}](/threads/${threadId}): ${first.replace(/^- /, "").slice(0, 300)}`,
      note: "A schedule change you made in another conversation, noted here so Main has every schedule change. Don't reply or act on it; reply exactly [PASS].",
    }).catch((error) => bb.log.warn(`Noting a schedule change in Main failed: ${errorText(error)}`));
  };

  const runnerTool = (name: string, description: string, parameters: z.ZodObject, execute: (input: never, botId: string) => Promise<string>) =>
    bb.agents.registerTool({
      name,
      description,
      parameters,
      execute: async (input, ctx) => {
        try {
          const botId = ownBot(ctx.threadId);
          const result = await execute(input as never, botId);
          if (SCHEDULE_CHANGES.has(name) && !result.startsWith("{")) void noteScheduleChange(name, ctx.threadId, botId, result);
          return result;
        } catch (error) {
          if (error instanceof RunnerPreflightError) return JSON.stringify({ warnings: error.warnings, blocked: error.blocked, confirmRequired: !error.blocked });
          throw error;
        }
      },
    });

  runnerTool(
    "runner_migrate",
    "Move a runner to a machine (host id/name, or null for server). Review preflight warnings and retry with confirm: true.",
    z.object({ id: z.string().min(1), machine: z.string().nullable(), confirm: z.boolean().optional() }),
    async (input: { id: string; machine: string | null; confirm?: boolean }, botId) => describeRunner(await runners.migrate(input, botId)),
  );

  runnerTool(
    "automation_list",
    "List what you have scheduled: check-ins, reminders, watchers and runners, one short line each with schedule, state and next run; give id for one item in full (instruction or script, last outcome). The user sees them on the Scheduled page; call them scheduled items, never automations.",
    z.object({ id: z.string().min(1).max(200).optional().describe("One item in full"), after: z.string().min(1).max(512).optional().describe("The cursor the last part's Next names") }),
    async ({ id, after }: { id?: string; after?: string }, botId) => {
      const items = await automations.list(botId);
      if (id) {
        const one = items.find((each) => each.id === id || each.name === id);
        return one ? describeAutomation(one) : `No scheduled item ${id}. List them with ${callText("automation_list", {})}.`;
      }
      if (!items.length) return "Nothing scheduled yet.";
      // One short line each (src/paging.ts); the full item with id.
      const rows = items.map((each) => ({ id: each.id, line: `- ${each.name} (${each.kind}, ${each.id}, ${each.state}): ${each.scheduleText}${each.nextRunAt ? `, next ${new Date(each.nextRunAt).toLocaleString()}` : ""}${each.lastOutcome ? ` · last: ${clipLine(each.lastOutcome, 100)}` : ""}` }));
      const part = pageItems(rows, (each) => each.id, (each) => each.line.length, { after });
      if (part.missing) return staleCursor(`Scheduled item ${after}`, callText("automation_list", {}));
      const next = nextLine(part, (last) => callText("automation_list", { after: last }), "scheduled items");
      return [`${items.length} scheduled item${items.length === 1 ? "" : "s"}. Full details: ${callText("automation_list", { id: "<id>" })}.`, ...(next ? [next] : []), ...part.items.map((each) => each.line)].join("\n");
    },
  );

  runnerTool(
    "automation_create",
    "Create a scheduled item (checkin, reminder, watcher, or runner). Watchers run a script and wake only on stdout (trailing JSON line supports each/key/severity/clear). A runner may answer with preflight warnings: review them and retry with confirm: true. Call them scheduled items to the user.",
    z.object({ kind: z.enum(["checkin", "reminder", "watcher", "runner"]), name: z.string().trim().min(1).max(60), ...automationFields, schedule: toolSchedule }),
    async (input: AutomationToolInput & { kind: "checkin" | "reminder" | "watcher" | "runner"; name: string }, botId) => {
      const schedule = toSchedule(input.schedule!);
      return `Made:\n${describeAutomation(await automations.create({ kind: input.kind, name: input.name, schedule, ...automationChanges(input) } as never, botId))}`;
    },
  );

  runnerTool(
    "automation_update",
    "Update a scheduled item's name, instruction, schedule, model or watcher script.",
    z.object({ id: z.string().min(1).describe("Automation id or name"), name: z.string().trim().min(1).max(60).optional(), ...automationFields }),
    async (input: AutomationToolInput & { id: string }, botId) => describeAutomation(await automations.update({ id: input.id, ...automationChanges(input) } as never, botId)),
  );

  runnerTool("automation_pause", "Pause an automation.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.setState(id, "paused", botId)));
  runnerTool("automation_resume", "Resume a paused automation.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.setState(id, "active", botId)));
  runnerTool("automation_run_now", "Run an automation now, outside its schedule.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.runNow(id, botId)));
  runnerTool("automation_delete", "Delete an automation. Only when the user asks or it's no longer needed.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => { await automations.delete(id, botId); return "Deleted."; });

  bb.agents.registerTool({
    name: "runner_report",
    description: "Report from this run. log: kept in this thread and the Bot's Activity. tell: one short line to the user in the Bot's chat. urgent: tell plus a phone push, and the Bot decides whether to bring it to the user; only when the user must act now. With nothing new, don't call it and finish without a final message.",
    parameters: z.object({ level: z.enum(["log", "tell", "urgent"]), summary: z.string().trim().min(1).max(600).describe("One or two short sentences") }),
    execute: async (input, ctx) => {
      if (!ctx.threadId || !runners.forThread(ctx.threadId)) throw new Error("Only a runner's thread can report.");
      return runners.report(ctx.threadId, input);
    },
  });

  bb.agents.registerTool({
    name: "bot_history_search",
    description: "Search your own past threads (your earlier threads and the threads you started) for words.",
    parameters: z.object({ query: z.string().trim().min(1).max(200) }),
    execute: async ({ query }, ctx) => {
      const hits = await bots.historySearch(query, 10, ownBot(ctx.threadId));
      return hits.length ? hits.map((hit) => `- [${hit.title}](/threads/${hit.threadId}): ${clipLine(hit.text.replace(/\s+/g, " "), 240)}`).join("\n") : "No matches in your threads.";
    },
  });

  return { runnerDispatch };
}
