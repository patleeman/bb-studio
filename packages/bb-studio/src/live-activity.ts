// Awareness (plan page pg_ca4aba3141b2d2af, "Awareness" and the Memory
// table's "Live activity" layer): every conversation's context gets a short
// digest of what the Bot's other conversations and workers are doing, and the
// Bot can look up one of them in detail. There is nothing on screen for it.
//
// - Live activity: the table `live_activity`, one row per thread: what it is
//   doing now (running, idle, waiting on an answer, failed), its title, its
//   latest reply's first line, its repo tag, and when its turn started and
//   ended. BB's thread events keep it current (thread.created, active, idle,
//   failed, interaction.pending); the start fills rows for threads that have
//   none. Joined with `bot_threads` (src/bot-threads.ts) for Bot, kind, owner
//   and needs-you.
// - The digest (buildDigest): one line per OTHER conversation of the same
//   Bot that isn't archived and was active in the last 24 hours, and one per
//   worker of that Bot that is running or waiting, or failed or finished in
//   the last 6 hours, newest first, at most DIGEST_CAP characters, then "and
//   N more" and where to look. A worker gets one line: the conversation it
//   works for. A thread no Bot has gets nothing.
// - It reaches the agent through the fork's per-turn context hook,
//   `bb.experimental_hooks.experimental_turnContext` (feature-detected by
//   name; on a BB without it nothing is registered). bb gives it to the
//   agent with the turn's input, agent-only and not stored; it waits at most
//   500 ms for all plugins, so the provider only reads Studio's database.
// - `bot_activity_lookup { threadId }`: one thread's details for the Bot
//   that owns it: state, latest reply, needs-you, owner or workers, a
//   finished conversation's summary, and its last tool calls (read from BB's
//   events, with a short timeout).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { latestLine, repoTag, type BotThreads, type ThreadFacts, type WorkerStatus } from "./bot-threads";

type Sdk = BbPluginApi["sdk"];

export type ActivityState = "running" | "idle" | "needs-you" | "failed";

export interface ActivityRow {
  threadId: string;
  state: ActivityState;
  title: string | null;
  line: string | null;
  tag: string | null;
  branch: string | null;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
}

interface Row {
  thread_id: string; state: string; title: string | null; line: string | null; tag: string | null; branch: string | null;
  started_at: number | null; ended_at: number | null; updated_at: number;
}

const STATES: readonly ActivityState[] = ["running", "idle", "needs-you", "failed"];
const row = (r: Row): ActivityRow => ({
  threadId: r.thread_id, state: STATES.find((each) => each === r.state) ?? "idle", title: r.title, line: r.line, tag: r.tag, branch: r.branch,
  startedAt: r.started_at, endedAt: r.ended_at, updatedAt: r.updated_at,
});

const BUSY = new Set(["starting", "active", "stopping", "pending", "provisioning"]);
const titleOf = (thread: Partial<ThreadFacts>) => thread.title?.trim() || thread.titleFallback?.trim() || null;

/** The state BB's thread record says (a seed for threads with no row yet). */
export function stateOf(thread: Pick<ThreadFacts, "status" | "hasPendingInteraction">): ActivityState {
  if (thread.hasPendingInteraction) return "needs-you";
  if (BUSY.has(thread.status ?? "")) return "running";
  if (thread.status === "error") return "failed";
  return "idle";
}

/** The live activity table: what each thread is doing now. */
export class LiveActivity {
  constructor(private readonly db: Database.Database, private readonly clock: () => number = Date.now) {}

  get(threadId: string): ActivityRow | null {
    const found = this.db.prepare("SELECT * FROM live_activity WHERE thread_id = ?").get(threadId) as Row | undefined;
    return found ? row(found) : null;
  }

  has(threadId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM live_activity WHERE thread_id = ?").get(threadId);
  }

