import type Database from "better-sqlite3";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { randomUUID } from "node:crypto";
import { fromHeartbeat, localZone, type Schedule } from "../schedule";
import { nextRun } from "../triggers/next-run";
import { parentIdOf } from "../tasks/automations";
import { isClosed, USER_OWNER, type Task } from "../tasks/contract";
import type { TaskStore } from "../tasks/store";
import { areaUpdateInput, STATUS_FILE, type Area, type AreaOwner, type AreaRun, type AreaUpdateInput, type AreaView, type OpenItem } from "./contract";
import { addRuns, areaFolder, clip, coversFromAreaMd, coversFromJob, deriveStatus, FRESH_SLACK_MS, fileItems, MISSED_GRACE_MS, MAX_FILE_BYTES, nameWords, readStatusFile, readStatusNotes, reportOutcome, runOutcome, sinceAt, sortAreas, type ReportLevel } from "./derive";
import type { AreaStore } from "./store";

export type AreaRunner = { id: string; botId: string; name: string; thread: string | null; state: "active" | "paused"; job: string; last: { level: ReportLevel; summary: string; at: number } | null };
export type AreaLead = { thread: string; name: string };
export type AreaCaller = { kind: "runner"; runnerId: string } | { kind: "bot"; botId: string; main: boolean } | { kind: "thread" };
export type AreaExtra = { name: string; covers?: string; owner: "cos" | `thread:${string}`; links?: string[]; cadence?: string };
export type AreaDeps = {
  bot(): { id: string; name: string } | null;
  runners(): AreaRunner[];
  leads?(): AreaLead[];
  caller?(threadId: string): AreaCaller;
  schedule?(task: Task): Schedule | null;
  fileStat?(path: string): { mtime: number; size: number } | null;
  readText?(path: string): string | null;
  zone?(): string;
  userWords?(): string[];
  now?(): number;
};
export type SeedReport = { seeded: boolean; created: string[]; problems: string[] };

/** The source an area item's task carries: the area and the item's title, so the task outlives every rewrite of the area's status. */
export const AREA_ITEM_SOURCE = "area-item";
export const areaItemRef = (areaId: string, title: string) => `${areaId}:${title.toLowerCase().replace(/\s+/g, " ").trim()}`;

const LEVEL_RANK: Record<ReportLevel, number> = { log: 0, tell: 1, urgent: 2 };
const KEEP_LEVELS = 20;

export function fileStat(path: string): { mtime: number; size: number } | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? { mtime: stat.mtimeMs, size: stat.size } : null;
  } catch { return null; }
}

export function ownNameWords(): string[] {
  let login: string | null = null;
  let fullName: string | null = null;
  try { login = userInfo().username; } catch { login = null; }
  if (process.platform === "darwin") {
    try { fullName = execFileSync("/usr/bin/id", ["-F"], { encoding: "utf8", timeout: 2_000 }).trim(); } catch { fullName = null; }
  } else {
    try { fullName = (userInfo() as { gecos?: string }).gecos?.split(",")[0] ?? null; } catch { fullName = null; }
  }
  return nameWords(login, fullName);
}

