// The Bot chat's model: BB timeline rows (from threads.timeline, across the
// Bot's handoff chain) turned into what the chat draws. Pure and runtime-free,
// so it's tested on its own. Rows are read defensively: they're the SDK's
// rows, nested under turns.
import { parseNextItems, type NextItems } from "../../explore/next";

export type Row = Record<string, unknown>;

/**
 * One thread's rows, oldest first. `continuation`: a thread after the first
 * whose start is loaded, so its first user message is the handoff request.
 */
export interface ChainPage { threadId: string; rows: readonly unknown[]; continuation: boolean }

export type ChildStatus = "running" | "finished" | "failed" | "stopped" | "needs-you" | "waiting";

export interface WorkStep { id: string; label: string; status: string | null }

export type ChatEntry =
  | { kind: "day"; id: string; label: string }
  | {
    kind: "message"; id: string; role: "user" | "assistant"; text: string; createdAt: number;
    /** First of a run from the same sender: the Bot's avatar shows here. */
    first: boolean;
    /** Quick replies and actions from a trailing `::next{…}` line. */
    next: NextItems | null;
    images: number;
    /** A user message BB hasn't accepted yet (queued behind the running turn). */
    queued: boolean;
  }
  | { kind: "work"; id: string; steps: WorkStep[]; running: boolean }
  | { kind: "child"; id: string; threadId: string | null; title: string; status: ChildStatus; verb: "started" | "update"; createdAt: number }
  | { kind: "notice"; id: string; text: string };

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.length ? value : null);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const THREAD_ID = /\bthr_[a-z0-9]{6,}\b/i;
const SPAWN_TOOL = /(^|[_.\-/])(thread[_.\-]?spawn|spawn[_.\-]?thread|threads?[_.\-]?create|create[_.\-]?thread|spawn)$/i;

/** Source rows in order: turns are opened up, everything else kept as is. */
export function* flatRows(rows: readonly unknown[] | unknown): Generator<Row> {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!isRow(row)) continue;
    if (row.kind === "turn") yield* flatRows(row.children);
    else yield row;
  }
}

/**
 * The Bot's chain as one conversation, oldest thread first. A thread after
 * the first starts with the handoff request the previous one wrote; that's
 * plumbing, so its first user message is left out and the history reads on.
 */
