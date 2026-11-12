// The one-time move from BB's automations plugin to Studio's own scheduler
// (src/triggers/scheduler.ts), run at every startup and safe to repeat: a
// row already moved holds a `trg_` id and is skipped.
//
// Moved: every project heartbeat (`project_runs`), every runner Studio made
// (`bot_runners` with adopted = 0) and every check-in and reminder
// (`bot_automations`). Watchers and adopted runners stay on the plugin.
//
// For each row: make the trigger with the same schedule and time zone, on
// only when both Studio's row and the BB automation were on (so one BB had
// turned off stays off, and shows paused); write the new id into the row;
// then delete the old BB automation. When the automations plugin does not
// answer, or the automation is gone, the row's own state decides on or off,
// so the move finishes with the plugin off. A schedule that took several BB
// automations becomes one trigger.
//
// The move never waits on a delete. A BB automation that could not be
// deleted (the plugin is off or did not answer) is listed in
// `space_retired_automations`, and the startup repair (ProjectRuns.repair)
// deletes it once the plugin answers again: left alone, it would run beside
// the trigger when the plugin comes back.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { HeartbeatRun } from "../contract";
import { fromHeartbeat, localZone, type Schedule } from "../schedule";
import { parseCron } from "./next-run";
import { isScheduleId, type EngineScheduler } from "./scheduler";

type Sdk = BbPluginApi["sdk"];
const PERSONAL = "proj_personal";
const ASK_MS = 10_000;
const missing = (error: unknown) => (error as { status?: number })?.status === 404 || /not found/i.test(String((error as Error)?.message ?? ""));
const listed = z.array(z.object({
  id: z.string(), enabled: z.boolean(), nextRunAt: z.number().nullish(), lastRunAt: z.number().nullish(),
  trigger: z.object({ timezone: z.string().optional() }).passthrough().optional(),
  execution: z.object({ targetThreadId: z.string().nullish() }).passthrough().optional(),
}).passthrough());
type Listed = z.infer<typeof listed>[number];

export interface MoveDeps {
  db: Database.Database;
  sdk: Sdk;
  scheduler: EngineScheduler;
  /** The thread a heartbeat wakes, by its `project_runs` key (a project's lead, or a Bot's thread). */
  leadOf(key: string): string | null;
  warn?(message: string): void;
  /** How long to wait for the automations plugin before going by the rows. */
  askMs?: number;
}

