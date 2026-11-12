import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";

type Sdk = BbPluginApi["sdk"];

export const SIDE_CHAT_PLUGIN = "side-chat";
export const SIDE_CHAT_SEED_PREFIX = "Replying to this earlier message in the conversation:\n\n";
export const BOT_THREAD_DIRECTIVE = "bot-thread";

const MAX_PAGES = 500;
const TRANSCRIPT_PAGES = 40;
const PAGE_SEGMENTS = "100";

export type ReplyRole = "user" | "assistant";
export type SideKind = "reply" | "fork";

const WORKING = new Set(["active", "starting"]);

interface SideRow {
  thread_id: string; bot_id: string; source_thread_id: string; message_id: string;
  replies: number; last_reply_at: number | null; last_reply_role: ReplyRole | null; created_at: number; kind: SideKind;
}

export interface SideThreadView {
  messageId: string;
  threadId: string;
  botId: string;
  replies: number;
  lastReplyAt: number | null;
  lastReplyRole: ReplyRole | null;
  working: boolean;
  kind: SideKind;
  conversations: number;
}

export interface BotSideThreadView {
  threadId: string;
  sourceThreadId: string;
  messageId: string;
  title: string;
  replies: number;
  working: boolean;
  updatedAt: number;
  menu: { projectId: string; parentThreadId: string | null; pinnedAt: number | null; sectionId: string | null; status: string; isUnread: boolean; parentNotifications: "auto" | "off" | "stuck" };
}

export interface TimelineRow {
  id: string; kind?: string; role?: string; text?: string; sourceSeqEnd?: number; turnId?: string | null;
  initiator?: string; createdAt?: number;
}
interface TimelinePage { rows?: TimelineRow[]; timelinePage?: { olderCursor?: { anchorSeq: number; anchorId: string } | null } }
type ThreadLike = {
  id: string; originPluginId?: string | null; originKind?: string | null; sourceThreadId?: string | null; archivedAt?: number | null; status?: string; title?: string | null; titleFallback?: string | null;
  projectId?: string; parentThreadId?: string | null; pinnedAt?: number | null; sectionId?: string | null; lastReadAt?: number | null; updatedAt?: number;
  parentNotifications?: "auto" | "off" | "stuck"; createdAt?: number;
};

export interface SideThreadDeps {
  db: Database.Database;
  sdk: Sdk;
  botFor(threadId: string): { id: string; name: string } | null;
  changed(): void;
  waits?: readonly number[];
}

export interface ReplyCount { replies: number; lastReplyAt: number | null; lastReplyRole: ReplyRole | null }

export function isReply(row: TimelineRow): boolean {
  if (row.kind !== undefined && row.kind !== "conversation") return false;
  if (!row.text?.trim()) return false;
  if (row.role === "assistant") return true;
  return row.role === "user" && (row.initiator === undefined || row.initiator === "user") && !row.text.trimStart().startsWith(SIDE_CHAT_SEED_PREFIX.trim());
}

export function afterFork(row: TimelineRow, since: number | null): boolean {
  return since === null || row.createdAt === undefined || row.createdAt >= since;
}

export function countReplies(pages: readonly (readonly TimelineRow[])[], since: number | null = null): ReplyCount {
  const turns = new Set<string>();
  let replies = 0;
  let newest: TimelineRow | null = null;
  for (const rows of pages) {
    for (const row of [...rows].reverse()) {
      if (!isReply(row) || !afterFork(row, since)) continue;
      newest ??= row;
      if (row.role === "assistant") {
        const turn = row.turnId ?? row.id;
        if (turns.has(turn)) continue;
        turns.add(turn);
      }
      replies++;
    }
  }
  return { replies, lastReplyAt: newest?.createdAt ?? null, lastReplyRole: newest ? newest.role as ReplyRole : null };
}

export class SideThreads {
  private readonly adopting = new Map<string, Promise<boolean>>();
  private readonly counting = new Map<string, Promise<void>>();

  constructor(private readonly deps: SideThreadDeps) {}

