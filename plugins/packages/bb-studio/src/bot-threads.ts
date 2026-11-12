// One Bot, many conversations (plan page pg_ca4aba3141b2d2af): every thread
// belongs to a Bot, as a conversation (Patrick ↔ the Bot) or a worker (the
// Bot ↔ an agent it started). This is Studio's record of which is which.
//
// The table `bot_threads` (src/migrations.ts) has one row per thread:
//   bot_id                  the Bot it belongs to
//   kind                    "conversation" or "worker"
//   is_main                 the Bot's Main conversation (its chat thread)
//   forked_from_thread_id   a fork's source conversation, and where it was
//   forked_from_message_id  cut: the reply a side thread answers (a message
//   forked_from_turn_id     id), or the last source turn a BB fork copied
//                           (BB's experimental_threadForkPoint); null for
//                           everything else
//   owner_conversation_id   a worker's conversation: the one whose thread
//                           spawned it, else the Bot's Main
//   title                   a title Patrick or the Bot gave it here, else null
//   archived_at             out of the sidebar (still searchable): archived
//                           in BB, finished, or adopted past the cutoff
//   finished_summary        what a finished conversation decided (step 4)
//   needs_you_*             why a conversation needs Patrick, and who raised it
//   latest, latest_at       the conversation's latest reply, for its row
//   activity_at             its latest real activity: the last turn or item
//                           event, or a turn Studio saw start or end; BB's
//                           updated_at isn't (the fork's importer moves it)
//   source                  backfill | created | reconciled | user
//
// How a thread is classified (classifyThread, in this order):
//   1. a Bot's chat thread: its Main conversation; an older thread of its
//      handoff chain: an archived conversation of that Bot;
//   2. a "Reply in thread" side chat (bot_side_threads, or a fork BB's
//      side-chat plugin made): a conversation, forked from the reply's
//      conversation at that message, though it is hidden and owned by its
//      source; this wins over every rule below;
//   3. a runner's thread: a worker owned by the Bot's Main;
//   4. a project's lead (not the personal project's, which is the primary
//      Bot's chat): a worker of the primary Bot, owned by Main;
//   5. Studio's own helper threads (skill reviews): an archived worker;
//   6. a fork (BB's fork from a message, originKind "fork"): a conversation
//      of the source's Bot, forked from it, when Patrick made it; a fork an
//      agent or a tool made is a worker owned by the conversation that owns
//      its source. BB's thread record doesn't say who made a fork, so an
//      agent's is told by: a parent or lifecycle owner; hidden visibility
//      (`bb thread fork --visibility hidden`); a source that is a worker, or
//      an agent's thread Studio has no row for (an archived chain of forks);
//      or a source that was mid-turn when the fork was made (its turn events);
//   7. a thread another thread spawned (parent or lifecycle owner): a worker
//      owned by the conversation that spawned it, at any depth;
//   8. a thread a Bot owns otherwise (an automation's run, a thread handed
//      to it): a worker owned by that Bot's Main;
//   9. an automation's run, or a hidden thread nobody spawned: a worker of
//      the current Bot, owned by its Main;
//  10. anything else (a thread Patrick started): a conversation of the
//      current Bot (the one the sidebar shows, `focus`), else the primary.
// Rules 1-5 and 8 are authoritative: a later sweep (reconcile) applies them
// over what an earlier guess said. A row Patrick changed (source "user")
// keeps its kind and Bot.
//
// The first start fills the table from what exists (backfill). Existing
// standalone threads are adopted as conversations of the primary Bot; only
// the newest ADOPT_RECENT of them stay in the sidebar, older ones come in
// archived (searchable, not listed). Archived BB threads are left out until
// they come back.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { overlayMirrorLive, type MirrorLive } from "./mirror-live";
import { kindOf, type BotChange } from "./bot-signal";

type Sdk = BbPluginApi["sdk"];

export type BotThreadKind = "conversation" | "worker";
export type BotThreadSource = "backfill" | "created" | "reconciled" | "user";

/** How many adopted standalone threads stay in the sidebar after the backfill; older ones are archived conversations. */
export const ADOPT_RECENT = 50;
const DAY_MS = 24 * 60 * 60_000;
/** A conversation other than Main is listed while it was active this recently (or works, or needs Patrick); older ones are "N older conversations". */
export const CONVERSATION_RECENT_MS = 14 * DAY_MS;
/** A failed worker is listed this long, a done one this long; running and waiting ones always. */
export const WORKER_FAILED_MS = 7 * DAY_MS;
export const WORKER_RECENT_MS = 2 * DAY_MS;
/** At most this many running or waiting workers in the sidebar; the rest are counted. */
export const WORKER_LIMIT = 30;
/** At most this many finished (done or failed) rows under them, the newest, same titles folded into one. */
export const WORKER_FINISHED_SHOWN = 5;
const BUSY = new Set(["starting", "active", "stopping", "pending", "provisioning"]);

export function threadRunning(thread: { status?: string | null; queuedMessageCount?: number } | null | undefined): boolean {
  if (!thread || !BUSY.has(thread.status ?? "")) return false;
  return !(thread.status === "pending" && !((thread.queuedMessageCount ?? 0) > 0));
}
const LATEST_MAX = 160;

/** A fork's source conversation, and where it was cut: a reply's message id (side threads) or the last copied turn (BB's forks), when known. */
export interface ForkedFrom { threadId: string; messageId: string | null; turnId: string | null }

export interface BotThreadRecord {
  threadId: string;
  botId: string;
  kind: BotThreadKind;
  isMain: boolean;
  forkedFrom: ForkedFrom | null;
  ownerConversationId: string | null;
  title: string | null;
  archivedAt: number | null;
  finishedSummary: string | null;
  needsYou: { reason: string; at: number; source: string | null } | null;
  latest: { text: string; at: number } | null;
  /** Its latest real activity (last turn or item event); null until Studio has read it. */
  activityAt: number | null;
  source: BotThreadSource;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  thread_id: string; bot_id: string; kind: string; is_main: number;
  forked_from_thread_id: string | null; forked_from_message_id: string | null; forked_from_turn_id: string | null; owner_conversation_id: string | null;
  title: string | null; archived_at: number | null; finished_summary: string | null;
  needs_you_reason: string | null; needs_you_at: number | null; needs_you_source: string | null;
  latest: string | null; latest_at: number | null; activity_at: number | null;
  source: string; created_at: number; updated_at: number;
}

const record = (row: Row): BotThreadRecord => ({
  threadId: row.thread_id, botId: row.bot_id, kind: row.kind === "worker" ? "worker" : "conversation", isMain: !!row.is_main,
  forkedFrom: row.forked_from_thread_id ? { threadId: row.forked_from_thread_id, messageId: row.forked_from_message_id, turnId: row.forked_from_turn_id } : null,
  ownerConversationId: row.owner_conversation_id, title: row.title, archivedAt: row.archived_at, finishedSummary: row.finished_summary,
  needsYou: row.needs_you_reason ? { reason: row.needs_you_reason, at: row.needs_you_at ?? row.updated_at, source: row.needs_you_source } : null,
  latest: row.latest ? { text: row.latest, at: row.latest_at ?? row.activity_at ?? row.created_at } : null,
  activityAt: row.activity_at,
  source: (["backfill", "created", "reconciled", "user"] as const).find((each) => each === row.source) ?? "created",
  createdAt: row.created_at, updatedAt: row.updated_at,
});

/** What Studio reads off a BB thread (threads.list, threads.get, thread.created). */
export interface ThreadFacts {
  id: string;
  parentThreadId?: string | null;
  lifecycleOwnerThreadId?: string | null;
  sourceThreadId?: string | null;
  originKind?: string | null;
  originPluginId?: string | null;
  /** Studio's own fact, not BB's: the fork's source was in a turn when the fork was made (from the source's turn events). */
  sourceBusy?: boolean;
  /** Studio's own fact: the fork's source, which Studio has no row for (archived), was itself an agent's thread. */
  sourceIsWorker?: boolean;
  visibility?: string | null;
  archivedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
  title?: string | null;
  titleFallback?: string | null;
  projectId?: string | null;
  status?: string;
  queuedMessageCount?: number;
  hasPendingInteraction?: boolean;
  environmentName?: string | null;
  environmentBranchName?: string | null;
  environmentPath?: string | null;
  /** Studio's own fact: a thread mirrored from bb waits on these in bb (src/mirror-live.ts); BB Studio's record has none. */
  mirroredPending?: { id: string; status?: string; payload?: unknown }[];
}

