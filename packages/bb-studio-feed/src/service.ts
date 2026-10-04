// What happens to a post: publishing (from feed_post, the CLI or another
// plugin), edits and removals, and the notification for an urgent post or a
// story update. BB specifics (threads,
// Teams, phones) come in as deps, so this is testable without a host.
import type { PostView } from "./contract";
import { EXPLORE_STORY_PREFIX, bodyImage, lede, postHref, sourceDomains, type Priority, type RealtimeEvent } from "./shared";
import { FeedStore, type ListedRow, type PostPatch, type PostRow } from "./store";

/** Where a post came from. */
export interface Origin {
  author: string;
  botId: string | null;
  threadId: string | null;
  projectId: string | null;
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
    preview: lede(row.body),
    domains: sourceDomains(row.body),
    image: bodyImage(row.body),
    avatar: null,
    link: null,
    embeds: [],
    explorable: row.story?.startsWith(EXPLORE_STORY_PREFIX) ?? false,
    threadTitle: null,
    read: row.read_at !== null,
    topic: row.topic,
    story: row.story,
    storyPosts: "story_posts" in row ? row.story_posts : (storyPosts ?? 1),
    priority: row.priority,
    author: row.author,
    botId: row.bot_id,
    threadId: row.thread_id,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedBy: row.edited_by,
    resolvedAt: row.resolved_at,
  };
}

export class FeedService {
  private readonly now: () => number;

  constructor(private readonly deps: FeedDeps) {
    this.now = deps.now ?? Date.now;
  }

  get store(): FeedStore {
    return this.deps.store;
  }

  view(row: PostRow): PostView {
    return view(row, row.story ? this.deps.store.story(row.story).length : 1);
  }

  /** A post from feed_post, the CLI or another plugin. */
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

  markRead(id: string, read: boolean): PostRow | null {
    const row = this.deps.store.markRead(id, read, this.now());
    // "seen": the reader keeps its list; counts update.
    if (row) this.deps.publish({ type: "seen" });
    return row;
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
    try {
      await this.deps.notify({
        title: row.title,
        body: `${earlier ? "Update · " : ""}${row.author}${row.body ? ` · ${lede(row.body, 300)}` : ""}`,
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
