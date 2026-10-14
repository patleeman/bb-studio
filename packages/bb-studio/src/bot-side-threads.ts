// Side threads: Slack-style threads on a Bot's replies. Each one is a BB fork
// of the Bot's chat, cut at the reply it answers (sourceSeqEnd), so it knows
// everything the chat knew up to there and nothing after. A reply has at most
// one side thread; replying again opens the same one.
//
// Where it shows: the Bot ends each reply with `::bot-thread{}` (its
// instructions, BOT_THREAD_INSTRUCTIONS). On the web that directive renders
// "Reply in thread" under the reply, then "🧵 2 replies · 5m" once a side thread
// has replies; either opens the side thread in a tab beside the chat. BB has no
// per-message slot a plugin can draw into, and the directive is one, on stable
// BB. iOS draws the same row under any Bot reply with a side thread.
//
// The fork is hidden (it lives under its reply, not in BB's thread list) and
// isn't Bot-owned work (src/bot-owned.ts): it's the user's conversation with
// the Bot. It runs as the Bot, with the Bot's instructions and tools, but
// without the directive: a side thread has no side threads.
//
// Replies counts the side thread's turns that ended in a reply, recounted
// from its timeline when it goes idle: BB also reports an idle while a fork
// is set up, and the fork's own timeline holds only its new messages.
//
// The fork inherits the Bot's session, marker instruction included, so its
// replies may carry `::bot-thread{}` too. bot_side_threads says whether a
// thread is a Bot's chat, and the directive draws nothing where it isn't.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";

type Sdk = BbPluginApi["sdk"];

export const BOT_THREAD_DIRECTIVE = "bot-thread";
export const BOT_THREAD_INSTRUCTIONS = `End every reply except [PASS] with the line \`::${BOT_THREAD_DIRECTIVE}{}\` on its own, before the ::next line when you write one. It lets the user answer that reply in a side thread. Don't mention it.`;
export const SIDE_THREAD_INSTRUCTIONS = "This is a side thread: the user forked your chat at one of your replies to talk about it. Stay on that reply's topic. Your main chat doesn't see this thread, so it won't know what you decide here.";

export const SIDE_THREADS_TABLE = `CREATE TABLE bot_side_threads (
       thread_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, source_thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
       replies INTEGER NOT NULL DEFAULT 0, last_reply_at INTEGER, created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX bot_side_threads_message ON bot_side_threads (source_thread_id, message_id);`;

/** How far back Open looks for the reply: pages of the chat's timeline. */
const MAX_PAGES = 25;

interface SideRow {
  thread_id: string; bot_id: string; source_thread_id: string; message_id: string;
  replies: number; last_reply_at: number | null; created_at: number;
}

export interface SideThreadView {
  messageId: string;
  threadId: string;
  replies: number;
  lastReplyAt: number | null;
  working: boolean;
}

interface TimelineRow { id: string; kind?: string; role?: string; text?: string; sourceSeqEnd?: number; turnId?: string | null }
interface TimelinePage { rows?: TimelineRow[]; timelinePage?: { hasOlderRows?: boolean; olderCursor?: { anchorSeq: number; anchorId: string } | null } }

export interface SideThreadDeps {
  db: Database.Database;
  sdk: Sdk;
  /** The Bot whose chat (its handoff chain included) holds this thread. */
  botFor(threadId: string): { id: string; name: string } | null;
  changed(): void;
}

export class SideThreads {
  /** Opens in flight, by reply: a double click opens one fork. */
  private readonly opening = new Map<string, Promise<{ threadId: string; created: boolean }>>();

  constructor(private readonly deps: SideThreadDeps) {}

  /** The side thread row of a fork, or null when the thread isn't one. */
  forThread(threadId: string): { botId: string; sourceThreadId: string; messageId: string } | null {
    const row = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE thread_id = ?").get(threadId) as SideRow | undefined;
    return row ? { botId: row.bot_id, sourceThreadId: row.source_thread_id, messageId: row.message_id } : null;
  }

  /** The side threads on a chat's replies; deleted ones are forgotten, archived ones skipped. */
  async list(sourceThreadId: string): Promise<SideThreadView[]> {
    const rows = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE source_thread_id = ? ORDER BY created_at").all(sourceThreadId) as SideRow[];
    const views = await Promise.all(rows.map(async (row) => {
      const thread = await this.deps.sdk.threads.get({ threadId: row.thread_id }).catch((error: { status?: number }) => error?.status === 404 ? "gone" as const : null);
      if (thread === "gone") { this.forget(row.thread_id); return null; }
      if (thread?.archivedAt) return null;
      return { messageId: row.message_id, threadId: row.thread_id, replies: row.replies, lastReplyAt: row.last_reply_at, working: thread?.status === "active" };
    }));
    return views.filter((view): view is SideThreadView => view !== null);
  }

  /** The reply's side thread, forked from the chat at that reply when it has none. */
  open(sourceThreadId: string, messageId: string): Promise<{ threadId: string; created: boolean }> {
    const key = `${sourceThreadId}\n${messageId}`;
    const running = this.opening.get(key);
    if (running) return running;
    const opened = this.fork(sourceThreadId, messageId).finally(() => this.opening.delete(key));
    this.opening.set(key, opened);
    return opened;
  }

  /** Whether a thread is a Bot's chat, where replies can have side threads. */
  isChat(threadId: string): boolean {
    return this.deps.botFor(threadId) !== null;
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

  private async fork(sourceThreadId: string, messageId: string): Promise<{ threadId: string; created: boolean }> {
    const existing = this.deps.db.prepare("SELECT * FROM bot_side_threads WHERE source_thread_id = ? AND message_id = ?").get(sourceThreadId, messageId) as SideRow | undefined;
    if (existing) {
      const thread = await this.deps.sdk.threads.get({ threadId: existing.thread_id }).catch(() => null);
      if (thread && !thread.archivedAt) return { threadId: existing.thread_id, created: false };
      this.forget(existing.thread_id);
    }
    const bot = this.deps.botFor(sourceThreadId);
    if (!bot) throw new Error("Side threads are for a Bot's chat.");
    const reply = await this.findRow(sourceThreadId, messageId);
    if (!reply || reply.sourceSeqEnd === undefined) throw new Error("Couldn't find that reply in the chat.");
    const fork = await this.deps.sdk.threads.fork({
      sourceThreadId, sourceSeqEnd: reply.sourceSeqEnd, title: `${bot.name} · ${snippet(reply.text)}`,
      visibility: "hidden", pluginMetadata: { botSideThread: bot.id },
    } as never);
    this.deps.db.prepare("INSERT INTO bot_side_threads (thread_id, bot_id, source_thread_id, message_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(fork.id, bot.id, sourceThreadId, messageId, Date.now());
    this.deps.changed();
    return { threadId: fork.id, created: true };
  }

  /** The timeline row with this id, newest pages first. */
  private async findRow(threadId: string, rowId: string): Promise<TimelineRow | null> {
    let cursor: { anchorSeq: number; anchorId: string } | null | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.page(threadId, cursor);
      const row = result.rows?.find((each) => each.id === rowId);
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