  /** Writes what changed; title and tag come from BB's thread record when it has them. */
  private write(thread: Partial<ThreadFacts> & { id: string }, patch: { state?: ActivityState; line?: string | null; startedAt?: number; endedAt?: number }): void {
    const now = this.clock();
    const tag = repoTag(thread as ThreadFacts);
    const existing = this.get(thread.id);
    const next = {
      state: patch.state ?? existing?.state ?? stateOf(thread),
      title: titleOf(thread) ?? existing?.title ?? null,
      line: patch.line !== undefined ? patch.line : existing?.line ?? null,
      tag: tag?.tag ?? existing?.tag ?? null,
      branch: tag?.branch ?? existing?.branch ?? null,
      startedAt: patch.startedAt ?? existing?.startedAt ?? null,
      endedAt: patch.endedAt ?? existing?.endedAt ?? null,
    };
    this.db.prepare(`INSERT INTO live_activity (thread_id, state, title, line, tag, branch, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (thread_id) DO UPDATE SET state = excluded.state, title = excluded.title, line = excluded.line, tag = excluded.tag, branch = excluded.branch,
        started_at = excluded.started_at, ended_at = excluded.ended_at, updated_at = excluded.updated_at`)
      .run(thread.id, next.state, next.title, next.line, next.tag, next.branch, next.startedAt, next.endedAt, now);
  }

  created(thread: ThreadFacts): void { this.write(thread, {}); }
  active(thread: Partial<ThreadFacts> & { id: string }): void { this.write(thread, { state: "running", startedAt: this.clock() }); }
  /** A turn ended: its reply's first line (a quiet "[PASS]" keeps the last one). */
  idle(thread: Partial<ThreadFacts> & { id: string }, lastAssistantText: string | null | undefined): void {
    const line = latestLine(lastAssistantText);
    this.write(thread, { state: "idle", endedAt: this.clock(), ...(line ? { line } : {}) });
  }
  failed(thread: Partial<ThreadFacts> & { id: string }): void { this.write(thread, { state: "failed", endedAt: this.clock() }); }
  pending(thread: Partial<ThreadFacts> & { id: string }): void { this.write(thread, { state: "needs-you" }); }
  deleted(threadId: string): void { this.db.prepare("DELETE FROM live_activity WHERE thread_id = ?").run(threadId); }

  /**
   * A row for a thread that has none, from BB's record and Studio's: the
   * conversation's stored latest line and the thread's latest real activity
   * (`at`; BB's updated_at only when Studio hasn't read it).
   */
  seed(thread: ThreadFacts, line: string | null, at: number | null = thread.updatedAt ?? null): void {
    if (this.has(thread.id)) return;
    const state = stateOf(thread);
    this.write(thread, { state, line, ...(state === "running" ? {} : at ? { endedAt: at } : {}) });
    // The seed is as old as BB's record, not now: the digest's ages stay true.
    if (at) this.db.prepare("UPDATE live_activity SET updated_at = ? WHERE thread_id = ?").run(at, thread.id);
  }
}

// ---------------------------------------------------------------------------
// The digest

/** The most of the digest's text (bb keeps up to 8,000 characters per plugin). */
export const DIGEST_CAP = 1500;
/** Other conversations active this recently are listed. */
export const DIGEST_CONVERSATIONS_MS = 24 * 60 * 60_000;
/** Failed and finished workers this recent are listed; running and waiting ones always. */
export const DIGEST_WORKERS_MS = 6 * 60 * 60_000;

export interface DigestConversation {
  threadId: string;
  title: string;
  isMain: boolean;
  running: boolean;
  needsYou: string | null;
  line: string | null;
  at: number;
}

export interface DigestWorker {
  threadId: string;
  title: string;
  status: WorkerStatus;
  /** The owning conversation's title; "this conversation" for the one asking. */
  owner: string | null;
  tag: string | null;
  at: number;
}

/** "now", "5m ago", "3h ago", "2d ago". */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (24 * 60))}d ago`;
}

const quote = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 59)}…` : text);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function conversationLine(row: DigestConversation, now: number): string {
  const name = row.isMain ? "Main" : quote(row.title);
  const state = row.needsYou ? `needs the user: ${clip(row.needsYou, 80)}` : row.running ? "working" : "idle";
  return `- ${name} (${row.threadId}) ${state} · ${ago(row.at, now)}${row.line ? ` · ${quote(clip(row.line, 90))}` : ""}`;
}

