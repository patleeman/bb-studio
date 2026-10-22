// Side threads: Slack-style threads on a Bot's replies, built on BB's
// side-chat plugin. A side chat is a hidden BB fork of a thread, cut at the
// message it answers, opened beside the chat with "Reply in side chat". On a
// Bot's chat Studio adds what makes them threads:
//
// - Each reply with side chats gets "2 replies · 5m" under it, and the Bot's
//   sidebar lists them under Threads (src/ui/bot/reply-in-thread.ts,
//   BotSidebar.tsx). iOS shows the same row and has Reply in Thread.
// - A side chat of a Bot's chat reads the Bot but never changes it: the Bot
//   tools that would refuse there (server.ts, SIDE_THREAD_REFUSED).
//
// Which reply a side chat answers: side-chat records no message id, but it
// starts the fork with an agent-only note quoting the message ("Replying to
// this earlier message…"), the fork's first event. Studio matches that text
// against the chat's messages, newest first (a selection matches the message
// that contains it), and keeps the answer here (adopt). Side chats are found
// as they're made (thread.created) and again whenever a chat's list is read.
//
// iOS and the open call (bot_side_thread_open) start a side chat through
// side-chat too, and reopen the reply's latest one when it has one. With
// side-chat turned off, Studio forks the chat itself the same way.
//
// Replies counts a side chat's turns that ended in a reply, recounted from its
// timeline when it goes idle: the fork's own timeline holds only its new
// messages. A reply can have several side chats; its row sums them and opens
// the newest.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";

type Sdk = BbPluginApi["sdk"];

export const SIDE_CHAT_PLUGIN = "side-chat";
/** What side-chat puts before the quoted message in a fork's first input. */
export const SIDE_CHAT_SEED_PREFIX = "Replying to this earlier message in the conversation:\n\n";
export const BOT_THREAD_DIRECTIVE = "bot-thread";
/** Studio's own forks (side-chat turned off) are told what they are, as side-chat's are told what they answer. */
export const SIDE_THREAD_INSTRUCTIONS = "This is a side thread: the user forked your chat at one of your replies to talk about it. Stay on that reply's topic. Your main chat doesn't see this thread, so it won't know what you decide here. Here you can read about yourself but not change yourself: your name, look and profile, your skills, your Memory page, your runners and schedules, or pausing and stopping stay with your main chat. When the user asks for one of those, say it's done from your main chat, and don't attempt it another way. Some of your earlier replies end with ::bot-thread{}; don't write it.";

export const SIDE_THREADS_TABLE = `CREATE TABLE bot_side_threads (
       thread_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, source_thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
       replies INTEGER NOT NULL DEFAULT 0, last_reply_at INTEGER, created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX bot_side_threads_message ON bot_side_threads (source_thread_id, message_id);`;
/** Side-chat makes a new side chat each time: a reply can have several. */
export const SIDE_THREADS_MANY = `DROP INDEX bot_side_threads_message;
   CREATE INDEX bot_side_threads_message ON bot_side_threads (source_thread_id, message_id);`;

/** How far back a lookup reads a chat: pages of its timeline. */
const MAX_PAGES = 25;

interface SideRow {
  thread_id: string; bot_id: string; source_thread_id: string; message_id: string;
  replies: number; last_reply_at: number | null; created_at: number;
}

export interface SideThreadView {
  messageId: string;
  /** The reply's newest side chat: what its row opens. */
  threadId: string;
  /** All its side chats' replies. */
  replies: number;
  lastReplyAt: number | null;
  working: boolean;
}

export interface BotSideThreadView {
  threadId: string;
  sourceThreadId: string;
  messageId: string;
  title: string;
  replies: number;
  working: boolean;
  updatedAt: number;
  /** What BB's thread menu needs (archive, rename, pin…), from the thread itself. */
  menu: { projectId: string; parentThreadId: string | null; pinnedAt: number | null; sectionId: string | null; status: string; isUnread: boolean };
}

interface TimelineRow { id: string; kind?: string; role?: string; text?: string; sourceSeqEnd?: number; turnId?: string | null }
interface TimelinePage { rows?: TimelineRow[]; timelinePage?: { hasOlderRows?: boolean; olderCursor?: { anchorSeq: number; anchorId: string } | null } }
type ThreadLike = {
  id: string; originPluginId?: string | null; originKind?: string | null; sourceThreadId?: string | null; archivedAt?: number | null; status?: string; title?: string | null; titleFallback?: string | null;
  projectId?: string; parentThreadId?: string | null; pinnedAt?: number | null; sectionId?: string | null; lastReadAt?: number | null; updatedAt?: number;
};