  forThread(threadId: string): { botId: string; sourceThreadId: string; messageId: string } | null {
    const row = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE thread_id = ?").get(threadId) as SideRow | undefined;
    return row ? { botId: row.bot_id, sourceThreadId: row.source_thread_id, messageId: row.message_id } : null;
  }

  async list(sourceThreadId: string): Promise<SideThreadView[]> {
    if (this.isChat(sourceThreadId)) await this.discover(sourceThreadId).catch(() => undefined);
    const rows = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE source_thread_id = ? ORDER BY created_at, rowid").all(sourceThreadId) as SideRow[];
    const live = (await this.live(rows)).filter(({ row, thread }) => row.replies > 0 || WORKING.has(thread.status ?? ""));
    const byMessage = new Map<string, SideThreadView>();
    for (const { row, thread } of live) {
      const kind = row.kind ?? "reply";
      const key = `${row.message_id}\n${kind}`;
      const seen = byMessage.get(key);
      const newer = !seen || (row.last_reply_at ?? row.created_at) >= (seen.lastReplyAt ?? 0);
      byMessage.set(key, {
        messageId: row.message_id, threadId: newer ? row.thread_id : seen!.threadId, botId: row.bot_id,
        replies: (seen?.replies ?? 0) + row.replies,
        lastReplyAt: Math.max(seen?.lastReplyAt ?? 0, row.last_reply_at ?? 0) || null,
        lastReplyRole: newer ? row.last_reply_role ?? seen?.lastReplyRole ?? null : seen!.lastReplyRole,
        working: (seen?.working ?? false) || WORKING.has(thread.status ?? ""),
        kind, conversations: (seen?.conversations ?? 0) + 1,
      });
    }
    return [...byMessage.values()].sort((a, b) => Number(a.kind === "fork") - Number(b.kind === "fork"));
  }

  threadIds(): string[] {
    return (this.deps.db.prepare("SELECT thread_id FROM bot_side_threads").all() as { thread_id: string }[]).map((row) => row.thread_id);
  }

  parents(): { threadId: string; parentThreadId: string }[] {
    return (this.deps.db.prepare("SELECT thread_id, source_thread_id FROM bot_side_threads ORDER BY created_at, rowid").all() as { thread_id: string; source_thread_id: string }[])
      .map((row) => ({ threadId: row.thread_id, parentThreadId: row.source_thread_id }));
  }

