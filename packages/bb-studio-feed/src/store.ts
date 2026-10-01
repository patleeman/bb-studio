// The feed's posts. A story is the posts that share a story key; the feed
// lists each story once, by its newest post.
import { createHash } from "node:crypto";
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import type { Priority } from "./shared";

export type PostRow = {
  id: string;
  title: string;
  body: string;
  topic: string | null;
  story: string | null;
  priority: Priority;
  /** Who posted it: a bot's name, the thread's title, or "CLI". */
  author: string;
  bot_id: string | null;
  thread_id: string | null;
  project_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  /** The directive line and body, hashed: the same reply seen twice is one post. */
  content_key: string;
  /** The directive line, hashed: how a reply's card finds its post. */
  directive_key: string;
  created_at: number;
  updated_at: number;
  edited_by: string | null;
  resolved_at: number | null;
};

/** A listed post, with how many posts its story has. */
export type ListedRow = PostRow & { story_posts: number };

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS feed_posts (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     topic TEXT,
     story TEXT,
     priority TEXT NOT NULL,
     author TEXT NOT NULL,
     bot_id TEXT,
     thread_id TEXT,
     project_id TEXT,
     channel_id TEXT,
     channel_name TEXT,
     content_key TEXT NOT NULL,
     directive_key TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     edited_by TEXT,
     resolved_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS feed_posts_created ON feed_posts (created_at DESC, id DESC);
   CREATE INDEX IF NOT EXISTS feed_posts_story ON feed_posts (story, created_at);
   CREATE INDEX IF NOT EXISTS feed_posts_content ON feed_posts (content_key, created_at);
   CREATE INDEX IF NOT EXISTS feed_posts_directive ON feed_posts (directive_key, created_at);`,
  `CREATE TABLE IF NOT EXISTS feed_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

/** The same reply arriving again within this long (from the bot's thread and its channel) is one post. */
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60_000;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const directiveKey = (source: string) => hash(source.trim());
export const contentKey = (source: string, body: string) => hash(`${source.trim()}\n${body.trim()}`);

export interface NewPost {
  title: string;
  body: string;
  topic: string | null;
  story: string | null;
  priority: Priority;
  author: string;
  botId?: string | null;
  threadId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  /** The `::post` line it came from; one is made up for a post without one. */
  source: string;
  at?: number;
}

export type PostPatch = Partial<Pick<PostRow, "title" | "body" | "topic" | "story" | "priority">> & { resolved?: boolean };

/** Where a listing continues: the last row's time and id. */
export const cursorOf = (row: Pick<PostRow, "created_at" | "id">) => `${row.created_at}:${row.id}`;
function parseCursor(cursor: string | undefined): { at: number; id: string } | null {
  const match = cursor ? /^(\d+):(.+)$/.exec(cursor) : null;
  return match ? { at: Number(match[1]), id: match[2]! } : null;
}

export class FeedStore {
  constructor(readonly db: Database.Database) {}

  get(id: string): PostRow | null {
    return (this.db.prepare("SELECT * FROM feed_posts WHERE id = ?").get(id) as PostRow | undefined) ?? null;
  }

  /** The same reply, recently: the copy a channel shows of a bot's post. */
  duplicate(key: string, now = Date.now()): PostRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM feed_posts WHERE content_key = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1")
        .get(key, now - DUPLICATE_WINDOW_MS) as PostRow | undefined) ?? null
    );
  }

  /** The newest post written with this directive line. */
  byDirective(source: string): PostRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM feed_posts WHERE directive_key = ? ORDER BY created_at DESC LIMIT 1")
        .get(directiveKey(source)) as PostRow | undefined) ?? null
    );
  }

  /** The newest post with this title: a card's fallback when its line was rewritten on the way. */
  byTitle(title: string): PostRow | null {
    return (this.db.prepare("SELECT * FROM feed_posts WHERE title = ? ORDER BY created_at DESC LIMIT 1").get(title) as PostRow | undefined) ?? null;
  }

  insert(post: NewPost): PostRow {
    const at = post.at ?? Date.now();
    const row: PostRow = {
      id: newId("post"),
      title: post.title,
      body: post.body,
      topic: post.topic,
      story: post.story,
      priority: post.priority,
      author: post.author,
      bot_id: post.botId ?? null,
      thread_id: post.threadId ?? null,
      project_id: post.projectId ?? null,
      channel_id: post.channelId ?? null,
      channel_name: post.channelName ?? null,
      content_key: contentKey(post.source, post.body),
      directive_key: directiveKey(post.source),
      created_at: at,
      updated_at: at,
      edited_by: null,
      resolved_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO feed_posts (id, title, body, topic, story, priority, author, bot_id, thread_id, project_id, channel_id, channel_name,
           content_key, directive_key, created_at, updated_at, edited_by, resolved_at)
         VALUES (@id, @title, @body, @topic, @story, @priority, @author, @bot_id, @thread_id, @project_id, @channel_id, @channel_name,
           @content_key, @directive_key, @created_at, @updated_at, @edited_by, @resolved_at)`,
      )
      .run(row);
    return row;
  }

  /** Fills in where a post came from when another copy knows more (a bot's name, its channel). */
  fillOrigin(id: string, origin: Partial<Pick<PostRow, "author" | "bot_id" | "thread_id" | "project_id" | "channel_id" | "channel_name">>): PostRow | null {
    const row = this.get(id);
    if (!row) return null;
    const next = { ...row };
    for (const key of ["bot_id", "thread_id", "project_id", "channel_id", "channel_name"] as const) {
      if (!next[key] && origin[key]) next[key] = origin[key]!;
    }
    // A bot's name beats the channel thread's title.
    if (origin.bot_id && !row.bot_id && origin.author) next.author = origin.author;
    if (JSON.stringify(next) === JSON.stringify(row)) return row;
    this.db
      .prepare(
        "UPDATE feed_posts SET author = @author, bot_id = @bot_id, thread_id = @thread_id, project_id = @project_id, channel_id = @channel_id, channel_name = @channel_name WHERE id = @id",
      )
      .run(next);
    return next;
  }

  update(id: string, patch: PostPatch, editedBy: string, now = Date.now()): PostRow | null {
    const row = this.get(id);
    if (!row) return null;
    const next: PostRow = {
      ...row,
      ...Object.fromEntries(Object.entries(patch).filter(([key, value]) => key !== "resolved" && value !== undefined)),
      resolved_at: patch.resolved === undefined ? row.resolved_at : patch.resolved ? (row.resolved_at ?? now) : null,
      updated_at: now,
      edited_by: editedBy,
    };
    this.db
      .prepare(
        `UPDATE feed_posts SET title = @title, body = @body, topic = @topic, story = @story, priority = @priority,
           updated_at = @updated_at, edited_by = @edited_by, resolved_at = @resolved_at WHERE id = @id`,
      )
      .run(next);
    return next;
  }

  /** Marks every post in a story resolved, or not. */
  resolveStory(story: string, resolved: boolean, editedBy: string, now = Date.now()): number {
    return this.db
      .prepare(
        resolved
          ? "UPDATE feed_posts SET resolved_at = COALESCE(resolved_at, @now), updated_at = @now, edited_by = @editedBy WHERE story = @story"
          : "UPDATE feed_posts SET resolved_at = NULL, updated_at = @now, edited_by = @editedBy WHERE story = @story",
      )
      .run({ story, now, editedBy }).changes;
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM feed_posts WHERE id = ?").run(id).changes > 0;
  }

  /**
   * Newest first. With `stories`, a story is listed once, by its newest post,
   * with its post count; otherwise every post is listed.
   */
  list(options: { limit?: number; cursor?: string; topic?: string | null; since?: number; query?: string; stories?: boolean } = {}): { rows: ListedRow[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 200);
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: limit + 1 };
    if (options.stories !== false)
      where.push("(p.story IS NULL OR p.id = (SELECT q.id FROM feed_posts q WHERE q.story = p.story ORDER BY q.created_at DESC, q.id DESC LIMIT 1))");
    if (options.topic) {
      where.push("lower(p.topic) = lower(@topic)");
      params.topic = options.topic;
    }
    if (options.since) {
      where.push("p.created_at > @since");
      params.since = options.since;
    }
    const query = options.query?.trim();
    if (query) {
      where.push("(p.title LIKE @query ESCAPE '\\' OR p.body LIKE @query ESCAPE '\\' OR p.author LIKE @query ESCAPE '\\')");
      params.query = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    }
    const cursor = parseCursor(options.cursor);
    if (cursor) {
      where.push("(p.created_at < @cursorAt OR (p.created_at = @cursorAt AND p.id < @cursorId))");
      params.cursorAt = cursor.at;
      params.cursorId = cursor.id;
    }
    const rows = this.db
      .prepare(
        `SELECT p.*, CASE WHEN p.story IS NULL THEN 1 ELSE (SELECT COUNT(*) FROM feed_posts q WHERE q.story = p.story) END AS story_posts
         FROM feed_posts p ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY p.created_at DESC, p.id DESC LIMIT @limit`,
      )
      .all(params) as ListedRow[];
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    return { rows: page, nextCursor: more ? cursorOf(page[page.length - 1]!) : null };
  }

  /** A story's posts, oldest first. */
  story(story: string): PostRow[] {
    return this.db.prepare("SELECT * FROM feed_posts WHERE story = ? ORDER BY created_at ASC, id ASC").all(story) as PostRow[];
  }

  /** Topics in use, most posts first. */
  topics(): { topic: string; posts: number }[] {
    return this.db
      .prepare("SELECT MIN(topic) AS topic, COUNT(*) AS posts FROM feed_posts WHERE topic IS NOT NULL GROUP BY lower(topic) ORDER BY posts DESC, topic ASC")
      .all() as { topic: string; posts: number }[];
  }

  meta(key: string): string | null {
    return (this.db.prepare("SELECT value FROM feed_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO feed_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** When you last read the feed; 0 before the first time. */
  lastSeenAt(): number {
    return Number(this.meta("last_seen_at") ?? 0) || 0;
  }

  /** Moves the read mark forward, never back. */
  markSeen(at: number): number {
    const next = Math.max(this.lastSeenAt(), at);
    this.setMeta("last_seen_at", String(next));
    return next;
  }

  /** Stories (or loose posts) with a post since then. */
  countSince(since: number): number {
    const row = this.db
      .prepare("SELECT COUNT(DISTINCT COALESCE(story, id)) AS count FROM feed_posts WHERE created_at > ?")
      .get(since) as { count: number };
    return row.count;
  }
}