const WORKER_STATE: Record<WorkerStatus, string> = { running: "running", "needs-you": "waiting on an answer", failed: "failed", done: "finished" };

function workerLine(row: DigestWorker, now: number): string {
  return `- ${quote(row.title)} (${row.threadId}) ${WORKER_STATE[row.status]} · ${ago(row.at, now)}${row.owner ? ` · for ${row.owner === "this conversation" ? row.owner : quote(row.owner)}` : ""}${row.tag ? ` · ${row.tag}` : ""}`;
}

export const DIGEST_HEADER = "Elsewhere with the user (your other conversations and your workers, newest first; not this conversation):";
const NOTHING = "Elsewhere: no other conversation was active in the last day, and no worker is running or finished in the last 6 hours.";
const footer = (more: number) => `${more ? `…and ${more} more. ` : ""}Details: bot_activity_lookup { threadId }; the full list: bot_conversations.`;

/**
 * The digest a conversation gets at each turn: other conversations, then
 * workers, each newest first, within `cap` characters; what doesn't fit is
 * counted. Short when nothing else is going on.
 */
export function buildDigest(input: { conversations: readonly DigestConversation[]; workers: readonly DigestWorker[]; now: number; cap?: number }): string {
  const cap = input.cap ?? DIGEST_CAP;
  const conversations = [...input.conversations].sort((a, b) => b.at - a.at).map((each) => conversationLine(each, input.now));
  const workers = [...input.workers].sort((a, b) => b.at - a.at).map((each) => workerLine(each, input.now));
  if (!conversations.length && !workers.length) return NOTHING;
  const sections: { head: string; lines: string[] }[] = [
    { head: "Conversations:", lines: conversations },
    { head: "Workers:", lines: workers },
  ].filter((section) => section.lines.length);
  const total = conversations.length + workers.length;
  const out = [DIGEST_HEADER];
  let shown = 0;
  let length = DIGEST_HEADER.length;
  // Room for the longest footer ("…and N more") is kept back from the start.
  const room = cap - footer(total).length - 1;
  for (const section of sections) {
    let headed = false;
    for (const line of section.lines) {
      const add = (headed ? 0 : section.head.length + 1) + line.length + 1;
      if (length + add > room) break;
      if (!headed) { out.push(section.head); headed = true; }
      out.push(line);
      length += add;
      shown++;
    }
  }
  out.push(footer(total - shown));
  return out.join("\n");
}

interface JoinedRow {
  thread_id: string; kind: string; is_main: number; title: string | null; owner_conversation_id: string | null; created_at: number; activity_at: number | null;
  latest: string | null; latest_at: number | null; needs_you_reason: string | null; needs_you_at: number | null;
  a_state: string | null; a_title: string | null; a_line: string | null; a_tag: string | null; a_started: number | null; a_ended: number | null; a_updated: number | null;
}

const workerStatusOf = (state: string | null): WorkerStatus => state === "running" ? "running" : state === "needs-you" ? "needs-you" : state === "failed" ? "failed" : "done";

/**
 * What `threadId`'s turn is told, read from Studio's database only: the
 * digest for a conversation, one line for a worker, null for a thread no Bot
 * has.
 */
