// Studio Feed's server: replies that end in `::post{…}` are published to the
// feed, from any thread, Teams channel or automation.
//
//   - FeedService (service.ts) publishes, dedupes and notifies; this file
//     gives it BB: who a thread is (its bot and channel, from Studio Teams
//     when it's installed), realtime, and phone notifications (Studio Mobile).
//   - It adds the RPC handlers, the feed_* tools, the instructions for
//     `bb.agents.configure`, and `bb feed …`.
import { parseFlags, subcommand } from "@bb-studio/kit/cli";
import { relativeTime } from "@bb-studio/kit/format";
import type { BbPluginApi, JsonValue, PluginCliContext, PluginCliResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PostView } from "./contract";
import { feedInstructions } from "./prompt";
import { FeedService, type NotifyMode, type Origin } from "./service";
import { MAX_BODY, MAX_STORY, MAX_TITLE, MAX_TOPIC, PRIORITIES, REALTIME_CHANNEL, firstLink, parseAttributes, postDirective, postHref, priority, storyKey, type RealtimeEvent } from "./shared";
import { FeedStore, MIGRATIONS, type PostRow } from "./store";
import { fetchPreview } from "./unfurl";

export const FEED_TOOLS = ["feed_list", "feed_read", "feed_edit"];

const TEAMS_PLUGIN_ID = "bot-teams";
const MOBILE_PLUGIN_ID = "mobile";
const CHANNEL_PROVIDER_ID = "bot-teams-channel";
/** How long Teams' bots and channels are trusted before asking again. */
const TEAMS_CACHE_MS = 30_000;
const RPC_TIMEOUT_MS = 10_000;

const USAGE = {
  list: "bb feed list [--topic <topic>] [--limit <n>] [--all]",
  show: "bb feed show <post id | story>",
  post: 'bb feed post --title "<title>" [--body "<markdown>"] [--topic <topic>] [--story <story>] [--urgent] [--author <name>]',
  edit: "bb feed edit <post id> [--title <title>] [--body <markdown>] [--topic <topic>] [--resolve | --reopen]",
  remove: "bb feed remove <post id>",
};
export const FEED_USAGE = "bb feed <list|show|post|edit|remove> …";

const teamsList = z.object({
  bots: z.array(z.object({ id: z.string(), name: z.string(), avatar: z.string().optional() })),
  rooms: z.array(z.object({ id: z.string(), name: z.string() })),
});
const threadBots = z.array(z.object({ threadId: z.string(), botId: z.string() }));

