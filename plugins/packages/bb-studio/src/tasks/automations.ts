import type Database from "better-sqlite3";
import { isSilentOutput } from "../kit/silent";
import { describeSchedule, fromHeartbeat, type Schedule } from "../schedule";
import { isClosed, USER_OWNER, type AutomationKind, type AutomationLink, type Task } from "./contract";
import { backupDatabase } from "./migrate";
import { TaskStore } from "./store";

export type AutomationBotInfo = { id: string; name: string; threadId: string | null; heartbeatKey: string | null };
export type AutomationSource = {
  id: string;
  kind: AutomationKind;
  botId: string;
  name: string;
  scheduleText: string;
  cron: string | null;
  timeZone: string | null;
  state: "active" | "paused" | "over";
  owner: string;
  thread: string | null;
  mode: "dedupe" | "each" | null;
  keys: string[];
};
export type WatcherPlan = { post: string; note: string; taskId: string };
export type SyncReport = { created: number; updated: number; closed: number; backup: string | null; backupError?: string };

export const CLEAR_AFTER_MS = 30 * 3_600_000;
export const KEEP_RUNS = 20;
export const KEEP_RUN_DAYS_MS = 14 * 86_400_000;
const LINE_MAX = 300;

export const parentIdOf = (sourceId: string) => `task_auto-${sourceId.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 85);
const firstLine = (text: string | null | undefined) => (text ?? "").replace(/::[a-z-]+\{[^}]*\}/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`#>]+/g, "")
  .split("\n").map((line) => line.trim()).find(Boolean) ?? "";