export function digestFor(db: Database.Database, threadId: string, now: number, cap = DIGEST_CAP): string | null {
  const self = db.prepare("SELECT bot_id, kind, owner_conversation_id FROM bot_threads WHERE thread_id = ?").get(threadId) as { bot_id: string; kind: string; owner_conversation_id: string | null } | undefined;
  if (!self) return null;
  const rows = db.prepare(`SELECT b.thread_id, b.kind, b.is_main, b.title, b.owner_conversation_id, b.created_at, b.activity_at, b.latest, b.latest_at, b.needs_you_reason, b.needs_you_at,
      a.state AS a_state, a.title AS a_title, a.line AS a_line, a.tag AS a_tag, a.started_at AS a_started, a.ended_at AS a_ended, a.updated_at AS a_updated
    FROM bot_threads b LEFT JOIN live_activity a ON a.thread_id = b.thread_id
    WHERE b.bot_id = ? AND b.archived_at IS NULL`).all(self.bot_id) as JoinedRow[];
  const byId = new Map(rows.map((each) => [each.thread_id, each]));
  const conversationTitle = (each: JoinedRow) => each.is_main ? "Main" : each.title?.trim() || each.a_title?.trim() || "New conversation";
  if (self.kind === "worker") {
    const owner = self.owner_conversation_id ? byId.get(self.owner_conversation_id) : undefined;
    return owner ? `You are a worker for your Bot's conversation ${JSON.stringify(conversationTitle(owner))} (${owner.thread_id}); report through your result.` : null;
  }
  const conversations: DigestConversation[] = [];
  const workers: DigestWorker[] = [];
  for (const each of rows) {
    if (each.thread_id === threadId) continue;
    if (each.kind === "conversation") {
      // Its latest real activity once Studio has read it (BB's and the importer's times move without use).
      const at = each.activity_at !== null
        ? Math.max(each.activity_at, each.needs_you_at ?? 0, each.a_state === "running" ? each.a_started ?? 0 : 0)
        : Math.max(each.latest_at ?? 0, each.a_updated ?? 0, each.needs_you_at ?? 0, each.created_at);
      if (now - at > DIGEST_CONVERSATIONS_MS && !each.needs_you_reason) continue;
      conversations.push({
        threadId: each.thread_id, title: conversationTitle(each), isMain: !!each.is_main, running: each.a_state === "running",
        needsYou: each.needs_you_reason ?? (each.a_state === "needs-you" ? "asked a question" : null), line: each.latest ?? each.a_line ?? null, at,
      });
      continue;
    }
    if (!each.a_state) continue;
    const status = workerStatusOf(each.a_state);
    const at = status === "running" || status === "needs-you" ? Math.max(each.a_started ?? 0, each.a_updated ?? 0) : Math.max(each.a_ended ?? 0, each.activity_at ?? 0) || each.a_updated || 0;
    if ((status === "failed" || status === "done") && now - at > DIGEST_WORKERS_MS) continue;
    const owner = each.owner_conversation_id === threadId ? "this conversation" : each.owner_conversation_id && byId.get(each.owner_conversation_id) ? conversationTitle(byId.get(each.owner_conversation_id)!) : null;
    workers.push({ threadId: each.thread_id, title: each.title?.trim() || each.a_title?.trim() || "Worker", status, owner, tag: each.a_tag, at });
  }
  return buildDigest({ conversations, workers, now, cap });
}

// ---------------------------------------------------------------------------
// Looking one up

interface EventItem { type?: string; text?: string; command?: string; description?: string; server?: string; tool?: string; queries?: string[]; changes?: { path?: string }[]; presentation?: { title?: string } }

/** A tool call's title as the timeline would show it, or null for what isn't one. */
export function toolTitle(item: EventItem): string | null {
  if (!item.type || item.type === "agentMessage" || item.type === "userMessage" || item.type === "reasoning" || item.type === "plan") return null;
  const title = item.presentation?.title?.trim() || item.description?.trim()
    || (item.type === "commandExecution" && item.command ? `$ ${item.command}` : null)
    || (item.type === "toolCall" && item.tool ? (item.server ? `${item.server}.${item.tool}` : item.tool) : null)
    || (item.type === "webSearch" && item.queries?.[0] ? `searched ${JSON.stringify(item.queries[0])}` : null)
    || (item.type === "fileChange" && item.changes?.length ? `edited ${item.changes.map((change) => change.path?.split("/").at(-1)).filter(Boolean).slice(0, 3).join(", ")}` : null);
  return title ? clip(title.replace(/\s+/g, " "), 100) : null;
}

