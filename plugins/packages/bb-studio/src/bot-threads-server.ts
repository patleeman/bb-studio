// The backend of one Bot, many conversations (src/bot-threads.ts): it keeps
// the record current from BB's thread events, fills it once from what
// exists, re-applies Studio's own facts every two minutes, and answers the
// RPC (src/bot-threads-contract.ts) and two agent tools.
//
// Events: thread.created classifies a new thread at once; archived,
// unarchived and deleted follow BB; idle stores a conversation's latest
// reply and clears its needs-you mark once Patrick replied after it; every
// status change of a recorded thread (active, idle, failed, a pending
// question) tells open views to reload.
import type { Appearance } from "./theme/appearance";
import type { Presence } from "./presence/schema";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { ThreadSeeds } from "./thread-seeds";
import { BotThreads, forkUndecided, botActivity, botNeedsYou, conversationTitle, conversationWorkers, latestLine, needsYouOf, olderView, repoTag, staleRaises, threadsView, workerStatus, type BotThreadRecord, type Signals, type ThreadFacts } from "./bot-threads";
import { isWorkerApproval, viewOf, waitingOn, workerApprovalPush, type Interaction, type WorkerApprovalPush } from "./worker-approvals";
import { PERSONAL_PROJECT_ID } from "./project-lead";
import { isFinishing } from "./bot-finish";
import { kindOf, type BotChange } from "./bot-signal";
import type { BotChangeKind } from "./bot-threads-contract";
import type { MirroredBatch, MirrorLive } from "./mirror-live";
import { SideThreads } from "./bot-side-threads";
import { MessageThreads, type MessageRef } from "./message-threads";
import { MirrorCatchUp } from "./mirror-catch-up";
import type { BotSpace, BotThreadInfo, LibraryItem, LibraryKind, NewConversationRequest } from "./bot-threads-contract";
import type { ReasoningLevel } from "./kit/reasoning";
import type { IndexedItem } from "./item-index";
import { familyHref, itemType } from "./item-model";
import type { Recording } from "./kit/talk-contract";
import { PLUGIN_ID as TALK_PLUGIN_ID, recordingHref } from "./talk/shared/format";

type Bb = Pick<BbPluginApi, "events" | "sdk" | "agents">;

export interface SpaceBot {
  id: string; name: string; avatar: string; shape?: string | null; color?: string | null; primary?: boolean; threadId: string | null; appearance?: Appearance | null; presence?: Presence;
}

export interface BotThreadsServerDeps {
  /** Every Bot, the primary first. */
  bots(): readonly SpaceBot[];
  /** Studio's facts (src/bot-threads.ts Signals), without the current Bot, which the store keeps. */
  signals(): Omit<Signals, "focusedBotId">;
  /** Studio's items, newest first, for the Library. */
  items(): readonly LibrarySource[];
  /** The thread that made each item, by `<plugin>:<id>`. */
  originThreads(): ReadonlyMap<string, string>;
  /** The agent thread each item's first activity names, by `<plugin>:<id>` (a worker that made it through Main). */
  creatorThreads?(): ReadonlyMap<string, string>;
  starred?(): ReadonlySet<string>;
  botItems?(): ReadonlyMap<string, string>;
  fileFormats?(): ReadonlyMap<string, string>;
  /** Tells every window something changed (Studio's realtime channel), and the phone which Bots' threads did. */
  changed(changes: readonly BotChange[]): void;
  log(message: string): void;
  /** The Bot a thread acts for, for the tools (its own conversation, a runner's, a thread it started). */
  actingBot(threadId: string | undefined): Promise<string | null>;
  /** Where BB forked a thread (`experimental_threadForkPoint`, the fork); absent on a BB without it. */
  forkPoint?(threadId: string): Promise<{ sourceThreadId: string; sourceTurnId: string | null } | null>;
  /** bb's live state of the threads BB Studio mirrors (src/mirror-live.ts); absent without an import. */
  mirrorLive?(threadIds: readonly string[]): ReadonlyMap<string, MirrorLive>;
  mirrored?(since: number): MirroredBatch | null;
  sideThreads?: SideThreads;
  seeds?: ThreadSeeds;
  /** A Bot's default model (src/bot.ts): what its new conversations start on; null when it has none. */
  defaultModel(botId: string): { providerId: string; model: string; reasoning: ReasoningLevel | null } | null;
}

/** How many forks the start looks up the fork point of. */
const FORK_POINTS = 100;
/** The one-time pass that applies the fork rule (agents' forks are workers) to forks recorded before it. */
const RECLASSIFY_FORKS = "reclassified_forks_v3";
/** How many threads' latest activity one pass reads from their events, and how many at once. */
const ACTIVITY_FILL = 3000;
const ACTIVITY_PARALLEL = 8;
const ACTIVITY_PER_VIEW = 20;