const clip = (text: string, max = LINE_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const hasTable = (db: Database.Database, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

export function findingKey(line: string): string {
  return line.toLowerCase().replace(/[0-9.,$%]/g, "").replace(/\s+/g, " ").trim();
}

const SHELL_PRINT = /^(echo|printf)\s+("[^"`$\\]*"|'[^']*')$/;
const PRINT_ONLY: Record<string, RegExp> = {
  bash: SHELL_PRINT,
  sh: SHELL_PRINT,
  node: /^console\.log\(("[^"\\]*"|'[^'\\]*')\);?$/,
  python3: /^print\(("[^"\\]*"|'[^'\\]*')\)$/,
};

export function alwaysPrints(script: string | null | undefined, interpreter: string | null | undefined): boolean {
  const shape = PRINT_ONLY[interpreter ?? "bash"];
  const lines = (script ?? "").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
  return !!shape && lines.length > 0 && lines.every((line) => shape.test(line));
}

export type WatcherControl = { key?: string; clear?: true | string[]; owner?: string; each?: boolean };

export function splitControl(output: string): { body: string; control: WatcherControl | null } {
  const lines = output.replace(/\s+$/, "").split("\n");
  const last = lines.at(-1)?.trim() ?? "";
  if (!last.startsWith("{")) return { body: output.trim(), control: null };
  let parsed: unknown;
  try { parsed = JSON.parse(last); } catch { return { body: output.trim(), control: null }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { body: output.trim(), control: null };
  const p = parsed as Record<string, unknown>;
  const control: WatcherControl = {};
  if (typeof p.key === "string" && p.key.trim()) control.key = p.key.trim().slice(0, 200);
  if (p.clear === true) control.clear = true;
  else if (Array.isArray(p.clear)) control.clear = p.clear.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean);
  if (typeof p.owner === "string" && /^(cos|thread:.+)$/.test(p.owner)) control.owner = p.owner;
  if (p.each === true) control.each = true;
  return { body: lines.slice(0, -1).join("\n").trim(), control };
}

type BotAutomationRow = { id: string; bot_id: string; kind: string; name: string; script: string | null; interpreter: string | null; target: string; schedule_json: string; state: string };
type RunnerRow = { id: string; bot_id: string; name: string; thread_id: string | null; state: string; cadence: string; time: string; cron: string | null; timezone: string | null };
type ProjectRunRow = { project_id: string; enabled: number; cadence: string; time: string; cron: string | null; lead_thread_id: string | null };

function scheduleFields(schedule: Schedule): { scheduleText: string; cron: string | null; timeZone: string | null } {
  let scheduleText = "Custom";
  try { scheduleText = describeSchedule(schedule); } catch { scheduleText = "Custom"; }
  return { scheduleText, cron: schedule.type === "cron" ? schedule.cron : null, timeZone: schedule.type !== "once" ? schedule.timezone ?? null : null };
}

export function readSources(db: Database.Database, bots: readonly AutomationBotInfo[]): AutomationSource[] {
  const out: AutomationSource[] = [];
  const automations = hasTable(db, "bot_automations");
  const runners = hasTable(db, "bot_runners");
  const runs = hasTable(db, "project_runs");
  for (const bot of bots) {
    const runnerRows = runners ? db.prepare("SELECT id, bot_id, name, thread_id, state, cadence, time, cron, timezone FROM bot_runners WHERE bot_id = ? AND cleanup_pending = 0 ORDER BY created_at, id").all(bot.id) as RunnerRow[] : [];
    if (automations) {
      const rows = db.prepare("SELECT id, bot_id, kind, name, script, interpreter, target, schedule_json, state FROM bot_automations WHERE bot_id = ? AND cleanup_pending = 0 AND kind IN ('checkin', 'watcher') ORDER BY created_at, id").all(bot.id) as BotAutomationRow[];
      for (const row of rows) {
        let schedule: Schedule;
        try { schedule = JSON.parse(row.schedule_json) as Schedule; } catch { continue; }
        const runner = row.kind === "watcher" && row.target !== "main" ? runnerRows.find((r) => r.id === row.target) : undefined;
        const thread = runner?.thread_id ?? bot.threadId;
        out.push({
          id: row.id, kind: row.kind as AutomationKind, botId: bot.id, name: row.name, ...scheduleFields(schedule),
          state: row.state === "active" ? "active" : row.state === "paused" ? "paused" : "over",
          owner: runner?.thread_id ? `thread:${runner.thread_id}` : "cos", thread,
          mode: row.kind === "watcher" ? (alwaysPrints(row.script, row.interpreter) ? "each" : "dedupe") : null,
          keys: [`${row.kind === "watcher" ? "watcher" : "automation"}:${row.id}`],
        });
      }
    }
    for (const row of runnerRows) {
      const schedule = fromHeartbeat({ cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) }, row.timezone ?? undefined);
      out.push({
        id: row.id, kind: "runner", botId: bot.id, name: row.name, ...scheduleFields(schedule), state: row.state === "active" ? "active" : "paused",
        owner: row.thread_id ? `thread:${row.thread_id}` : "cos", thread: row.thread_id, mode: null, keys: [`runner:${row.id}`],
      });
    }
    if (runs && bot.heartbeatKey) {
      const row = db.prepare("SELECT project_id, enabled, cadence, time, cron, lead_thread_id FROM project_runs WHERE project_id = ?").get(bot.heartbeatKey) as ProjectRunRow | undefined;
      if (row) {
        const schedule = fromHeartbeat({ cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) });
        out.push({
          id: `heartbeat:${bot.id}`, kind: "heartbeat", botId: bot.id, name: "Check-in", ...scheduleFields(schedule), state: row.enabled ? "active" : "paused",
          owner: "cos", thread: row.lead_thread_id ?? bot.threadId, mode: null, keys: [`heartbeat:${row.project_id}`],
        });
      }
    }
  }
  return out;
}

const runNote = (id: string) => `This run is task ${id}. If something needs the user, hand it to them with task_handoff (to "user", needs: what they must do or decide) instead of only writing it here; otherwise it closes by itself when you finish.`;
const findingNote = (id: string) => `This finding is task ${id}. Record what you do about it with task_update, and hand it to the user with task_handoff only if they must act. Leave it open while the problem lasts: the watcher adds repeats to it quietly and closes it when the problem clears.`;
export const URGENT_RUN_NOTE = (id: string) => `This run is task ${id}, now in the user's Today and waiting on them. If they must act, post its card once on its own line: ::loop{id="${id}"}. If you can handle it yourself, take it with task_handoff to "cos" and close it with task_update when done.`;

export class AutomationTasks {
  constructor(readonly store: TaskStore, readonly deps: { sources(): AutomationSource[]; log?(message: string): void; zone?(): string }) {}

  private now() { return this.store.now(); }

  private parents(): Task[] {
    return this.store.rows("SELECT record FROM tasks WHERE parent_id IS NULL AND json_extract(record, '$.automation.role') = 'schedule' ORDER BY rowid");
  }

  private openChildren(parentId: string): Task[] {
    return this.store.rows("SELECT record FROM tasks WHERE parent_id = ? AND closed_at IS NULL ORDER BY created_at, id", parentId);
  }

  source(match: (s: AutomationSource) => boolean): AutomationSource | null {
    return this.deps.sources().find(match) ?? null;
  }

  private desired(src: AutomationSource, existing: Task | null): Task {
    const now = this.now();
    const base: Task = existing ? structuredClone(existing) : {
      id: parentIdOf(src.id), title: src.name, why: "", owner: src.owner, state: "in_progress", kind: "do", options: [], needs: null, priority: "normal",
      conversation: null, project: null, area: null, timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false },
      progress: { step: null, line: null }, workers: [], outputs: [], source: { kind: "automation", ref: src.id }, parentId: null, schedule: null, card: null,
      automation: null, stale: false, origin: "task", createdAt: now, updatedAt: now, closedAt: null, closedBy: null,
    };
    base.title = src.name;
    base.owner = src.owner;
    base.state = src.state === "active" ? "in_progress" : src.state === "paused" ? "waiting" : "done";
    base.schedule = { text: src.scheduleText, cron: src.cron, timeZone: src.timeZone, automationId: src.id, paused: src.state === "paused" };
    const link: AutomationLink = existing?.automation ?? { id: src.id, kind: src.kind, role: "schedule", thread: null, keys: [], count: 0, lastAt: null, mode: null, clearedAt: null };
    base.automation = { ...link, id: src.id, kind: src.kind, role: "schedule", thread: src.thread, mode: src.mode };
    return base;
  }

  private same(a: Task, b: Task) {
    return a.title === b.title && a.owner === b.owner && a.state === b.state && JSON.stringify(a.schedule) === JSON.stringify(b.schedule)
      && a.automation?.thread === b.automation?.thread && a.automation?.mode === b.automation?.mode;
  }

  private ensureParent(src: AutomationSource): Task {
    const existing = this.store.find(parentIdOf(src.id));
    if (existing && this.same(existing, this.desired(src, existing))) return existing;
    this.apply(src, existing);
    return this.store.get(parentIdOf(src.id));
  }

  private apply(src: AutomationSource, existing: Task | null): "created" | "updated" | null {
    const next = this.desired(src, existing);
    if (!existing) {
      if (src.state === "over") return null;
      this.store.write(next);
      this.store.event(next.id, "created", { by: "cos", owner: next.owner, automation: src.id });
      return "created";
    }
    if (this.same(existing, next)) return null;
    this.store.change(existing.id, (t) => {
      t.title = next.title; t.owner = next.owner; t.state = next.state; t.schedule = next.schedule; t.automation = next.automation;
    }, "cos");
    return "updated";
  }

  sync(options: { backup?: boolean } = {}): SyncReport {
    const report: SyncReport = { created: 0, updated: 0, closed: 0, backup: null };
    const sources = this.deps.sources();
    const parents = new Map(this.parents().map((t) => [t.id, t]));
    const fresh = sources.filter((src) => src.state !== "over" && !parents.has(parentIdOf(src.id)));
    if (options.backup && !parents.size && fresh.length) {
      try { report.backup = backupDatabase(this.store.db, this.now(), "automation-tasks"); }
      catch (error) { report.backupError = error instanceof Error ? error.message : String(error); }
    }
    this.store.db.transaction(() => {
      for (const src of sources) {
        const id = parentIdOf(src.id);
        const done = this.apply(src, parents.get(id) ?? null);
        parents.delete(id);
        if (done === "created") report.created++;
        else if (done === "updated") report.updated++;
      }
      for (const left of parents.values()) {
        if (isClosed(left)) continue;
        this.store.change(left.id, (t) => { t.state = "dropped"; t.progress.line = "Deleted"; if (t.schedule) t.schedule.paused = false; }, "cos");
        report.closed++;
      }
    })();
    if (report.created || report.updated || report.closed) this.store.changed();
    return report;
  }

  private setParent(parentId: string | null, patch: (link: AutomationLink, t: Task) => void): void {
    if (!parentId) return;
    const parent = this.store.find(parentId);
    if (!parent?.automation) return;
    const next = structuredClone(parent);
    patch(next.automation!, next);
    if (JSON.stringify(next) === JSON.stringify(parent)) return;
    next.updatedAt = this.now();
    this.store.save(next);
  }

  private whenLabel(at: number, src: AutomationSource): string {
    const timeZone = src.timeZone ?? this.deps.zone?.() ?? undefined;
    try { return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }); }
    catch { return new Date(at).toISOString().slice(0, 16).replace("T", " "); }
  }

  openRun(src: AutomationSource, thread: string | null): Task {
    const parent = this.ensureParent(src);
    const now = this.now();
    for (const left of this.openChildren(parent.id)) {
      if (left.automation?.role !== "run" || left.owner === USER_OWNER || left.state !== "in_progress") continue;
      this.store.change(left.id, (t) => { t.state = "done"; t.progress.line = t.progress.line ?? "No report"; }, left.owner);
    }
    const run: Task = {
      id: this.store.newId("task"), title: `${src.name} · ${this.whenLabel(now, src)}`, why: "", owner: src.owner, state: "in_progress", kind: "do", options: [], needs: null,
      priority: "normal", conversation: null, project: null, area: null, timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false },
      progress: { step: null, line: null }, workers: [], outputs: [], source: { kind: "automation", ref: src.id }, parentId: parent.id, schedule: null, card: null,
      automation: { id: src.id, kind: src.kind, role: "run", thread, keys: [], count: 0, lastAt: null, mode: null, clearedAt: null },
      stale: false, origin: "task", createdAt: now, updatedAt: now, closedAt: null, closedBy: null,
    };
    const saved = this.store.save(run);
    this.store.event(saved.id, "created", { by: src.owner, owner: saved.owner, automation: src.id });
    this.setParent(parent.id, (link) => { link.count += 1; link.lastAt = now; });
    return saved;
  }

  started(key: { owner: string; ownerId: string }, threadId: string): { prompt: string; failed(error: string): void } | null {
    const want = `${key.owner}:${key.ownerId}`;
    const src = this.source((s) => s.keys.includes(want));
    if (!src || src.kind === "watcher") return null;
    const run = this.openRun(src, threadId);
    return {
      prompt: src.kind === "runner" ? `This run is task ${run.id}; runner_report records its result there.` : runNote(run.id),
      failed: (error) => this.close(run.id, "failed", `Failed: ${clip(firstLine(error))}`),
    };
  }

  private close(id: string, state: "done" | "failed", line: string): void {
    const run = this.store.find(id);
    if (!run || isClosed(run)) return;
    const at = this.now();
    this.store.change(id, (t) => { t.state = state; t.progress.line = clip(line); if (t.automation) t.automation.lastAt = at; }, run.owner);
    this.setParent(run.parentId, (_, parent) => { parent.progress.line = clip(line); });
  }

  settle(threadId: string, text: string | null | undefined, status: "succeeded" | "failed"): number {
    const now = this.now();
    const runs = this.store.rows("SELECT record FROM tasks WHERE parent_id IS NOT NULL AND closed_at IS NULL AND json_extract(record, '$.automation.role') = 'run' ORDER BY created_at, id")
      .filter((t) => t.automation?.role === "run" && t.automation.thread === threadId && t.createdAt <= now);
    let settled = 0;
    for (const run of runs) {
      if (run.owner === USER_OWNER) {
        this.setParent(run.parentId, (_, parent) => { parent.progress.line = clip(`Needs you: ${run.needs ?? run.title}`); });
        continue;
      }
      if (run.state !== "in_progress") continue;
      const line = status === "failed" ? `Failed: ${firstLine(text) || "the run stopped"}` : run.progress.line ?? (isSilentOutput(text) ? "Nothing new" : firstLine(text) || "Ran");
      this.close(run.id, status === "failed" ? "failed" : "done", line);
      settled++;
    }
    return settled;
  }

  report(runnerId: string, threadId: string, level: "log" | "tell" | "urgent", summary: string): string | null {
    const src = this.source((s) => s.kind === "runner" && s.id === runnerId);
    if (!src) return null;
    const parent = this.ensureParent(src);
    const open = this.openChildren(parent.id).filter((t) => t.automation?.role === "run" && t.automation.thread === threadId && t.owner === src.owner).at(-1);
    const run = open ?? this.openRun(src, threadId);
    const line = clip(summary.trim().replace(/\s+/g, " "));
    if (level !== "urgent") {
      this.close(run.id, "done", line);
      return null;
    }
    this.store.change(run.id, (t) => {
      t.owner = USER_OWNER; t.state = "waiting"; t.needs = line; t.progress.line = null; t.attention.queue = "surfaced"; t.title = clip(`${src.name}: ${line}`, 160);
    }, src.owner);
    this.store.event(run.id, "handed_to_you", { by: src.owner });
    this.setParent(parent.id, (_, p) => { p.progress.line = clip(`Needs you: ${line}`); });
    return URGENT_RUN_NOTE(run.id);
  }

  watcherRun(watcherId: string, finding: string | null, raw: string | null, at: number): WatcherPlan | "quiet" | null {
    const src = this.source((s) => s.kind === "watcher" && s.id === watcherId);
    if (!src) return null;
    const parent = this.ensureParent(src);
    const { body, control } = splitControl(finding ?? raw ?? "");
    if (control?.clear) this.clearKeys(parent, control.clear, at);
    if (finding === null || !body) {
      this.ran(parent, [], at);
      this.setParent(parent.id, (link, p) => { link.count += 1; link.lastAt = at; if (src.mode !== "each") p.progress.line = this.openFindings(parent.id).length ? p.progress.line : "Nothing found"; });
      return "quiet";
    }
    const mode = control?.each ? "each" : control?.key ? "dedupe" : src.mode ?? "dedupe";
    if (mode === "each") {
      const run = this.openRun(src, src.thread);
      return { post: body, note: runNote(run.id), taskId: run.id };
    }
    const lines = control?.key ? [{ key: control.key, text: body }] : body.split("\n").map((line) => line.trim()).filter(Boolean).map((text) => ({ key: findingKey(text), text }));
    const known = this.store.children(parent.id).filter((t) => t.automation?.role === "finding" && (!isClosed(t) || (t.state === "dropped" && t.closedBy === USER_OWNER && t.automation.clearedAt === null)));
    const fresh: typeof lines = [];
    const touched = new Map<string, { task: Task; texts: string[] }>();
    for (const line of lines) {
      const task = known.find((t) => t.automation!.keys.includes(line.key));
      if (!task) { if (!fresh.some((f) => f.key === line.key)) fresh.push(line); continue; }
      const entry = touched.get(task.id) ?? { task, texts: [] };
      entry.texts.push(line.text);
      touched.set(task.id, entry);
    }
    for (const { task, texts } of touched.values()) this.foundAgain(task, texts, at);
    this.ran(parent, lines.map((line) => line.key), at);
    this.setParent(parent.id, (link, p) => { link.count += 1; link.lastAt = at; p.progress.line = clip(`Found: ${lines[0]!.text}`); });
    if (!fresh.length) return "quiet";
    const made = this.newFinding(src, parent, fresh, control?.owner ?? src.owner, at);
    return { post: fresh.map((line) => line.text).join("\n"), note: findingNote(made.id), taskId: made.id };
  }

  private openFindings(parentId: string): Task[] {
    return this.openChildren(parentId).filter((t) => t.automation?.role === "finding");
  }

  private newFinding(src: AutomationSource, parent: Task, lines: { key: string; text: string }[], owner: string, at: number): Task {
    const text = lines.map((line) => line.text).join("\n");
    const task: Task = {
      id: this.store.newId("task"), title: clip(`${src.name}: ${lines[0]!.text}`, 160), why: text.slice(0, 4000), owner, state: "in_progress", kind: "do", options: [], needs: null,
      priority: "normal", conversation: owner === "cos" ? src.thread : owner.startsWith("thread:") ? owner.slice(7) : null, project: null, area: null,
      timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false },
      progress: { step: null, line: clip(lines[0]!.text) }, workers: [], outputs: [], source: { kind: "watcher", ref: src.id }, parentId: parent.id, schedule: null, card: null,
      automation: { id: src.id, kind: "watcher", role: "finding", thread: src.thread, keys: lines.map((line) => line.key), count: 1, lastAt: at, mode: null, clearedAt: null },
      stale: false, origin: "task", createdAt: at, updatedAt: at, closedAt: null, closedBy: null,
    };
    const saved = this.store.save(task);
    this.store.event(saved.id, "created", { by: "cos", owner, automation: src.id });
    return saved;
  }

  private foundAgain(task: Task, texts: string[], at: number): void {
    const next = structuredClone(task);
    const link = next.automation!;
    link.count += 1;
    link.lastAt = at;
    if (!isClosed(next)) {
      next.progress.line = clip(texts[0]!);
      next.why = texts.join("\n").slice(0, 4000);
    }
    next.updatedAt = at;
    this.store.save(next);
    this.store.event(task.id, "found_again", { count: link.count, line: clip(texts[0]!), muted: isClosed(next) });
  }

  private ran(parent: Task, keysNow: readonly string[], at: number): void {
    const findings = this.store.children(parent.id).filter((t) => t.automation?.role === "finding" && (!isClosed(t) || (t.state === "dropped" && t.closedBy === USER_OWNER && t.automation.clearedAt === null)));
    for (const task of findings) {
      const link = task.automation!;
      if (link.keys.some((key) => keysNow.includes(key))) continue;
      if ((link.lastAt ?? task.createdAt) > at - CLEAR_AFTER_MS) continue;
      this.clear(task, at);
    }
  }

  private clearKeys(parent: Task, keys: true | string[], at: number): void {
    for (const task of this.store.children(parent.id)) {
      if (task.automation?.role !== "finding" || task.automation.clearedAt !== null) continue;
      if (keys !== true && !task.automation.keys.some((key) => keys.includes(key))) continue;
      if (isClosed(task) && !(task.state === "dropped" && task.closedBy === USER_OWNER)) continue;
      this.clear(task, at);
    }
  }

  private clear(task: Task, at: number): void {
    if (isClosed(task)) {
      const next = structuredClone(task);
      next.automation!.clearedAt = at;
      this.store.save(next);
      this.store.event(task.id, "cleared", {});
      return;
    }
    this.store.change(task.id, (t) => { t.state = "done"; t.progress.line = "Cleared: the watcher stopped finding it"; t.automation!.clearedAt = at; }, "cos");
  }

  prune(now = this.now()): number {
    let removed = 0;
    for (const parent of this.parents()) {
      const runs = this.store.rows("SELECT record FROM tasks WHERE parent_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC, id", parent.id)
        .filter((t) => t.automation?.role === "run" && t.owner !== USER_OWNER);
      const old = runs.slice(KEEP_RUNS).filter((t) => (t.closedAt ?? 0) < now - KEEP_RUN_DAYS_MS);
      if (!old.length) continue;
      this.store.db.transaction(() => {
        for (const t of old) {
          if (this.store.db.prepare("SELECT 1 FROM tasks WHERE parent_id = ?").get(t.id)) continue;
          this.store.db.prepare("DELETE FROM task_events WHERE task_id = ?").run(t.id);
          this.store.db.prepare("DELETE FROM tasks WHERE id = ?").run(t.id);
          removed++;
        }
      })();
    }
    if (removed) this.store.changed();
    return removed;
  }

  runs(parentId: string, limit = 10): Task[] {
    return this.store.rows("SELECT record FROM tasks WHERE parent_id = ? ORDER BY created_at DESC, id LIMIT ?", parentId, limit);
  }
}