export interface SideThreadDeps {
  db: Database.Database;
  sdk: Sdk;
  /** The Bot whose chat (its handoff chain included) holds this thread. */
  botFor(threadId: string): { id: string; name: string } | null;
  changed(): void;
  /** Retry delays while a new fork's first event isn't written yet. */
  waits?: readonly number[];
}

export class SideThreads {
  /** Opens in flight, by reply: a double tap opens one side chat. */
  private readonly opening = new Map<string, Promise<{ threadId: string; created: boolean }>>();
  /** Side chats being matched to their reply. */
  private readonly adopting = new Map<string, Promise<boolean>>();

  constructor(private readonly deps: SideThreadDeps) {}

  /** The side thread row of a fork, or null when the thread isn't a recorded one. */
  forThread(threadId: string): { botId: string; sourceThreadId: string; messageId: string } | null {
    const row = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE thread_id = ?").get(threadId) as SideRow | undefined;
    return row ? { botId: row.bot_id, sourceThreadId: row.source_thread_id, messageId: row.message_id } : null;
  }

  /** Whether a thread is a side chat of a Bot's chat, recorded or about to be (the Bot tools' guard). */
  async isSideThread(threadId: string): Promise<boolean> {
    if (this.forThread(threadId)) return true;
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadLike | null;
    return !!thread && this.isBotSideChat(thread);
  }

  /** The side threads on a chat's replies, one per reply; finds new side chats first. */
  async list(sourceThreadId: string): Promise<SideThreadView[]> {
    if (this.isChat(sourceThreadId)) await this.discover(sourceThreadId).catch(() => undefined);
    const rows = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE source_thread_id = ? ORDER BY created_at, rowid").all(sourceThreadId) as SideRow[];
    const live = await this.live(rows);
    const byMessage = new Map<string, SideThreadView>();
    for (const { row, thread } of live) {
      const seen = byMessage.get(row.message_id);
      const lastReplyAt = Math.max(seen?.lastReplyAt ?? 0, row.last_reply_at ?? 0) || null;
      byMessage.set(row.message_id, {
        messageId: row.message_id, threadId: row.thread_id,
        replies: (seen?.replies ?? 0) + row.replies, lastReplyAt,
        working: (seen?.working ?? false) || thread.status === "active",
      });
    }
    return [...byMessage.values()];
  }

  /** Every side thread, any Bot's. */
  threadIds(): string[] {
    return (this.deps.db.prepare("SELECT thread_id FROM bot_side_threads").all() as { thread_id: string }[]).map((row) => row.thread_id);
  }

  /** A Bot's side threads across its chain, for its sidebar: the latest reply first. */
  async forBot(botId: string): Promise<BotSideThreadView[]> {
    const rows = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE bot_id = ? ORDER BY created_at DESC, rowid DESC").all(botId) as SideRow[];
    return (await this.live(rows)).map(({ row, thread }) => ({
      threadId: row.thread_id, sourceThreadId: row.source_thread_id, messageId: row.message_id,
      // Hidden threads don't show in BB's own title lookup, so the title comes from here.
      title: thread.title?.trim() || thread.titleFallback?.trim() || "Thread",
      replies: row.replies, working: thread.status === "active", updatedAt: row.last_reply_at ?? row.created_at,
      menu: {
        projectId: thread.projectId ?? "", parentThreadId: thread.parentThreadId ?? null, pinnedAt: thread.pinnedAt ?? null, sectionId: thread.sectionId ?? null,
        status: thread.status ?? "idle", isUnread: !!thread.updatedAt && (thread.lastReadAt ?? 0) < thread.updatedAt,
      },
    })).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The reply's latest side chat, or a new one through side-chat. */
  open(sourceThreadId: string, messageId: string): Promise<{ threadId: string; created: boolean }> {
    const key = `${sourceThreadId}\n${messageId}`;
    const running = this.opening.get(key);
    if (running) return running;
    const opened = this.start(sourceThreadId, messageId).finally(() => this.opening.delete(key));
    this.opening.set(key, opened);
    return opened;
  }

  /** Whether a thread is a Bot's chat, where replies can have side threads. */
  isChat(threadId: string): boolean {
    return this.deps.botFor(threadId) !== null;
  }

  /** A thread was made: a side chat of a Bot's chat is matched to its reply. */
  async created(thread: ThreadLike): Promise<void> {
    if (this.isBotSideChat(thread) && !this.forThread(thread.id)) await this.adopt(thread);
  }

  /** A side thread went idle: recount its replies from its timeline. */
  async idle(threadId: string): Promise<void> {
    const row = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE thread_id = ?").get(threadId) as SideRow | undefined;
    if (!row) return;
    const turns = new Set<string>();
    let cursor: { anchorSeq: number; anchorId: string } | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.page(threadId, cursor);
      for (const each of result.rows ?? []) if (each.role === "assistant" && each.text?.trim()) turns.add(each.turnId ?? each.id);
      cursor = result.timelinePage?.olderCursor;
      if (!result.timelinePage?.hasOlderRows || !cursor) break;
    }
    if (turns.size === row.replies) return;
    this.deps.db.prepare("UPDATE bot_side_threads SET replies = ?, last_reply_at = ? WHERE thread_id = ?").run(turns.size, Date.now(), threadId);
    this.deps.changed();
  }

