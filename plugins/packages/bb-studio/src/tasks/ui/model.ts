import { dayNumber } from "../../loops/clock";
import { KIND as LOOP_KIND, PRIORITY_RANK } from "../../loops/ui/model";
import { KIND as WORK_KIND } from "../../work/ui/model";
import { isClosed, needsYou, USER_OWNER, type Task, type TaskEvent, type TaskKind } from "../contract";

export type Glyph = "needs-you" | "running" | "waiting" | "done" | "failed" | "todo" | "dropped";
export type Tone = "warning" | "destructive" | "muted" | "default" | "success";
export type TaskStatus = { id: string; label: string; glyph: Glyph; tone: Tone; stale?: boolean };

const loopKindOf = (kind: TaskKind) => (kind === "waiting-outside" ? "waiting" : kind);

export function taskKind(task: Pick<Task, "kind" | "card">): { label: string; icon: string } {
  const card = task.card?.kind;
  if (card && card !== "todo" && card !== "task") return WORK_KIND[card];
  return LOOP_KIND[loopKindOf(task.kind)];
}

export function taskStatus(task: Task): TaskStatus {
  if (task.stale) return { id: "ended", label: "Ended", glyph: "done", tone: "muted", stale: true };
  if (task.state === "failed") return { id: "failed", label: "Failed", glyph: "failed", tone: "destructive" };
  if (task.state === "dropped") return { id: "dropped", label: "Dismissed", glyph: "dropped", tone: "muted" };
  if (task.state === "done") return { id: "done", label: "Done", glyph: "done", tone: "success" };
  if (needsYou(task)) return { id: "needs-you", label: "Needs you", glyph: "needs-you", tone: "warning" };
  if (task.owner === USER_OWNER) {
    if (task.kind === "waiting-outside") return { id: "waiting-outside", label: "Waiting on others", glyph: "waiting", tone: "muted" };
    if (task.timing.snoozed) return { id: "snoozed", label: "Snoozed", glyph: "waiting", tone: "muted" };
    return { id: "todo", label: "To do", glyph: "todo", tone: "default" };
  }
  if (task.state === "in_progress") return { id: "running", label: "Running", glyph: "running", tone: "default" };
  if (task.state === "todo") return { id: "scheduled", label: "Scheduled", glyph: "waiting", tone: "muted" };
  return { id: "waiting", label: "Waiting", glyph: "waiting", tone: "muted" };
}

export const isMine = (task: Pick<Task, "owner">) => task.owner === USER_OWNER;

export type ThreadName = { owner: string; name: string; threadId: string | null };
export type Names = { bot: string; leads: ReadonlyMap<string, string>; threads?: readonly ThreadName[]; botThreadId?: string | null };

export function ownerLabel(owner: string | null | undefined, names: Names): string {
  if (!owner) return "";
  if (owner === USER_OWNER) return "You";
  if (owner === "cos") return names.bot;
  const id = owner.startsWith("thread:") ? owner.slice(7) : owner;
  if (names.botThreadId && id === names.botThreadId) return names.bot;
  return names.leads.get(id) ?? names.threads?.find((t) => t.owner === `thread:${id}`)?.name ?? "A thread";
}

export function ownerThreadId(owner: string, botThreadId: string | null, threads: readonly ThreadName[] = []): string | null {
  if (owner === "cos") return botThreadId;
  if (!owner.startsWith("thread:")) return null;
  const found = threads.find((t) => t.owner === owner);
  return found ? found.threadId : owner.slice(7);
}

export function handOffTargets(task: Pick<Task, "owner" | "workers" | "conversation">, base: readonly { owner: string; name: string }[], threads: readonly ThreadName[], botThreadId: string | null): { owner: string; name: string }[] {
  const out: { owner: string; name: string }[] = [];
  const add = (owner: string, name: string) => { if (owner !== task.owner && !out.some((t) => t.owner === owner)) out.push({ owner, name }); };
  for (const t of base) add(t.owner, t.name);
  const named = (id: string) => threads.find((t) => t.owner === `thread:${id}`);
  for (const id of [...task.workers, ...(task.conversation ? [task.conversation] : [])]) {
    if (id === botThreadId) continue;
    const thread = named(id);
    if (thread && thread.threadId) add(`thread:${id}`, thread.name);
  }
  return out;
}

