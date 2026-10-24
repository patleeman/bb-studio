// Auto-resume: BB turns an automation off after its runs fail, even when the
// failure was passing (the host daemon disconnected mid-run, then the retry
// found the thread not runnable). Studio turns its own runner and Bot
// automations back on when that happened, and logs each time.
//
// Studio resumes one only when all of these hold:
//   - Studio has it on: the runner or Studio automation is active (not paused
//     through Studio's Pause or Stop, which record that) and its Bot is
//     active (not paused or stopped);
//   - BB has it off, its latest run failed, and BB turned it off at that
//     failure (not changed since: someone pausing it in BB later leaves it);
//   - every failed run since its last good one failed for a transient reason
//     (transientReason), and its target thread still exists, not archived or
//     deleted (threads.get, which reads hidden threads too);
//   - Studio didn't already resume it after that same failed run.
//
// Cap: at most RESUME_CAP resumes per automation in a rolling 24 hours,
// recorded in automation_auto_resumes (append-only). Past the cap it stays
// off; the owning Bot gets a phone push and one line in its chat to triage
// (the urgent runner_report path), once per failed run, not every sweep.
// When it's on again, a "cleared" row ends the episode.
//
// When: at startup, on the five-minute sweep, and soon after a target thread
// goes idle or fails (BB sends plugins no automation events).
import { readAvailable, type Available } from "./kit/server/read-available";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";

type Sdk = BbPluginApi["sdk"];
export const RESUME_CAP = 3;
const DAY = 24 * 60 * 60_000;
/** BB turns it off in the same moment the run fails; a later change is someone pausing it. */
const SETTLE_MS = 60_000;

/** Clearly passing failures in BB's own messages (apps/server thread-lifecycle, plugins/automations run.ts). */
const TRANSIENT: { pattern: RegExp; reason: string; thread?: boolean }[] = [
  { pattern: /host daemon disconnected/i, reason: "host disconnected" },
  { pattern: /connection to (the )?host was lost/i, reason: "host connection lost" },
  { pattern: /host daemon restarted/i, reason: "host restarted" },
  { pattern: /provider stopped sending progress/i, reason: "provider stalled" },
  // The thread was busy or errored when the run came; only when it still exists (checked separately).
  { pattern: /^Target thread \S+ is unavailable: missing, deleted, archived, or not runnable/i, reason: "thread not runnable", thread: true },
];

/** Why a failed run's error is transient, or null when it isn't (a script's exit, a deleted thread, anything else). */
export function transientReason(error: string | null | undefined): { reason: string; thread: boolean } | null {
  if (!error) return null;
  const found = TRANSIENT.find((each) => each.pattern.test(error.trim()));
  return found ? { reason: found.reason, thread: !!found.thread } : null;
}

export interface ResumeTarget {
  automationId: string;
  projectId: string;
  botId: string;
  /** Which Studio thing owns it: a runner, the Bot's original check-in, or a Studio automation (src/automations.ts). */
  owner: "runner" | "checkin" | "automation";
  ownerId: string;
  name: string;
  /** Studio has it on: not paused through Studio, and its Bot is active. */
  on: boolean;
}

export interface AutoResumeDeps {
  db: Database.Database;
  sdk: Sdk;
  targets(): ResumeTarget[];
  /** Logs a resume: a runner's log entry; a Bot automation's shows in its runs. */
  resumed(target: ResumeTarget, line: string): void | Promise<void>;
  /** Past the cap: a phone push and one line in the Bot's chat, for the Bot to triage. */
  exhausted(target: ResumeTarget, line: string): Promise<void>;
  log?(message: string): void;
  now?(): number;
  delayMs?: number;
}

const automationRow = z.object({
  id: z.string(), enabled: z.boolean(), updatedAt: z.number().nullish(),
  execution: z.object({ targetThreadId: z.string().nullish() }).passthrough().optional(),
}).passthrough();
const runRow = z.object({ id: z.string(), status: z.string(), error: z.string().nullish(), startedAt: z.number().nullish(), finishedAt: z.number().nullish(), scheduledFor: z.number().nullish() }).passthrough();
type Run = z.infer<typeof runRow>;
type LogRow = { delivered: number; id: number; automation_id: string; bot_id: string; owner: string; owner_id: string; event: "resumed" | "exhausted" | "cleared"; reason: string | null; run_id: string | null; message: string | null; at: number };