export function readText(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

export function readSchedule(db: Database.Database, task: Task): Schedule | null {
  const link = task.automation;
  if (!link) return null;
  try {
    if (link.kind === "runner") {
      const row = db.prepare("SELECT cadence, time, cron, timezone FROM bot_runners WHERE id = ?").get(link.id) as { cadence: string; time: string; cron: string | null; timezone: string | null } | undefined;
      return row ? fromHeartbeat({ cadence: row.cadence, time: row.time, ...(row.cron ? { cron: row.cron } : {}) }, row.timezone ?? undefined) : null;
    }
    if (link.kind === "checkin" || link.kind === "watcher") {
      const row = db.prepare("SELECT schedule_json FROM bot_automations WHERE id = ?").get(link.id) as { schedule_json: string } | undefined;
      return row ? (JSON.parse(row.schedule_json) as Schedule) : null;
    }
  } catch { return null; }
  return null;
}

export class Areas {
  constructor(readonly store: AreaStore, readonly tasks: TaskStore, readonly deps: AreaDeps) {}

  private now() { return this.deps.now?.() ?? Date.now(); }
  private zone() { return this.deps.zone?.() ?? localZone(); }
  private stat(path: string) { return (this.deps.fileStat ?? fileStat)(path); }
  private text(path: string) { return (this.deps.readText ?? readText)(path); }
  private read(path: string): { text: string; mtime: number } | null {
    const stat = this.stat(path);
    if (!stat || stat.size > MAX_FILE_BYTES) return null;
    const text = this.text(path);
    return text === null ? null : { text, mtime: stat.mtime };
  }
  private schedule(task: Task) { return this.deps.schedule ? this.deps.schedule(task) : readSchedule(this.tasks.db, task); }

  private blank(id: string, name: string, owner: AreaOwner, ownerName: string, now: number): Area {
    return { id, name: clip(name, 80), covers: "", owner, ownerName: clip(ownerName, 120), cadence: null, stated: null, now: null, open: [], runs: [], links: [], statusFile: null, file: null, notesMtime: null, levels: {}, archived: false, createdAt: now, updatedAt: now };
  }

  private put(area: Area, before: Area | null): boolean {
    const strip = (a: Area) => JSON.stringify({ ...a, updatedAt: 0 });
    if (before && strip(before) === strip(area)) return false;
    this.store.save({ ...area, updatedAt: this.now() });
    return true;
  }

  seed(extra: readonly AreaExtra[] = []): SeedReport {
    const report: SeedReport = { seeded: false, created: [], problems: [] };
    if (this.store.count() > 0) return report;
    report.seeded = true;
    const now = this.now();
    const bot = this.deps.bot();
    this.store.db.transaction(() => {
      for (const x of extra) {
        if (x.owner === "cos" && !bot) { report.problems.push(`${x.name}: no Bot to own it`); continue; }
        const owner: AreaOwner = x.owner === "cos" ? { kind: "bot", botId: bot!.id } : { kind: "lead", thread: x.owner.slice("thread:".length) };
        const area = this.blank(`area_${randomUUID().slice(0, 8)}`, x.name, owner, owner.kind === "bot" ? bot!.name : `${x.name} lead`, now);
        area.covers = clip(x.covers ?? "", 300);
        area.cadence = x.cadence ? clip(x.cadence, 120) : null;
        for (const id of x.links ?? []) {
          const link = this.resolveLink(id);
          if (link) area.links.push(link); else report.problems.push(`${x.name}: no schedule ${id}`);
        }
        this.store.save(area);
        report.created.push(area.name);
      }
    })();
    const made = this.sync();
    report.created.push(...made.created);
    report.problems.push(...made.problems);
    return report;
  }

  sync(): { created: string[]; changed: number; problems: string[] } {
    const out = { created: [] as string[], changed: 0, problems: [] as string[] };
    this.store.db.transaction(() => {
      this.ensureLeadAreas(out);
      this.ensureRunnerAreas(out);
      for (const area of this.store.all()) {
        if (area.archived) continue;
        if (this.put(this.refreshed(area), area)) out.changed++;
      }
    })();
    if (out.created.length || out.changed) this.store.changed();
    return out;
  }

  private ensureLeadAreas(out: { created: string[] }): void {
    const now = this.now();
    for (const lead of this.deps.leads?.() ?? []) {
      const areas = this.store.all();
      if (areas.some((a) => (a.owner.kind === "lead" && a.owner.thread === lead.thread) || a.name.toLowerCase() === lead.name.toLowerCase())) continue;
      const area = this.blank(`area_lead-${lead.thread.replace(/[^A-Za-z0-9-]/g, "-")}`.slice(0, 60), lead.name, { kind: "lead", thread: lead.thread }, `${lead.name} lead`, now);
      if (areas.some((a) => a.id === area.id)) continue;
      this.store.save(area);
      out.created.push(area.name);
    }
  }

  private ensureRunnerAreas(out: { created: string[]; problems: string[] }): void {
    const bot = this.deps.bot();
    if (!bot) return;
    const now = this.now();
    for (const runner of this.deps.runners().filter((r) => r.botId === bot.id)) {
      const areas = this.store.all();
      const link = parentIdOf(runner.id);
      if (areas.some((a) => (a.owner.kind === "runner" && a.owner.runnerId === runner.id) || a.links.includes(link))) continue;
      const host = areas.find((a) => a.owner.kind !== "runner" && !a.archived && runner.name.toLowerCase().startsWith(`${a.name.toLowerCase()} `));
      if (host) { this.store.save({ ...host, links: [...host.links, link], updatedAt: now }); continue; }
      const folder = areaFolder(runner.job);
      if (runner.state === "paused" && !folder) continue;
      const area = this.blank(`area_${runner.id}`, runner.name, { kind: "runner", runnerId: runner.id, thread: runner.thread }, `${runner.name} runner`, now);
      area.links = [link];
      area.covers = coversFromJob(runner.job);
      if (folder) {
        area.statusFile = join(folder.dir, STATUS_FILE);
        const areaMd = this.read(join(folder.dir, "AREA.md"));
        const covers = areaMd ? coversFromAreaMd(areaMd.text) : null;
        if (covers) area.covers = covers; else out.problems.push(`${runner.name}: AREA.md ${areaMd ? "has no Owns: line" : "not found"}`);
        const problems = this.readNotes(area, folder.dir, now);
        if (problems) out.problems.push(...problems.map((problem) => `${runner.name}: STATUS.md ${problem}`));
        else out.problems.push(`${runner.name}: STATUS.md not found`);
      } else out.problems.push(`${runner.name}: no area folder in its job; runner_report only`);
      if (runner.last) area.runs = [{ at: runner.last.at, outcome: reportOutcome(runner.last.level, runner.last.summary), line: clip(runner.last.summary), taskId: null }];
      this.store.save(area);
      out.created.push(area.name);
    }
  }

  private refreshed(before: Area): Area {
    const area = structuredClone(before);
    const now = this.now();
    if (area.owner.kind === "runner") {
      const runnerId = area.owner.runnerId;
      const runner = this.deps.runners().find((r) => r.id === runnerId);
      if (!runner) { area.archived = true; return area; }
      area.ownerName = clip(`${runner.name} runner`, 120);
      area.owner = { ...area.owner, thread: runner.thread };
      const folder = areaFolder(runner.job);
      const statusFile = folder ? join(folder.dir, STATUS_FILE) : null;
      if (statusFile !== area.statusFile) {
        area.statusFile = statusFile;
        area.file = null;
        const areaMd = folder ? this.read(join(folder.dir, "AREA.md")) : null;
        const covers = areaMd ? coversFromAreaMd(areaMd.text) : null;
        if (covers) area.covers = covers;
      }
    } else if (area.owner.kind === "bot") {
      const bot = this.deps.bot();
      if (bot && bot.id === area.owner.botId) area.ownerName = clip(bot.name, 120);
    }
    if (area.statusFile) this.readStatus(area, now);
    if (area.owner.kind === "runner" && area.statusFile && area.file?.mtime == null && (area.stated === null || area.stated.from === "notes")) this.readNotes(area, dirname(area.statusFile), now);
    const added: AreaRun[] = [];
    const cutoff = area.runs.length >= 30 ? area.runs.at(-1)!.at : -Infinity;
    const known = new Set(area.runs.map((r) => r.taskId).filter(Boolean));
    for (const link of area.links) {
      for (const run of this.tasks.rows("SELECT record FROM tasks WHERE parent_id = ? AND json_extract(record, '$.automation.role') = 'run' ORDER BY created_at, id", link)) {
        const byUser = run.owner === USER_OWNER && !isClosed(run);
        if (known.has(run.id) || !(isClosed(run) || byUser)) continue;
        const at = byUser ? run.updatedAt : run.closedAt ?? run.updatedAt;
        if (at <= cutoff) continue;
        const line = clip(byUser ? run.needs ?? run.title : run.progress.line ?? "Nothing new");
        const stated = area.stated?.from === "file" ? area.stated : null;
        const file = stated && stated.at >= run.createdAt - FRESH_SLACK_MS && stated.at <= at + FRESH_SLACK_MS ? stated.status : null;
        const outcome = runOutcome({ state: run.state, byUser, runner: run.automation?.kind === "runner", line, level: area.levels[run.id] ?? null, file });
        added.push({ at, outcome, line, taskId: run.id });
        delete area.levels[run.id];
      }
    }
    if (added.length) area.runs = addRuns(area.runs, added);
    const levels = Object.entries(area.levels);
    if (levels.length > KEEP_LEVELS) area.levels = Object.fromEntries(levels.slice(-KEEP_LEVELS));
    return area;
  }

  private readNotes(area: Area, dir: string, now: number): string[] | null {
    const path = join(dir, "STATUS.md");
    const stat = this.stat(path);
    if (!stat) return null;
    if (area.notesMtime === stat.mtime) return [];
    const notes = this.read(path);
    if (!notes) return null;
    const read = readStatusNotes(notes.text, now, this.deps.userWords?.());
    area.notesMtime = stat.mtime;
    area.now = read.now;
    area.open = read.open;
    area.stated = read.status ? { status: read.status, at: notes.mtime, from: "notes" } : null;
    return read.problems;
  }

  private readStatus(area: Area, now: number): void {
    const path = area.statusFile!;
    const stat = this.stat(path);
    const missing = () => { if (area.file?.mtime !== null || area.file?.error !== "missing") area.file = { readAt: now, mtime: null, error: "missing" }; };
    if (!stat) return missing();
    if (area.file && area.file.mtime === stat.mtime) return;
    if (stat.size > MAX_FILE_BYTES) { area.file = { readAt: now, mtime: stat.mtime, error: `Larger than ${MAX_FILE_BYTES / 1024} KB` }; return; }
    const text = this.text(path);
    if (text === null) return missing();
    const read = readStatusFile(text);
    if (!read.ok) { area.file = { readAt: now, mtime: stat.mtime, error: clip(read.error, 300) }; return; }
    area.file = { readAt: now, mtime: stat.mtime, error: null };
    const at = Math.min(Date.parse(read.value.updatedAt), stat.mtime + FRESH_SLACK_MS, now + FRESH_SLACK_MS);
    if (area.stated && area.stated.from === "agent" && area.stated.at > at) return;
    area.stated = { status: read.value.status, at, from: "file" };
    area.now = clip(read.value.now, 400);
    area.open = fileItems(read.value, now);
  }

  reported(runnerId: string, level: ReportLevel): void {
    const link = parentIdOf(runnerId);
    const area = this.store.all().find((a) => (a.owner.kind === "runner" && a.owner.runnerId === runnerId) || a.links.includes(link));
    const run = this.tasks.rows("SELECT record FROM tasks WHERE parent_id = ? AND json_extract(record, '$.automation.role') = 'run' ORDER BY created_at DESC, id DESC LIMIT 1", link)[0];
    if (!area || !run) return;
    const had = area.levels[run.id];
    if (had && LEVEL_RANK[had] >= LEVEL_RANK[level]) return;
    this.store.save({ ...area, levels: { ...area.levels, [run.id]: level }, updatedAt: this.now() });
  }

  private resolveLink(id: string): string | null {
    for (const candidate of [id, parentIdOf(id)]) {
      const task = this.tasks.find(candidate);
      if (task?.automation?.role === "schedule") return task.id;
    }
    return null;
  }

  private schedules(area: Area): Task[] {
    return area.links.map((id) => this.tasks.find(id)).filter((t): t is Task => !!t && t.automation?.role === "schedule" && !isClosed(t));
  }

  private when(at: number): string {
    try { return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: this.zone() }); }
    catch { return new Date(at).toISOString().slice(0, 16).replace("T", " "); }
  }

  view(area: Area): AreaView {
    const now = this.now();
    const zone = this.zone();
    const schedules = this.schedules(area);
    const active = schedules.filter((t) => !t.schedule?.paused);
    const paused = schedules.length > 0 && active.length === 0;
    let nextAt: number | null = null;
    let nextLabel: string | null = null;
    let missed: string | null = null;
    const lastRun = area.runs[0]?.at ?? null;
    for (const task of active) {
      const schedule = this.schedule(task);
      if (!schedule) continue;
      const next = nextRun(schedule, now, zone);
      if (next !== null && (nextAt === null || next < nextAt)) { nextAt = next; nextLabel = schedules.length > 1 || task.title !== area.name ? task.title : null; }
      if (task.id === area.links[0] && lastRun !== null) {
        const expected = nextRun(schedule, lastRun, zone);
        if (expected !== null && now > expected + MISSED_GRACE_MS) missed = `No run since ${this.when(lastRun)}`;
      }
    }
    const derived = deriveStatus(area, paused ? null : missed);
    const open: OpenItem[] = this.linkItems(area);
    const linked = new Set(open.map((o) => o.taskId).filter(Boolean));
    for (const task of schedules) {
      for (const child of this.tasks.rows("SELECT record FROM tasks WHERE parent_id = ? AND closed_at IS NULL ORDER BY created_at, id", task.id)) {
        const finding = child.automation?.role === "finding";
        if (linked.has(child.id) || !(finding || child.owner === USER_OWNER)) continue;
        open.push({ title: clip(child.owner === USER_OWNER && child.needs ? child.needs : child.title, 200), since: new Date(child.createdAt).toISOString().slice(0, 10), sinceAt: child.createdAt, needsUser: child.owner === USER_OWNER, taskId: child.id });
      }
    }
    return {
      id: area.id, name: area.name, covers: area.covers, owner: area.owner, ownerName: area.ownerName,
      cadence: area.cadence ?? schedules[0]?.schedule?.text ?? null,
      status: derived.status, reason: derived.reason, now: area.now, open: open.slice(0, 40), runs: area.runs,
      lastRun, nextRun: nextAt, nextLabel, paused, links: area.links, statusFile: area.statusFile,
      fileError: area.file?.error === "missing" ? `${STATUS_FILE} not found` : area.file?.error ?? null, updatedAt: area.updatedAt,
    };
  }

  /** The newest task made for each of an area's items, by item. */
  private itemTasks(areaId: string): Map<string, Task> {
    const prefix = `${areaId}:`;
    const out = new Map<string, Task>();
    const rows = this.tasks.rows("SELECT record FROM tasks WHERE json_extract(record, '$.source.kind') = ? AND substr(json_extract(record, '$.source.ref'), 1, ?) = ? ORDER BY created_at, id", AREA_ITEM_SOURCE, prefix.length, prefix);
    for (const task of rows) out.set(task.source!.ref, task);
    return out;
  }

  /**
   * The area's open items, each with the task Studio made for it when the
   * item names none (the runner's next status.json doesn't know it). An item
   * whose task the user closed after the area's last report is left out
   * until a newer report still lists it.
   */
  private linkItems(area: Area): OpenItem[] {
    if (!area.open.some((o) => !o.taskId)) return [...area.open];
    const made = this.itemTasks(area.id);
    const reportedAt = area.stated?.at ?? 0;
    return area.open.flatMap((item) => {
      if (item.taskId) return [item];
      const task = made.get(areaItemRef(area.id, item.title));
      if (!task) return [item];
      if (isClosed(task) && (task.closedAt ?? 0) > reportedAt) return [];
      return [{ ...item, taskId: task.id }];
    });
  }

  list(): AreaView[] {
    return sortAreas(this.store.all().filter((a) => !a.archived).map((a) => this.view(a)));
  }

  find(idOrName: string): Area | null {
    const key = idOrName.trim();
    const all = this.store.all();
    return all.find((a) => a.id === key) ?? all.find((a) => a.name.toLowerCase() === key.toLowerCase()) ?? null;
  }

  get(idOrName: string): AreaView {
    const area = this.find(idOrName);
    if (!area) throw new Error(`No area ${JSON.stringify(idOrName)}.`);
    return this.view(area);
  }

  update(input: AreaUpdateInput, threadId: string | null | undefined): { area: AreaView; note?: string } {
    const x = areaUpdateInput.parse(input);
    const now = this.now();
    const bot = this.deps.bot();
    const who: AreaCaller = threadId ? this.deps.caller?.(threadId) ?? { kind: "thread" } : bot ? { kind: "bot", botId: bot.id, main: true } : { kind: "thread" };
    const mine = (a: Area) => who.kind === "runner" ? a.owner.kind === "runner" && a.owner.runnerId === who.runnerId
      : a.owner.kind === "lead" ? a.owner.thread === threadId
      : who.kind === "bot" && who.main && a.owner.kind === "bot";
    const all = this.store.all();
    let before: Area | null = x.area ? this.find(x.area) : all.find((a) => !a.archived && mine(a)) ?? null;
    if (before && !mine(before) && who.kind !== "bot") throw new Error(`${before.name} is looked after by ${before.ownerName}; only it or the Bot can change it.`);
    let area: Area;
    if (before) area = structuredClone(before);
    else {
      if (who.kind === "runner") throw new Error("Your area is made from your runner; try again in a minute.");
      const name = x.name ?? x.area;
      if (!name) throw new Error("You have no area yet: give it a name (name).");
      if (all.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error(`An area named ${JSON.stringify(name)} exists; pass area: ${JSON.stringify(name)}.`);
      if (who.kind !== "bot" && !(threadId && (this.deps.leads?.() ?? []).some((lead) => lead.thread === threadId))) throw new Error("Only the Bot or a project's lead can make an area; ask the Bot to make it for you.");
      const owner: AreaOwner = who.kind === "bot" && who.main && bot ? { kind: "bot", botId: bot.id } : { kind: "lead", thread: threadId! };
      area = this.blank(`area_${randomUUID().slice(0, 8)}`, name, owner, owner.kind === "bot" ? bot!.name : `${name} lead`, now);
      before = null;
    }
    if (x.name !== undefined && before) area.name = x.name;
    if (x.covers !== undefined) area.covers = x.covers;
    if (x.cadence !== undefined) area.cadence = x.cadence || null;
    if (x.now !== undefined) area.now = x.now || null;
    if (x.open !== undefined) area.open = x.open.map((o) => ({ title: o.title, since: o.since ?? null, sinceAt: sinceAt(o.since, now), needsUser: o.needsUser ?? false, taskId: o.taskId ?? null }));
    if (x.status !== undefined) {
      area.stated = { status: x.status, at: now, from: "agent" };
      if (who.kind !== "runner") area.runs = addRuns(area.runs, [{ at: now, outcome: x.status, line: clip(x.now ?? area.now ?? x.status), taskId: null }]);
    }
    if (x.links !== undefined) {
      const missing = x.links.filter((id) => !this.resolveLink(id));
      if (missing.length) throw new Error(`No schedule ${missing.join(", ")}: pass a runner, check-in or watcher id, or its recurring task id.`);
      area.links = [...new Set(x.links.map((id) => this.resolveLink(id)!))];
      if (area.owner.kind === "runner") { const own = parentIdOf(area.owner.runnerId); if (!area.links.includes(own)) area.links.unshift(own); }
    }
    if (x.owner !== undefined) {
      if (who.kind === "runner") throw new Error("A runner's area stays with its runner.");
      if (x.owner === "cos") { if (!bot) throw new Error("There is no Bot."); area.owner = { kind: "bot", botId: bot.id }; area.ownerName = bot.name; }
      else {
        const thread = x.owner === "me" ? threadId : x.owner.slice("thread:".length);
        if (x.owner === "me" && who.kind === "bot" && who.main && bot) { area.owner = { kind: "bot", botId: bot.id }; area.ownerName = bot.name; }
        else if (thread) { area.owner = { kind: "lead", thread }; area.ownerName = `${area.name} lead`; }
        else throw new Error("\"me\" needs a calling thread.");
      }
    }
    if (x.archive !== undefined) area.archived = x.archive;
    const changed = this.put(this.refreshed(area), before);
    if (changed) this.store.changed();
    const saved = this.store.find(area.id) ?? area;
    return { area: this.view(saved), ...(saved.archived ? { note: "Archived: it is off the list. Pass archive: false to bring it back." } : {}) };
  }
}