/** Moves what is still on BB's automations to Studio's scheduler. Returns how many rows it moved. */
export async function moveToScheduler(deps: MoveDeps): Promise<number> {
  const { db, scheduler } = deps;
  const call = (method: string, input: unknown) => deps.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema: z.unknown() });
  // One list per project, and none again once the plugin has not answered.
  const lists = new Map<string, Promise<Map<string, Listed> | null>>();
  let silent = false;
  const list = (projectId: string) => {
    if (silent) return Promise.resolve(null);
    if (!lists.has(projectId)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      lists.set(projectId, Promise.race([
        call("automations_list", { projectId }).then((raw) => new Map(listed.parse(raw).map((each) => [each.id, each] as const))),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("no answer")), deps.askMs ?? ASK_MS); }),
      ]).catch(() => { silent = true; return null; }).finally(() => clearTimeout(timer)));
    }
    return lists.get(projectId)!;
  };
  const live = async (id: string, projectId: string | null) => (await list(projectId ?? PERSONAL))?.get(id);
  const retire = db.prepare("INSERT OR IGNORE INTO space_retired_automations (automation_id, automation_project_id) VALUES (?, ?)");
  const drop = async (id: string, projectId: string | null) => {
    const gone = silent ? false : await call("automations_delete", { projectId: projectId ?? PERSONAL, automationId: id }).then(() => true, (error) => missing(error));
    if (!gone) retire.run(id, projectId ?? PERSONAL);
  };
  const runnable = (schedule: Schedule, what: string) => {
    if (schedule.type !== "cron" || parseCron(schedule.cron)) return true;
    deps.warn?.(`${what} stays on BB automations: Studio can't run its cron "${schedule.cron}".`);
    return false;
  };
  let moved = 0;

  const heartbeats = db.prepare("SELECT * FROM project_runs WHERE automation_id IS NOT NULL AND automation_id NOT LIKE 'trg\\_%' ESCAPE '\\'").all() as (Omit<HeartbeatRun, "cron" | "enabled"> & { project_id: string; enabled: number; cron: string | null; automation_id: string; automation_project_id: string | null })[];
  for (const row of heartbeats) {
    const schedule = fromHeartbeat({ cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) });
    if (!runnable(schedule, `Heartbeat ${row.project_id}`)) continue;
    const old = await live(row.automation_id, row.automation_project_id);
    const threadId = old?.execution?.targetThreadId ?? deps.leadOf(row.project_id);
    const on = !!threadId && !!row.enabled && (old?.enabled ?? true);
    const key = { owner: "heartbeat" as const, ownerId: row.project_id };
    if (on) {
      const id = scheduler.ensure(key, { schedule, timeZone: old?.trigger?.timezone ?? localZone() }, true);
      db.prepare("UPDATE project_runs SET enabled = 1, automation_id = ?, lead_thread_id = ? WHERE project_id = ?").run(id, threadId, row.project_id);
    } else {
      // A heartbeat that is off has no schedule; turning it on makes one.
      scheduler.remove(key);
      db.prepare("UPDATE project_runs SET enabled = 0, automation_id = NULL, automation_project_id = NULL, lead_thread_id = NULL WHERE project_id = ?").run(row.project_id);
    }
    await drop(row.automation_id, row.automation_project_id);
    moved++;
  }

  const runners = db.prepare("SELECT * FROM bot_runners WHERE adopted = 0 AND automation_id IS NOT NULL AND automation_id NOT LIKE 'trg\\_%' ESCAPE '\\'").all() as { id: string; project_id: string; state: string; cadence: HeartbeatRun["cadence"]; time: string; cron: string | null; timezone: string | null; automation_id: string; automation_project_id: string | null; machine_offline: number; machine_suspended: number }[];
  for (const row of runners) {
    const schedule = fromHeartbeat({ cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) });
    if (!runnable(schedule, `Runner ${row.id}`)) continue;
    const projectId = row.automation_project_id ?? row.project_id;
    const old = await live(row.automation_id, projectId);
    const on = (old?.enabled ?? true) && row.state === "active" && !row.machine_offline && !row.machine_suspended;
    const id = scheduler.ensure({ owner: "runner", ownerId: row.id }, { schedule, timeZone: row.timezone ?? old?.trigger?.timezone ?? localZone() }, on);
    db.prepare("UPDATE bot_runners SET automation_id = ? WHERE id = ?").run(id, row.id);
    await drop(row.automation_id, projectId);
    moved++;
  }

  const automations = db.prepare("SELECT * FROM bot_automations WHERE kind IN ('checkin', 'reminder') AND cleanup_pending = 0").all() as { id: string; kind: "checkin" | "reminder"; state: string; project_id: string; schedule_json: string; bb_ids: string; resources: string | null }[];
  for (const row of automations) {
    const resources: { id: string; projectId: string }[] = row.resources ? JSON.parse(row.resources) : (JSON.parse(row.bb_ids) as string[]).map((id) => ({ id, projectId: row.project_id }));
    const olds = resources.filter((each) => !isScheduleId(each.id));
    if (!olds.length) continue;
    const schedule = JSON.parse(row.schedule_json) as Schedule;
    if (!runnable(schedule, `Automation ${row.id}`)) continue;
    const found = (await Promise.all(olds.map((each) => live(each.id, each.projectId)))).filter((each): each is Listed => !!each);
    const on = (found.length ? found.some((each) => each.enabled) : true) && row.state === "active";
    const key = { owner: "automation" as const, ownerId: row.id };
    const id = scheduler.ensure(key, { schedule, timeZone: (schedule.type !== "once" && schedule.timezone) || localZone() }, on);
    // A reminder BB already ran is done, and one whose time passed stays that way. A check-in BB had turned off shows paused, so Resume brings it back.
    const ran = row.kind === "reminder" && found.length > 0 && found.every((each) => each.lastRunAt && !each.nextRunAt);
    const state = row.state !== "active" ? row.state : ran || (row.kind === "reminder" && scheduler.status(key).done) ? "done" : on ? "active" : "paused";
    db.prepare("UPDATE bot_automations SET bb_ids = ?, resources = ?, state = ?, provision_pending = 0 WHERE id = ?").run(JSON.stringify([id]), JSON.stringify([{ id, projectId: olds[0]!.projectId }]), state, row.id);
    for (const each of olds) await drop(each.id, each.projectId);
    moved++;
  }
  return moved;
}