/** The resume line a runner or Bot automation logs. */
export function resumedLine(reason: string, count: number): string {
  return `Resumed after BB turned it off (${reason}) — ${count} of ${RESUME_CAP} today`;
}

/** The line past the cap. */
export function exhaustedLine(name: string, reason: string): string {
  return `${name} is off: BB turned it off again (${reason}) after ${RESUME_CAP} resumes today. Check it, then resume it.`;
}

/** Studio's resumes of these BB automations, newest first: Bot automations show them among their runs. */
export function resumeLog(db: Database.Database, automationIds: readonly string[], limit = 10): { id: string; at: number; message: string }[] {
  if (!automationIds.length) return [];
  const rows = db.prepare(`SELECT * FROM automation_auto_resumes WHERE event = 'resumed' AND automation_id IN (${automationIds.map(() => "?").join(", ")}) ORDER BY at DESC, id DESC LIMIT ?`).all(...automationIds, limit) as LogRow[];
  return rows.map((row) => ({ id: `resume-${row.id}`, at: row.at, message: row.message ?? "Resumed after BB turned it off" }));
}

export class AutoResume {
  private running: Promise<number> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: AutoResumeDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private call(method: string, input: unknown) {
    return this.deps.sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema: z.unknown() });
  }

  private append(target: ResumeTarget, event: LogRow["event"], fields: { reason?: string | null; runId?: string | null; message?: string | null } = {}): void {
    this.deps.db.prepare("INSERT INTO automation_auto_resumes (automation_id, bot_id, owner, owner_id, event, reason, run_id, message, at, delivered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(target.automationId, target.botId, target.owner, target.ownerId, event, fields.reason ?? null, fields.runId ?? null, fields.message ?? null, this.now(), event === "exhausted" ? 0 : 1);
  }

  private latest(automationId: string): LogRow | undefined {
    return this.deps.db.prepare("SELECT * FROM automation_auto_resumes WHERE automation_id = ? ORDER BY at DESC, id DESC LIMIT 1").get(automationId) as LogRow | undefined;
  }

  /** Resumes in the last 24 hours. */
  count(automationId: string): number {
    return (this.deps.db.prepare("SELECT COUNT(*) AS n FROM automation_auto_resumes WHERE automation_id = ? AND event = 'resumed' AND at > ?").get(automationId, this.now() - DAY) as { n: number }).n;
  }

  /** A Bot's automations past the cap and still off. */
  alerts(botId: string): { automationId: string; owner: ResumeTarget["owner"]; name: string; message: string; at: number }[] {
    return this.deps.targets().filter((target) => target.botId === botId && target.on).flatMap((target) => {
      const row = this.latest(target.automationId);
      return row?.event === "exhausted" ? [{ automationId: target.automationId, owner: target.owner, name: target.name, message: row.message ?? exhaustedLine(target.name, row.reason ?? "failed"), at: row.at }] : [];
    });
  }

  /** A sweep soon, once (debounced): a target thread went idle or failed. */
  later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.sweep().catch((error) => this.deps.log?.(`Auto-resume failed: ${(error as Error)?.message ?? error}`)); }, this.deps.delayMs ?? 30_000);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Checks every target once; returns how many it resumed. */
  sweep(): Promise<number> {
    this.running ??= this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<number> {
    const targets = this.deps.targets().filter((target) => target.on);
    if (!targets.length) return 0;
    const lists = new Map<string, Promise<Available<z.infer<typeof automationRow>[]>>>();
    let resumed = 0;
    for (const target of targets) {
      try {
        const pending = this.latest(target.automationId);
        if (pending?.event === "exhausted" && !pending.delivered) {
          await this.deliver(target, pending);
          continue;
        }
        if (!lists.has(target.projectId)) lists.set(target.projectId, this.list(target.projectId));
        const result = await lists.get(target.projectId)!;
        const automation = result.status === "ok" ? result.value.find((row) => row.id === target.automationId) : undefined;
        if (automation && await this.check(target, automation)) resumed++;
      } catch (error) {
        this.deps.log?.(`Auto-resume of ${target.name} (${target.automationId}) failed: ${(error as Error)?.message ?? error}`);
      }
    }
    return resumed;
  }

  private async list(projectId: string): Promise<Available<z.infer<typeof automationRow>[]>> {
    const result = await readAvailable(async () => z.array(automationRow).parse(await this.call("automations_list", { projectId })));
    if (result.status === "unavailable") this.deps.log?.(`Automation list unavailable for ${projectId}: ${String(result.error)}`);
    return result;
  }

  private async runs(target: ResumeTarget): Promise<Run[]> {
    const result = await readAvailable(async () => z.object({ runs: z.array(runRow) }).passthrough().parse(await this.call("automations_runs", { projectId: target.projectId, automationId: target.automationId, limit: 10 })));
    if (result.status === "unavailable") throw result.error;
    const at = (run: Run) => run.startedAt ?? run.scheduledFor ?? run.finishedAt ?? 0;
    return result.status === "ok" ? [...result.value.runs].sort((a, b) => at(b) - at(a)) : [];
  }

  /** True when the thread is there to run in: not missing, archived or deleted. */
  private async threadAlive(threadId: string): Promise<boolean> {
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as { archivedAt?: number | null; deletedAt?: number | null } | null;
    return !!thread && !thread.archivedAt && !thread.deletedAt;
  }

  private async deliver(target: ResumeTarget, row: LogRow): Promise<void> {
    await this.deps.exhausted(target, row.message ?? exhaustedLine(target.name, row.reason ?? "failed"));
    this.deps.db.prepare("UPDATE automation_auto_resumes SET delivered = 1 WHERE id = ?").run(row.id);
  }

  private async check(target: ResumeTarget, automation: z.infer<typeof automationRow>): Promise<boolean> {
    if (automation.enabled) {
      // On again (the user or the Bot resumed it, or a resume took): the episode ends.
      if (this.latest(target.automationId)?.event === "exhausted") this.append(target, "cleared");
      return false;
    }
    const runs = await this.runs(target);
    // The failures since its last run that didn't fail; none means the user (or something else) turned it off.
    const streak: Run[] = [];
    for (const run of runs) { if (run.status !== "failed") break; streak.push(run); }
    const last = streak[0];
    if (!last) return false;
    if (automation.updatedAt && last.finishedAt && automation.updatedAt > last.finishedAt + SETTLE_MS) return false;
    const handled = this.deps.db.prepare("SELECT event FROM automation_auto_resumes WHERE automation_id = ? AND run_id = ?").all(target.automationId, last.id) as { event: string }[];
    // Resumed after this failure and off again with no new run: someone paused it.
    if (handled.some((row) => row.event === "resumed")) return false;
    const reasons = streak.map((run) => transientReason(run.error));
    if (reasons.some((reason) => !reason)) return false;
    const threads = new Set<string>();
    if (automation.execution?.targetThreadId) threads.add(automation.execution.targetThreadId);
    streak.forEach((run, i) => { const id = reasons[i]!.thread ? /^Target thread (\S+)/.exec(run.error ?? "")?.[1] : undefined; if (id) threads.add(id); });
    for (const threadId of threads) if (!(await this.threadAlive(threadId))) return false;
    // The first failure is the cause (a disconnect), the later ones its retries.
    const reason = reasons.at(-1)!.reason;
    const count = this.count(target.automationId);
    if (count >= RESUME_CAP) {
      if (handled.some((row) => row.event === "exhausted")) return false;
      const line = exhaustedLine(target.name, reason);
      this.append(target, "exhausted", { reason, runId: last.id, message: line });
      await this.deliver(target, this.latest(target.automationId)!);
      return false;
    }
    await this.call("automations_resume", { projectId: target.projectId, automationId: target.automationId });
    const line = resumedLine(reason, count + 1);
    this.append(target, "resumed", { reason, runId: last.id, message: line });
    this.deps.log?.(`${target.name} (${target.automationId}): ${line}`);
    await this.deps.resumed(target, line);
    return true;
  }
}