/** The message a fork was cut at, where BB says (the fork's field names, feature-detected); null where it doesn't. */
export function forkMessageIdOf(thread: object): string | null {
  for (const name of ["experimental_sourceMessageId", "sourceMessageId", "forkedFromMessageId", "sourceItemId"]) {
    const value = (thread as Record<string, unknown>)[name];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/** The automation whose run started a thread, from its first message's marker. */
const AUTOMATION_DUE = /^\[bb automation due:([^\]\s]+)\]/;
function automationRun(thread: ThreadFacts): boolean {
  if (thread.originPluginId === "automations") return true;
  return [thread.titleFallback, thread.title].some((text) => !!text && AUTOMATION_DUE.test(text));
}

/** Facts from Studio's other stores that settle a thread's place. */
export interface Signals {
  /** Every Bot, the primary first: its chat thread and its handoff chain (the chat first). */
  bots: readonly { id: string; threadId: string | null; chain: readonly string[] }[];
  /** The Bot the sidebar shows (the "current" Bot), for threads Patrick starts. */
  focusedBotId: string | null;
  sideThread(threadId: string): { botId: string; sourceThreadId: string; messageId: string } | null;
  runnerBot(threadId: string): string | null;
  /** Lead threads of projects other than the personal one. */
  leadThreads: ReadonlySet<string>;
  /** Studio's own helper threads (skill reviews). */
  internal: ReadonlySet<string>;
  /** The Bot that owns a thread by Studio's sweep (automation runs, handed threads). */
  managedBot(threadId: string): string | null;
}

export interface Classification {
  botId: string;
  kind: BotThreadKind;
  isMain: boolean;
  forkedFrom: ForkedFrom | null;
  ownerConversationId: string | null;
  archived: boolean;
  /** From a rule a later sweep may apply over an earlier guess. */
  authoritative: boolean;
}

type Known = (threadId: string) => Pick<BotThreadRecord, "botId" | "kind" | "ownerConversationId" | "isMain"> | null;

/** The Bot a new conversation or worker joins when nothing says otherwise: the current one, else the primary. */
function currentBot(signals: Signals): string | null {
  const focused = signals.focusedBotId && signals.bots.some((bot) => bot.id === signals.focusedBotId) ? signals.focusedBotId : null;
  return focused ?? signals.bots[0]?.id ?? null;
}

function mainOf(signals: Signals, botId: string): string | null {
  return signals.bots.find((bot) => bot.id === botId)?.threadId ?? null;
}

/** A worker's owner, from what spawned it: that conversation, or the spawning worker's owner. */
function ownerFrom(parent: NonNullable<ReturnType<Known>>, parentId: string): string | null {
  return parent.kind === "conversation" ? parentId : parent.ownerConversationId;
}

/**
 * Where a thread belongs (the rules at the top of this file). Null when
 * there is no Bot yet. "parent-unknown": it was spawned by a thread with no
 * row yet; classify that one first.
 */
export function classifyThread(thread: ThreadFacts, signals: Signals, known: Known): Classification | "parent-unknown" | null {
  const chain = signals.bots.find((bot) => bot.chain.includes(thread.id));
  if (chain) return { botId: chain.id, kind: "conversation", isMain: chain.threadId === thread.id, forkedFrom: null, ownerConversationId: null, archived: chain.threadId !== thread.id, authoritative: true };
  if (!signals.bots.length) return null;
  const side = signals.sideThread(thread.id);
  if (side && signals.bots.some((bot) => bot.id === side.botId)) {
    return { botId: side.botId, kind: "conversation", isMain: false, forkedFrom: { threadId: side.sourceThreadId, messageId: side.messageId, turnId: null }, ownerConversationId: null, archived: false, authoritative: true };
  }
  // BB's side chat ("Reply in thread"), made by its side-chat plugin: Patrick's reply, a conversation.
  if (thread.originKind === "fork" && thread.originPluginId === SIDE_CHAT_PLUGIN && thread.sourceThreadId) {
    const from = known(thread.sourceThreadId);
    const botId = from?.botId ?? currentBot(signals) ?? signals.bots[0]!.id;
    const source = from?.kind === "worker" ? from.ownerConversationId ?? mainOf(signals, botId) : thread.sourceThreadId;
    if (source) return { botId, kind: "conversation", isMain: false, forkedFrom: { threadId: source, messageId: forkMessageIdOf(thread), turnId: null }, ownerConversationId: null, archived: false, authoritative: true };
  }
  const worker = (botId: string, owner: string | null, archived = false, authoritative = true): Classification =>
    ({ botId, kind: "worker", isMain: false, forkedFrom: null, ownerConversationId: owner ?? mainOf(signals, botId), archived, authoritative });
  const runner = signals.runnerBot(thread.id);
  if (runner && signals.bots.some((bot) => bot.id === runner)) return worker(runner, null);
  const primary = signals.bots[0]!.id;
  if (signals.leadThreads.has(thread.id)) return worker(primary, null);
  const fallback = currentBot(signals) ?? primary;
  if (signals.internal.has(thread.id) || studioHelperFork(thread)) {
    const from = thread.sourceThreadId ? known(thread.sourceThreadId) : null;
    return worker(from?.botId ?? fallback, from ? ownerFrom(from, thread.sourceThreadId!) : null, true);
  }
  if (thread.originKind === "fork" && thread.sourceThreadId) {
    const from = known(thread.sourceThreadId);
    const botId = from?.botId ?? fallback;
    if (agentFork(thread, from)) {
      // An agent's or a tool's fork works for the conversation that owns its source (or its spawner's).
      const spawner = thread.parentThreadId ?? thread.lifecycleOwnerThreadId ?? null;
      const parent = !from && spawner ? known(spawner) : null;
      const owner = from ? ownerFrom(from, thread.sourceThreadId) : parent && spawner ? ownerFrom(parent, spawner) : null;
      return worker(from?.botId ?? parent?.botId ?? fallback, owner, false, false);
    }
    // A fork of a worker is about the worker's conversation; it can't make a worker into a conversation.
    const source = from?.kind === "worker" ? from.ownerConversationId ?? mainOf(signals, botId) : thread.sourceThreadId;
    if (!source) return worker(botId, null, false, false);
    return { botId, kind: "conversation", isMain: false, forkedFrom: { threadId: source, messageId: forkMessageIdOf(thread), turnId: null }, ownerConversationId: null, archived: false, authoritative: false };
  }
  const spawner = thread.parentThreadId ?? thread.lifecycleOwnerThreadId ?? null;
  if (spawner) {
    const parent = known(spawner);
    if (!parent) return "parent-unknown";
    return worker(parent.botId, ownerFrom(parent, spawner), false, false);
  }
  const managed = signals.managedBot(thread.id);
  if (managed && signals.bots.some((bot) => bot.id === managed)) return worker(managed, null);
  if (automationRun(thread) || thread.visibility === "hidden") return worker(fallback, null, false, false);
  return { botId: fallback, kind: "conversation", isMain: false, forkedFrom: null, ownerConversationId: null, archived: false, authoritative: false };
}

/**
 * Whether a fork was made by an agent or a tool rather than by Patrick.
 * BB's thread record has no field for who made it, so: a parent or
 * lifecycle owner; hidden (a thread Patrick starts in the app is visible); a
 * source that is a worker (or an agent's thread Studio has no row for); a
 * source that was in a turn when the fork was made.
 */
export function agentFork(thread: Pick<ThreadFacts, "parentThreadId" | "lifecycleOwnerThreadId" | "sourceBusy" | "sourceIsWorker" | "visibility">, source: { kind: BotThreadKind } | null): boolean {
  if (thread.parentThreadId || thread.lifecycleOwnerThreadId) return true;
  if (thread.visibility === "hidden") return true;
  return source?.kind === "worker" || thread.sourceIsWorker === true || thread.sourceBusy === true;
}

/** Whether a thread Studio has no row for would be a worker by itself: hidden, spawned, an automation's, or an agent's fork. */
function agentThread(thread: ThreadFacts): boolean {
  if (thread.parentThreadId || thread.lifecycleOwnerThreadId || thread.visibility === "hidden" || automationRun(thread)) return true;
  return thread.originKind === "fork" && agentFork(thread, null);
}

export function studioHelperFork(thread: Pick<ThreadFacts, "originKind" | "originPluginId" | "visibility" | "lifecycleOwnerThreadId" | "parentThreadId">): boolean {
  return thread.originKind === "fork" && thread.originPluginId === STUDIO_PLUGIN && thread.visibility === "hidden" && !thread.lifecycleOwnerThreadId && !thread.parentThreadId;
}

/** Whether `fork` needs the source's turn events or record to decide who made it (nothing on the fork itself says). */
export function forkUndecided(fork: ThreadFacts): boolean {
  return fork.originKind === "fork" && !!fork.sourceThreadId && !fork.parentThreadId && !fork.lifecycleOwnerThreadId && fork.visibility !== "hidden" && fork.originPluginId !== SIDE_CHAT_PLUGIN;
}

export type WorkerStatus = "running" | "needs-you" | "failed" | "done";

export function workerStatus(thread: Pick<ThreadFacts, "status" | "hasPendingInteraction" | "queuedMessageCount"> | null | undefined): WorkerStatus {
  if (!thread) return "done";
  if (thread.hasPendingInteraction) return "needs-you";
  if (threadRunning(thread)) return "running";
  if (thread.status === "error") return "failed";
  return "done";
}

/** A worker's repo or worktree tag: the environment's name (or folder), when it is a git checkout. */
export function repoTag(thread: Pick<ThreadFacts, "environmentName" | "environmentBranchName" | "environmentPath"> | null | undefined): { tag: string; branch: string | null } | null {
  if (!thread?.environmentBranchName) return null;
  const folder = thread.environmentPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
  const tag = thread.environmentName?.trim() || folder;
  return tag ? { tag, branch: thread.environmentBranchName } : null;
}

/** The first line of a reply, short, for a conversation's second line; null for a quiet "[PASS]". */
export function latestLine(text: string | null | undefined): string | null {
  const clean = (text ?? "").replace(/::[a-z-]+\{[^}]*\}/g, "").replace(/[*_`#>]+/g, "").split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  if (!clean || /^\[PASS\]$/i.test(clean)) return null;
  return clean.length > LATEST_MAX ? `${clean.slice(0, LATEST_MAX - 1)}…` : clean;
}

const titleOf = (thread: ThreadFacts | null | undefined) => thread?.title?.trim() || thread?.titleFallback?.trim() || null;

export interface ConversationView {
  threadId: string;
  title: string;
  isMain: boolean;
  /** The conversation it was forked from, with its title. */
  forkedFrom: { threadId: string; messageId: string | null; turnId: string | null; title: string } | null;
  projectId: string | null;
  updatedAt: number;
  /** The latest reply's first line. */
  latest: string | null;
  running: boolean;
  /** Why it needs Patrick: a reason the Bot raised, or its own pending question. */
  needsYou: { reason: string; at: number } | null;
  /** Mirrored from bb: its state is bb's (src/mirror-live.ts). */
  mirrored: boolean;
}

export interface WorkerView {
  threadId: string;
  title: string;
  status: WorkerStatus;
  ownerConversationId: string | null;
  ownerTitle: string | null;
  projectId: string | null;
  updatedAt: number;
  tag: string | null;
  branch: string | null;
  /** Mirrored from bb: its state is bb's (src/mirror-live.ts). */
  mirrored: boolean;
  /** How many finished workers with this title the row stands for (it is the newest of them); 1 when alone. */
  sameTitle: number;
}

export interface BotThreadsView {
  botId: string;
  conversations: ConversationView[];
  workers: WorkerView[];
  /** Workers the sidebar doesn't stand for (older, past the limit, or past the five newest finished). */
  hiddenWorkers: number;
  /** Of those, the ones that finished in the last 24 hours ("N more done today"). */
  hiddenToday: number;
  /** Conversations left out of `conversations`: not active in CONVERSATION_RECENT_MS, not working, not needing Patrick. */
  olderConversations: number;
}

/** What the sidebar leaves out: the "N older conversations" and "N older workers" lists. */
export interface OlderThreadsView {
  botId: string;
  conversations: ConversationView[];
  workers: WorkerView[];
}

/** A conversation's own pending question, as its reason. */
const PENDING_REASON = "Asked you a question";

/** The title a conversation shows: Main for the Bot's chat, else its own or BB's. */
export function conversationTitle(rec: Pick<BotThreadRecord, "isMain" | "title">, thread: ThreadFacts | null | undefined): string {
  if (rec.isMain) return "Main";
  return rec.title?.trim() || titleOf(thread) || "New conversation";
}

export function needsYouOf(rec: Pick<BotThreadRecord, "needsYou">, thread: Pick<ThreadFacts, "hasPendingInteraction" | "updatedAt"> | null | undefined): { reason: string; at: number } | null {
  if (rec.needsYou) return { reason: rec.needsYou.reason, at: rec.needsYou.at };
  if (thread?.hasPendingInteraction) return { reason: PENDING_REASON, at: thread.updatedAt ?? 0 };
  return null;
}

/**
 * A Bot's sidebar: Main first, then its other conversations by last
 * activity; then its workers, the ones that need attention or are running
 * first, then the newest. Archived rows are left out, and so are old ones:
 * a conversation not active in 14 days (unless it works or needs Patrick),
 * a worker failed more than 7 days or done more than 2 days ago. Those are
 * counted, and listed by olderView.
 */
export function threadsView(botId: string, records: readonly BotThreadRecord[], threads: ReadonlyMap<string, ThreadFacts>, now: number): BotThreadsView {
  const all = allRows(botId, records, threads);
  const conversations = all.conversations.filter((row) => conversationListed(row, now));
  const { shown, standsFor } = sidebarWorkers(all.workers, now);
  const hidden = all.workers.filter((row) => !standsFor.has(row.threadId));
  const hiddenToday = hidden.filter((row) => (row.status === "done" || row.status === "failed") && now - row.updatedAt < DAY_MS).length;
  return { botId, conversations, workers: shown, hiddenWorkers: hidden.length, hiddenToday, olderConversations: all.conversations.length - conversations.length };
}

/**
 * The sidebar's workers (UX review 3, item 2): every running or waiting one
 * (up to WORKER_LIMIT), then the WORKER_FINISHED_SHOWN newest finished ones
 * of the last days, a run of the same title folded into its newest
 * ("Chief of Staff · skill review ×5"). `standsFor` is every worker a shown
 * row stands for.
 */
export function sidebarWorkers(all: readonly WorkerView[], now: number): { shown: WorkerView[]; standsFor: Set<string> } {
  const recent = all.filter((row) => workerListed(row, now));
  const active = recent.filter((row) => row.status === "running" || row.status === "needs-you").slice(0, WORKER_LIMIT);
  const finished = recent.filter((row) => row.status === "done" || row.status === "failed").sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = new Map<string, WorkerView[]>();
  for (const row of finished) {
    const key = row.title.trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.push(row);
    else if (groups.size < WORKER_FINISHED_SHOWN) groups.set(key, [row]);
  }
  const folded = [...groups.values()].map((group) => ({ ...group[0]!, sameTitle: group.length }));
  return { shown: [...active, ...folded], standsFor: new Set([...active, ...[...groups.values()].flat()].map((row) => row.threadId)) };
}

/** The rows the sidebar leaves out (its "N older" lists), newest first; a folded row's older namesakes are listed here too. */
export function olderView(botId: string, records: readonly BotThreadRecord[], threads: ReadonlyMap<string, ThreadFacts>, now: number): OlderThreadsView {
  const all = allRows(botId, records, threads);
  const shown = new Set(sidebarWorkers(all.workers, now).shown.map((row) => row.threadId));
  return {
    botId,
    conversations: all.conversations.filter((row) => !conversationListed(row, now)).sort((a, b) => b.updatedAt - a.updatedAt),
    workers: all.workers.filter((row) => !shown.has(row.threadId)).sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

function conversationListed(row: ConversationView, now: number): boolean {
  return row.isMain || row.running || !!row.needsYou || now - row.updatedAt < CONVERSATION_RECENT_MS;
}

function workerListed(row: Pick<WorkerView, "status" | "updatedAt">, now: number): boolean {
  if (row.status === "running" || row.status === "needs-you") return true;
  return now - row.updatedAt < (row.status === "failed" ? WORKER_FAILED_MS : WORKER_RECENT_MS);
}

function allRows(botId: string, records: readonly BotThreadRecord[], threads: ReadonlyMap<string, ThreadFacts>): { conversations: ConversationView[]; workers: WorkerView[] } {
  const mine = records.filter((rec) => rec.botId === botId && rec.archivedAt === null);
  const byId = new Map(records.map((rec) => [rec.threadId, rec]));
  const at = (rec: BotThreadRecord) => activityOf(rec, threads.get(rec.threadId));
  const name = (id: string | null) => {
    if (!id) return null;
    const rec = byId.get(id);
    return rec ? conversationTitle(rec, threads.get(id)) : titleOf(threads.get(id));
  };
  const conversations = mine.filter((rec) => rec.kind === "conversation")
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || at(b) - at(a))
    .map((rec): ConversationView => {
      const thread = threads.get(rec.threadId);
      return {
        threadId: rec.threadId, title: conversationTitle(rec, thread), isMain: rec.isMain,
        forkedFrom: rec.forkedFrom ? { ...rec.forkedFrom, title: name(rec.forkedFrom.threadId) ?? "a conversation" } : null,
        projectId: thread?.projectId ?? null, updatedAt: at(rec), latest: rec.latest?.text ?? null,
        running: threadRunning(thread), needsYou: needsYouOf(rec, thread), mirrored: !!thread?.mirroredPending,
      };
    });
  const rank: Record<WorkerStatus, number> = { "needs-you": 0, running: 1, failed: 2, done: 3 };
  const all = mine.filter((rec) => rec.kind === "worker").map((rec): WorkerView => {
    const thread = threads.get(rec.threadId);
    const tag = repoTag(thread);
    return {
      threadId: rec.threadId, title: rec.title?.trim() || titleOf(thread) || "Worker", status: workerStatus(thread),
      ownerConversationId: rec.ownerConversationId, ownerTitle: name(rec.ownerConversationId), projectId: thread?.projectId ?? null,
      updatedAt: at(rec), tag: tag?.tag ?? null, branch: tag?.branch ?? null, mirrored: !!thread?.mirroredPending, sameTitle: 1,
    };
  }).sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt);
  return { conversations, workers: all };
}

/**
 * When a thread was last used: its latest real activity (last turn or item
 * event) once Studio has read it, or a needs-you mark after that. Before
 * that, BB's record (whose updated_at the fork's importer moves) and
 * Studio's own times.
 */
export function activityOf(rec: Pick<BotThreadRecord, "activityAt" | "latest" | "needsYou" | "createdAt">, thread: Pick<ThreadFacts, "updatedAt" | "status" | "queuedMessageCount"> | null | undefined): number {
  // A thread in a turn right now is active now, whatever was read before.
  const live = threadRunning(thread) ? thread?.updatedAt ?? 0 : 0;
  if (rec.activityAt !== null) return Math.max(rec.activityAt, rec.needsYou?.at ?? 0, live);
  return Math.max(thread?.updatedAt ?? 0, rec.latest?.at ?? 0, rec.needsYou?.at ?? 0, rec.createdAt);
}

/**
 * A conversation's workers for the compact line above its composer (6b):
 * the same ones the sidebar lists (running or waiting, failed in the last
 * 7 days, done in the last 2), the ones that need attention first. So Main,
 * which owns hundreds of old workers, shows only what is going on.
 */
export function conversationWorkers(workers: readonly BotThreadRecord[], threads: ReadonlyMap<string, ThreadFacts>, now: number): { threadId: string; status: WorkerStatus; updatedAt: number }[] {
  const rank: Record<WorkerStatus, number> = { "needs-you": 0, running: 1, failed: 2, done: 3 };
  return workers.map((rec) => ({ threadId: rec.threadId, status: workerStatus(threads.get(rec.threadId)), updatedAt: activityOf(rec, threads.get(rec.threadId)) }))
    .filter((row) => workerListed(row, now))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt);
}

/** How long after a worker's mark BB's word that it no longer waits is believed (a list read just before the mark is stale). */
const RAISE_SETTLE_MS = 5_000;

/**
 * Workers whose mark on a conversation is over: BB, read at `readAt`, says
 * the worker has no pending interaction any more (its approval or question
 * was answered, from the card or anywhere else). Their marks are cleared.
 */
export function staleRaises(records: readonly BotThreadRecord[], threads: ReadonlyMap<string, ThreadFacts>, readAt: number): string[] {
  const kinds = new Map(records.map((rec) => [rec.threadId, rec.kind]));
  const sources = records.flatMap((rec) => {
    const source = rec.kind === "conversation" ? rec.needsYou?.source : null;
    if (!source || kinds.get(source) !== "worker" || readAt - rec.needsYou!.at < RAISE_SETTLE_MS) return [];
    return threads.get(source)?.hasPendingInteraction === false ? [source] : [];
  });
  return [...new Set(sources)];
}

/** Whether a Bot has a conversation that needs Patrick (its space dot turns amber). */
export function botNeedsYou(botId: string, records: readonly BotThreadRecord[], threads: ReadonlyMap<string, ThreadFacts>): boolean {
  return records.some((rec) => rec.botId === botId && rec.kind === "conversation" && rec.archivedAt === null && !!needsYouOf(rec, threads.get(rec.threadId)));
}

export function botActivity(botId: string, records: readonly BotThreadRecord[], threads: ReadonlyMap<string, ThreadFacts>): { turn: boolean; workers: number } {
  const mine = records.filter((rec) => rec.botId === botId && rec.archivedAt === null);
  return {
    turn: mine.some((rec) => rec.kind === "conversation" && threadRunning(threads.get(rec.threadId))),
    workers: mine.filter((rec) => rec.kind === "worker" && workerStatus(threads.get(rec.threadId)) === "running").length,
  };
}

export interface BotThreadsDeps {
  db: Database.Database;
  sdk: Sdk;
  /** bb's live state of mirrored threads (src/mirror-live.ts), laid over BB Studio's copy; absent without an import. */
  mirrorLive?(threadIds: readonly string[]): ReadonlyMap<string, MirrorLive>;
  signals(): Signals;
  changed(changes: readonly BotChange[]): void;
  log?(message: string): void;
  now?(): number;
}

export function rowChanges(before: BotThreadRecord | null, after: BotThreadRecord | null): BotChange[] {
  const rows = [before, after].filter((rec): rec is BotThreadRecord => !!rec);
  const needsYou = (before?.needsYou?.reason ?? null) !== (after?.needsYou?.reason ?? null);
  return rows.map((rec) => ({ botId: rec.botId, kinds: needsYou && rec.needsYou ? [kindOf(rec), "needs-you"] : [kindOf(rec)] }));
}

const PAGE = 200;
const MAX_PAGES = 50;
/** BB's side-chat plugin: the forks it makes are "Reply in thread" side chats. */
const SIDE_CHAT_PLUGIN = "side-chat";
const STUDIO_PLUGIN = "studio";
const EVENT_PAGE = 100;
const MID_TURN_PAGES = 5;

/** Studio's record of every thread's Bot and kind, and the sidebar's reads of it. */
export class BotThreads {
  private backfilling: Promise<{ conversations: number; workers: number; archived: number }> | null = null;

  constructor(private readonly deps: BotThreadsDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  get(threadId: string): BotThreadRecord | null {
    const row = this.deps.db.prepare("SELECT * FROM bot_threads WHERE thread_id = ?").get(threadId) as Row | undefined;
    return row ? record(row) : null;
  }

  /** Every row of one Bot (archived too), or every Bot's. */
  all(botId?: string): BotThreadRecord[] {
    const rows = botId
      ? this.deps.db.prepare("SELECT * FROM bot_threads WHERE bot_id = ?").all(botId) as Row[]
      : this.deps.db.prepare("SELECT * FROM bot_threads").all() as Row[];
    return rows.map(record);
  }

  /** The rows the sidebar lists: one Bot's, not archived. */
  listed(botId?: string): BotThreadRecord[] {
    const rows = botId
      ? this.deps.db.prepare("SELECT * FROM bot_threads WHERE bot_id = ? AND archived_at IS NULL").all(botId) as Row[]
      : this.deps.db.prepare("SELECT * FROM bot_threads WHERE archived_at IS NULL").all() as Row[];
    return rows.map(record);
  }

  /** Conversations and workers of every Bot that aren't archived, latest activity first (activityOf without BB's live status). */
  recent(limit: number): BotThreadRecord[] {
    return (this.deps.db.prepare("SELECT * FROM bot_threads WHERE archived_at IS NULL ORDER BY CASE WHEN activity_at IS NOT NULL THEN MAX(activity_at, COALESCE(needs_you_at, 0)) ELSE MAX(COALESCE(latest_at, 0), COALESCE(needs_you_at, 0), created_at) END DESC LIMIT ?").all(limit) as Row[]).map(record);
  }

  /** The conversations of a Bot that are not archived. */
  conversations(botId: string): BotThreadRecord[] {
    return (this.deps.db.prepare("SELECT * FROM bot_threads WHERE bot_id = ? AND kind = 'conversation' AND archived_at IS NULL").all(botId) as Row[]).map(record);
  }

  /** The Bot whose conversation this is (Main included), or null. */
  conversationBot(threadId: string | null | undefined): string | null {
    if (!threadId) return null;
    const rec = this.get(threadId);
    return rec?.kind === "conversation" ? rec.botId : null;
  }

  /** Where a thread's news goes: a conversation itself, a worker's owning conversation, else null. */
  conversationFor(threadId: string): string | null {
    const rec = this.get(threadId);
    if (!rec) return null;
    return rec.kind === "conversation" ? rec.threadId : rec.ownerConversationId;
  }

  /** The workers a conversation started (the line above its composer). */
  workersOf(conversationId: string): BotThreadRecord[] {
    return (this.deps.db.prepare("SELECT * FROM bot_threads WHERE owner_conversation_id = ? AND kind = 'worker' AND archived_at IS NULL ORDER BY created_at DESC").all(conversationId) as Row[]).map(record);
  }

  /** The Bot the sidebar shows, for threads Patrick starts next. */
  focus(): string | null {
    const row = this.deps.db.prepare("SELECT value FROM bot_threads_state WHERE key = 'focus'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setFocus(botId: string): void {
    this.deps.db.prepare("INSERT INTO bot_threads_state (key, value) VALUES ('focus', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(botId);
  }

  backfilledAt(): number | null {
    const row = this.deps.db.prepare("SELECT value FROM bot_threads_state WHERE key = 'backfilled_at'").get() as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }

  private signals(): Signals {
    return { ...this.deps.signals(), focusedBotId: this.focus() };
  }

  /**
   * Writes a classification. A row Patrick changed keeps its Bot and kind;
   * a guess never overrides an authoritative row; titles, needs-you, latest
   * and a Finish stay.
   */
  private write(thread: ThreadFacts, found: Classification, source: BotThreadSource): BotChange[] {
    const before = this.get(thread.id);
    return this.writeRow(thread, found, source) ? rowChanges(before, this.get(thread.id)) : [];
  }

  private writeRow(thread: ThreadFacts, found: Classification, source: BotThreadSource): boolean {
    const existing = this.get(thread.id);
    const now = this.now();
    if (existing) {
      if (existing.source === "user") return false;
      const same = existing.botId === found.botId && existing.kind === found.kind && existing.isMain === found.isMain
        && existing.ownerConversationId === found.ownerConversationId
        && (existing.forkedFrom?.threadId ?? null) === (found.forkedFrom?.threadId ?? null)
        && (!found.forkedFrom?.messageId || found.forkedFrom.messageId === existing.forkedFrom?.messageId);
      const archive = found.authoritative && found.archived && existing.archivedAt === null;
      if (same && !archive && !(found.isMain && existing.archivedAt !== null)) return false;
      this.deps.db.prepare(`UPDATE bot_threads SET bot_id = ?, kind = ?, is_main = ?, forked_from_turn_id = CASE WHEN forked_from_thread_id IS ? THEN forked_from_turn_id ELSE NULL END,
        forked_from_thread_id = ?, forked_from_message_id = COALESCE(?, forked_from_message_id),
        owner_conversation_id = ?, archived_at = CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE archived_at END, source = ?, updated_at = ? WHERE thread_id = ?`)
        .run(found.botId, found.kind, found.isMain ? 1 : 0, found.forkedFrom?.threadId ?? null, found.forkedFrom?.threadId ?? null, found.forkedFrom?.messageId ?? null,
          found.ownerConversationId, found.isMain ? 1 : 0, archive ? 1 : 0, now, source === "backfill" ? "backfill" : "reconciled", now, thread.id);
      if (found.isMain) this.deps.db.prepare("UPDATE bot_threads SET is_main = 0 WHERE bot_id = ? AND is_main = 1 AND thread_id <> ?").run(found.botId, thread.id);
      return true;
    }
    this.deps.db.prepare(`INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, forked_from_thread_id, forked_from_message_id, forked_from_turn_id, owner_conversation_id, title, archived_at, finished_summary,
        needs_you_reason, needs_you_at, needs_you_source, latest, latest_at, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`)
      .run(thread.id, found.botId, found.kind, found.isMain ? 1 : 0, found.forkedFrom?.threadId ?? null, found.forkedFrom?.messageId ?? null, found.forkedFrom?.turnId ?? null, found.ownerConversationId,
        found.archived ? now : null, source, thread.createdAt ?? now, now);
    if (found.isMain) this.deps.db.prepare("UPDATE bot_threads SET is_main = 0 WHERE bot_id = ? AND is_main = 1 AND thread_id <> ?").run(found.botId, thread.id);
    return true;
  }

  private known = (threadId: string) => this.get(threadId);

  /**
   * Classifies one thread and records it. A thread spawned by one with no row
   * yet classifies its spawner first (read from BB, a few levels up); past
   * that it is a worker of the current Bot's Main.
   */
  async classify(thread: ThreadFacts, source: BotThreadSource = "created", depth = 0): Promise<BotThreadRecord | null> {
    const signals = this.signals();
    let found = classifyThread(thread, signals, this.known);
    if (found === "parent-unknown") {
      const spawner = thread.parentThreadId ?? thread.lifecycleOwnerThreadId!;
      const parent = depth < 6 ? await this.deps.sdk.threads.get({ threadId: spawner }).catch(() => null) as ThreadFacts | null : null;
      if (parent) await this.classify(parent, source, depth + 1);
      found = classifyThread(thread, this.signals(), this.known);
      if (found === "parent-unknown") {
        const botId = currentBot(signals);
        found = botId ? { botId, kind: "worker", isMain: false, forkedFrom: null, ownerConversationId: mainOf(signals, botId), archived: false, authoritative: false } : null;
      }
    }
    if (!found) return null;
    const changes = this.write(thread, found, source);
    if (changes.length) this.deps.changed(changes);
    return this.get(thread.id);
  }

  /** BB made a thread: record it at once. Never throws. */
  async created(thread: ThreadFacts): Promise<void> {
    try {
      if (this.get(thread.id)) return;
      // A fork BB doesn't say the maker of: one made mid-turn, or from an agent's thread, is an agent's.
      if (forkUndecided(thread) && thread.sourceBusy === undefined) {
        const source = await this.deps.sdk.threads.get({ threadId: thread.sourceThreadId! }).catch(() => null) as ThreadFacts | null;
        thread = BUSY.has(source?.status ?? "") ? { ...thread, sourceBusy: true } : await this.forkFacts(thread);
      }
      await this.classify(thread, "created");
    } catch (error) {
      this.deps.log?.(`Classifying thread ${thread.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Every thread that isn't archived, hidden ones included, oldest first (a parent before its children). */
  private async activeThreads(): Promise<ThreadFacts[]> {
    const seen = new Map<string, ThreadFacts>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.deps.sdk.threads.list({ archived: false, includeHidden: true, limit: PAGE, offset: page * PAGE }) as ThreadFacts[];
      for (const thread of batch) if (!thread.archivedAt) seen.set(thread.id, thread);
      if (batch.length < PAGE) break;
    }
    return [...seen.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  /**
   * The first fill (once; `force` runs it again over rows it hasn't seen).
   * Adopted standalone threads past the newest ADOPT_RECENT come in archived.
   */
  backfill(force = false): Promise<{ conversations: number; workers: number; archived: number }> {
    if (!force && this.backfilledAt() !== null) return Promise.resolve({ conversations: 0, workers: 0, archived: 0 });
    return this.backfilling ??= this.runBackfill().finally(() => { this.backfilling = null; });
  }

  private async runBackfill(): Promise<{ conversations: number; workers: number; archived: number }> {
    const listed = await this.activeThreads();
    // Forks nothing on the fork itself decides who made: read their sources' records and turn events first.
    const threads: ThreadFacts[] = [];
    for (const thread of listed) threads.push(forkUndecided(thread) && !this.get(thread.id) ? await this.forkFacts(thread) : thread);
    if (!this.signals().bots.length) return { conversations: 0, workers: 0, archived: 0 };
    const counts = { conversations: 0, workers: 0, archived: 0 };
    const changes: BotChange[] = [];
    const adopted: ThreadFacts[] = [];
    const run = this.deps.db.transaction(() => {
      for (const thread of threads) {
        if (this.get(thread.id)) continue;
        const found = classifyThread(thread, this.signals(), this.known);
        // Threads come oldest first, so a spawner is known by now unless it was archived: then Main owns its worker.
        const resolved = found === "parent-unknown" ? (() => {
          const botId = currentBot(this.signals());
          return botId ? { botId, kind: "worker" as const, isMain: false, forkedFrom: null, ownerConversationId: mainOf(this.signals(), botId), archived: false, authoritative: false } : null;
        })() : found;
        if (!resolved) continue;
        const standalone = resolved.kind === "conversation" && !resolved.authoritative && !resolved.forkedFrom;
        if (standalone) adopted.push(thread);
        changes.push(...this.write(thread, resolved, "backfill"));
        if (resolved.kind === "worker") counts.workers++;
        else counts.conversations++;
      }
      // Keep the newest ADOPT_RECENT standalone threads in the sidebar; archive the rest.
      const old = adopted.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)).slice(ADOPT_RECENT);
      const archive = this.deps.db.prepare("UPDATE bot_threads SET archived_at = ? WHERE thread_id = ? AND archived_at IS NULL");
      for (const thread of old) {
        const rec = this.get(thread.id);
        if (archive.run(this.now(), thread.id).changes && rec) { counts.archived++; changes.push({ botId: rec.botId, kinds: [kindOf(rec)] }); }
      }
      this.deps.db.prepare("INSERT INTO bot_threads_state (key, value) VALUES ('backfilled_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(this.now()));
    });
    run();
    this.deps.changed(changes);
    return counts;
  }

  /**
   * Applies the authoritative rules again (a runner's thread recorded after
   * BB made it, a Bot that handed off to a new chat, a new side thread).
   * Answers how many rows changed.
   */
  reconcile(threads?: readonly ThreadFacts[]): number {
    const signals = this.signals();
    const changes: BotChange[] = [];
    let changed = 0;
    const rows = this.all();
    const facts = new Map((threads ?? []).map((thread) => [thread.id, thread]));
    const run = this.deps.db.transaction(() => {
      for (const bot of signals.bots) {
        for (const id of bot.chain) {
          const found = classifyThread(facts.get(id) ?? { id }, signals, this.known);
          const wrote = found && found !== "parent-unknown" ? this.write(facts.get(id) ?? { id }, found, "reconciled") : [];
          if (wrote.length) { changed++; changes.push(...wrote); }
        }
      }
      for (const rec of rows) {
        if (rec.source === "user") continue;
        const found = classifyThread(facts.get(rec.threadId) ?? { id: rec.threadId }, signals, this.known);
        if (!found || found === "parent-unknown" || !found.authoritative) continue;
        // A worker already under a conversation of the same Bot stays there: the sweep only knows its Bot, not who spawned it.
        if (rec.kind === "worker" && found.kind === "worker" && rec.botId === found.botId && rec.ownerConversationId && !found.archived) continue;
        const wrote = this.write(facts.get(rec.threadId) ?? { id: rec.threadId }, found, "reconciled");
        if (wrote.length) { changed++; changes.push(...wrote); }
      }
    });
    run();
    if (changed) this.deps.changed(changes);
    return changed;
  }

  /** Where a forked conversation was cut, once known (BB's fork point): its link gets the turn. */
  forkedAt(threadId: string, point: { sourceThreadId: string; turnId: string | null }): boolean {
    const rec = this.get(threadId);
    if (rec?.kind !== "conversation" || !rec.forkedFrom || rec.forkedFrom.turnId === point.turnId) return false;
    // A fork of a worker links to the worker's conversation; keep that link, add the turn only when it is the source's own.
    const turn = rec.forkedFrom.threadId === point.sourceThreadId ? point.turnId : null;
    if (turn === rec.forkedFrom.turnId) return false;
    this.deps.db.prepare("UPDATE bot_threads SET forked_from_turn_id = ?, updated_at = ? WHERE thread_id = ?").run(turn, this.now(), threadId);
    this.deps.changed([{ botId: rec.botId, kinds: ["conversations"] }]);
    return true;
  }

  /** Conversations forked by BB (not side threads) with no turn yet, for the fork point lookup. */
  forksWithoutTurn(limit: number): BotThreadRecord[] {
    return (this.deps.db.prepare("SELECT * FROM bot_threads WHERE kind = 'conversation' AND forked_from_thread_id IS NOT NULL AND forked_from_turn_id IS NULL AND forked_from_message_id IS NULL ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(record);
  }

  /** BB archived (or brought back) a thread. */
  archived(threadId: string, archived: boolean): void {
    const before = this.get(threadId);
    const result = archived
      ? this.deps.db.prepare("UPDATE bot_threads SET archived_at = ?, needs_you_reason = NULL, needs_you_at = NULL, needs_you_source = NULL, updated_at = ? WHERE thread_id = ? AND archived_at IS NULL").run(this.now(), this.now(), threadId)
      : this.deps.db.prepare("UPDATE bot_threads SET archived_at = NULL, updated_at = ? WHERE thread_id = ? AND archived_at IS NOT NULL").run(this.now(), threadId);
    if (result.changes) this.deps.changed(rowChanges(before, this.get(threadId)));
  }

  deleted(threadId: string): void {
    const db = this.deps.db;
    const before = this.get(threadId);
    const owned = (db.prepare("SELECT * FROM bot_threads WHERE owner_conversation_id = ?").all(threadId) as Row[]).map(record);
    const removed = db.prepare("DELETE FROM bot_threads WHERE thread_id = ?").run(threadId).changes;
    // Its workers fall back to their Bot's Main; forks keep their link (the title reads "a conversation").
    const orphans = db.prepare(`UPDATE bot_threads SET owner_conversation_id = (SELECT m.thread_id FROM bot_threads m WHERE m.bot_id = bot_threads.bot_id AND m.is_main = 1 LIMIT 1), updated_at = ?
      WHERE owner_conversation_id = ?`).run(this.now(), threadId).changes;
    if (removed || orphans) this.deps.changed([...rowChanges(before, null), ...(orphans ? owned.map((rec) => ({ botId: rec.botId, kinds: [kindOf(rec)] })) : [])]);
  }

  /** A turn started or ended, or a question came up: real activity, now. */
  touched(threadId: string): void {
    this.deps.db.prepare("UPDATE bot_threads SET activity_at = ? WHERE thread_id = ?").run(this.now(), threadId);
  }

  /** Rows whose latest activity Studio hasn't read yet (listed ones first, newest Studio row first). */
  missingActivity(limit: number): BotThreadRecord[] {
    return (this.deps.db.prepare("SELECT * FROM bot_threads WHERE activity_at IS NULL ORDER BY archived_at IS NOT NULL, created_at DESC LIMIT ?").all(limit) as Row[]).map(record);
  }

  /** Writes what the thread's events say its latest activity was (no change notice; a fill). */
  fillActivity(threadId: string, at: number): void {
    this.deps.db.prepare("UPDATE bot_threads SET activity_at = MAX(COALESCE(activity_at, 0), ?) WHERE thread_id = ?").run(at, threadId);
  }

  /**
   * When a thread was last really used, from its events: its last turn or
   * item event, else when it was made. Null when BB can't say.
   */
  async lastActivity(threadId: string, createdAt: number | null): Promise<number | null> {
    const rows = await Promise.resolve().then(() => this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "1", types: ["turn/completed", "turn/started", "item/completed"] })).catch(() => null) as { createdAt?: number }[] | null;
    if (!rows) return null;
    return rows[0]?.createdAt ?? createdAt;
  }

  /**
   * Whether `sourceId` was in a turn at `at`: its last turn/started or
   * turn/completed at or before `at` is a start. Pages back through its turn
   * events, newest first, a few pages at most.
   */
  async midTurn(sourceId: string, at: number): Promise<boolean> {
    let before: number | null = null;
    for (let page = 0; page < MID_TURN_PAGES; page++) {
      const rows = await Promise.resolve().then(() => this.deps.sdk.threads.events.list({ threadId: sourceId, order: "desc", limit: String(EVENT_PAGE), types: ["turn/started", "turn/completed"], ...(before === null ? {} : { beforeSeq: String(before) }) })).catch(() => null) as { seq: number; type: string; createdAt: number }[] | null;
      if (!rows?.length) return false;
      const last = rows.find((row) => row.createdAt <= at);
      if (last) return last.type === "turn/started";
      if (rows.length < EVENT_PAGE) return false;
      before = rows.at(-1)!.seq;
    }
    return false;
  }

  /**
   * What only BB's other records say about a fork's maker: whether its
   * source was mid-turn when the fork was made, and, for a source Studio
   * has no row for (archived), whether that source was an agent's thread
   * itself (a chain of agents' forks), a few levels up.
   */
  async forkFacts(thread: ThreadFacts, depth = 0): Promise<ThreadFacts> {
    if (!forkUndecided(thread)) return thread;
    const sourceId = thread.sourceThreadId!;
    const known = this.get(sourceId);
    if (known?.kind === "worker") return thread;
    let sourceIsWorker = false;
    if (!known && depth < 4) {
      const source = await this.deps.sdk.threads.get({ threadId: sourceId }).catch(() => null) as ThreadFacts | null;
      if (source) sourceIsWorker = agentThread(await this.forkFacts(source, depth + 1));
    }
    if (sourceIsWorker) return { ...thread, sourceIsWorker };
    const sourceBusy = thread.sourceBusy ?? (thread.createdAt ? await this.midTurn(sourceId, thread.createdAt) : false);
    return { ...thread, sourceIsWorker, sourceBusy };
  }

  /** A conversation's turn ended: its latest reply becomes its second line. A quiet "[PASS]" changes nothing. */
  idle(threadId: string, lastAssistantText: string | null | undefined): void {
    this.touched(threadId);
    const line = latestLine(lastAssistantText);
    if (!line) return;
    const result = this.deps.db.prepare("UPDATE bot_threads SET latest = ?, latest_at = ?, activity_at = ? WHERE thread_id = ? AND kind = 'conversation'").run(line, this.now(), this.now(), threadId);
    if (result.changes) this.deps.changed(rowChanges(null, this.get(threadId)));
  }

  /** Conversations with no latest line yet, newest first (filled lazily from BB's output). */
  missingLatest(botId: string, limit: number): string[] {
    return (this.deps.db.prepare("SELECT thread_id FROM bot_threads WHERE bot_id = ? AND kind = 'conversation' AND archived_at IS NULL AND latest IS NULL ORDER BY updated_at DESC LIMIT ?").all(botId, limit) as { thread_id: string }[]).map((row) => row.thread_id);
  }

  /** Conversations filled with no latest line (""), newest first: a later look may find a reply. */
  emptyLatest(botId: string, limit: number): string[] {
    return (this.deps.db.prepare("SELECT thread_id FROM bot_threads WHERE bot_id = ? AND kind = 'conversation' AND archived_at IS NULL AND latest = '' ORDER BY updated_at DESC LIMIT ?").all(botId, limit) as { thread_id: string }[]).map((row) => row.thread_id);
  }

  /** Writes a conversation's latest line without a change notice (a lazy fill); "" marks it as having none. `overEmpty` also fills one marked "". */
  fillLatest(threadId: string, text: string | null, overEmpty = false): void {
    // Its time is the thread's activity, not now: a lazy fill isn't a new reply.
    this.deps.db.prepare(`UPDATE bot_threads SET latest = ? WHERE thread_id = ? AND (latest IS NULL${overEmpty ? " OR latest = ''" : ""})`).run(latestLine(text) ?? "", threadId);
  }

  /** Marks a conversation as needing Patrick (`reason`), or clears it (null). `source` names who raised it (a worker's id, or "bot"). */
  setNeedsYou(threadId: string, reason: string | null, source: string | null = null): boolean {
    const clean = reason?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
    const before = this.get(threadId);
    const result = clean
      ? this.deps.db.prepare("UPDATE bot_threads SET needs_you_reason = ?, needs_you_at = ?, needs_you_source = ?, updated_at = ? WHERE thread_id = ? AND kind = 'conversation'").run(clean, this.now(), source, this.now(), threadId)
      : this.deps.db.prepare("UPDATE bot_threads SET needs_you_reason = NULL, needs_you_at = NULL, needs_you_source = NULL, updated_at = ? WHERE thread_id = ? AND needs_you_reason IS NOT NULL").run(this.now(), threadId);
    if (result.changes && before) this.deps.changed([{ botId: before.botId, kinds: ["needs-you"] }]);
    return result.changes > 0;
  }

  /** What `source` raised is over (a worker's wait ended): the conversations it marked are clear again. */
  clearNeedsYouFrom(source: string): number {
    const marked = (this.deps.db.prepare("SELECT bot_id FROM bot_threads WHERE needs_you_source = ?").all(source) as { bot_id: string }[]).map((row) => row.bot_id);
    const changes = this.deps.db.prepare("UPDATE bot_threads SET needs_you_reason = NULL, needs_you_at = NULL, needs_you_source = NULL, updated_at = ? WHERE needs_you_source = ?").run(this.now(), source).changes;
    if (changes) this.deps.changed(marked.map((botId) => ({ botId, kinds: ["needs-you"] })));
    return changes;
  }

  /** Patrick replied in a conversation after it was marked: the mark goes. */
  async repliedSince(threadId: string): Promise<boolean> {
    const rec = this.get(threadId);
    if (!rec?.needsYou) return false;
    const page = await this.deps.sdk.threads.timeline({ threadId, segmentLimit: "1" } as never).catch(() => null) as { rows?: { kind?: string; role?: string; createdAt?: number }[] } | null;
    const replied = (page?.rows ?? []).some((row) => row.kind === "conversation" && row.role === "user" && (row.createdAt ?? 0) > rec.needsYou!.at);
    return replied ? this.setNeedsYou(threadId, null) : false;
  }

  /**
   * Patrick's changes: a title (null: BB's own), archived or not, or a move
   * to another Bot or kind. Moves and kinds mark the row his, so no sweep
   * changes it back.
   */
  update(threadId: string, patch: { title?: string | null; archived?: boolean; finishedSummary?: string | null }): BotThreadRecord {
    const rec = this.get(threadId);
    if (!rec) throw new Error(`Thread ${threadId} isn't a conversation or a worker of any Bot.`);
    const now = this.now();
    if (patch.title !== undefined) this.deps.db.prepare("UPDATE bot_threads SET title = ?, updated_at = ? WHERE thread_id = ?").run(patch.title?.trim().slice(0, 200) || null, now, threadId);
    if (patch.archived !== undefined) {
      if (rec.isMain && patch.archived) throw new Error("Main can't be archived.");
      this.deps.db.prepare("UPDATE bot_threads SET archived_at = ?, updated_at = ? WHERE thread_id = ?").run(patch.archived ? now : null, now, threadId);
    }
    if (patch.finishedSummary !== undefined) this.deps.db.prepare("UPDATE bot_threads SET finished_summary = ?, updated_at = ? WHERE thread_id = ?").run(patch.finishedSummary, now, threadId);
    const after = this.get(threadId)!;
    this.deps.changed(rowChanges(rec, after));
    return after;
  }

  /** A marker in bot_threads_state (a one-time pass ran). */
  marked(key: string): boolean {
    return !!this.deps.db.prepare("SELECT 1 FROM bot_threads_state WHERE key = ?").get(key);
  }

  mark(key: string): void {
    this.deps.db.prepare("INSERT INTO bot_threads_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, String(this.now()));
  }

  /**
   * The rows the fork rules may move: forks recorded as conversations (not
   * side threads with their message), and listed workers (a side chat an
   * earlier rule made one). Not Patrick's own.
   */
  forkConversations(): BotThreadRecord[] {
    return (this.deps.db.prepare(`SELECT * FROM bot_threads WHERE source <> 'user' AND is_main = 0 AND (
        (kind = 'conversation' AND forked_from_thread_id IS NOT NULL AND forked_from_message_id IS NULL) OR (kind = 'worker' AND archived_at IS NULL))`).all() as Row[]).map(record);
  }

  /**
   * Applies the fork rule again to forks recorded as conversations (once,
   * after the rule learned agents' forks): an agent's or a tool's fork
   * becomes a worker of the conversation that owns its source. Answers how
   * many moved.
   */
  async reclassifyForks(threads: ReadonlyMap<string, ThreadFacts>): Promise<number> {
    const signals = this.signals();
    let moved = 0;
    const changes: BotChange[] = [];
    const facts = new Map<string, ThreadFacts>();
    for (const rec of this.forkConversations()) {
      const thread = threads.get(rec.threadId);
      if (!thread) continue;
      if (rec.kind === "worker") { if (thread.originKind === "fork") facts.set(rec.threadId, thread); continue; }
      facts.set(rec.threadId, await this.forkFacts({ ...thread, originKind: thread.originKind ?? "fork", sourceThreadId: thread.sourceThreadId ?? rec.forkedFrom!.threadId }));
    }
    const run = this.deps.db.transaction(() => {
      for (const rec of this.forkConversations()) {
        const thread = facts.get(rec.threadId);
        if (!thread) continue;
        const found = classifyThread(thread, signals, this.known);
        if (!found || found === "parent-unknown" || found.kind === rec.kind) continue;
        // A worker goes back to a conversation only by a firm rule (a side chat), never by a guess.
        if (found.kind === "conversation" && !found.authoritative) continue;
        const wrote = this.write(thread, found, "reconciled");
        if (wrote.length) { moved++; changes.push(...wrote); }
      }
    });
    run();
    if (moved) this.deps.changed(changes);
    return moved;
  }

  /**
   * Records a fork Patrick made from a message ("Fork conversation from
   * here") as a conversation of the source's Bot, linked back to that
   * message: his own call, so no later rule moves it (source "user"), even
   * when BB's thread.created classified it first.
   */
  recordFork(threadId: string, botId: string, from: ForkedFrom): BotThreadRecord {
    const before = this.get(threadId);
    const now = this.now();
    this.deps.db.prepare(`INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, forked_from_thread_id, forked_from_message_id, forked_from_turn_id, owner_conversation_id, source, created_at, updated_at, activity_at)
        VALUES (?, ?, 'conversation', 0, ?, ?, ?, NULL, 'user', ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET bot_id = excluded.bot_id, kind = 'conversation', is_main = 0, forked_from_thread_id = excluded.forked_from_thread_id,
        forked_from_message_id = excluded.forked_from_message_id, forked_from_turn_id = excluded.forked_from_turn_id, owner_conversation_id = NULL, archived_at = NULL,
        source = 'user', updated_at = excluded.updated_at, activity_at = excluded.activity_at`)
      .run(threadId, botId, from.threadId, from.messageId, from.turnId, now, now, now);
    const after = this.get(threadId)!;
    this.deps.changed(rowChanges(before, after));
    return after;
  }

  /**
   * Records a conversation Patrick started from a Bot's + New as that Bot's:
   * his own call, so no later rule moves it (source "user"), even when BB's
   * thread.created classified it first.
   */
  recordConversation(threadId: string, botId: string): BotThreadRecord {
    const before = this.get(threadId);
    const now = this.now();
    this.deps.db.prepare(`INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, owner_conversation_id, source, created_at, updated_at, activity_at)
        VALUES (?, ?, 'conversation', 0, NULL, 'user', ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET bot_id = excluded.bot_id, kind = 'conversation', is_main = 0, owner_conversation_id = NULL, archived_at = NULL,
        source = 'user', updated_at = excluded.updated_at, activity_at = excluded.activity_at`)
      .run(threadId, botId, now, now, now);
    const after = this.get(threadId)!;
    this.deps.changed(rowChanges(before, after));
    return after;
  }

  /** Writes a conversation's second line directly (Main's "Finished “…” · summary saved"). */
  setLatest(threadId: string, text: string): void {
    const result = this.deps.db.prepare("UPDATE bot_threads SET latest = ?, latest_at = ?, updated_at = ? WHERE thread_id = ? AND kind = 'conversation'").run(text.slice(0, LATEST_MAX), this.now(), this.now(), threadId);
    if (result.changes) this.deps.changed(rowChanges(null, this.get(threadId)));
  }

  /** A Finish: archived (out of the sidebar, still searchable) with its summary; its needs-you mark goes. */
  finish(threadId: string, summary: string): BotThreadRecord {
    const rec = this.get(threadId);
    if (!rec || rec.kind !== "conversation" || rec.isMain) throw new Error("Only a conversation other than Main can be finished.");
    const now = this.now();
    this.deps.db.prepare("UPDATE bot_threads SET archived_at = COALESCE(archived_at, ?), finished_summary = ?, needs_you_reason = NULL, needs_you_at = NULL, needs_you_source = NULL, updated_at = ? WHERE thread_id = ?").run(now, summary, now, threadId);
    const after = this.get(threadId)!;
    this.deps.changed(rowChanges(rec, after));
    return after;
  }

  /** Reopen after a Finish: listed again; the summary stays as what it decided then. */
  reopen(threadId: string): BotThreadRecord {
    const rec = this.get(threadId);
    if (!rec || rec.kind !== "conversation") throw new Error("That thread isn't a conversation.");
    this.deps.db.prepare("UPDATE bot_threads SET archived_at = NULL, updated_at = ? WHERE thread_id = ?").run(this.now(), threadId);
    const after = this.get(threadId)!;
    this.deps.changed(rowChanges(rec, after));
    return after;
  }

  /**
   * Reads BB's view of the given threads (status, titles, environments), 200
   * at a time, with bb's live state over the ones mirrored from bb.
   */
  async facts(threadIds: readonly string[]): Promise<Map<string, ThreadFacts>> {
    const read = await this.ownFacts(threadIds);
    if (!this.deps.mirrorLive) return read;
    let live: ReadonlyMap<string, MirrorLive>;
    try { live = this.deps.mirrorLive([...read.keys()]); } catch { return read; }
    return live.size ? overlayMirrorLive(read, live) : read;
  }

  private async ownFacts(threadIds: readonly string[]): Promise<Map<string, ThreadFacts>> {
    const ids = [...new Set(threadIds)];
    const result = new Map<string, ThreadFacts>();
    for (let at = 0; at < ids.length; at += PAGE) {
      const batch = ids.slice(at, at + PAGE);
      const listed = await this.deps.sdk.threads.list({ threadIds: batch, includeHidden: true, limit: PAGE } as never).catch(() => null) as ThreadFacts[] | null;
      for (const thread of listed ?? []) result.set(thread.id, thread);
      if (!listed) for (const id of batch) {
        const thread = await this.deps.sdk.threads.get({ threadId: id }).catch(() => null) as ThreadFacts | null;
        if (thread) result.set(id, thread);
      }
    }
    return result;
  }
}

/**
 * What a conversation's session is told after the Bot's own instructions:
 * one short line on which conversation this is (BB cuts a plugin's
 * instructions at 4,096 characters, and the Bot's are long already).
 */
export function conversationInstructions(rec: Pick<BotThreadRecord, "isMain" | "forkedFrom">, title: string, forkedFromTitle: string | null): string {
  if (rec.isMain) return "This is Main: reports and alerts arrive here; see bot_conversations for the others.";
  const fork = rec.forkedFrom ? `, forked from ${JSON.stringify(forkedFromTitle ?? "another conversation")}` : "";
  return `This is your conversation ${JSON.stringify(title)}${fork}, not Main; reports go to Main. See bot_conversations; bot_needs_you flags this one for the user. If the user asks to finish it: save its summary with memory_add, then call bot_finish_done.`;
}
