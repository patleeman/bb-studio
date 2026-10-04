// The feed's posts. A story is the posts that share a story key; the feed
// lists each story once, by its newest post.
import { AUTOMATIC_MIGRATION, AUTOMATIC_FILTER_MIGRATION } from "./automatic-store";
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
  /** When you read it; null while it's unread. */
  read_at: number | null;
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
  // A linked page's preview picture; image is "" when it has none.
  `CREATE TABLE IF NOT EXISTS feed_link_images (url TEXT PRIMARY KEY, image TEXT NOT NULL, fetched_at INTEGER NOT NULL);`,
  // Read state per post. Everything before the old read mark is read.
  `ALTER TABLE feed_posts ADD COLUMN read_at INTEGER;
   UPDATE feed_posts SET read_at = created_at
     WHERE created_at <= CAST(COALESCE((SELECT value FROM feed_meta WHERE key = 'last_seen_at'), '0') AS INTEGER);
   CREATE INDEX IF NOT EXISTS feed_posts_unread ON feed_posts (read_at, created_at);`,
  // Link previews keep the page's title and description too; look them up again.
  `DELETE FROM feed_link_images;
   ALTER TABLE feed_link_images ADD COLUMN title TEXT NOT NULL DEFAULT '';
   ALTER TABLE feed_link_images ADD COLUMN description TEXT NOT NULL DEFAULT '';`,
  AUTOMATIC_MIGRATION,
  AUTOMATIC_FILTER_MIGRATION,
];

/** A linked page's preview; empty strings when it has none. */
export type LinkPreviewRow = { title: string; description: string; image: string };

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
  /** Identifies the post for its keys. */
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
      read_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO feed_posts (id, title, body, topic, story, priority, author, bot_id, thread_id, project_id, channel_id, channel_name,
           content_key, directive_key, created_at, updated_at, edited_by, resolved_at, read_at)
         VALUES (@id, @title, @body, @topic, @story, @priority, @author, @bot_id, @thread_id, @project_id, @channel_id, @channel_name,
           @content_key, @directive_key, @created_at, @updated_at, @edited_by, @resolved_at, @read_at)`,
      )
      .run(row);
    return row;
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
  list(
    options: { limit?: number; cursor?: string; topic?: string | null; since?: number; until?: number; query?: string; stories?: boolean; unread?: boolean; attention?: boolean } = {},
  ): { rows: ListedRow[]; nextCursor: string | null } {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 200);
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: limit + 1 };
    // Every unresolved alert remains actionable, even if its story has a newer post.
    if (options.attention) where.push("p.priority = 'urgent' AND p.resolved_at IS NULL");
    if (!options.attention && options.stories !== false)
      where.push("(p.story IS NULL OR p.id = (SELECT q.id FROM feed_posts q WHERE q.story = p.story ORDER BY q.created_at DESC, q.id DESC LIMIT 1))");
    if (options.topic) {
      where.push("lower(p.topic) = lower(@topic)");
      params.topic = options.topic;
    }
    if (options.since) {
      where.push("p.created_at > @since");
      params.since = options.since;
    }
    if (options.until) {
      where.push("p.created_at <= @until");
      params.until = options.until;
    }
    if (options.unread) where.push("p.read_at IS NULL");
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

  /** A link's cached preview; undefined when it hasn't been looked up. */
  linkPreview(url: string): LinkPreviewRow | undefined {
    return this.db.prepare("SELECT title, description, image FROM feed_link_images WHERE url = ?").get(url) as LinkPreviewRow | undefined;
  }

  setLinkPreview(url: string, preview: LinkPreviewRow, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO feed_link_images (url, image, title, description, fetched_at) VALUES (@url, @image, @title, @description, @now)
         ON CONFLICT(url) DO UPDATE SET image = excluded.image, title = excluded.title, description = excluded.description, fetched_at = excluded.fetched_at`,
      )
      .run({ url, ...preview, now });
  }

  /** Marks a post read or unread, with the rest of its story. */
  markRead(id: string, read: boolean, now = Date.now()): PostRow | null {
    const row = this.get(id);
    if (!row) return null;
    const readAt = read ? now : null;
    if (row.story) this.db.prepare("UPDATE feed_posts SET read_at = CASE WHEN @readAt IS NULL THEN NULL ELSE COALESCE(read_at, @readAt) END WHERE story = @story").run({ readAt, story: row.story });
    else this.db.prepare("UPDATE feed_posts SET read_at = CASE WHEN @readAt IS NULL THEN NULL ELSE COALESCE(read_at, @readAt) END WHERE id = @id").run({ readAt, id });
    return this.get(id);
  }

  /** Stories (or loose posts) with an unread post. */
  unreadCount(): number {
    return (this.db.prepare("SELECT COUNT(DISTINCT COALESCE(story, id)) AS count FROM feed_posts WHERE read_at IS NULL").get() as { count: number }).count;
  }

  /** When you last marked everything read; 0 before the first time. */
  lastSeenAt(): number {
    return Number(this.meta("last_seen_at") ?? 0) || 0;
  }

  /** Marks everything posted up to then read, and moves the read mark forward, never back. */
  markSeen(at: number): number {
    this.db.prepare("UPDATE feed_posts SET read_at = @at WHERE read_at IS NULL AND created_at <= @at").run({ at });
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