const FACTS_TTL_MS = 3_000;
const LATEST_FILL = 8;
/** A worker's approval is looked for only if the worker was active this recently. */
const APPROVAL_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** The Library's flat kinds. */
export function libraryKind(type: string | null | undefined): LibraryKind {
  if (type === "doc") return "page";
  if (type === "whiteboard") return "whiteboard";
  if (type === "design") return "design";
  if (type === "mini") return "app";
  if (type === "artifact") return "artifact";
  if (type === "recording") return "recording";
  return "other";
}

export type LibrarySource = Pick<IndexedItem, "pluginId" | "id" | "title" | "createdAt" | "updatedAt" | "archived" | "template"> & { type: string; href?: string };

export function recordingFiles(recordings: readonly Pick<Recording, "id" | "kind" | "title" | "createdAt" | "updatedAt" | "archived">[]): LibrarySource[] {
  return recordings.filter((each) => each.kind === "recording").map((each) => ({
    pluginId: TALK_PLUGIN_ID, id: each.id, type: "recording", title: each.title, createdAt: each.createdAt, updatedAt: each.updatedAt, archived: each.archived, template: false, href: recordingHref(each.id),
  }));
}

/**
 * Where a file came from: the thread that made it; but when that is a
 * conversation (Main, mostly) and the agent its first activity names is a
 * worker of the same Bot, the worker (UX review 3, item 7): it made it.
 * With no thread recorded, the Bot's thread its first activity names.
 */
export function fileOrigin(key: string, origins: ReadonlyMap<string, string>, creators: ReadonlyMap<string, string> | null, record: (threadId: string) => BotThreadRecord | null): string | null {
  const origin = origins.get(key) ?? null;
  const creator = creators?.get(key) ?? null;
  if (!origin || !creator || creator === origin) return origin ?? (creator && record(creator) ? creator : null);
  const made = record(origin);
  const worker = record(creator);
  return made?.kind === "conversation" && worker?.kind === "worker" && worker.botId === made.botId ? creator : origin;
}

/**
 * The Bot's files: items its conversations and workers made, newest first.
 * An item no thread made (Patrick's own), or whose thread no Bot has, counts
 * as the primary Bot's.
 */
