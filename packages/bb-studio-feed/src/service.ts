// What happens to a post: a reply ending in `::post{…}` is published (once,
// however many threads it arrives through), edits and removals, and the
// notification for an urgent post or a story update. BB specifics (threads,
// Teams, phones) come in as deps, so this is testable without a host.
import type { PostView } from "./contract";
import { parsePost, plainText, postHref, sourceDomains, type ParsedPost, type Priority, type RealtimeEvent } from "./shared";
import { contentKey, FeedStore, type ListedRow, type PostPatch, type PostRow } from "./store";

/** Where a reply came from. */
export interface Origin {
  author: string;
  botId: string | null;
  threadId: string;
  projectId: string | null;
  channelId: string | null;
  channelName: string | null;
}

export type NotifyMode = "urgent" | "all" | "off";

export interface Notification {
  title: string;
  body: string;
  threadId: string | null;
  projectId: string | null;
  path: string;
  coalesceKey: string;
}

export interface FeedDeps {
  store: FeedStore;
  /** Who and where a thread is; null for a thread that shouldn't post (a hidden worker, say). */
  origin: (threadId: string) => Promise<Origin | null>;
  publish: (event: RealtimeEvent) => void;
  notify: (notification: Notification) => Promise<void>;
  notifyMode: () => NotifyMode;
  log: { warn(message: string): void };
  now?: () => number;
}

export function view(row: PostRow | ListedRow, storyPosts?: number): PostView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    preview: plainText(row.body, 240),
    domains: sourceDomains(row.body),
    topic: row.topic,
    story: row.story,
    storyPosts: "story_posts" in row ? row.story_posts : (storyPosts ?? 1),
    priority: row.priority,
    author: row.author,
    botId: row.bot_id,
    threadId: row.thread_id,
    projectId: row.project_id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedBy: row.edited_by,
    resolvedAt: row.resolved_at,
  };
}

export class FeedService {
  private readonly now: () => number;
  /** Replies being ingested, by content key: the bot's thread and its channel can go idle at once. */
  private readonly inFlight = new Map<string, Promise<PostRow | null>>();

  constructor(private readonly deps: FeedDeps) {
    this.now = deps.now ?? Date.now;
  }

  get store(): FeedStore {
    return this.deps.store;
  }

  view(row: PostRow): PostView {
    return view(row, row.story ? this.deps.store.story(row.story).length : 1);
  }

  /** A thread went idle: publish its reply if it ends in `::post`. */
  async ingest(threadId: string, text: string | null | undefined): Promise<PostRow | null> {
    const parsed = parsePost(text);
    if (!parsed) return null;
    const key = contentKey(parsed.source, parsed.body);
    const running = this.inFlight.get(key);
    if (running) {
      await running.catch(() => null);
      return this.merge(key, threadId);
    }
    const work = this.ingestNew(threadId, parsed, key);
    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async ingestNew(threadId: string, parsed: ParsedPost, key: string): Promise<PostRow | null> {
    if (this.deps.store.duplicate(key, this.now())) return this.merge(key, threadId);
    const origin = await this.deps.origin(threadId).catch((error: unknown) => {
      this.deps.log.warn(`Could not resolve where a post came from: ${String(error)}`);
      return fallbackOrigin(threadId);
    });
    if (!origin) return null;
    // Another copy may have landed while we looked the thread up.
    if (this.deps.store.duplicate(key, this.now())) return this.merge(key, threadId, origin);
    const row = this.deps.store.insert({ ...parsed, ...origin, at: this.now() });
    this.changed(row);
    await this.notifyFor(row);
    return row;
  }

  /** The same reply again (the channel's copy of a bot's reply): fill in what this copy knows. */
  private async merge(key: string, threadId: string, known?: Origin): Promise<PostRow | null> {
    const existing = this.deps.store.duplicate(key, this.now());
    if (!existing) return null;
    if (existing.thread_id === threadId) return existing;
    const origin = known ?? (await this.deps.origin(threadId).catch(() => null));
    if (!origin) return existing;
    const merged = this.deps.store.fillOrigin(existing.id, {
      author: origin.author,
      bot_id: origin.botId,
      project_id: origin.projectId,
      channel_id: origin.channelId,
      channel_name: origin.channelName,
    });
    if (merged && merged !== existing) this.changed(merged);
    return merged;
  }

  /** A post from the CLI or a tool, without a reply around it. */
  async create(input: { title: string; body: string; topic: string | null; story: string | null; priority: Priority; origin: Origin }): Promise<PostRow> {
    const at = this.now();
    const row = this.deps.store.insert({
      ...input,
      ...input.origin,
      source: `::post{created="${at}" title="${input.title.replace(/"/g, "'")}"}`,
      at,
    });
    this.changed(row);
    await this.notifyFor(row);
    return row;
  }

  edit(id: string, patch: PostPatch, editedBy: string): PostRow | null {
    const row = this.deps.store.update(id, patch, editedBy, this.now());
    if (row) this.changed(row);
    return row;
  }

  remove(id: string): boolean {
    const removed = this.deps.store.remove(id);
    if (removed) this.deps.publish({ type: "removed", postId: id });
    return removed;
  }

  seen(at?: number): number {
    const lastSeenAt = this.deps.store.markSeen(Math.min(at ?? this.now(), this.now()));
    this.deps.publish({ type: "seen" });
    return lastSeenAt;
  }

  private changed(row: PostRow) {
    this.deps.publish({ type: "post", postId: row.id, story: row.story });
  }

  /** Urgent posts always (unless off); every post with "all"; a story's update says so. */
  private async notifyFor(row: PostRow) {
    const mode = this.deps.notifyMode();
    if (mode === "off" || (mode === "urgent" && row.priority !== "urgent")) return;
    const earlier = row.story ? this.deps.store.story(row.story).length - 1 : 0;
    const from = row.channel_name ? `${row.author} in #${row.channel_name}` : row.author;
    try {
      await this.deps.notify({
        title: row.title,
        body: `${earlier ? "Update · " : ""}${from}${row.body ? ` · ${plainText(row.body, 300)}` : ""}`,
        threadId: row.thread_id,
        projectId: row.project_id,
        path: postHref(row.id),
        coalesceKey: `feed:${row.story ?? row.id}`,
      });
    } catch (error) {
      this.deps.log.warn(`Could not send the feed notification: ${String(error)}`);
    }
  }
}

function fallbackOrigin(threadId: string): Origin {
  return { author: "Agent", botId: null, threadId, projectId: null, channelId: null, channelName: null };
}