export function mergeChain(pages: readonly ChainPage[]): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    let skippedHandoff = !page.continuation;
    for (const row of flatRows(page.rows)) {
      if (!skippedHandoff && row.kind === "conversation" && row.role === "user") { skippedHandoff = true; continue; }
      const key = `${page.threadId}:${str(row.id) ?? out.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

/** Splits a trailing `::next{…}` line off a reply. */
export function splitNext(text: string): { body: string; next: NextItems | null } {
  const match = /(?:^|\n)[ \t]*::next\{([^}\n]*)\}[ \t]*\s*$/.exec(text);
  if (!match) return { body: text, next: null };
  const attributes: Record<string, string> = {};
  for (const [, key, value] of match[1]!.matchAll(/([a-z]+)="([^"]*)"/g)) attributes[key!] = value!;
  const next = parseNextItems(attributes);
  return { body: text.slice(0, match.index).trimEnd(), next: next.reply.length || next.do.length ? next : null };
}

const CHILD_STATUS: Record<string, ChildStatus> = {
  "child-completed": "finished",
  "child-failed": "failed",
  "child-interrupted": "stopped",
  "child-needs-attention": "needs-you",
};

/** A thread the Bot started, from a spawn tool or `bb thread spawn` command; null for other work. */
export function spawnedThread(row: Row): { threadId: string | null; title: string } | null {
  const tool = str(row.toolName) ?? "";
  const command = str(row.command) ?? "";
  const isSpawn = SPAWN_TOOL.test(tool) || /\bbb\s+thread\s+(spawn|create)\b/.test(command);
  if (!isSpawn) return null;
  const args = isRow(row.toolArgs) ? row.toolArgs : {};
  const output = str(row.output) ?? str(row.aggregatedOutput) ?? "";
  const threadId = THREAD_ID.exec(output)?.[0] ?? null;
  const title = str(args.title) ?? str(args.name) ?? firstLine(str(args.prompt) ?? str(args.message) ?? /--title[= ]["']?([^"'\n]+)/.exec(command)?.[1] ?? "") ?? "a thread";
  return { threadId, title };
}

function firstLine(text: string): string | null {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean);
  if (!line) return null;
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function workLabel(row: Row): string {
  const presentation = isRow(row.presentation) ? row.presentation : null;
  const label = isRow(presentation?.label) ? presentation.label : null;
  const text =
    str(presentation?.title) ??
    str(row.status === "pending" ? label?.pending : label?.completed) ??
    str(row.title) ??
    str(row.summary) ??
    (str(row.command) ? `Ran ${str(row.command)}` : null) ??
    (str(row.toolName) ? `Used ${str(row.toolName)!.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ")}` : null) ??
    (isRow(row.change) && str(row.change.path) ? `Edited ${str(row.change.path)}` : null) ??
    str(row.query) ??
    str(row.workKind) ??
    "Step";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 119)}…` : clean;
}

function dayLabel(at: number, now: number): string {
  const day = new Date(at);
  const today = new Date(now);
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(day)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, diff < 7 ? { weekday: "long" } : { weekday: "short", month: "short", day: "numeric", ...(day.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) }).format(day);
}

const dayKey = (at: number) => { const date = new Date(at); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; };

/**
 * What the chat draws, in order: day separators, messages grouped by sender,
 * each run of tool steps folded into one Working line, and child-thread events
 * as compact cards. `working` marks the last step group as still running.
 */
export function chatEntries(rows: readonly Row[], options: { working?: boolean; now?: number } = {}): ChatEntry[] {
  const now = options.now ?? Date.now();
  const out: ChatEntry[] = [];
  let lastDay: string | null = null;
  let lastSender: "user" | "assistant" | null = null;
  let work: Extract<ChatEntry, { kind: "work" }> | null = null;

  const stamp = (at: number) => {
    if (!at) return;
    const key = dayKey(at);
    if (key === lastDay) return;
    lastDay = key;
    out.push({ kind: "day", id: `day:${key}`, label: dayLabel(at, now) });
    lastSender = null;
  };
  const push = (entry: ChatEntry) => {
    if (entry.kind !== "work") work = null;
    out.push(entry);
  };

  for (const row of rows) {
    const id = str(row.id);
    if (!id) continue;
    const at = num(row.createdAt) || num(row.startedAt);
    if (row.kind === "conversation") {
      const text = str(row.text) ?? "";
      const attachments = isRow(row.attachments) ? row.attachments : null;
      const images = num(attachments?.localImages) + num(attachments?.webImages);
      if (row.role === "assistant") {
        if (!text.trim()) continue;
        const { body, next } = splitNext(text);
        stamp(at);
        push({ kind: "message", id, role: "assistant", text: body, createdAt: at, first: lastSender !== "assistant", next, images, queued: false });
        lastSender = "assistant";
        continue;
      }
      if (row.role !== "user") continue;
      const initiator = str(row.initiator) ?? "user";
      if (initiator === "user") {
        if (!text.trim() && !images) continue;
        stamp(at);
        const request = isRow(row.turnRequest) ? row.turnRequest : null;
        push({ kind: "message", id, role: "user", text, createdAt: at, first: lastSender !== "user", next: null, images, queued: request?.status === "pending" });
        lastSender = "user";
        continue;
      }
      // System messages about threads the Bot started become cards; the rest is plumbing.
      const status = CHILD_STATUS[str(row.systemMessageKind) ?? ""];
      const subject = isRow(row.systemMessageSubject) ? row.systemMessageSubject : null;
      if (status && subject?.kind === "thread") {
        stamp(at);
        push({ kind: "child", id, threadId: str(subject.threadId), title: str(subject.threadName) ?? "A thread", status, verb: "update", createdAt: at });
        lastSender = null;
      } else if (row.systemMessageKind === "child-outcome-batch" && subject?.kind === "thread-batch") {
        const outcomes = Array.isArray(subject.outcomes) ? subject.outcomes.filter(isRow) : [];
        const failed = outcomes.some((outcome) => outcome.status === "failed");
        stamp(at);
        push({ kind: "child", id, threadId: null, title: `${num(subject.count) || outcomes.length} threads`, status: failed ? "failed" : "finished", verb: "update", createdAt: at });
        lastSender = null;
      }
      continue;
    }
    if (row.kind === "work") {
      const spawned = spawnedThread(row);
      if (spawned) {
        stamp(at);
        push({ kind: "child", id, threadId: spawned.threadId, title: spawned.title, status: row.status === "error" ? "failed" : "running", verb: "started", createdAt: at });
        lastSender = null;
        continue;
      }
      // Questions and approvals show in the Needs-you card above the composer.
      if (row.workKind === "question" || row.workKind === "approval" || row.workKind === "form") continue;
      const presentation = isRow(row.presentation) ? row.presentation : null;
      if (presentation?.suppress === true) continue;
      if (!work) {
        stamp(at);
        work = { kind: "work", id, steps: [], running: false };
        out.push(work);
      }
      work.steps.push({ id, label: workLabel(row), status: str(row.status) });
      continue;
    }
    if (row.kind === "system" && row.systemKind === "error") {
      stamp(at);
      push({ kind: "notice", id, text: str(row.title) ?? "Something went wrong" });
    }
  }
  const last = out.at(-1);
  if (options.working && last?.kind === "work") last.running = true;
  for (const entry of out) if (entry.kind === "work" && entry.steps.some((step) => step.status === "pending")) entry.running = true;
  return out;
}

/** The pending question or approval the chat can answer inline. */
export type InlineAsk =
  | { kind: "question"; interactionId: string; threadId: string; questionId: string; prompt: string; options: { label: string; value: string }[]; allowFreeText: boolean }
  | { kind: "approval"; interactionId: string; threadId: string; title: string; detail: string | null; allowSession: boolean }
  | { kind: "open"; interactionId: string; threadId: string; title: string };

/** Maps a pending interaction (threads.interactions.list) to what the inline card offers. */
export function inlineAsk(interaction: unknown): InlineAsk | null {
  if (!isRow(interaction) || interaction.status !== "pending") return null;
  const interactionId = str(interaction.id);
  const threadId = str(interaction.threadId);
  const payload = isRow(interaction.payload) ? interaction.payload : null;
  if (!interactionId || !threadId || !payload) return null;
  if (payload.kind === "user_question") {
    const questions = Array.isArray(payload.questions) ? payload.questions.filter(isRow) : [];
    const question = questions[0];
    if (questions.length === 1 && question && !question.multiSelect && str(question.id) && str(question.prompt)) {
      const options = (Array.isArray(question.options) ? question.options.filter(isRow) : [])
        .flatMap((option) => (str(option.label) && str(option.value) ? [{ label: str(option.label)!, value: str(option.value)! }] : []));
      if (options.length || question.allowFreeText) {
        return { kind: "question", interactionId, threadId, questionId: str(question.id)!, prompt: str(question.prompt)!, options, allowFreeText: question.allowFreeText === true };
      }
    }
    return { kind: "open", interactionId, threadId, title: str(question?.prompt) ?? "A question is waiting" };
  }
  if (payload.kind === "approval") {
    const subject = isRow(payload.subject) ? payload.subject : {};
    const decisions = Array.isArray(payload.availableDecisions) ? payload.availableDecisions : [];
    if (!decisions.includes("allow_once") || !decisions.includes("deny")) return { kind: "open", interactionId, threadId, title: "Approval needed" };
    const title = subject.kind === "command" ? "Run a command?" : subject.kind === "file_change" ? "Change files?" : subject.kind === "plan" ? "Approve the plan?" : subject.kind === "tool_use" ? `Use ${str(subject.tool) ?? "a tool"}?` : "Allow this?";
    const detail = str(subject.command) ?? str(payload.reason) ?? str(subject.writeScope) ?? null;
    return { kind: "approval", interactionId, threadId, title, detail, allowSession: decisions.includes("allow_for_session") };
  }
  return { kind: "open", interactionId, threadId, title: str(payload.title) ?? "Something is waiting on you" };
}