const parse = (data: string): Record<string, unknown> => { try { return JSON.parse(data || "{}") as Record<string, unknown>; } catch { return {}; } };
const str = (value: unknown) => (typeof value === "string" ? value : null);

export type HistoryLine = { at: number; text: string; type: string };

export function historyLines(history: readonly TaskEvent[], names: Names): HistoryLine[] {
  const who = (by: unknown) => { const s = str(by); return s ? ownerLabel(s, names) : null; };
  const out: HistoryLine[] = [];
  for (const event of history) {
    const d = parse(event.data);
    let text: string | null = null;
    switch (event.type) {
      case "created": {
        const by = who(d.by) ?? "An agent";
        const forWhom = ownerLabel(str(d.owner), names);
        text = forWhom === by ? `${by} created it` : `${by} created it for ${forWhom === "You" ? "you" : forWhom}`;
        break;
      }
      case "added_by_you": text = "You added it"; break;
      case "handed_off": {
        const to = ownerLabel(str(d.owner), names);
        const by = who(d.by) ?? who(d.from);
        if (to === "You" && by === "You") { const from = who(d.from); text = from && from !== "You" ? `You took it back from ${from}` : "You took it back"; break; }
        text = `${by ? `${by} handed it to ` : "Handed to "}${to === "You" ? "you" : to}${str(d.needs) ? `: ${str(d.needs)}` : ""}`;
        break;
      }
      case "closed": text = d.action === "drop" ? "Dismissed" : d.action === "failed" ? "Failed" : str(d.option) ? `Chose ${str(d.option)}` : "Done"; { const by = who(d.by); if (by && by !== "You") text += ` by ${by}`; } break;
      case "reopened": text = "Reopened"; break;
      case "snoozed": text = "Snoozed"; break;
      case "surfaced": case "surfaced_by_you": text = "Came up in Today"; break;
      case "acted": text = d.action === "choose" && str(d.option) ? `You chose ${str(d.option)}` : d.action === "nudge" ? "You asked for a nudge" : null; break;
      case "state": text = d.state === "waiting" ? "Waiting" : d.state === "in_progress" ? "In progress" : d.state === "todo" ? "To do" : null; break;
      case "progress": text = [str(d.step), str(d.line)].filter(Boolean).join(" · ") || null; if (text && d.kept) text += " (after it was closed)"; break;
      case "started": text = "Started"; break;
      default: text = null;
    }
    if (text) out.push({ at: event.at, text, type: event.type });
  }
  const chosen = (line: HistoryLine) => line.type === "acted" && line.text.startsWith("You chose");
  return out.filter((line, i) => {
    if (line.type === "closed" && line.text.startsWith("Chose ") && (chosen(out[i - 1] ?? line) || chosen(out[i + 1] ?? line))) return false;
    if (line.type === "progress" && line.text.startsWith("Chose: ") && out.some((other) => chosen(other) && Math.abs(other.at - line.at) < 1000)) return false;
    return true;
  }).reverse();
}

export function taskDate(task: Pick<Task, "timing">): number | null {
  if (task.timing.due !== null) return task.timing.due;
  const trigger = task.timing.trigger;
  return trigger.type === "time" && trigger.at !== undefined ? trigger.at : null;
}

export type SectionId = "today" | "later" | "agents" | "waiting" | "scheduled" | "done";
export const SECTIONS: readonly { id: SectionId; title: string }[] = [
  { id: "today", title: "Today" },
  { id: "later", title: "Later" },
  { id: "agents", title: "Agents on it" },
  { id: "waiting", title: "Waiting" },
  { id: "scheduled", title: "Scheduled & recurring" },
  { id: "done", title: "Done" },
];

