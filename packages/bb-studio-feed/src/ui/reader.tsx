// The Feed page, read like a news front page: today's top stories as cards,
// then everything else by day, one row per story, with a rail of what needs
// you and the stories still developing. A post opens on its own page
// (feed/<id>), which is also where notifications and reply cards go.
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, GHOST_BUTTON, ICON_BUTTON, PageColumn, cn } from "@bb-studio/kit/app";
import { errorMessage, relativeTime, shortDateTime } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { Markdown, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { rpcContract } from "../contract";
import { FEED_ICON, PANEL_PATH, REALTIME_CHANNEL } from "../shared";
import { feedEvent, from, useDiscuss, useMinuteTick, type PostView } from "./feed";

const PAGE = 30;
/** Cards at the top of the unfiltered feed, when there's enough to fill them. */
const TOP_STORIES = 4;

export function FeedPanel({ subPath }: { subPath: string }) {
  const id = decodeURIComponent(subPath.split("/")[0] ?? "");
  return id ? <PostPage postId={id} /> : <FeedFront />;
}

const urgent = (post: PostView) => post.priority === "urgent" && !post.resolvedAt;

const dayKey = (at: number) => new Date(at).toDateString();

/** "Today", "Yesterday", "Monday", or "Sep 24". */
function dayLabel(at: number, now = Date.now()): string {
  const day = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(day).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(day);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: day.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(day);
}

function FeedFront() {
  const rpc = useRpc<typeof rpcContract>();
  useMinuteTick();
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [topics, setTopics] = useState<{ topic: string; posts: number }[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const isNew = (post: PostView) => seenAt > 0 && post.createdAt > seenAt;
  // Top stories: what needs you, then the newest. Only on the whole feed, and
  // only when there's a front page's worth.
  const ordered = posts ? [...posts.filter(urgent), ...posts.filter((post) => !urgent(post))] : [];
  const top = !topic && ordered.length > TOP_STORIES + 2 ? ordered.slice(0, TOP_STORIES) : [];
  const rest = (posts ?? []).filter((post) => !top.includes(post));
  const days: { key: string; at: number; posts: PostView[] }[] = [];
  for (const post of rest) {
    const key = dayKey(post.createdAt);
    const last = days.at(-1);
    if (last?.key === key) last.posts.push(post);
    else days.push({ key, at: post.createdAt, posts: [post] });
  }
  const attention = (posts ?? []).filter(urgent);
  const developing = (posts ?? []).filter((post) => post.storyPosts > 1 && !post.resolvedAt).slice(0, 5);
  const rail = posts?.length ? attention.length > 0 || developing.length > 0 : false;

  return (
    <PageColumn className="max-w-6xl">
      <header className="mb-6">
        <h1 className="text-[28px] leading-tight font-bold">
          Feed{" "}
          <span className="text-muted-foreground">{new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date())}</span>
        </h1>
        {topics.length ? (
          <nav className="mt-4 flex gap-5 overflow-x-auto border-b border-border/70 [scrollbar-width:none]" aria-label="Topics">
            <TopicTab active={topic === null} onClick={() => setTopic(null)}>
              All
            </TopicTab>
            {topics.map((each) => (
              <TopicTab key={each.topic} active={topic?.toLowerCase() === each.topic.toLowerCase()} onClick={() => setTopic(each.topic)}>
                {each.topic}
              </TopicTab>
            ))}
          </nav>
        ) : null}
      </header>
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
      {posts === null ? (
        <div className="grid gap-4 @3xl/page:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-56 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState icon={FEED_ICON} title={topic ? `Nothing in ${topic} yet` : "Nothing posted yet"}>
          Agents post here when a task or automation asks them to: they end the reply with a <code>::post</code> line. Ask one to “post that to the feed”.
        </EmptyState>
      ) : (
        <div className={cn("grid items-start gap-x-10 gap-y-8", rail && "@5xl/page:grid-cols-[minmax(0,1fr)_17rem]")}>
          <main className="min-w-0">
            {top.length ? (
              <section aria-labelledby="feed-top" className="mb-10">
                <h2 id="feed-top" className="mb-3 text-xl font-bold">
                  Top stories
                </h2>
                <Lead post={top[0]!} unread={isNew(top[0]!)} />
                <div className="mt-4 grid gap-4 @2xl/page:grid-cols-3">
                  {top.slice(1).map((post) => (
                    <StoryCard key={post.id} post={post} unread={isNew(post)} />
                  ))}
                </div>
              </section>
            ) : null}
            {days.map((day) => (
              <section key={day.key} aria-label={dayLabel(day.at)} className="mb-8">
                <h2 className="mb-1 text-xl font-bold">{dayLabel(day.at)}</h2>
                <ol className="divide-y divide-border/60">
                  {day.posts.map((post) => (
                    <li key={post.id}>
                      <StoryRow post={post} unread={isNew(post)} showTopic={!topic} />
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            {nextCursor ? (
              <button type="button" className={cn(GHOST_BUTTON, "mx-auto")} onClick={more}>
                Older posts
              </button>
            ) : null}
          </main>
          {rail ? (
            <aside className="space-y-4 @5xl/page:sticky @5xl/page:top-0">
              {attention.length ? (
                <RailBox title="Needs you" tone="danger">
                  {attention.map((post) => (
                    <RailItem key={post.id} post={post} detail={`${post.author} · ${relativeTime(post.createdAt)}`} />
                  ))}
                </RailBox>
              ) : null}
              {developing.length ? (
                <RailBox title="Developing">
                  {developing.map((post) => (
                    <RailItem key={post.id} post={post} detail={`${post.storyPosts} updates · ${relativeTime(post.createdAt)}`} />
                  ))}
                </RailBox>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
    </PageColumn>
  );
}

function TopicTab({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="-mb-px shrink-0 border-b-2 border-transparent pb-2.5 text-sm text-muted-foreground hover:text-foreground aria-pressed:border-foreground aria-pressed:font-medium aria-pressed:text-foreground"
    >
      {children}
    </button>
  );
}

/** A bot's emoji, or the first letter of who posted. */
function Avatar({ post, className }: { post: Pick<PostView, "avatar" | "author">; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-[11px] leading-none font-semibold text-muted-foreground", className)}>
      {post.avatar || post.author.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The post's picture; gone if it doesn't load. */
function Picture({ post, className }: { post: PostView; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!post.image || failed) return null;
  return <img src={post.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn("bg-muted object-cover", className)} />;
}

/** Who posted it, as a news source: avatar and name. */
function Source({ post, unread }: { post: PostView; unread?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold" title={from(post)}>
      <Avatar post={post} />
      <span className="truncate">{post.author}</span>
      {unread ? <span className="size-1.5 shrink-0 rounded-full bg-blue-500" aria-label="New" /> : null}
    </span>
  );
}

/** Topic and state, above a row's title; the topic is left out when it's just the author's name again. */
function Kicker({ post, showTopic, unread }: { post: PostView; showTopic: boolean; unread: boolean }) {
  const topic = showTopic && post.topic && post.topic.toLowerCase() !== post.author.toLowerCase() ? post.topic : null;
  if (!topic && !urgent(post) && !post.resolvedAt && !unread) return null;
  return (
    <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
      {unread ? <span className="size-1.5 shrink-0 rounded-full bg-blue-500" aria-label="New" /> : null}
      {urgent(post) ? <Badge label="Urgent" tone="danger" /> : null}
      {post.resolvedAt ? <Badge label="Resolved" tone="success" /> : null}
      {topic ? <span>{topic}</span> : null}
    </div>
  );
}

function Lead({ post, unread }: { post: PostView; unread: boolean }) {
  const discuss = useDiscuss();
  return (
    <article className={cn("group relative grid gap-5", post.image && "@2xl/page:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
      <Picture post={post} className="aspect-[16/10] w-full rounded-lg" />
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <Source post={post} unread={unread} />
          {urgent(post) ? <Badge label="Urgent" tone="danger" /> : null}
        </div>
        <h3 className="mt-2 text-2xl leading-tight font-bold text-balance">
          <button type="button" className="text-left after:absolute after:inset-0 group-hover:underline" onClick={() => discuss.openPost(post)}>
            {post.title}
          </button>
        </h3>
        {post.preview ? <p className={cn("mt-2 text-[15px] leading-relaxed text-muted-foreground", post.image ? "line-clamp-4" : "line-clamp-3")}>{post.preview}</p> : null}
        <Footer post={post} className="mt-auto pt-3" />
      </div>
    </article>
  );
}

function StoryCard({ post, unread }: { post: PostView; unread: boolean }) {
  const discuss = useDiscuss();
  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.06]">
      <Picture post={post} className="aspect-video w-full" />
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-center gap-2">
          <Source post={post} unread={unread} />
          {urgent(post) ? <Badge label="Urgent" tone="danger" /> : null}
        </div>
        <h3 className="mt-1.5 line-clamp-3 text-[15px] leading-snug font-semibold">
          <button type="button" className="text-left after:absolute after:inset-0" onClick={() => discuss.openPost(post)}>
            {post.title}
          </button>
        </h3>
        {!post.image && post.preview ? <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">{post.preview}</p> : null}
        <Footer post={post} className="mt-auto pt-3" />
      </div>
    </article>
  );
}

function StoryRow({ post, unread, showTopic }: { post: PostView; unread: boolean; showTopic: boolean }) {
  const discuss = useDiscuss();
  return (
    <article className={cn("group relative flex gap-5 py-4", post.resolvedAt && "opacity-60 hover:opacity-100")}>
      <div className="min-w-0 flex-1">
        <Kicker post={post} showTopic={showTopic} unread={unread} />
        <h3 className="text-base leading-snug font-semibold">
          <button type="button" className="text-left after:absolute after:inset-0 group-hover:underline" onClick={() => discuss.openPost(post)}>
            {post.title}
          </button>
        </h3>
        {post.preview ? <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{post.preview}</p> : null}
        <Footer post={post} className="mt-2" withSource />
      </div>
      <Picture post={post} className="mt-1 h-20 w-32 shrink-0 rounded-md @max-xl/page:h-16 @max-xl/page:w-20" />
    </article>
  );
}

/** Source, time and the rest, with the post's menu at the end. */
function Footer({ post, className, withSource }: { post: PostView; className?: string; withSource?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}>
      {withSource ? (
        <>
          <Source post={post} />
          <span aria-hidden>·</span>
        </>
      ) : null}
      <time dateTime={new Date(post.createdAt).toISOString()} title={shortDateTime(post.createdAt)} className="shrink-0">
        {relativeTime(post.createdAt)}
      </time>
      {post.storyPosts > 1 ? <span className="shrink-0">· {post.storyPosts} updates</span> : null}
      {post.domains[0] ? <span className="truncate">· {post.domains[0]}</span> : null}
      <PostMenu post={post} className="relative z-10 ml-auto opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100" />
    </div>
  );
}

/** Discuss, resolve or remove a post without opening it. */
function PostMenu({ post, className }: { post: PostView; className?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const discuss = useDiscuss();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`More for ${post.title}`} className={cn("flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground", className)}>
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {post.threadId ? (
          <DropdownMenuItem onSelect={() => discuss.openSource(post)}>
            <Icon name="ArrowUpRight" className="size-4" /> {post.channelName ? `Open #${post.channelName}` : `Open ${post.author}`}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => discuss.newThread(post)}>
          <Icon name="MessageSquare" className="size-4" /> Discuss in a new thread
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void rpc.call("edit", { postId: post.id, resolved: !post.resolvedAt })}>
          <Icon name={post.resolvedAt ? "RotateCcw" : "Check"} className="size-4" /> {post.resolvedAt ? "Reopen" : "Resolve"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void rpc.call("remove", { postId: post.id })}>
          <Icon name="Trash2" className="size-4" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RailBox({ title, tone, children }: { title: string; tone?: "danger"; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-foreground/[0.04] p-4">
      <h2 className={cn("mb-2 text-sm font-bold", tone === "danger" && "text-destructive")}>{title}</h2>
      <ol className="space-y-3">{children}</ol>
    </section>
  );
}

function RailItem({ post, detail }: { post: PostView; detail: string }) {
  const discuss = useDiscuss();
  return (
    <li>
      <button type="button" className="group flex w-full items-start gap-2.5 text-left" onClick={() => discuss.openPost(post)}>
        <Avatar post={post} className="mt-px" />
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline">{post.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
      </button>
    </li>
  );
}

// A post's page -----------------------------------------------------------------

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
      <button type="button" className={cn(GHOST_BUTTON, "-ml-3 mb-6")} onClick={() => navigate.toPluginPanel(PANEL_PATH)}>
        <Icon name="ArrowLeft" /> Feed
      </button>
      {post === undefined ? (
        <div className="h-24 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
      ) : post === null ? (
        <EmptyState icon={FEED_ICON} title="This post was removed" />
      ) : (
        <article>
          <Kicker post={post} showTopic unread={false} />
          <h1 className="text-3xl leading-tight font-bold text-balance">{post.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Avatar post={post} className="size-6 text-xs" />
            <span className="font-medium text-foreground">{from(post)}</span>
            <span aria-hidden>·</span>
            <time dateTime={new Date(post.createdAt).toISOString()}>{shortDateTime(post.createdAt)}</time>
            {post.editedBy ? <span>· edited</span> : null}
          </div>
          <Actions post={post} />
          <Picture post={post} className="mb-6 max-h-[420px] w-full rounded-lg" />
          {post.body ? <Markdown content={post.body} className="text-[15px] leading-relaxed" /> : null}
          <EarlierUpdates post={post} />
        </article>
      )}
    </PageColumn>
  );
}

/** The story's earlier posts, newest first. */
function EarlierUpdates({ post }: { post: PostView }) {
  const rpc = useRpc<typeof rpcContract>();
  const [earlier, setEarlier] = useState<PostView[]>([]);
  useEffect(() => {
    if (!post.story || post.storyPosts < 2) return setEarlier([]);
    rpc.call("story", { story: post.story }).then(
      (result) => setEarlier(result.posts.filter((each) => each.id !== post.id).reverse()),
      () => undefined,
    );
  }, [rpc, post.id, post.story, post.storyPosts]);
  if (!earlier.length) return null;
  return (
    <section className="mt-10 border-t border-border/70 pt-6">
      <h2 className="mb-4 text-lg font-bold">Earlier updates</h2>
      <ol className="space-y-5">
        {earlier.map((each) => (
          <li key={each.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4">
            <time dateTime={new Date(each.createdAt).toISOString()} className="pt-0.5 text-xs text-muted-foreground">
              {shortDateTime(each.createdAt)}
            </time>
            <details className="group">
              <summary className="cursor-pointer list-none text-[15px] leading-snug font-semibold hover:underline">{each.title}</summary>
              {each.preview ? <p className="mt-1 text-sm text-muted-foreground group-open:hidden">{each.preview}</p> : null}
              {each.body ? <Markdown content={each.body} className="mt-2 hidden text-sm group-open:block" /> : null}
            </details>
          </li>
        ))}
      </ol>
    </section>
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
    <div className="my-5 flex flex-wrap items-center gap-1 border-y border-border/70 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={GHOST_BUTTON}>
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
          <button type="button" aria-label="More" className={cn(ICON_BUTTON, "ml-auto border-transparent bg-transparent shadow-none")}>
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
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