  async forBot(botId: string): Promise<BotSideThreadView[]> {
    const rows = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE bot_id = ? ORDER BY created_at DESC, rowid DESC").all(botId) as SideRow[];
    return (await this.live(rows)).map(({ row, thread }) => ({
      threadId: row.thread_id, sourceThreadId: row.source_thread_id, messageId: row.message_id,
      title: thread.title?.trim() || thread.titleFallback?.trim() || "Thread",
      replies: row.replies, working: thread.status === "active", updatedAt: row.last_reply_at ?? row.created_at,
      menu: {
        projectId: thread.projectId ?? "", parentThreadId: thread.parentThreadId ?? null, pinnedAt: thread.pinnedAt ?? null, sectionId: thread.sectionId ?? null,
        status: thread.status ?? "idle", isUnread: !!thread.updatedAt && (thread.lastReadAt ?? 0) < thread.updatedAt,
        parentNotifications: thread.parentNotifications ?? "auto",
      },
    })).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async newest(sourceThreadId: string, messageId: string): Promise<string | null> {
    const rows = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE source_thread_id = ? AND message_id = ? AND kind = 'reply' ORDER BY created_at DESC, rowid DESC").all(sourceThreadId, messageId) as SideRow[];
    return (await this.live(rows))[0]?.row.thread_id ?? null;
  }

  async message(threadId: string, messageId: string): Promise<TimelineRow | null> {
    return await this.findRow(threadId, (row) => row.id === messageId);
  }

  async transcript(threadId: string, upToSeq: number): Promise<TimelineRow[]> {
    const pages: TimelineRow[][] = [];
    let cursor: { anchorSeq: number; anchorId: string } | null | undefined;
    for (let page = 0; page < TRANSCRIPT_PAGES; page++) {
      const result = await this.page(threadId, cursor);
      pages.unshift(result.rows ?? []);
      cursor = result.timelinePage?.olderCursor;
      if (!cursor) break;
    }
    return pages.flat().filter((row) => (row.kind === undefined || row.kind === "conversation") && (row.role === "user" || row.role === "assistant")
      && !!row.text?.trim() && (row.sourceSeqEnd === undefined || row.sourceSeqEnd <= upToSeq));
  }

  isChat(threadId: string): boolean {
    return this.deps.botFor(threadId) !== null;
  }

  record(threadId: string, botId: string, sourceThreadId: string, messageId: string, createdAt = Date.now(), kind: SideKind = "reply"): boolean {
    const result = this.deps.db.prepare("INSERT OR IGNORE INTO bot_side_threads (thread_id, bot_id, source_thread_id, message_id, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)")
      .run(threadId, botId, sourceThreadId, messageId, createdAt, kind);
    if (result.changes) this.deps.changed();
    return result.changes > 0;
  }

  linkForks(): string[] {
    const linked = (this.deps.db.prepare(`INSERT OR IGNORE INTO bot_side_threads (thread_id, bot_id, source_thread_id, message_id, created_at)
        SELECT thread_id, bot_id, forked_from_thread_id, forked_from_message_id, created_at FROM bot_threads
        WHERE kind = 'conversation' AND forked_from_thread_id IS NOT NULL AND forked_from_message_id IS NOT NULL
          AND thread_id NOT IN (SELECT thread_id FROM bot_side_threads)
      RETURNING thread_id`).all() as { thread_id: string }[]).map((row) => row.thread_id);
    if (linked.length) this.deps.changed();
    return linked;
  }

  async created(thread: ThreadLike): Promise<void> {
    if (this.isBotSideChat(thread) && !this.forThread(thread.id)) await this.adopt(thread);
  }

  recount(threadId: string): Promise<void> {
    if (!this.forThread(threadId)) return Promise.resolve();
    const running = this.counting.get(threadId);
    if (running) return running.then(() => this.recount(threadId));
    const counted = this.count(threadId).finally(() => this.counting.delete(threadId));
    this.counting.set(threadId, counted);
    return counted;
  }

  async recountAll(): Promise<void> {
    for (const threadId of this.threadIds()) await this.recount(threadId);
  }

  touched(threadId: string): void {
    if (this.forThread(threadId)) this.deps.changed();
  }

  forget(threadId: string): void {
    const result = this.deps.db.prepare("DELETE FROM bot_side_threads WHERE thread_id = ?").run(threadId);
    if (result.changes) this.deps.changed();
  }

  private async count(threadId: string): Promise<void> {
    const row = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE thread_id = ?").get(threadId) as SideRow | undefined;
    if (!row) return;
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadLike | null;
    if (!thread) return;
    const since = thread?.createdAt ?? null;
    const pages: TimelineRow[][] = [];
    let cursor: { anchorSeq: number; anchorId: string } | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.page(threadId, cursor);
      const rows = result.rows ?? [];
      pages.push(rows);
      cursor = result.timelinePage?.olderCursor;
      if (!cursor || rows.some((each) => !afterFork(each, since))) break;
    }
    const counted = countReplies(pages, since);
    if (counted.replies === row.replies && counted.lastReplyRole === row.last_reply_role && (counted.lastReplyAt ?? row.last_reply_at) === row.last_reply_at) return;
    this.deps.db.prepare("UPDATE bot_side_threads SET replies = ?, last_reply_at = ?, last_reply_role = ? WHERE thread_id = ?")
      .run(counted.replies, counted.lastReplyAt ?? (counted.replies ? Date.now() : null), counted.lastReplyRole, threadId);
    this.deps.changed();
  }

  private isBotSideChat(thread: ThreadLike): boolean {
    return thread.originPluginId === SIDE_CHAT_PLUGIN && !!thread.sourceThreadId && this.isChat(thread.sourceThreadId);
  }

