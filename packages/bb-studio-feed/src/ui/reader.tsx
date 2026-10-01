// The Feed page: every post, newest first, a story once by its newest post.
// Read it like Hacker News: a title and a line of who, where and when;
// click to read the post and the story's earlier updates. A post's own page
// (feed/<id>) is where notifications and reply cards open.
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, GHOST_BUTTON, ICON_BUTTON, PageColumn, PILL, cn } from "@bb-studio/kit/app";
import { errorMessage, relativeTime } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { Markdown, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { rpcContract } from "../contract";
import { FEED_ICON, PANEL_PATH, REALTIME_CHANNEL } from "../shared";
import { feedEvent, from, useDiscuss, useMinuteTick, type PostView } from "./feed";

const PAGE = 30;

export function FeedPanel({ subPath }: { subPath: string }) {
  const id = decodeURIComponent(subPath.split("/")[0] ?? "");
  return id ? <PostPage postId={id} /> : <FeedList />;
}

function FeedList() {
  const rpc = useRpc<typeof rpcContract>();
  useMinuteTick();
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [topics, setTopics] = useState<{ topic: string; posts: number }[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** The read mark when you opened the page: posts after it are new, until you leave. */
  const baseline = useRef<number | null>(null);
  const loaded = useRef(PAGE);

  const load = useCallback(() => {
    rpc.call("list", { topic, limit: loaded.current }).then(
      (result) => {
        baseline.current ??= result.lastSeenAt;
        setPosts(result.posts);
        setNextCursor(result.nextCursor);
        setError(null);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
    rpc.call("topics", {}).then((result) => setTopics(result.topics), () => undefined);
  }, [rpc, topic]);
  useEffect(load, [load]);
  // Reading the page reads the feed.
  useEffect(() => {
    if (posts) void rpc.call("seen", {}).catch(() => undefined);
  }, [rpc, posts]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = feedEvent(payload);
    if (event && event.type !== "seen") load();
  });

  const more = () => {
    if (!nextCursor) return;
    rpc.call("list", { topic, cursor: nextCursor, limit: PAGE }).then(
      (result) => {
        loaded.current += result.posts.length;
        setPosts((current) => [...(current ?? []), ...result.posts]);
        setNextCursor(result.nextCursor);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
  };

  const seenAt = baseline.current ?? 0;
  const firstOld = posts?.findIndex((post) => post.createdAt <= seenAt) ?? -1;

  return (
    <PageColumn className="max-w-3xl">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Feed</h1>
        <nav className="-ml-3 flex flex-wrap items-center gap-0.5" aria-label="Topics">
          <button type="button" className={PILL} aria-pressed={topic === null} onClick={() => setTopic(null)}>
            All
          </button>
          {topics.map((each) => (
            <button key={each.topic} type="button" className={PILL} aria-pressed={topic?.toLowerCase() === each.topic.toLowerCase()} onClick={() => setTopic(each.topic)}>
              {each.topic}
            </button>
          ))}
        </nav>
      </header>
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      {posts === null ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-12 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState icon={FEED_ICON} title={topic ? `Nothing in ${topic} yet` : "Nothing posted yet"}>
          Agents post here when a task or automation asks them to: they end the reply with a <code>::post</code> line. Ask one to “post that to the feed”.
        </EmptyState>
      ) : (
        <ol className="divide-y divide-border/60">
          {posts.map((post, index) => (
            <li key={post.id}>
              {index === firstOld && index > 0 ? <NewDivider /> : null}
              <FeedRow post={post} unread={post.createdAt > seenAt && seenAt > 0} open={open === post.id} onToggle={() => setOpen((current) => (current === post.id ? null : post.id))} />
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? (
        <button type="button" className={cn(GHOST_BUTTON, "mx-auto mt-4")} onClick={more}>
          More
        </button>
      ) : null}
    </PageColumn>
  );
}

function NewDivider() {
  return (
    <div className="flex items-center gap-3 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      <span className="h-px flex-1 bg-border" /> Earlier <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Who, where, when, and how many updates. */
function Meta({ post, className }: { post: PostView; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground", className)}>
      {post.priority === "urgent" && !post.resolvedAt ? <Badge label="Urgent" tone="danger" /> : null}
      {post.resolvedAt ? <Badge label="Resolved" tone="success" /> : null}
      <span className="text-foreground/80">{from(post)}</span>
      {post.topic ? <span>· {post.topic}</span> : null}
      <span>· {relativeTime(post.createdAt)}</span>
      {post.storyPosts > 1 ? <span>· {post.storyPosts - 1} earlier update{post.storyPosts === 2 ? "" : "s"}</span> : null}
      {post.domains.length ? <span className="truncate">· {post.domains.join(", ")}</span> : null}
    </div>
  );
}

function FeedRow({ post, unread, open, onToggle }: { post: PostView; unread: boolean; open: boolean; onToggle(): void }) {
  return (
    <article className={cn("py-3", post.resolvedAt && !open && "opacity-60")}>
      <button type="button" className="group flex w-full items-start gap-3 text-left" aria-expanded={open} onClick={onToggle}>
        <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", unread ? "bg-blue-500" : "bg-transparent")} aria-label={unread ? "New" : undefined} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] leading-snug font-medium group-hover:underline">{post.title}</h2>
          <Meta post={post} className="mt-1" />
          {!open && post.preview ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.preview}</p> : null}
        </div>
      </button>
      {open ? (
        <div className="mt-3 pl-4.5">
          <PostBody post={post} />
        </div>
      ) : null}
    </article>
  );
}

/** A post's body, its story's earlier updates, and what you can do with it. */
function PostBody({ post }: { post: PostView }) {
  const rpc = useRpc<typeof rpcContract>();
  const [earlier, setEarlier] = useState<PostView[]>([]);
  const load = useCallback(() => {
    if (!post.story || post.storyPosts < 2) return setEarlier([]);
    rpc.call("story", { story: post.story }).then(
      (result) => setEarlier(result.posts.filter((each) => each.id !== post.id).reverse()),
      () => undefined,
    );
  }, [rpc, post.id, post.story, post.storyPosts]);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      {post.body ? <Markdown content={post.body} className="text-sm" /> : null}
      <Actions post={post} />
      {earlier.length ? (
        <section>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Earlier in this story</h3>
          <ol className="space-y-3 border-l border-border pl-4">
            {earlier.map((each) => (
              <li key={each.id}>
                <details>
                  <summary className="cursor-pointer list-none text-sm">
                    <span className="font-medium">{each.title}</span> <span className="text-xs text-muted-foreground">· {relativeTime(each.createdAt)}</span>
                  </summary>
                  {each.body ? <Markdown content={each.body} className="mt-2 text-sm" /> : null}
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Actions({ post }: { post: PostView }) {
  const rpc = useRpc<typeof rpcContract>();
  const discuss = useDiscuss();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    work().finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn(GHOST_BUTTON, "-ml-3")}>
            <Icon name="MessageSquare" /> Discuss
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {post.threadId ? (
            <DropdownMenuItem onSelect={() => discuss.openSource(post)}>
              <Icon name="ArrowUpRight" className="size-4" /> {post.channelName ? `Open #${post.channelName}` : `Open ${post.author}`}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => discuss.newThread(post)}>
            <Icon name="Plus" className="size-4" /> New thread about this
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => run(() => rpc.call("edit", { postId: post.id, resolved: !post.resolvedAt }))}>
        <Icon name={post.resolvedAt ? "RotateCcw" : "Check"} /> {post.resolvedAt ? "Reopen" : "Resolve"}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More" className={ICON_BUTTON}>
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onSelect={() => discuss.openPost(post)}>
            <Icon name="Maximize2" className="size-4" /> Open post
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              run(async () => {
                await rpc.call("remove", { postId: post.id });
                navigate.toPluginPanel(PANEL_PATH, { replace: true });
              })
            }
          >
            <Icon name="Trash2" className="size-4" /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PostPage({ postId }: { postId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  useMinuteTick();
  const [post, setPost] = useState<PostView | null | undefined>(undefined);
  const load = useCallback(() => {
    rpc.call("post", { postId }).then(
      (result) => setPost(result.post),
      () => setPost(null),
    );
  }, [rpc, postId]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = feedEvent(payload);
    if (event && event.type !== "seen") load();
  });

  return (
    <PageColumn className="max-w-3xl">
      <button type="button" className={cn(GHOST_BUTTON, "-ml-3 mb-4")} onClick={() => navigate.toPluginPanel(PANEL_PATH)}>
        <Icon name="ArrowLeft" /> Feed
      </button>
      {post === undefined ? (
        <div className="h-24 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
      ) : post === null ? (
        <EmptyState icon={FEED_ICON} title="This post was removed" />
      ) : (
        <article>
          <h1 className="text-2xl leading-tight font-semibold">{post.title}</h1>
          <Meta post={post} className="mt-2 mb-5" />
          <PostBody post={post} />
        </article>
      )}
    </PageColumn>
  );
}

/** New stories since you last read the feed, next to Feed in the sidebar. */
export function UnreadCount() {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    rpc.call("unread", {}).then((result) => setCount(result.count), () => undefined);
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (feedEvent(payload)) load();
  });
  return count ? <span className="text-xs text-muted-foreground tabular-nums">{count > 99 ? "99+" : count}</span> : null;
}
