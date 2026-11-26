import { KIND as LOOP_KIND } from "../../loops/ui/model";
import { KIND as WORK_KIND } from "../../work/ui/model";
import { isClosed, needsYou, USER_OWNER, type Task, type TaskEvent, type TaskKind } from "../contract";

export type Glyph = "needs-you" | "running" | "waiting" | "done" | "failed" | "todo" | "dropped";
export type Tone = "warning" | "destructive" | "muted" | "default" | "success";
export type TaskStatus = { id: string; label: string; glyph: Glyph; tone: Tone; stale?: boolean };

const loopKindOf = (kind: TaskKind) => (kind === "waiting-outside" ? "waiting" : kind);

const RECURRING: Record<NonNullable<Task["automation"]>["kind"], { label: string; icon: string }> = {
  checkin: { label: "Check-in", icon: "Clock" },
  heartbeat: { label: "Check-in", icon: "Clock" },
  runner: { label: "Runner", icon: "Repeat" },
  watcher: { label: "Watcher", icon: "Eye" },
};

export function taskKind(task: Pick<Task, "kind" | "card"> & { automation?: Task["automation"] }): { label: string; icon: string } {
  const auto = task.automation;
  if (auto?.role === "schedule") return RECURRING[auto.kind];
  if (auto?.role === "run") return { label: "Run", icon: RECURRING[auto.kind].icon };
  if (auto?.role === "finding") return { label: "Finding", icon: "Eye" };
  const card = task.card?.kind;
  if (card && card !== "todo" && card !== "task") return WORK_KIND[card];
  return LOOP_KIND[loopKindOf(task.kind)];
}

export function taskStatus(task: Task): TaskStatus {
  if (task.automation?.role === "schedule" && !isClosed(task)) return task.schedule?.paused ? { id: "paused", label: "Paused", glyph: "waiting", tone: "muted" } : { id: "active", label: "Active", glyph: "running", tone: "default" };
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

export const SEVERITY_LABEL = { info: "Info", warn: "Warning", critical: "Critical" } as const;
export const severityTone = (severity: keyof typeof SEVERITY_LABEL): Tone => (severity === "critical" ? "destructive" : severity === "warn" ? "warning" : "muted");

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
      case "acted": text = d.action === "choose" && str(d.option) ? `You chose ${str(d.option)}` : d.action === "nudge" ? "You asked for a nudge" : d.action === "start" ? "You asked to start it" : null; break;
      case "state": text = d.state === "waiting" ? "Waiting" : d.state === "in_progress" ? "In progress" : d.state === "todo" ? "To do" : null; break;
      case "progress": text = [str(d.step), str(d.line)].filter(Boolean).join(" · ") || null; if (text && d.kept) text += " (after it was closed)"; break;
      case "started": text = "Started"; break;
      case "found_again": text = `Found again${typeof d.count === "number" ? ` (${d.count} times in all)` : ""}${str(d.line) ? `: ${str(d.line)}` : ""}`; break;
      case "cleared": text = "Cleared: the watcher stopped finding it"; break;
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

export function rowNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (value === "true") return 1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 && String(n) === value.trim() ? n : null;
}

export function ownerShort(task: Pick<Task, "owner" | "title" | "kind" | "card">, names: Names): string {
  const name = ownerLabel(task.owner, names);
  if (!task.owner.startsWith("thread:")) return name;
  const a = name.trim().toLowerCase(), b = task.title.trim().toLowerCase();
  if (!a || !b || !(a === b || a.includes(b) || b.includes(a))) return name;
  const card = task.card?.kind;
  return card === "lead" ? "Its lead" : card === "release" ? "Its release worker" : "Its worker";
}