  private async live(rows: SideRow[]): Promise<{ row: SideRow; thread: ThreadLike }[]> {
    const found = await Promise.all(rows.map(async (row) => {
      const thread = await this.deps.sdk.threads.get({ threadId: row.thread_id }).catch((error: { status?: number }) => error?.status === 404 ? "gone" as const : null) as ThreadLike | "gone" | null;
      if (thread === "gone") { this.forget(row.thread_id); return null; }
      return thread && !thread.archivedAt ? { row, thread } : null;
    }));
    return found.filter((each): each is { row: SideRow; thread: ThreadLike } => each !== null);
  }

  private async discover(sourceThreadId: string): Promise<void> {
    const known = new Set(this.threadIds());
    const forks = await this.deps.sdk.threads.list({ includeHidden: true, sourceThreadId, originPluginId: SIDE_CHAT_PLUGIN, archived: false, limit: 100 } as never) as ThreadLike[];
    await Promise.all(forks.filter((fork) => !known.has(fork.id)).map((fork) => this.adopt(fork)));
  }

  private adopt(thread: ThreadLike): Promise<boolean> {
    const running = this.adopting.get(thread.id);
    if (running) return running;
    const adopted = (async () => {
      const bot = thread.sourceThreadId ? this.deps.botFor(thread.sourceThreadId) : null;
      if (!bot || !thread.sourceThreadId) return false;
      const quote = await this.quoteOf(thread.id);
      if (!quote) return false;
      const message = await this.findByText(thread.sourceThreadId, quote);
      if (!message || this.forThread(thread.id)) return false;
      this.record(thread.id, bot.id, thread.sourceThreadId, message.id);
      await this.deps.sdk.threads.update({ threadId: thread.id, title: `${bot.name} · ${snippet(message.text)}` } as never).catch(() => undefined);
      return true;
    })().finally(() => this.adopting.delete(thread.id));
    this.adopting.set(thread.id, adopted);
    return adopted;
  }

  private async quoteOf(threadId: string, wait = true): Promise<string | null> {
    for (const delay of [0, ...(wait ? this.deps.waits ?? [250, 1000, 3000] : [])]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const events = await this.deps.sdk.threads.events.list({ threadId, limit: "3" } as never).catch(() => []) as { data?: { input?: { type?: string; text?: string }[] } }[];
      for (const event of events) {
        const text = event.data?.input?.find((part) => part.type === "text" && part.text?.includes(SIDE_CHAT_SEED_PREFIX))?.text;
        if (text) return text.slice(text.indexOf(SIDE_CHAT_SEED_PREFIX) + SIDE_CHAT_SEED_PREFIX.length).trim() || null;
      }
      if (events.length) return null;
    }
    return null;
  }

  private findByText(threadId: string, quote: string): Promise<TimelineRow | null> {
    const wanted = quote.trim();
    return this.findRow(threadId, (row) => row.kind === "conversation" && !!row.text && (row.text.trim() === wanted || row.text.includes(wanted)));
  }

  private async findRow(threadId: string, matches: (row: TimelineRow) => boolean): Promise<TimelineRow | null> {
    let cursor: { anchorSeq: number; anchorId: string } | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.page(threadId, cursor);
      const row = [...(result.rows ?? [])].reverse().find(matches);
      if (row) return row;
      cursor = result.timelinePage?.olderCursor;
      if (!cursor) return null;
    }
    return null;
  }

  private async page(threadId: string, cursor: { anchorSeq: number; anchorId: string } | null | undefined): Promise<TimelinePage> {
    return await this.deps.sdk.threads.timeline({
      threadId, segmentLimit: PAGE_SEGMENTS, ...(cursor ? { beforeAnchorSeq: String(cursor.anchorSeq), beforeAnchorId: cursor.anchorId } : {}),
    } as never) as unknown as TimelinePage;
  }
}

export function snippet(text: string | undefined): string {
  const plain = (text ?? "")
    .replace(/^\s*::[\w-]+\{[^}]*\}\s*$/gm, "")
    .replace(/[`*_#>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Thread";
  return plain.length > 60 ? `${plain.slice(0, 59).trimEnd()}…` : plain;
}