const hasTable = (db: Database.Database, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

export function runnersFrom(db: Database.Database): AreaRunner[] {
  if (!hasTable(db, "bot_runners")) return [];
  const rows = db.prepare("SELECT id, bot_id, name, job, thread_id, state, last_level, last_report, last_report_at FROM bot_runners WHERE cleanup_pending = 0 ORDER BY created_at, id").all() as { id: string; bot_id: string; name: string; job: string; thread_id: string | null; state: string; last_level: string | null; last_report: string | null; last_report_at: number | null }[];
  return rows.map((row) => ({
    id: row.id, botId: row.bot_id, name: row.name, job: row.job, thread: row.thread_id, state: row.state === "active" ? "active" : "paused",
    last: row.last_report && row.last_report_at && (row.last_level === "log" || row.last_level === "tell" || row.last_level === "urgent") ? { level: row.last_level, summary: row.last_report, at: row.last_report_at } : null,
  }));
}

export function leadsFrom(db: Database.Database, projectNames: ReadonlyMap<string, string>, skipProject: string): AreaLead[] {
  if (!hasTable(db, "project_leads")) return [];
  const rows = db.prepare("SELECT project_id, lead_thread_id FROM project_leads WHERE lead_thread_id IS NOT NULL AND project_id <> ? ORDER BY created_at, project_id").all(skipProject) as { project_id: string; lead_thread_id: string }[];
  const spaces = new Map(hasTable(db, "spaces") ? (db.prepare("SELECT default_project_id AS project, name FROM spaces WHERE default_project_id IS NOT NULL").all() as { project: string; name: string }[]).map((r) => [r.project, r.name]) : []);
  return rows.flatMap((row) => { const name = spaces.get(row.project_id) ?? projectNames.get(row.project_id); return name ? [{ thread: row.lead_thread_id, name }] : []; });
}