const LOOKUP_TOOLS = 8;
const LOOKUP_EVENTS_MS = 2_500;

/** The last tool calls and the latest reply, from BB's events, within a short time. */
async function recentItems(sdk: Sdk, threadId: string): Promise<{ tools: string[]; reply: string | null }> {
  const read = Promise.resolve().then(() => sdk.threads.events.list({ threadId, order: "desc", limit: "60", types: ["item/completed"] })) as Promise<{ data?: { item?: EventItem } }[]>;
  const timeout = new Promise<null>((resolve) => { setTimeout(() => resolve(null), LOOKUP_EVENTS_MS); });
  const events = await Promise.race([read.catch(() => null), timeout]) ?? [];
  const tools: string[] = [];
  let reply: string | null = null;
  for (const event of events) {
    const item = event.data?.item;
    if (!item) continue;
    if (!reply && item.type === "agentMessage" && item.text?.trim()) reply = clip(item.text.trim(), 600);
    const title = toolTitle(item);
    if (title && tools.length < LOOKUP_TOOLS) tools.push(title);
  }
  return { tools, reply };
}

export interface LiveActivityDeps {
  threads: BotThreads;
  /** The Bot a calling thread acts for, when it isn't a recorded conversation or worker. */
  actingBot(threadId: string | undefined): Promise<string | null>;
  log(message: string): void;
  now?(): number;
}

/** A thread's details for the lookup tool. */
export async function lookUp(sdk: Sdk, activity: LiveActivity, threads: BotThreads, threadId: string, now: number): Promise<string> {
  const rec = threads.get(threadId);
  if (!rec) return `No conversation or worker ${threadId}.`;
  const live = activity.get(threadId);
  const name = (id: string) => { const other = threads.get(id); return other?.isMain ? "Main" : other?.title?.trim() || activity.get(id)?.title || id; };
  const title = rec.isMain ? "Main" : rec.title?.trim() || live?.title || (rec.kind === "worker" ? "Worker" : "New conversation");
  const lines = [`${rec.kind === "worker" ? "Worker" : "Conversation"} ${JSON.stringify(title)} (${threadId})${rec.archivedAt ? `, ${rec.finishedSummary ? "finished" : "archived"} ${ago(rec.archivedAt, now)}` : ""}`];
  const state = live ? (live.state === "running" ? `running since ${ago(live.startedAt ?? live.updatedAt, now)}` : live.state === "needs-you" ? "waiting on an answer" : live.state === "failed" ? `failed ${ago(live.endedAt ?? live.updatedAt, now)}` : `idle since ${ago(live.endedAt ?? live.updatedAt, now)}`) : "state unknown";
  lines.push(`State: ${state}${live?.tag ? ` · in ${live.tag}${live.branch ? ` (${live.branch})` : ""}` : ""}`);
  if (rec.needsYou) lines.push(`Needs the user: ${rec.needsYou.reason}`);
  if (rec.kind === "worker" && rec.ownerConversationId) lines.push(`Works for: ${JSON.stringify(name(rec.ownerConversationId))} (${rec.ownerConversationId})`);
  if (rec.forkedFrom) lines.push(`Forked from: ${JSON.stringify(name(rec.forkedFrom.threadId))} (${rec.forkedFrom.threadId})`);
  if (rec.kind === "conversation") {
    const workers = threads.workersOf(threadId).slice(0, 8);
    if (workers.length) lines.push("Its workers:", ...workers.map((worker) => `- ${JSON.stringify(worker.title?.trim() || activity.get(worker.threadId)?.title || "Worker")} (${worker.threadId}): ${activity.get(worker.threadId)?.state ?? "unknown"}`));
  }
  if (rec.finishedSummary) lines.push("Summary when it was finished:", rec.finishedSummary);
  const recent = await recentItems(sdk, threadId);
  const reply = recent.reply ?? rec.latest?.text ?? live?.line ?? null;
  if (reply) lines.push(`Latest reply: ${reply}`);
  if (recent.tools.length) lines.push("Last tool calls (newest first):", ...recent.tools.map((tool) => `- ${tool}`));
  lines.push("Read the whole transcript with the normal thread tools if you need more.");
  return lines.join("\n");
}