const waitsForTrigger = (task: Task) => task.state !== "in_progress" && (task.attention.queue === "queued" || task.timing.snoozed) && task.timing.trigger.type !== "none";

export function taskSection(task: Task, now = Date.now(), zone?: string): SectionId {
  if (isClosed(task)) return "done";
  if (task.schedule) return "scheduled";
  if (task.kind === "waiting-outside") return "waiting";
  if (task.owner !== USER_OWNER) return waitsForTrigger(task) ? "scheduled" : "agents";
  if (needsYou(task) || task.attention.queue === "surfaced") return "today";
  const at = taskDate(task);
  if (at !== null && dayNumber(at, zone) - dayNumber(now, zone) < 1) return "today";
  return "later";
}

export const ALL = "all";
export type TaskFilters = { area: string; project: string; owner: string; query: string; botThreadId?: string | null };

export function ownerFilterOf(owner: string, botThreadId?: string | null): string {
  if (botThreadId && owner === `thread:${botThreadId}`) return "cos";
  return owner === USER_OWNER || owner === "cos" ? owner : "agents";
}

export function matches(task: Task, f: TaskFilters): boolean {
  if (f.area !== ALL && (task.area ?? "").trim() !== f.area) return false;
  if (f.project !== ALL && task.project !== f.project) return false;
  if (f.owner !== ALL && ownerFilterOf(task.owner, f.botThreadId) !== f.owner && task.owner !== f.owner) return false;
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [task.title, task.why, task.area ?? "", task.project ?? "", task.source?.ref ?? "", task.progress.line ?? ""].join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

export function sectionTasks(tasks: readonly Task[], f: TaskFilters, now = Date.now(), zone?: string): Record<SectionId, Task[]> {
  const out: Record<SectionId, Task[]> = { today: [], later: [], agents: [], waiting: [], scheduled: [], done: [] };
  for (const task of tasks) if (matches(task, f)) out[taskSection(task, now, zone)].push(task);
  const open = (a: Task, b: Task) => Number(needsYou(b)) - Number(needsYou(a)) || (taskDate(a) ?? Infinity) - (taskDate(b) ?? Infinity) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt;
  for (const id of Object.keys(out) as SectionId[]) out[id].sort(id === "done" ? (a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0) : id === "agents" ? (a, b) => b.updatedAt - a.updatedAt : open);
  return out;
}

export function filterChoices(tasks: readonly Task[], pick: (t: Task) => string | null | undefined, label: (value: string) => string = (v) => v): { id: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const t of tasks) { const v = pick(t)?.trim(); if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
  return [{ id: ALL, label: "All" }, ...[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => ({ id, label: label(id) }))];
}

export function rowNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (value === "true") return 1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 && String(n) === value.trim() ? n : null;
}

export function inFlightDetail(task: Task): string | null {
  if (needsYou(task) && task.needs) return task.needs;
  return [isClosed(task) ? null : task.progress.step, task.progress.line].filter(Boolean).join(" · ") || null;
}

export const TASKS_ERROR_HINT = "Tasks can't be shown right now. Nothing was lost. Restart BB Studio to try again.";

export function everMine(history: readonly TaskEvent[]): boolean {
  return history.some((e) => {
    if (e.type === "added_by_you") return true;
    const d = parse(e.data);
    return (e.type === "created" || e.type === "handed_off") && (d.owner === USER_OWNER || d.from === USER_OWNER);
  });
}

export function ownerShort(task: Pick<Task, "owner" | "title" | "kind" | "card">, names: Names): string {
  const name = ownerLabel(task.owner, names);
  if (!task.owner.startsWith("thread:")) return name;
  const a = name.trim().toLowerCase(), b = task.title.trim().toLowerCase();
  if (!a || !b || !(a === b || a.includes(b) || b.includes(a))) return name;
  const card = task.card?.kind;
  return card === "lead" ? "Its lead" : card === "release" ? "Its release worker" : "Its worker";
}