export function libraryItems(input: {
  botId: string;
  primaryId: string | null;
  items: readonly LibrarySource[];
  origins: ReadonlyMap<string, string>;
  /** The agent thread each item's first activity names; a worker there gets the credit over Main. */
  creators?: ReadonlyMap<string, string>;
  starred?: ReadonlySet<string>;
  botItems?: ReadonlyMap<string, string>;
  formats?: ReadonlyMap<string, string>;
  record(threadId: string): BotThreadRecord | null;
  title(threadId: string): string;
}): LibraryItem[] {
  const result: LibraryItem[] = [];
  for (const item of input.items) {
    if (item.archived || item.template) continue;
    const key = `${item.pluginId}:${item.id}`;
    const origin = fileOrigin(key, input.origins, input.creators ?? null, input.record);
    const rec = origin ? input.record(origin) : null;
    const maker = origin ? null : input.botItems?.get(key) ?? null;
    const owner = rec?.botId ?? maker ?? input.primaryId;
    if (owner !== input.botId) continue;
    const conversationId = rec ? (rec.kind === "conversation" ? rec.threadId : rec.ownerConversationId) : null;
    const info = itemType(item.type);
    result.push({
      pluginId: item.pluginId, id: item.id, title: item.title.trim() || "Untitled", kind: libraryKind(item.type), type: item.type, format: input.formats?.get(key) ?? null,
      href: item.href ?? (info ? familyHref(info.family, item.id) : null), updatedAt: item.updatedAt, createdAt: item.createdAt || null,
      madeIn: origin ? { threadId: origin, title: input.title(origin), kind: rec?.kind ?? "conversation", conversationId, conversationTitle: conversationId ? input.title(conversationId) : null } : null,
      starred: input.starred?.has(key) ?? false,
      byBot: !!maker,
    });
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function registerBotThreads(bb: Bb, db: Database.Database, deps: BotThreadsServerDeps) {
  /** BB's view of threads, shared by the reads of one refresh. */
  let factsCache: { at: number; key: string; facts: Map<string, ThreadFacts> } | null = null;
  const changed = (changes: readonly BotChange[]) => { factsCache = null; deps.changed(changes); };
  const threadChanged = (threadId: string, extra: readonly BotChangeKind[] = []) => {
    const rec = store.get(threadId);
    changed(rec ? [{ botId: rec.botId, kinds: [kindOf(rec), ...extra] }] : []);
  };
  const store = new BotThreads({
    db, sdk: bb.sdk, changed, log: deps.log,
    signals: () => ({ ...deps.signals(), focusedBotId: null }),
    ...(deps.mirrorLive ? { mirrorLive: deps.mirrorLive } : {}),
  });
  const known = (threadId: string) => !!store.get(threadId);

  /** A fork's point in its source (the last copied turn), from BB where it says. */
  const lookUpForkPoint = async (threadId: string) => {
    if (!deps.forkPoint) return;
    const point = await deps.forkPoint(threadId).catch(() => null);
    if (point) store.forkedAt(threadId, { sourceThreadId: point.sourceThreadId, turnId: point.sourceTurnId });
  };

  // Thread events.
  bb.events.on("thread.created", ({ thread }) => {
    void store.created(thread as ThreadFacts).then(() => {
      const rec = store.get(thread.id);
      if (rec?.kind === "conversation" && rec.forkedFrom && !rec.forkedFrom.messageId) return lookUpForkPoint(thread.id);
    });
    // A side chat learns its reply a moment later, a runner its thread: apply them.
    setTimeout(() => { try { store.reconcile(); } catch { /* the next sweep */ } }, 8_000);
  });
  bb.events.on("thread.archived", ({ thread }) => store.archived(thread.id, true));
  bb.events.on("thread.unarchived", ({ thread }) => { if (known(thread.id)) store.archived(thread.id, false); else void store.created(thread as ThreadFacts); });
  bb.events.on("thread.deleted", ({ thread }) => store.deleted(thread.id));
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    if (!known(thread.id)) return;
    store.idle(thread.id, lastAssistantText);
    void store.repliedSince(thread.id).catch(() => false);
    threadChanged(thread.id);
  });
  // A turn starting or failing, or a question, is real activity (BB's updated_at isn't: the importer moves it).
  for (const event of ["thread.active", "thread.failed"] as const) bb.events.on(event, ({ thread }) => { if (known(thread.id)) { store.touched(thread.id); threadChanged(thread.id); } });
  bb.events.on("interaction.pending", ({ thread }) => { if (known(thread.id)) { store.touched(thread.id); threadChanged(thread.id, store.get(thread.id)?.kind === "conversation" ? ["needs-you"] : []); } });

  const facts = async (ids: readonly string[]): Promise<Map<string, ThreadFacts>> => {
    const key = [...new Set(ids)].sort().join(",");
    if (factsCache && factsCache.key === key && Date.now() - factsCache.at < FACTS_TTL_MS) return factsCache.facts;
    const at = Date.now();
    const read = await store.facts(ids);
    factsCache = { at, key, facts: read };
    return read;
  };
  const botOrCurrent = (botId: string | undefined): string | null => {
    const bots = deps.bots();
    if (botId) return bots.some((bot) => bot.id === botId) ? botId : null;
    const focus = store.focus();
    return bots.find((bot) => bot.id === focus)?.id ?? bots[0]?.id ?? null;
  };
  const titleFrom = (all: ReadonlyMap<string, ThreadFacts>) => (threadId: string): string => {
    const rec = store.get(threadId);
    const thread = all.get(threadId);
    if (rec?.kind === "conversation") return conversationTitle(rec, thread);
    return rec?.title?.trim() || thread?.title?.trim() || thread?.titleFallback?.trim() || "a thread";
  };
  /**
   * Conversations with no latest line yet get one, a few per read: the
   * newest reply that says something (Main's turns are mostly a quiet
   * "[PASS]", so BB's last output alone left Main's second line empty), else
   * BB's output. A row filled with nothing ("") is looked at again once per
   * run, for a reply that came before Studio read its events.
   */
  const fillLatest = async (botId: string) => {
    const missing = [...store.missingLatest(botId, LATEST_FILL), ...store.emptyLatest(botId, LATEST_FILL).filter((threadId) => !rechecked.has(threadId))].slice(0, LATEST_FILL);
    await Promise.all(missing.map(async (threadId) => {
      rechecked.add(threadId);
      const events = await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "60", types: ["item/completed"] } as never).catch(() => []) as { data?: { item?: { type?: string; text?: string } } }[];
      const reply = events.map((event) => event.data?.item).find((item) => item?.type === "agentMessage" && !!latestLine(item.text))?.text ?? null;
      if (reply) { store.fillLatest(threadId, reply, true); return; }
      const output = await bb.sdk.threads.output({ threadId }).catch(() => null) as { output?: string | null } | null;
      store.fillLatest(threadId, output?.output ?? null);
    }));
  };
  const rechecked = new Set<string>();

  /** One Bot's rows with BB's view of them, for the sidebar and its "N older" lists. */
  const botRows = async (id: string) => {
    await Promise.all([fillLatest(id).catch(() => {}), fillActivity(ACTIVITY_PER_VIEW).catch(() => 0)]);
    const records = store.all(id);
    const listed = records.filter((rec) => rec.archivedAt === null);
    const raisedBy = listed.flatMap((rec) => rec.needsYou?.source && store.get(rec.needsYou.source)?.kind === "worker" ? [rec.needsYou.source] : []);
    const links = [...listed.flatMap((rec) => [rec.forkedFrom?.threadId, rec.ownerConversationId].filter((each): each is string => !!each)), ...raisedBy];
    const threads = await facts([...listed.map((rec) => rec.threadId), ...links]);
    const readAt = factsCache?.at ?? Date.now();
    const others = links.filter((link) => !records.some((rec) => rec.threadId === link)).flatMap((link) => store.get(link) ?? []);
    const all = [...records, ...others];
    // A worker's approval or question answered anywhere: the conversation it marked is clear.
    const stale = staleRaises(all, threads, readAt);
    for (const source of stale) store.clearNeedsYouFrom(source);
    return { records: stale.length ? [...store.all(id), ...others] : all, threads };
  };
  /** Reads the latest real activity of rows that have none yet, from their events, a few at a time. */
  const fillActivity = async (limit: number) => {
    const rows = store.missingActivity(limit);
    for (let at = 0; at < rows.length; at += ACTIVITY_PARALLEL) {
      await Promise.all(rows.slice(at, at + ACTIVITY_PARALLEL).map(async (rec) => {
        const when = await store.lastActivity(rec.threadId, rec.createdAt);
        if (when !== null) store.fillActivity(rec.threadId, when);
      }));
    }
    return rows.length;
  };
  const view = async (botId: string | undefined) => {
    const id = botOrCurrent(botId);
    if (!id) return { botId: null, conversations: [], workers: [], hiddenWorkers: 0, hiddenToday: 0, olderConversations: 0 };
    const { records, threads } = await botRows(id);
    return threadsView(id, records, threads, Date.now());
  };
  /** What the sidebar leaves out, and the finished conversations, newest first. */
  const older = async (botId: string | undefined) => {
    const id = botOrCurrent(botId);
    if (!id) return { botId: null, conversations: [], workers: [], finished: [] };
    const { records, threads } = await botRows(id);
    const rest = olderView(id, records, threads, Date.now());
    const finished = records.filter((rec) => rec.botId === id && rec.kind === "conversation" && rec.archivedAt !== null && rec.finishedSummary !== null)
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)).slice(0, 200)
      .map((rec) => ({ threadId: rec.threadId, title: rec.title?.trim() || "Untitled conversation", finishedAt: rec.archivedAt!, summary: rec.finishedSummary! }));
    return { ...rest, finished };
  };

  const spaces = async (): Promise<{ bots: BotSpace[]; currentBotId: string | null }> => {
    const listed = store.listed();
    const records = listed.filter((rec) => rec.kind === "conversation");
    const threads = await facts(listed.map((rec) => rec.threadId));
    return {
      currentBotId: botOrCurrent(undefined),
      bots: deps.bots().map((bot, index) => ({
        id: bot.id, name: bot.name, avatar: bot.avatar, shape: bot.shape ?? null, color: bot.color ?? null,
        primary: bot.primary ?? index === 0, mainThreadId: bot.threadId, needsYou: botNeedsYou(bot.id, records, threads), appearance: bot.appearance ?? null,
        ...(bot.presence ? { presence: bot.presence } : {}), activity: botActivity(bot.id, listed, threads),
      })),
    };
  };

  const placed = async (threadId: string): Promise<BotThreadRecord | null> => {
    const known = store.get(threadId);
    if (known) return known;
    // A thread Studio hasn't seen (made before it ran, or brought back): place it now.
    const thread = await bb.sdk.threads.get({ threadId }).catch(() => null) as ThreadFacts | null;
    return thread && !thread.archivedAt ? await store.classify(thread, "created") : null;
  };
  const owner = async (threadId: string): Promise<string | null> => (await placed(threadId))?.botId ?? null;
  const info = async (threadId: string): Promise<BotThreadInfo | null> => {
    const rec = await placed(threadId);
    if (!rec) return null;
    const bot = deps.bots().find((each) => each.id === rec!.botId);
    const workers = rec.kind === "conversation" ? store.workersOf(rec.threadId) : [];
    const ids = [rec.threadId, rec.forkedFrom?.threadId, rec.ownerConversationId, ...workers.map((each) => each.threadId)].filter((each): each is string => !!each);
    const threads = await facts(ids);
    const title = titleFrom(threads);
    const thread = threads.get(rec.threadId);
    const tag = repoTag(thread);
    const status = rec.kind === "worker" ? workerStatus(thread) : null;
    // A mirrored worker waits in bb: its pending interactions are bb's (src/mirror-live.ts).
    const waiting = status !== "needs-you" ? null
      : thread?.mirroredPending ? waitingOn(thread.mirroredPending as Interaction[])
      : waitingOn(await bb.sdk.threads.interactions.list({ threadId: rec.threadId }).catch(() => []) as Interaction[]);
    return {
      threadId: rec.threadId, botId: rec.botId, botName: bot?.name ?? "Bot", kind: rec.kind, isMain: rec.isMain, title: title(rec.threadId),
      forkedFrom: rec.forkedFrom ? { ...rec.forkedFrom, title: title(rec.forkedFrom.threadId) } : null,
      owner: rec.kind === "worker" && rec.ownerConversationId ? { threadId: rec.ownerConversationId, title: title(rec.ownerConversationId) } : null,
      status, waitingOn: waiting, startedAt: thread?.createdAt ?? rec.createdAt, tag: tag?.tag ?? null, branch: tag?.branch ?? null,
      archivedAt: rec.archivedAt, finishedSummary: rec.finishedSummary, finishing: isFinishing(db, rec.threadId), needsYou: rec.kind === "conversation" ? needsYouOf(rec, thread) : null,
      projectId: thread?.projectId ?? null,
      workers: conversationWorkers(workers, threads, Date.now()).slice(0, 12).map((worker) => ({ threadId: worker.threadId, title: title(worker.threadId), status: worker.status })),
    };
  };

  /** Sends Patrick's question about a worker to the Bot in the worker's conversation. */
  const askAboutWorker = async (threadId: string, text: string) => {
    const rec = store.get(threadId);
    if (!rec || rec.kind !== "worker") throw new Error("That thread isn't a worker.");
    const main = deps.bots().find((bot) => bot.id === rec.botId)?.threadId ?? null;
    const conversationId = rec.ownerConversationId && store.get(rec.ownerConversationId) ? rec.ownerConversationId : main;
    if (!conversationId) throw new Error("This worker's Bot has no conversation to ask in.");
    const threads = await facts([threadId, conversationId]);
    const worker = threads.get(threadId);
    const name = (rec.title?.trim() || worker?.title?.trim() || worker?.titleFallback?.trim() || "this worker").replace(/[[\]]/g, "");
    const link = worker?.projectId ? `/projects/${worker.projectId}/threads/${threadId}` : `/threads/${threadId}`;
    await bb.sdk.threads.send({ threadId: conversationId, mode: "auto", input: [{ type: "text", text: `About the worker [${name}](${link}): ${text.trim()}`, mentions: [] }] } as never);
    threadChanged(conversationId);
    return { conversationId, projectId: threads.get(conversationId)?.projectId ?? null };
  };

  /**
   * The approvals waiting in a conversation's workers, for its live cards
   * (src/ui/conversations/ConversationApprovals.tsx). A worker's approval
   * belongs where server.ts raises it: its conversation, else Main. Only
   * workers active in the last week are asked (a pending interaction marks
   * the worker active when it arrives), and only those BB says wait.
   */
  const pushIds = (threadId: string): { botId?: string; conversationId?: string; workerId?: string } => {
    const rec = store.get(threadId);
    if (!rec) return {};
    if (rec.kind === "conversation") return { botId: rec.botId, conversationId: rec.threadId };
    const owner = rec.ownerConversationId ? store.get(rec.ownerConversationId) : null;
    const conversationId = owner && owner.archivedAt === null ? owner.threadId : deps.bots().find((bot) => bot.id === rec.botId)?.threadId ?? null;
    return conversationId ? { botId: rec.botId, conversationId, workerId: rec.threadId } : { botId: rec.botId };
  };
  const approvalPush = async (thread: { id: string; projectId?: string | null }, interaction: Interaction): Promise<WorkerApprovalPush | null> => {
    if (!interaction.id || (interaction.status !== undefined && interaction.status !== "pending") || !isWorkerApproval(interaction)) return null;
    const { botId, conversationId, workerId } = pushIds(thread.id);
    if (!botId || !conversationId || !workerId) return null;
    const threads = await facts([conversationId, workerId]);
    const title = titleFrom(threads);
    return workerApprovalPush({
      botId, botName: deps.bots().find((bot) => bot.id === botId)?.name ?? "Bot",
      conversationId, conversationTitle: title(conversationId),
      workerId, workerTitle: title(workerId),
      projectId: threads.get(workerId)?.projectId ?? thread.projectId ?? PERSONAL_PROJECT_ID,
      interaction,
    });
  };
  const conversationApprovals = async (threadId: string) => {
    const rec = store.get(threadId);
    if (!rec || rec.kind !== "conversation" || rec.archivedAt !== null) return { approvals: [] };
    const main = deps.bots().find((bot) => bot.id === rec.botId)?.threadId ?? null;
    const now = Date.now();
    const target = (worker: BotThreadRecord) => {
      const owner = worker.ownerConversationId ? store.get(worker.ownerConversationId) : null;
      return owner && owner.archivedAt === null ? owner.threadId : main;
    };
    const candidates = store.all(rec.botId).filter((each) => each.kind === "worker" && each.archivedAt === null && target(each) === threadId && now - (each.activityAt ?? each.createdAt) < APPROVAL_WINDOW_MS);
    if (!candidates.length) return { approvals: [] };
    const threads = await facts(candidates.map((each) => each.threadId));
    const waiting = candidates.filter((each) => threads.get(each.threadId)?.hasPendingInteraction === true);
    const title = titleFrom(threads);
    const found = await Promise.all(waiting.map(async (worker) => {
      const list = await bb.sdk.threads.interactions.list({ threadId: worker.threadId }).catch(() => []) as (Interaction & { createdAt?: number })[];
      return list.filter((each) => each.status === "pending" && isWorkerApproval(each)).map((each) => ({
        at: each.createdAt ?? 0,
        worker: { threadId: worker.threadId, title: title(worker.threadId), projectId: threads.get(worker.threadId)?.projectId ?? null },
        approval: viewOf(each),
      }));
    }));
    return { approvals: found.flat().sort((a, b) => a.at - b.at).map(({ worker, approval }) => ({ worker, approval })) };
  };

  const sides = deps.sideThreads ?? new SideThreads({ db, sdk: bb.sdk, changed: () => {}, botFor: (threadId) => { const rec = store.get(threadId); return rec?.isMain ? { id: rec.botId, name: "" } : null; } });
  const messageThreads = new MessageThreads({
    sdk: bb.sdk, sides,
    source: async (threadId) => store.get(threadId) ?? await info(threadId).then(() => store.get(threadId)),
    title: async (threadId) => {
      const rec = store.get(threadId);
      const thread = rec?.isMain ? null : await bb.sdk.threads.get({ threadId }).catch(() => null) as ThreadFacts | null;
      return rec ? conversationTitle(rec, thread) : thread?.title?.trim() || "Conversation";
    },
    recordFork: (threadId, botId, from) => { store.recordFork(threadId, botId, from); },
    defaultModel: (botId) => deps.defaultModel(botId),
    changed: (threadId) => threadChanged(threadId),
    log: deps.log,
    ...(deps.seeds ? { seeds: deps.seeds } : {}),
  });
  const forkConversation = async (input: MessageRef) => {
    const { threadId, projectId } = await messageThreads.fork(input);
    return { threadId, projectId };
  };

  /**
   * A Bot's + New: BB's new-thread request (its composer, seeded with the
   * Bot's default model; Patrick's picks win), spawned and recorded as that
   * Bot's conversation. The Bot is focused first, so BB's thread.created
   * places it there too.
   */
  const startConversation = async ({ botId, request }: { botId: string; request: NewConversationRequest }) => {
    if (!deps.bots().some((bot) => bot.id === botId)) throw new Error(`No Bot "${botId}".`);
    store.setFocus(botId);
    const thread = await bb.sdk.threads.spawn({ ...request, pluginMetadata: { botConversation: botId } } as never) as { id: string; projectId?: string | null };
    store.recordConversation(thread.id, botId);
    threadChanged(thread.id);
    return { threadId: thread.id, projectId: thread.projectId ?? null };
  };

  const ask = async ({ text, to }: { text: string; to: { kind: "thread"; threadId: string } | { kind: "new"; botId: string | null } }) => {
    if (to.kind === "thread") {
      if (store.get(to.threadId)?.kind === "worker") {
        const asked = await askAboutWorker(to.threadId, text);
        return { threadId: asked.conversationId, projectId: asked.projectId };
      }
      await bb.sdk.threads.send({ threadId: to.threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] } as never);
      threadChanged(to.threadId);
      return { threadId: to.threadId, projectId: (await facts([to.threadId])).get(to.threadId)?.projectId ?? null };
    }
    const id = botOrCurrent(to.botId ?? undefined);
    const bot = deps.bots().find((each) => each.id === id);
    if (!bot) throw new Error(to.botId ? `No Bot "${to.botId}".` : "Make your Bot first.");
    const projectId = bot.threadId ? (await facts([bot.threadId])).get(bot.threadId)?.projectId ?? null : null;
    if (!projectId) throw new Error(`${bot.name} has no chat to start from.`);
    const preset = deps.defaultModel(bot.id);
    const model = preset ? {
      providerId: preset.providerId, model: preset.model, ...(preset.reasoning ? { reasoningLevel: preset.reasoning } : {}),
      executionInputSources: { providerId: "explicit", model: "explicit", ...(preset.reasoning ? { reasoningLevel: "explicit" } : {}) },
    } : {};
    store.setFocus(bot.id);
    const thread = await bb.sdk.threads.spawn({
      projectId, environment: { type: "project-default" }, input: [{ type: "text", text, mentions: [] }], pluginMetadata: { botConversation: bot.id }, ...model,
    } as never) as { id: string; projectId?: string | null };
    store.recordConversation(thread.id, bot.id);
    threadChanged(thread.id);
    return { threadId: thread.id, projectId: thread.projectId ?? projectId };
  };

  const library = async (botId: string | undefined) => {
    const id = botOrCurrent(botId);
    if (!id) return { botId: null, items: [] };
    const origins = deps.originThreads();
    const creators = deps.creatorThreads?.() ?? new Map<string, string>();
    const items = deps.items();
    const threadIds = [...new Set(items.flatMap((item) => { const key = `${item.pluginId}:${item.id}`; return [origins.get(key), creators.get(key)].filter((each): each is string => !!each); }))];
    const records = new Map(threadIds.flatMap((threadId) => { const rec = store.get(threadId); return rec ? [[threadId, rec] as const] : []; }));
    const owners = [...records.values()].flatMap((rec) => rec.ownerConversationId ? [rec.ownerConversationId] : []);
    const threads = await facts([...threadIds, ...owners]);
    return { botId: id, items: libraryItems({ botId: id, primaryId: deps.bots()[0]?.id ?? null, items, origins, creators, starred: deps.starred?.() ?? new Set(), botItems: deps.botItems?.() ?? new Map(), formats: deps.fileFormats?.() ?? new Map(), record: (threadId) => records.get(threadId) ?? store.get(threadId), title: titleFrom(threads) }) };
  };

  const rpc = {
    bot_spaces: () => spaces(),
    bot_threads_view: ({ botId }: { botId?: string }) => view(botId),
    bot_threads_older: ({ botId }: { botId?: string }) => older(botId),
    bot_thread_info: async ({ threadId }: { threadId: string }) => ({ info: await info(threadId) }),
    bot_landing: async ({ botId, last }: { botId: string; last: string | null }) => {
      const main = deps.bots().find((bot) => bot.id === botId)?.threadId ?? null;
      for (const candidate of [...new Set([last, main])]) {
        if (!candidate) continue;
        const thread = await bb.sdk.threads.get({ threadId: candidate }).catch(() => null) as { deletedAt?: number | null } | null;
        if (thread && !thread.deletedAt) return { threadId: candidate };
      }
      return { threadId: null };
    },
    bot_focus: ({ botId }: { botId: string }) => {
      if (!deps.bots().some((bot) => bot.id === botId)) throw new Error(`No Bot "${botId}".`);
      store.setFocus(botId);
      return { ok: true };
    },
    bot_worker_ask: ({ threadId, text }: { threadId: string; text: string }) => askAboutWorker(threadId, text),
    bot_conversation_approvals: ({ threadId }: { threadId: string }) => conversationApprovals(threadId),
    bot_push_ids: ({ threadId }: { threadId: string }) => pushIds(threadId),
    bot_thread_update: ({ threadId, title, archived }: { threadId: string; title?: string | null; archived?: boolean }) => {
      store.update(threadId, { ...(title !== undefined ? { title } : {}), ...(archived !== undefined ? { archived } : {}) });
      return { ok: true };
    },
    bot_needs_you_set: ({ threadId, reason }: { threadId: string; reason: string | null }) => ({ ok: store.setNeedsYou(threadId, reason, reason ? "user" : null) }),
    bot_library: ({ botId }: { botId?: string }) => library(botId),
    bot_fork_conversation: (input: { threadId: string; messageId: string; turnId: string | null; sourceSeqEnd: number }) => forkConversation(input),
    bot_thread_reply: (input: { threadId: string; messageId: string; turnId?: string | null; sourceSeqEnd?: number | null }) => messageThreads.reply(input),
    bot_conversation_start: (input: { botId: string; request: NewConversationRequest }) => startConversation(input),
    bot_ask: (input: { text: string; to: { kind: "thread"; threadId: string } | { kind: "new"; botId: string | null } }) => ask(input),
  };

  // The tools: a Bot's own view of its conversations and workers, and its way to raise something with Patrick.
  const describe = async (botId: string) => {
    const shown = await view(botId);
    const lines = [
      "Conversations (you and the user; Main gets reports and alerts):",
      ...shown.conversations.map((each) => `- ${each.title} (/threads/${each.threadId})${each.isMain ? " [Main]" : ""}${each.forkedFrom ? `, forked from ${each.forkedFrom.title}` : ""}${each.running ? ", working" : ""}${each.needsYou ? `, needs the user: ${each.needsYou.reason}` : ""}${each.latest ? `. Latest: ${each.latest}` : ""}`),
      "Workers (agents you started; each reports to the conversation that started it):",
      ...(shown.workers.length ? shown.workers.map((each) => `- ${each.title} (/threads/${each.threadId}): ${each.status}${each.ownerTitle ? `, from ${each.ownerTitle}` : ""}${each.tag ? `, in ${each.tag}${each.branch ? ` (${each.branch})` : ""}` : ""}`) : ["- none"]),
      ...(shown.olderConversations ? [`(${shown.olderConversations} older conversations not listed: not active in 14 days)`] : []),
      ...(shown.hiddenWorkers ? [`(${shown.hiddenWorkers} older finished or failed workers not listed)`] : []),
    ];
    return lines.join("\n");
  };
  const conversationsTool = (name: string, description: string) => bb.agents.registerTool({
    name, description, parameters: z.object({}),
    execute: async (_input, ctx) => {
      const botId = (ctx.threadId ? store.get(ctx.threadId)?.botId : null) ?? await deps.actingBot(ctx.threadId) ?? deps.bots()[0]?.id;
      return botId ? describe(botId) : "The user has no Bot yet.";
    },
  });
  conversationsTool("bot_conversations", "List your conversations with the user (Main first, then the others: their titles, thread links, which one each was forked from, whether it's working, and why it needs the user) and your workers (the agents you started, with their status, the conversation that started each, and the repo it runs in). Use it to see what else is going on before you start something, or when the user asks about another conversation; read one with the normal thread tools.");
  conversationsTool("bot_threads_list", "Alias of bot_conversations. Reply-in-thread side threads are conversations now: forks of a message, listed with what they were forked from.");
  bb.agents.registerTool({
    name: "bot_needs_you",
    description: "Mark this conversation as needing the user, with a short reason they see in the sidebar (\"Pick a date for the trip\"), when only they can answer something: a worker's question you can't settle, a decision, an approval. It clears when the user replies here. Pass reason null to clear it yourself. Don't use it for things you can handle.",
    parameters: z.object({ reason: z.string().trim().max(200).nullable().describe("One short line; null clears") }),
    execute: async ({ reason }, ctx) => {
      const rec = ctx.threadId ? store.get(ctx.threadId) : null;
      if (!rec) return "This thread isn't one of your conversations.";
      const target = rec.kind === "conversation" ? rec.threadId : rec.ownerConversationId;
      if (!target) return "This worker has no conversation to raise it in; tell the Bot through your result instead.";
      if (rec.kind === "worker") return "A worker doesn't talk to the user. End your turn with the question; your Bot raises it in its conversation.";
      store.setNeedsYou(target, reason, reason ? "bot" : null);
      return reason ? "Marked: the user sees this conversation highlighted with your reason until they reply." : "Cleared.";
    },
  });

  const reconcile = () => { try { store.reconcile(); } catch (error) { deps.log(`Reconciling conversations and workers failed: ${error instanceof Error ? error.message : String(error)}`); } };
  /** The first fill, then the authoritative facts; safe to call again. */
  const start = async () => {
    try {
      const counts = await store.backfill();
      if (counts.conversations || counts.workers) deps.log(`Conversations and workers: adopted ${counts.conversations} conversation(s) (${counts.archived} archived past the newest ${50}) and ${counts.workers} worker(s).`);
    } catch (error) {
      deps.log(`Filling conversations and workers failed; retrying next start: ${error instanceof Error ? error.message : String(error)}`);
    }
    reconcile();
    // Every row's latest real activity, once (new rows get theirs from events and the next reads).
    try { await fillActivity(ACTIVITY_FILL); } catch (error) { deps.log(`Reading conversations' activity failed: ${error instanceof Error ? error.message : String(error)}`); }
    await reclassifyForks();
    await catchUp();
    if (deps.forkPoint) for (const rec of store.forksWithoutTurn(FORK_POINTS)) await lookUpForkPoint(rec.threadId);
  };
  /** Once: forks agents made, recorded as conversations before the fork rule knew them, become workers. */
  const reclassifyForks = async () => {
    if (store.marked(RECLASSIFY_FORKS) || store.backfilledAt() === null) return;
    try {
      const forks = store.forkConversations();
      const moved = forks.length ? await store.reclassifyForks(await store.facts(forks.map((rec) => rec.threadId))) : 0;
      store.mark(RECLASSIFY_FORKS);
      if (moved) deps.log(`Conversations and workers: ${moved} fork(s) made by agents are workers now.`);
    } catch (error) {
      deps.log(`Reclassifying forks failed; retrying next start: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const classifyMirrored = async (threadIds: readonly string[]) => {
    const read = await store.facts(threadIds);
    const settled = threadIds.filter((id) => !read.has(id));
    let classified = 0;
    for (const each of [...read.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
      if (store.get(each.id) || each.archivedAt) { settled.push(each.id); continue; }
      const thread = forkUndecided(each) ? await store.forkFacts(each) : each;
      if (await store.classify(thread, "reconciled")) { classified++; settled.push(each.id); }
    }
    return { classified, settled };
  };
  const mirrorCatchUp = deps.mirrored ? new MirrorCatchUp({ mirrored: deps.mirrored, known, classify: classifyMirrored }) : null;
  const catchUp = async (): Promise<{ classified: number; linked: number }> => {
    let classified = 0;
    try { classified = (await mirrorCatchUp?.run()) ?? 0; } catch (error) { deps.log(`Sorting mirrored threads failed: ${error instanceof Error ? error.message : String(error)}`); }
    const linked = sides.linkForks();
    for (const threadId of linked) void sides.recount(threadId).catch(() => undefined);
    try { await sides.correctKinds(); } catch (error) { deps.log(`Correcting reply and fork kinds failed: ${error instanceof Error ? error.message : String(error)}`); }
    if (classified) deps.log(`Conversations and workers: sorted ${classified} mirrored thread(s).`);
    return { classified, linked: linked.length };
  };

  return { store, rpc, start, reconcile, threadChanged, catchUp, messageThreads, owner, pushIds, approvalPush, tools: ["bot_conversations", "bot_threads_list", "bot_needs_you"] as const };
}