type Bb = Pick<BbPluginApi, "events" | "sdk" | "agents"> & { experimental_hooks?: object };

interface TurnContextHooks { experimental_turnContext?: (provider: (context: { threadId: string }) => string | null | Promise<string | null>) => void }

/** Registers the per-turn digest on a BB that has the hook. Answers whether it did. */
export function registerTurnContext(bb: { experimental_hooks?: object }, provider: (threadId: string) => string | null): boolean {
  const hooks = bb.experimental_hooks as TurnContextHooks | undefined;
  if (typeof hooks?.experimental_turnContext !== "function") return false;
  hooks.experimental_turnContext(({ threadId }) => {
    try { return provider(threadId); } catch { return null; }
  });
  return true;
}

/**
 * The live activity table from BB's events, the per-turn digest, and the
 * lookup tool. `start` fills rows for the Bots' threads that have none.
 */
export function registerLiveActivity(bb: Bb, db: Database.Database, deps: LiveActivityDeps) {
  const now = () => deps.now?.() ?? Date.now();
  const activity = new LiveActivity(db, now);
  const safe = (what: string, fn: () => void) => { try { fn(); } catch (error) { deps.log(`Live activity (${what}): ${error instanceof Error ? error.message : String(error)}`); } };
  bb.events.on("thread.created", ({ thread }) => safe("created", () => activity.created(thread as ThreadFacts)));
  bb.events.on("thread.active", ({ thread }) => safe("active", () => activity.active(thread as ThreadFacts)));
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => safe("idle", () => activity.idle(thread as ThreadFacts, lastAssistantText)));
  bb.events.on("thread.failed", ({ thread }) => safe("failed", () => activity.failed(thread as ThreadFacts)));
  bb.events.on("interaction.pending", ({ thread }) => safe("pending", () => activity.pending(thread as ThreadFacts)));
  bb.events.on("thread.deleted", ({ thread }) => safe("deleted", () => activity.deleted(thread.id)));

  const hooked = registerTurnContext(bb, (threadId) => digestFor(db, threadId, now()));

  bb.agents.registerTool({
    name: "bot_activity_lookup",
    description: "Look up one of your conversations or workers in detail: what it is doing now, its latest reply, whether it needs the user, the conversation it works for or the workers it started, a finished conversation's summary, and its last tool calls. Use it on a thread id from the \"Elsewhere\" digest at the start of your turn, or from bot_conversations.",
    parameters: z.object({ threadId: z.string().trim().min(1).max(200).describe("The conversation's or worker's thread id (thr_…)") }),
    execute: async ({ threadId }, ctx) => {
      const mine = (ctx.threadId ? deps.threads.get(ctx.threadId)?.botId : null) ?? await deps.actingBot(ctx.threadId);
      const target = deps.threads.get(threadId);
      if (!target || (mine && target.botId !== mine)) return `${threadId} isn't one of your conversations or workers. List them with bot_conversations.`;
      return lookUp(bb.sdk, activity, deps.threads, threadId, now());
    },
  });

  /** Rows for the Bots' listed threads that have none yet (made before this ran, or while Studio was off). */
  const start = async () => {
    const records = deps.threads.listed().filter((rec) => !activity.has(rec.threadId));
    if (!records.length) return;
    const facts = await deps.threads.facts(records.map((rec) => rec.threadId)).catch(() => new Map<string, ThreadFacts>());
    for (const rec of records) {
      const thread = facts.get(rec.threadId);
      if (thread) safe("seed", () => activity.seed(thread, rec.latest?.text ?? null, rec.activityAt ?? thread.updatedAt ?? null));
    }
  };

  return { activity, start, hooked, digest: (threadId: string) => digestFor(db, threadId, now()), tools: ["bot_activity_lookup"] as const };
}
