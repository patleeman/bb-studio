// Stops everything in a copy of bb's Studio database before it becomes this
// install's (start.ts), so nothing of bb's runs here until someone resumes it.
//
// For each Bot it writes what Bots.stop writes (src/bot.ts), without BB:
//   - Pause: a heartbeat that is on is remembered (heartbeat_was_on = 1) and
//     turned off the way ProjectRuns turns one off (src/project-lead.ts): the
//     run is kept with enabled = 0, its schedule is removed. Its active
//     check-ins, reminders and watchers (bot_automations) are paused, their
//     triggers off, each recorded in bot_stop_paused ("bot-automation").
//   - Stop: its active runners are paused, their triggers off, each recorded
//     ("runner"). The Bot ends "stopped".
// Resume (Bots.resume) then turns back on exactly those, as after a Stop.
// The bot-stop test runs the real Bots.stop on the same rows and compares.
//
// Then what no Bot owns: other project and space leads' heartbeats are turned
// off (they're turned on again in the lead's settings), and any scheduler
// trigger still on is turned off. The engine's own every() rows (owner id
// "tick") are housekeeping and stay. Approvals a person gave in bb (mini app
// grants, dashboard scripts) are reset; they're asked for again here.
// Task reminders are Studio settings, not rows: start.ts turns them off in
// the copied key-value store.
//
// BB automations (bb's automations plugin) are not part of Studio's data and
// don't come over, so there is nothing of them to pause here.
import type Database from "better-sqlite3";
import { BOT_RUN_PREFIX, PERSONAL_PROJECT_ID } from "../project-lead";
import { scheduleId, scheduleKey, type SchedulerOwner } from "../triggers/scheduler";
import type { StopSummary } from "./journal";

const BOT_ID = "bot_main";
const SCHEDULER_OWNERS: readonly SchedulerOwner[] = ["heartbeat", "runner", "automation", "watcher"];

type BotRow = { id: string; state: string; heartbeat_was_on: number };
type RunRow = { project_id: string; enabled: number };
type AutomationRow = { id: string; state: string; bb_ids: string; resources: string | null; project_id: string };
type RunnerRow = { id: string; state: string; adopted: number };

const missingTable = (error: unknown) => /no such (table|column)/.test(String((error as Error)?.message ?? error));

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function stopImportedStudio(db: Database.Database, now = Date.now()): StopSummary {
  const summary: StopSummary = { bots: 0, heartbeats: 0, runners: 0, automations: 0, leads: 0, otherTriggers: 0, approvals: 0 };
  const triggerOff = db.prepare("UPDATE triggers SET state = 'off' WHERE owner = ? AND owner_id = ? AND state = 'on'");
  const removeHeartbeat = (projectId: string) => {
    db.prepare("DELETE FROM triggers WHERE owner = 'heartbeat' AND owner_id = ?").run(projectId);
    db.prepare("DELETE FROM trigger_runs WHERE trigger_id = ?").run(scheduleId({ owner: "heartbeat", ownerId: projectId }));
  };
  const runOff = (projectId: string) => {
    removeHeartbeat(projectId);
    db.prepare("UPDATE project_runs SET enabled = 0, automation_id = NULL, automation_project_id = NULL, lead_thread_id = NULL WHERE project_id = ?").run(projectId);
  };
  const remember = db.prepare("INSERT OR IGNORE INTO bot_stop_paused (bot_id, kind, item_id, project_id) VALUES (?, ?, ?, NULL)");
  const runOf = db.prepare("SELECT project_id, enabled FROM project_runs WHERE project_id = ?");

  db.transaction(() => {
    const bots = db.prepare("SELECT id, state, heartbeat_was_on FROM bots ORDER BY (id = ?) DESC, created_at, id").all(BOT_ID) as BotRow[];
    const primary = bots[0]?.id ?? null;
    for (const bot of bots) {
      summary.bots += 1;
      if (bot.state === "active") {
        // Pause (Bots.pause).
        const key = bot.id === primary ? PERSONAL_PROJECT_ID : `${BOT_RUN_PREFIX}${bot.id}`;
        const run = runOf.get(key) as RunRow | undefined;
        if (run?.enabled) {
          db.prepare("UPDATE bots SET heartbeat_was_on = 1, updated_at = ? WHERE id = ?").run(now, bot.id);
          runOff(key);
          summary.heartbeats += 1;
        }
        for (const row of db.prepare("SELECT id, state, bb_ids, resources, project_id FROM bot_automations WHERE bot_id = ? ORDER BY created_at, id").all(bot.id) as AutomationRow[]) {
          if (row.state !== "active") continue;
          const resources: { id: string }[] = row.resources ? JSON.parse(row.resources) : (JSON.parse(row.bb_ids) as string[]).map((id) => ({ id }));
          for (const resource of resources) {
            const scheduled = scheduleKey(resource.id);
            if (scheduled) triggerOff.run(scheduled.owner, scheduled.ownerId);
          }
          db.prepare("UPDATE bot_automations SET state = 'paused', updated_at = ? WHERE id = ?").run(now, row.id);
          remember.run(bot.id, "bot-automation", row.id);
          summary.automations += 1;
        }
        db.prepare("UPDATE bots SET state = 'paused', updated_at = ? WHERE id = ?").run(now, bot.id);
      }
      // Stop (Bots.stop): its runners.
      for (const row of db.prepare("SELECT id, state, adopted FROM bot_runners WHERE bot_id = ? ORDER BY created_at, id").all(bot.id) as RunnerRow[]) {
        if (row.state !== "active") continue;
        if (!row.adopted) triggerOff.run("runner", row.id);
        db.prepare("UPDATE bot_runners SET state = 'paused', updated_at = ? WHERE id = ?").run(now, row.id);
        remember.run(bot.id, "runner", row.id);
        summary.runners += 1;
      }
      db.prepare("UPDATE bots SET state = 'stopped', updated_at = ? WHERE id = ?").run(now, bot.id);
    }

    // Heartbeats no Bot owns: project and space leads.
    for (const row of db.prepare("SELECT project_id FROM project_runs WHERE enabled = 1").all() as { project_id: string }[]) {
      runOff(row.project_id);
      summary.leads += 1;
    }

    // Anything on Studio's scheduler that is still on.
    const placeholders = SCHEDULER_OWNERS.map(() => "?").join(", ");
    summary.otherTriggers = db.prepare(`UPDATE triggers SET state = 'off' WHERE state = 'on' AND owner IN (${placeholders})`).run(...SCHEDULER_OWNERS).changes;
    summary.otherTriggers += db.prepare("UPDATE triggers SET state = 'off' WHERE state = 'on' AND owner_id != 'tick' AND owner NOT IN (" + placeholders + ")").run(...SCHEDULER_OWNERS).changes;
    db.prepare("UPDATE triggers SET lease_until = NULL").run();

    for (const table of ["mini_grants", "dashboard_script_approvals"]) {
      if (!tableExists(db, table)) continue;
      try {
        summary.approvals += db.prepare(`DELETE FROM ${table}`).run().changes;
      } catch (error) {
        if (!missingTable(error)) throw error;
      }
    }
  })();
  return summary;
}