export function registerFeed(bb: BbPluginApi, options: { notifyMode: () => NotifyMode }) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new FeedStore(db);

  const callRpc = <T>(pluginId: string, method: string, input: JsonValue, outputSchema: z.ZodType<T>) =>
    bb.sdk.plugins.callRpc({ pluginId, method, input, outputSchema, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });

  // Studio Teams, when installed: which bot a thread belongs to, and names.
  let teams: {
    at: number;
    value: Promise<{ bots: Map<string, string>; avatars: Map<string, string>; rooms: Map<string, string>; threads: Map<string, string> } | null>;
  } | null = null;
  function teamsDirectory() {
    if (teams && Date.now() - teams.at < TEAMS_CACHE_MS) return teams.value;
    const value = Promise.all([callRpc(TEAMS_PLUGIN_ID, "list", null, teamsList), callRpc(TEAMS_PLUGIN_ID, "threadBots", {}, threadBots)])
      .then(([list, links]) => ({
        bots: new Map(list.bots.map((bot) => [bot.id, bot.name])),
        avatars: new Map(list.bots.flatMap((bot) => (bot.avatar ? [[bot.id, bot.avatar] as const] : []))),
        rooms: new Map(list.rooms.map((room) => [room.id, room.name])),
        threads: new Map(links.map((link) => [link.threadId, link.botId])),
      }))
      .catch(() => null);
    teams = { at: Date.now(), value };
    return value;
  }

  async function origin(threadId: string): Promise<Origin | null> {
    const thread = await bb.sdk.threads.get({ threadId });
    const directory = await teamsDirectory();
    const botId = directory?.threads.get(threadId) ?? null;
    const isChannel = thread.providerId === CHANNEL_PROVIDER_ID;
    const channelId =
      directory && (botId || isChannel) ? await callRpc(TEAMS_PLUGIN_ID, "channelForThread", { threadId }, z.string().nullable()).catch(() => null) : null;
    const channelName = channelId ? (directory?.rooms.get(channelId) ?? null) : null;
    const title = thread.title?.trim() || thread.titleFallback?.trim() || null;
    return {
      author: (botId && directory?.bots.get(botId)) || (isChannel && channelName) || title || "Agent",
      botId,
      threadId,
      projectId: thread.projectId ?? null,
      channelId,
      channelName,
      channelThread: isChannel,
    };
  }

  const service = new FeedService({
    store,
    origin,
    publish: (event: RealtimeEvent) => bb.realtime.publish(REALTIME_CHANNEL, event),
    notify: async (notification) => {
      if (!notification.projectId) return;
      await callRpc(
        MOBILE_PLUGIN_ID,
        "notify",
        { ...notification, projectId: notification.projectId, kind: "turn-finished" },
        z.object({ ok: z.literal(true), sent: z.number() }),
      );
    },
    notifyMode: options.notifyMode,
    log: bb.log,
  });

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    try {
      await service.ingest(thread.id, lastAssistantText);
    } catch (error) {
      bb.log.warn(`Could not publish a post from ${thread.id}: ${String(error)}`);
    }
  });

  const mustGet = (id: string): PostRow => {
    const row = store.get(id);
    if (!row) throw new Error(`Post ${id} not found.`);
    return row;
  };
  // The page a post links to first: its title and picture make the post's
  // link card, and the picture stands in for a post without one. A lookup runs
  // once per link; the reader reloads when it lands.
  const looking = new Set<string>();
  function link(row: PostRow): PostView["link"] {
    const url = firstLink(row.body);
    if (!url) return null;
    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
    const cached = store.linkPreview(url);
    if (cached) return { url, domain, ...cached };
    if (!looking.has(url)) {
      looking.add(url);
      fetchPreview(url)
        .catch(() => ({ title: "", description: "", image: "" }))
        .then((preview) => {
          store.setLinkPreview(url, preview);
          if (preview.title || preview.image) bb.realtime.publish(REALTIME_CHANNEL, { type: "post", postId: row.id, story: row.story } satisfies RealtimeEvent);
        })
        .finally(() => looking.delete(url));
    }
    return { url, domain, title: "", description: "", image: "" };
  }

  // Thread titles, for "open the thread it came from".
  const titles = new Map<string, { at: number; title: Promise<string | null> }>();
  function threadTitle(threadId: string): Promise<string | null> {
    const cached = titles.get(threadId);
    if (cached && Date.now() - cached.at < TEAMS_CACHE_MS) return cached.title;
    const title = bb.sdk.threads
      .get({ threadId })
      .then((thread) => thread.title?.trim() || thread.titleFallback?.trim() || null)
      .catch(() => null);
    titles.set(threadId, { at: Date.now(), title });
    return title;
  }

  /** Posts for the reader: with a picture, link card, the bot's avatar and the thread's title. */
  async function views(rows: PostRow[]): Promise<PostView[]> {
    const directory = rows.some((row) => row.bot_id) ? await teamsDirectory() : null;
    return Promise.all(
      rows.map(async (row) => {
        const post = service.view(row);
        const linked = link(row);
        return {
          ...post,
          image: post.image ?? (linked?.image || null),
          link: linked,
          avatar: (row.bot_id && directory?.avatars.get(row.bot_id)) || null,
          threadTitle: post.threadTitle ?? (row.thread_id ? await threadTitle(row.thread_id) : null),
        };
      }),
    );
  }
  const one = async (row: PostRow | null) => (row ? ((await views([row]))[0] ?? null) : null);

  // RPC ------------------------------------------------------------------------

  const rpc = {
    list: async ({ cursor, limit, topic, query, unread, since, until }: { cursor?: string; limit?: number; topic?: string | null; query?: string; unread?: boolean; since?: number; until?: number }) => {
      const page = store.list({ cursor, limit: limit ?? 30, topic, query, unread, since, until });
      return { posts: await views(page.rows), nextCursor: page.nextCursor, lastSeenAt: store.lastSeenAt() };
    },
    post: async ({ postId }: { postId: string }) => ({ post: await one(store.get(postId)) }),
    story: async ({ story }: { story: string }) => ({ posts: await views(store.story(story)) }),
    forDirective: async ({ source }: { source: string }) => {
      const title = postDirective(parseAttributes(source))?.title;
      return { post: await one(store.byDirective(source) ?? (title ? store.byTitle(title) : null)) };
    },
    topics: () => ({ topics: store.topics() }),
    edit: async ({ postId, resolved, ...patch }: { postId: string; title?: string; body?: string; topic?: string | null; priority?: (typeof PRIORITIES)[number]; resolved?: boolean }) => {
      const row = service.edit(postId, { ...patch, ...(patch.topic === "" ? { topic: null } : {}), resolved }, "you");
      return { post: await one(row) };
    },
    read: async ({ postId, read }: { postId: string; read: boolean }) => ({ post: await one(service.markRead(postId, read)) }),
    remove: ({ postId }: { postId: string }) => ({ removed: service.remove(postId) }),
    seen: ({ at }: { at?: number }) => ({ lastSeenAt: service.seen(at) }),
    unread: () => {
      const lastSeenAt = store.lastSeenAt();
      return { count: store.unreadCount(), lastSeenAt };
    },
  };

  // Agents ---------------------------------------------------------------------

  const from = (post: PostView) => (post.channelName ? `${post.author} in #${post.channelName}` : post.author);
  const summary = (post: PostView) =>
    [
      `- ${post.title} (id ${post.id}${post.story ? `, story ${post.story}, ${post.storyPosts} post${post.storyPosts === 1 ? "" : "s"}` : ""})`,
      `  ${[from(post), post.topic, relativeTime(post.createdAt), post.priority === "urgent" ? "urgent" : null, post.resolvedAt ? "resolved" : null].filter(Boolean).join(" · ")}`,
      post.preview ? `  ${post.preview}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  const full = (post: PostView) =>
    [
      `# ${post.title}`,
      `id ${post.id} · ${from(post)}${post.topic ? ` · ${post.topic}` : ""} · ${new Date(post.createdAt).toISOString()}${post.priority !== "normal" ? ` · ${post.priority}` : ""}${post.resolvedAt ? " · resolved" : ""}`,
      post.threadId ? `Thread: ${post.threadId}` : "",
      "",
      post.body || "(no body)",
    ]
      .filter((line, index) => line !== "" || index === 3)
      .join("\n");

  bb.agents.registerTool({
    name: "feed_list",
    description:
      "List Studio Feed posts, newest first (a story once, by its newest post). Use it to see what agents have reported, or before posting an update to a story.",
    presentation: { label: { pending: "Reading the feed", completed: "Read the feed" } },
    parameters: z.object({
      topic: z.string().max(MAX_TOPIC).optional(),
      query: z.string().max(200).optional().describe("Words in the title, body or author."),
      sinceHours: z.number().min(0).max(24 * 90).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    async execute({ topic, query, sinceHours, limit }) {
      const since = sinceHours === undefined ? undefined : Date.now() - sinceHours * 3_600_000;
      const { rows } = store.list({ topic, query, since, limit: limit ?? 20 });
      return rows.length ? rows.map((row) => summary(service.view(row))).join("\n") : "No posts.";
    },
  });

  bb.agents.registerTool({
    name: "feed_read",
    description: "Read a Studio Feed post in full by id, or every post in a story, oldest first, by its story key.",
    presentation: { label: { pending: "Reading a post", completed: "Read a post" } },
    parameters: z.object({ id: z.string().max(100).optional(), story: z.string().max(MAX_STORY).optional() }),
    async execute({ id, story }) {
      if (id) {
        const row = store.get(id);
        return row ? full(service.view(row)) : { content: [{ type: "text", text: `Post ${id} not found.` }], isError: true };
      }
      const key = storyKey(story);
      const rows = key ? store.story(key) : [];
      if (!rows.length) return { content: [{ type: "text", text: story ? `No story "${story}".` : "Give an id or a story." }], isError: true };
      return rows.map((row) => full(service.view(row))).join("\n\n---\n\n");
    },
  });

  bb.agents.registerTool({
    name: "feed_edit",
    description:
      "Edit a Studio Feed post: correct its title, body, topic or priority, or mark it resolved. With resolveStory, resolves (or reopens) every post in its story.",
    presentation: { label: { pending: "Editing a post", completed: "Edited a post" } },
    parameters: z.object({
      id: z.string().min(1).max(100),
      title: z.string().trim().min(1).max(MAX_TITLE).optional(),
      body: z.string().max(MAX_BODY).optional().describe("Markdown; replaces the whole body."),
      topic: z.string().trim().max(MAX_TOPIC).optional().describe("Empty to clear."),
      priority: z.enum(PRIORITIES).optional(),
      resolved: z.boolean().optional(),
      resolveStory: z.boolean().optional(),
    }),
    async execute({ id, title, body, topic, priority: level, resolved, resolveStory }, context) {
      const row = store.get(id);
      if (!row) return { content: [{ type: "text", text: `Post ${id} not found.` }], isError: true };
      const editedBy = context.threadId;
      const edited = service.edit(id, { title, body, topic: topic === undefined ? undefined : topic || null, priority: level, resolved: resolveStory ? undefined : resolved }, editedBy);
      if (resolveStory && row.story && resolved !== undefined) {
        store.resolveStory(row.story, resolved, editedBy);
        bb.realtime.publish(REALTIME_CHANNEL, { type: "post", postId: id, story: row.story } satisfies RealtimeEvent);
      }
      return `Edited: ${summary(service.view(store.get(id) ?? edited ?? row))}`;
    },
  });

  const instructions = feedInstructions();

  // CLI: `bb feed …` ---------------------------------------------------------------

  const line = (post: PostView) =>
    [post.id, relativeTime(post.createdAt), post.priority === "urgent" ? "urgent" : "", post.topic ?? "", from(post), post.title, post.story ? `${post.story} (${post.storyPosts})` : ""].join("\t");

  async function cli(argv: string[], ctx: PluginCliContext): Promise<PluginCliResult> {
    const { command, rest } = subcommand(argv);
    const flags = parseFlags(rest, ["all", "urgent", "resolve", "reopen"]);
    const { positional } = flags;
    const fail = (message: string): PluginCliResult => ({ exitCode: 1, stderr: `${message}\n` });
    switch (command) {
      case "list": {
        const limit = Number(flags.values.limit ?? 30);
        const { rows } = store.list({ topic: flags.values.topic, limit: Number.isFinite(limit) ? limit : 30, stories: flags.values.all === undefined });
        return { exitCode: 0, stdout: rows.length ? `${rows.map((row) => line(service.view(row))).join("\n")}\n` : "No posts.\n" };
      }
      case "show": {
        const target = positional[0] ?? "";
        const row = store.get(target);
        if (row) return { exitCode: 0, stdout: `${full(service.view(row))}\n\n${postHref(row.id)}\n` };
        const key = storyKey(target);
        const rows = key ? store.story(key) : [];
        if (!rows.length) return fail(`usage: ${USAGE.show}`);
        return { exitCode: 0, stdout: `${rows.map((post) => full(service.view(post))).join("\n\n---\n\n")}\n` };
      }
      case "post": {
        const title = flags.values.title?.trim().slice(0, MAX_TITLE);
        if (!title) return fail(`usage: ${USAGE.post}`);
        const threadOrigin = ctx.threadId ? await origin(ctx.threadId).catch(() => null) : null;
        // --author names who it's from, even when run inside a thread.
        const author = flags.values.author?.trim().slice(0, 80);
        const row = await service.create({
          title,
          body: (flags.values.body ?? "").replace(/\\n/g, "\n").slice(0, MAX_BODY),
          topic: flags.values.topic?.trim().slice(0, MAX_TOPIC) || null,
          story: storyKey(flags.values.story),
          priority: flags.values.urgent !== undefined ? "urgent" : priority(flags.values.priority),
          origin: threadOrigin
            ? { ...threadOrigin, author: author || threadOrigin.author }
            : { author: author || "CLI", botId: null, threadId: ctx.threadId ?? "", projectId: ctx.projectId ?? null, channelId: null, channelName: null },
        });
        return { exitCode: 0, stdout: `${line(service.view(row))}\n` };
      }
      case "edit": {
        const id = positional[0] ?? "";
        if (!store.get(id)) return fail(`usage: ${USAGE.edit}`);
        const row = service.edit(
          id,
          {
            title: flags.values.title?.trim() || undefined,
            body: flags.values.body?.replace(/\\n/g, "\n"),
            topic: flags.values.topic === undefined ? undefined : flags.values.topic.trim() || null,
            resolved: flags.values.resolve !== undefined ? true : flags.values.reopen !== undefined ? false : undefined,
          },
          ctx.threadId ?? "you",
        );
        return { exitCode: 0, stdout: `${line(service.view(row ?? mustGet(id)))}\n` };
      }
      case "remove": {
        const id = positional[0] ?? "";
        return service.remove(id) ? { exitCode: 0, stdout: `Removed ${id}.\n` } : fail(`usage: ${USAGE.remove}`);
      }
      default:
        return fail(`usage: ${FEED_USAGE}\n${Object.values(USAGE).map((usage) => `  ${usage}`).join("\n")}`);
    }
  }

  return {
    service,
    rpc,
    cli,
    /** What `bb.agents.configure` gives a thread: the tools, and the instructions when the setting is on. */
    configure: (enabled: boolean) => ({ tools: FEED_TOOLS, skills: [], ...(enabled ? { instructions } : {}) }),
  };
}