  /** A side thread started or stopped working. */
  touched(threadId: string): void {
    if (this.forThread(threadId)) this.deps.changed();
  }

  forget(threadId: string): void {
    const result = this.deps.db.prepare("DELETE FROM bot_side_threads WHERE thread_id = ?").run(threadId);
    if (result.changes) this.deps.changed();
  }

  private isBotSideChat(thread: ThreadLike): boolean {
    return thread.originPluginId === SIDE_CHAT_PLUGIN && !!thread.sourceThreadId && this.isChat(thread.sourceThreadId);
  }

  /** Rows whose thread still exists and isn't archived; deleted ones are forgotten. */
  private async live(rows: SideRow[]): Promise<{ row: SideRow; thread: ThreadLike }[]> {
    const found = await Promise.all(rows.map(async (row) => {
      const thread = await this.deps.sdk.threads.get({ threadId: row.thread_id }).catch((error: { status?: number }) => error?.status === 404 ? "gone" as const : null) as ThreadLike | "gone" | null;
      if (thread === "gone") { this.forget(row.thread_id); return null; }
      return thread && !thread.archivedAt ? { row, thread } : null;
    }));
    return found.filter((each): each is { row: SideRow; thread: ThreadLike } => each !== null);
  }

  /** Side chats of a chat not recorded yet (made while Studio wasn't listening). */
  private async discover(sourceThreadId: string): Promise<void> {
    const known = new Set(this.threadIds());
    const forks = await this.deps.sdk.threads.list({ includeHidden: true, sourceThreadId, originPluginId: SIDE_CHAT_PLUGIN, archived: false, limit: 100 } as never) as ThreadLike[];
    await Promise.all(forks.filter((fork) => !known.has(fork.id)).map((fork) => this.adopt(fork)));
  }

  /** Matches a side chat to the reply it quotes and records it. False when it can't tell. */
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
      // BB titles it from side-chat's note ("Replying to this earlier message…"): name it after the reply.
      await this.deps.sdk.threads.update({ threadId: thread.id, title: `${bot.name} · ${snippet(message.text)}` } as never).catch(() => undefined);
      return true;
    })().finally(() => this.adopting.delete(thread.id));
    this.adopting.set(thread.id, adopted);
    return adopted;
  }

  /** The message a side chat quotes, from its first event; null when it has none. */
  private async quoteOf(threadId: string): Promise<string | null> {
    for (const wait of [0, ...(this.deps.waits ?? [250, 1000, 3000])]) {
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      const events = await this.deps.sdk.threads.events.list({ threadId, limit: "3" } as never).catch(() => []) as { data?: { input?: { type?: string; text?: string }[] } }[];
      for (const event of events) {
        const text = event.data?.input?.find((part) => part.type === "text" && part.text?.startsWith(SIDE_CHAT_SEED_PREFIX))?.text;
        if (text) return text.slice(SIDE_CHAT_SEED_PREFIX.length).trim() || null;
      }
      if (events.length) return null;
    }
    return null;
  }

  private record(threadId: string, botId: string, sourceThreadId: string, messageId: string): void {
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_side_threads (thread_id, bot_id, source_thread_id, message_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(threadId, botId, sourceThreadId, messageId, Date.now());
    this.deps.changed();
  }

  private async start(sourceThreadId: string, messageId: string): Promise<{ threadId: string; created: boolean }> {
    // A previous create may have succeeded before its response was lost.
    await this.discover(sourceThreadId);
    const latest = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE source_thread_id = ? AND message_id = ? ORDER BY created_at DESC, rowid DESC").all(sourceThreadId, messageId) as SideRow[];
    const open = (await this.live(latest))[0];
    if (open) return { threadId: open.row.thread_id, created: false };
    const bot = this.deps.botFor(sourceThreadId);
    if (!bot) throw new Error("Side threads are for a Bot's chat.");
    const reply = await this.findRow(sourceThreadId, (row) => row.id === messageId);
    if (!reply || reply.sourceSeqEnd === undefined) throw new Error("Couldn't find that reply in the chat.");
    let threadId: string;
    try {
      ({ threadId } = await this.deps.sdk.plugins.callRpc({
        pluginId: SIDE_CHAT_PLUGIN, method: "createSideChat",
        input: { sourceThreadId, sourceSeqEnd: reply.sourceSeqEnd, anchorText: reply.text ?? "" } as never,
        outputSchema: z.object({ threadId: z.string() }),
      }));
    } catch (error) {
      const { plugins } = await this.deps.sdk.plugins.list();
      if (plugins.some((plugin) => plugin.id === SIDE_CHAT_PLUGIN && plugin.enabled)) throw error;
      // Confirmed absent or disabled: make the same fork here.
      const fork = await this.deps.sdk.threads.fork({
        sourceThreadId, sourceSeqEnd: reply.sourceSeqEnd, lifecycleOwnerThreadId: sourceThreadId, visibility: "hidden",
        agentContextSeed: [{ type: "text", text: `${SIDE_THREAD_INSTRUCTIONS}\n\n${SIDE_CHAT_SEED_PREFIX}${reply.text ?? ""}`, mentions: [], visibility: "agent-only" }],
      } as never);
      threadId = fork.id;
    }
    this.record(threadId, bot.id, sourceThreadId, messageId);
    // Side chats have no title of their own: name it after the reply, for the sidebar.
    await this.deps.sdk.threads.update({ threadId, title: `${bot.name} · ${snippet(reply.text)}` } as never).catch(() => undefined);
    return { threadId, created: true };
  }

  /** The newest message a side chat's quote came from: the same text, or one holding it (a selection). */
  private findByText(threadId: string, quote: string): Promise<TimelineRow | null> {
    const wanted = quote.trim();
    return this.findRow(threadId, (row) => row.kind === "conversation" && !!row.text && (row.text.trim() === wanted || row.text.includes(wanted)));
  }

  /** The newest timeline row that matches, newest pages first. */
  private async findRow(threadId: string, matches: (row: TimelineRow) => boolean): Promise<TimelineRow | null> {
    let cursor: { anchorSeq: number; anchorId: string } | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.page(threadId, cursor);
      const row = [...(result.rows ?? [])].reverse().find(matches);
      if (row) return row;
      cursor = result.timelinePage?.olderCursor;
      if (!result.timelinePage?.hasOlderRows || !cursor) return null;
    }
    return null;
  }

  /** One page of a thread's timeline, before the cursor when there is one. */
  private async page(threadId: string, cursor: { anchorSeq: number; anchorId: string } | null | undefined): Promise<TimelinePage> {
    return await this.deps.sdk.threads.timeline({
      threadId, segmentLimit: "20", ...(cursor ? { beforeAnchorSeq: String(cursor.anchorSeq), beforeAnchorId: cursor.anchorId } : {}),
    } as never) as unknown as TimelinePage;
  }
}

/** A side thread's title: the start of the reply, without markdown or directives. */
export function snippet(text: string | undefined): string {
  const plain = (text ?? "")
    .replace(/^\s*::[\w-]+\{[^}]*\}\s*$/gm, "")
    .replace(/[`*_#>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Thread";
  return plain.length > 60 ? `${plain.slice(0, 59).trimEnd()}…` : plain;
}
