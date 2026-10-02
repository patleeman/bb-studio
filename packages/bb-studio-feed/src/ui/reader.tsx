// The Feed page, read like an RSS reader: one continuous stream, newest
// first, one row per story, the day in the margin. Unread is bold; read is
// dimmed. A row opens in place to the whole post, and reading it marks it
// read. Each row opens the thread it came from, marks itself read or unread,
// or starts a new thread. A rail lists what needs you and the stories still
// developing. A post's own page (feed/<id>) is where notifications and reply
// cards go.
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, GHOST_BUTTON, OUTLINE_BUTTON, PageColumn, cn, openAppPath, studioItemProps } from "@bb-studio/kit/app";
import { errorMessage, relativeTime, shortDateTime } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { Markdown, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { rpcContract } from "../contract";
import { FEED_ICON, PANEL_PATH, REALTIME_CHANNEL } from "../shared";
import { feedEvent, from, useDiscuss, useMinuteTick, type PostView } from "./feed";

const PAGE = 40;

export function FeedPanel({ subPath }: { subPath: string }) {
  const id = decodeURIComponent(subPath.split("/")[0] ?? "");
  return id ? <PostPage postId={id} /> : <FeedReader />;
}

const urgent = (post: PostView) => post.priority === "urgent" && !post.resolvedAt;
const sameStory = (a: PostView, b: PostView) => a.id === b.id || (a.story !== null && a.story === b.story);

/** "2026-10-01" in the reader's time zone. */
const dayOf = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** The margin's day: "Today", "Yesterday", "Monday" with its date, or a date. */
function dayMarker(at: number): { day: string; date: string | null } {
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(Date.now()) - midnight(at)) / 86_400_000);
  const date = new Date(at);
  const short = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
  if (days <= 0) return { day: "Today", date: short };
  if (days === 1) return { day: "Yesterday", date: short };
  if (days < 7) return { day: new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date), date: short };
  return { day: short, date: null };
}

/** Read and unread, kept in the list as you read so rows don't jump. */
function useReadState(setPosts: (update: (posts: PostView[] | null) => PostView[] | null) => void) {
  const rpc = useRpc<typeof rpcContract>();
  return useCallback(
    (post: PostView, read: boolean) => {
      setPosts((posts) => posts?.map((each) => (sameStory(each, post) ? { ...each, read } : each)) ?? null);
      void rpc.call("read", { postId: post.id, read }).catch(() => undefined);
    },
    [rpc, setPosts],
  );
}

function FeedReader() {
  const rpc = useRpc<typeof rpcContract>();
  useMinuteTick();
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [topics, setTopics] = useState<{ topic: string; posts: number }[]>([]);
  const [topic, setTopic] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(PAGE);
  const loadingMore = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    rpc.call("list", { topic, limit: loaded.current }).then(
      (result) => {
        setPosts(result.posts);
        setNextCursor(result.nextCursor);
        setError(null);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
    rpc.call("topics", {}).then((result) => setTopics(result.topics), () => undefined);
  }, [rpc, topic]);
  useEffect(load, [load]);
  // New posts and edits reload; reading ("seen") is already in the list.
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = feedEvent(payload);
    if (event && event.type !== "seen") load();
  });
  const markRead = useReadState(setPosts);

  const more = useCallback(() => {
    if (!nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    rpc
      .call("list", { topic, cursor: nextCursor, limit: PAGE })
      .then(
        (result) => {
          loaded.current += result.posts.length;
          setPosts((current) => [...(current ?? []), ...result.posts]);
          setNextCursor(result.nextCursor);
        },
        (cause: unknown) => setError(errorMessage(cause)),
      )
      .finally(() => (loadingMore.current = false));
  }, [rpc, topic, nextCursor]);
  // Older posts load as you reach the end.
  useEffect(() => {
    const target = end.current;
    if (!target || !nextCursor) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && more(), { rootMargin: "600px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, nextCursor]);

  const markAllRead = () => {
    setPosts((current) => current?.map((post) => ({ ...post, read: true })) ?? null);
    void rpc.call("seen", {}).catch(() => undefined);
  };

  const toggle = useCallback(
    (post: PostView, show?: boolean) => {
      const opening = show ?? open !== post.id;
      setOpen(opening ? post.id : null);
      if (opening && !post.read) markRead(post, true);
      if (opening) requestAnimationFrame(() => document.getElementById(`post-${post.id}`)?.scrollIntoView({ block: "nearest" }));
    },
    [open, markRead],
  );

  // j and k step through posts, opening each; m marks the open one read or unread.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || !posts?.length) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const index = posts.findIndex((post) => post.id === open);
      if (event.key === "j" || event.key === "k") {
        const next = posts[event.key === "j" ? Math.min(index + 1, posts.length - 1) : Math.max(index - 1, 0)];
        if (next) toggle(next, true);
      } else if (event.key === "m" && index >= 0) {
        markRead(posts[index]!, !posts[index]!.read);
      } else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [posts, open, toggle, markRead]);

  const days: { day: string; at: number; posts: PostView[] }[] = [];
  for (const post of posts ?? []) {
    const key = dayOf(post.createdAt);
    const last = days.at(-1);
    if (last?.day === key) last.posts.push(post);
    else days.push({ day: key, at: post.createdAt, posts: [post] });
  }
  const unread = (posts ?? []).filter((post) => !post.read).length;
  const attention = (posts ?? []).filter((post) => urgent(post) && !post.read);
  const developing = (posts ?? []).filter((post) => post.storyPosts > 1 && !post.resolvedAt).slice(0, 5);
  const rail = attention.length > 0 || developing.length > 0;

  return (
    <PageColumn className="max-w-6xl">
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="mr-auto text-[28px] leading-tight font-semibold tracking-tight">Feed</h1>
        {unread ? <span className="text-sm text-muted-foreground tabular-nums">{unread} unread</span> : null}
        <button type="button" className={OUTLINE_BUTTON} disabled={!unread} onClick={markAllRead}>
          <Icon name="CheckCheck" /> Mark all read
        </button>
      </header>
      <nav className="mb-2 flex gap-5 overflow-x-auto border-b border-border/70 [scrollbar-width:none]" aria-label="Topics">
        <TopicTab active={topic === null} onClick={() => setTopic(null)}>
          All topics
        </TopicTab>
        {topics.map((each) => (
          <TopicTab key={each.topic} active={topic?.toLowerCase() === each.topic.toLowerCase()} onClick={() => setTopic(each.topic)}>
            {each.topic}
          </TopicTab>
        ))}
      </nav>
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
      {posts === null ? (
        <div className="space-y-2 pt-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="h-16 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState icon={FEED_ICON} title={topic ? `Nothing in ${topic}` : "Nothing posted yet"}>
          {topic ? null : (
            <>
              Agents post here when a task or automation asks them to: they end the reply with a <code>::post</code> line. Ask one to “post that to the feed”.
            </>
          )}
        </EmptyState>
      ) : (
        <div className={cn("grid items-start gap-x-10 gap-y-6", rail && "@5xl/page:grid-cols-[minmax(0,1fr)_17rem]")}>
          <main className="min-w-0">
            {days.map((group) => {
              const marker = dayMarker(group.at);
              return (
                <section key={group.day} aria-label={marker.day} className="@2xl/page:grid @2xl/page:grid-cols-[6.5rem_minmax(0,1fr)]">
                  <h2 className="pt-5 pb-1 text-sm @2xl/page:sticky @2xl/page:top-0 @2xl/page:self-start @2xl/page:pt-3.5 @2xl/page:pb-0">
                    <span className="font-semibold">{marker.day}</span>
                    {marker.date ? <span className="ml-1.5 text-muted-foreground @2xl/page:ml-0 @2xl/page:block @2xl/page:text-xs">{marker.date}</span> : null}
                  </h2>
                  <ol className="min-w-0">
                    {group.posts.map((post) => (
                      <li key={post.id}>
                        <StoryRow post={post} open={open === post.id} showTopic={!topic} onToggle={() => toggle(post)} onRead={(read) => markRead(post, read)} />
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
            <div ref={end} />
            {nextCursor ? (
              <button type="button" className={cn(GHOST_BUTTON, "mx-auto mt-4 flex")} onClick={more}>
                Older posts
              </button>
            ) : null}
          </main>
          {rail ? (
            <aside className="space-y-4 pt-5 @5xl/page:sticky @5xl/page:top-0">
              {attention.length ? (
                <RailBox title="Needs you" tone="danger">
                  {attention.map((post) => (
                    <RailItem key={post.id} post={post} detail={`${post.author} · ${relativeTime(post.createdAt)}`} onOpen={() => toggle(post, true)} />
                  ))}
                </RailBox>
              ) : null}
              {developing.length ? (
                <RailBox title="Developing">
                  {developing.map((post) => (
                    <RailItem key={post.id} post={post} detail={`${post.storyPosts} updates · ${relativeTime(post.createdAt)}`} onOpen={() => toggle(post, true)} />
                  ))}
                </RailBox>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
      {posts?.length ? (
        <p className="mt-10 text-center text-xs text-muted-foreground">
          <kbd className="font-sans">j</kbd> / <kbd className="font-sans">k</kbd> next and previous · <kbd className="font-sans">m</kbd> mark read or unread
        </p>
      ) : null}
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
    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-xs leading-none font-semibold text-muted-foreground", className)}>
      {post.avatar || post.author.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** A picture; gone if it doesn't load. */
function Picture({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn("bg-muted object-cover", className)} />;
}

/** Who, what topic, when, and how many updates. The topic is left out when it's just the author's name again. */
function Meta({ post, showTopic = true, className }: { post: PostView; showTopic?: boolean; className?: string }) {
  const topic = showTopic && post.topic && post.topic.toLowerCase() !== post.author.toLowerCase() ? post.topic : null;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground", className)}>
      {urgent(post) ? <Badge label="Urgent" tone="danger" /> : null}
      {post.resolvedAt ? <Badge label="Resolved" tone="success" /> : null}
      <span className="font-medium text-foreground/80">{post.author}</span>
      {topic ? <span>· {topic}</span> : null}
      <span>·</span>
      <time dateTime={new Date(post.createdAt).toISOString()} title={shortDateTime(post.createdAt)}>
        {relativeTime(post.createdAt)}
      </time>
      {post.storyPosts > 1 ? <span>· {post.storyPosts} updates</span> : null}
      {post.domains[0] ? <span className="truncate">· {post.domains[0]}</span> : null}
    </div>
  );
}

function StoryRow({ post, open, showTopic, onToggle, onRead }: { post: PostView; open: boolean; showTopic: boolean; onToggle(): void; onRead(read: boolean): void }) {
  // Read rows step back: one line, a small picture, faded until hovered.
  const dim = post.read && !open;
  return (
    <article id={`post-${post.id}`} className={cn("scroll-mt-4 border-b border-border/60", open && "bg-foreground/[0.025]")}>
      <div className={cn("group flex items-start gap-2 pr-1", dim ? "py-2" : "py-3")}>
        <button type="button" aria-expanded={open} className={cn("flex min-w-0 flex-1 items-start gap-3 text-left", dim && "opacity-60 group-hover:opacity-100")} onClick={onToggle}>
          <span className={cn("mt-2.5 size-1.5 shrink-0 rounded-full", post.read ? "bg-transparent" : "bg-blue-500")} aria-label={post.read ? undefined : "Unread"} />
          <Avatar post={post} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block leading-snug group-hover:underline",
                open || !post.read ? "text-sm font-semibold text-foreground" : "text-sm text-muted-foreground",
                dim && "truncate",
              )}
            >
              {post.title}
            </span>
            {!post.read && !open && post.preview ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{post.preview}</span> : null}
            <Meta post={post} showTopic={showTopic} className="mt-1" />
          </span>
          {!open ? <Picture src={post.image} className={cn("mt-0.5 shrink-0 rounded-md", dim ? "h-10 w-14" : "h-16 w-24")} /> : null}
        </button>
        <RowActions post={post} onRead={onRead} />
      </div>
      {open ? (
        <div className="pr-1 pb-5 pl-[3.375rem]">
          <PostContent post={post} />
          <PostActions post={post} onRead={onRead} className="mt-5" />
        </div>
      ) : null}
    </article>
  );
}

const ROW_ICON = "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active [&_svg]:size-4";

/** On every row: the thread it came from, read or unread, and the rest. */
function RowActions({ post, onRead }: { post: PostView; onRead(read: boolean): void }) {
  const discuss = useDiscuss();
  return (
    <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100 focus-within:opacity-100">
      {post.threadId ? (
        <button type="button" className={ROW_ICON} aria-label={`Open ${post.threadTitle ?? "its thread"}`} title={`Open ${post.threadTitle ?? "its thread"}`} onClick={() => discuss.openSource(post)}>
          <Icon name="MessageSquare" />
        </button>
      ) : null}
      <button type="button" className={ROW_ICON} aria-label={post.read ? "Mark unread" : "Mark read"} title={post.read ? "Mark unread" : "Mark read"} onClick={() => onRead(!post.read)}>
        <Icon name={post.read ? "Circle" : "Check"} />
      </button>
      <PostMenu post={post} />
    </div>
  );
}

function PostMenu({ post, onRemoved }: { post: PostView; onRemoved?(): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const discuss = useDiscuss();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`More for ${post.title}`} className={ROW_ICON}>
          <Icon name="MoreHorizontal" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => discuss.newThread(post)}>
          <Icon name="Plus" className="size-4" /> New thread about this
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => discuss.openPost(post)}>
          <Icon name="Maximize2" className="size-4" /> Open as a page
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            if (!confirm(`Remove “${post.title}” from the feed?`)) return;
            void rpc.call("remove", { postId: post.id }).then(() => onRemoved?.());
          }}
        >
          <Icon name="Trash2" className="size-4" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The thread it came from, by name; or a new thread when there's none. */
function PostActions({ post, onRead, onRemoved, className }: { post: PostView; onRead(read: boolean): void; onRemoved?(): void; className?: string }) {
  const discuss = useDiscuss();
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {post.explorable && !post.embeds.length ? <ExploreButton post={post} /> : null}
      {post.threadId ? (
        <button type="button" className={cn(OUTLINE_BUTTON, "max-w-80")} onClick={() => discuss.openSource(post)}>
          <Icon name="MessageSquare" /> <span className="truncate">{post.threadTitle ?? "Open thread"}</span>
        </button>
      ) : null}
      <button type="button" className={post.threadId ? GHOST_BUTTON : OUTLINE_BUTTON} onClick={() => discuss.newThread(post)}>
        <Icon name="Plus" /> New thread
      </button>
      <button type="button" className={GHOST_BUTTON} onClick={() => onRead(!post.read)}>
        <Icon name={post.read ? "Circle" : "Check"} /> {post.read ? "Mark unread" : "Mark read"}
      </button>
      <span className="ml-auto">
        <PostMenu post={post} onRemoved={onRemoved} />
      </span>
    </div>
  );
}

/** A finding Studio Explore saved: write the page explaining it. The post links the page when it's done. */
function ExploreButton({ post }: { post: PostView }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<"idle" | "working" | "unavailable">("idle");
  const explore = () => {
    setState("working");
    rpc.call("explore", { postId: post.id }).then(
      (result) => {
        if (result.status === "ready" && result.href) openAppPath(result.href);
        setState(result.status === "unavailable" ? "unavailable" : result.status === "ready" ? "idle" : "working");
      },
      () => setState("unavailable"),
    );
  };
  return (
    <button
      type="button"
      className={OUTLINE_BUTTON}
      disabled={state !== "idle"}
      title={state === "unavailable" ? "Studio Explore isn't installed or couldn't find this finding" : "Write a page explaining this"}
      onClick={explore}
    >
      <Icon name={state === "working" ? "Loader2" : "Compass"} className={cn(state === "working" && "animate-spin motion-reduce:animate-none")} />
      {state === "working" ? "Exploring…" : state === "unavailable" ? "Can't explore" : "Explore"}
    </button>
  );
}

/** The whole post: picture, body, the Studio items and page it links to, and the story's earlier updates. */
function PostContent({ post }: { post: PostView }) {
  // A picture in the body shows where it is; a linked web page's shows on top. A Studio item's shows in its preview.
  const linkedPicture = post.image && post.image === post.link?.image && !post.body.includes(post.image) ? post.image : null;
  return (
    <>
      <Picture src={linkedPicture} className="mb-4 max-h-80 w-full rounded-lg" />
      {post.body ? <Markdown content={post.body} className="text-sm leading-relaxed [&_img]:max-h-96 [&_img]:rounded-lg [&_li]:text-sm [&_li:has(input[type=checkbox])]:list-none [&_p]:text-sm" /> : null}
      {post.embeds.map((embed) => (
        <ItemPreview key={`${embed.pluginId}:${embed.id}`} embed={embed} />
      ))}
      {post.link?.title ? <LinkCard link={post.link} /> : null}
      <EarlierUpdates post={post} />
    </>
  );
}

/** A page, artifact or other Studio item the post links to, shown in the post. */
function ItemPreview({ embed }: { embed: PostView["embeds"][number] }) {
  const { content } = embed;
  // Long text is cut to a few paragraphs until asked for.
  const long = content?.type === "markdown" && (content.text?.length ?? 0) > 900;
  const [more, setMore] = useState(!long);
  return (
    <section
      aria-label={`${embed.kind}: ${embed.title}`}
      className="mt-4 overflow-hidden rounded-lg border border-border/70 bg-background"
      {...studioItemProps({ href: embed.href, title: embed.title })}
    >
      <header className="flex items-center gap-2 border-b border-border/60 py-1.5 pr-1.5 pl-3">
        {embed.icon ? <span aria-hidden>{embed.icon}</span> : <Icon name={embed.pluginId === "artifacts" ? "FileCode2" : "FileText"} className="size-4 text-muted-foreground" />}
        <span className="min-w-0 truncate text-sm font-semibold">{embed.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {embed.kind} · {relativeTime(embed.updatedAt)}
        </span>
        <button type="button" className={cn(GHOST_BUTTON, "ml-auto shrink-0")} onClick={() => openAppPath(embed.href)}>
          Open <Icon name="ArrowUpRight" />
        </button>
      </header>
      {content?.type === "markdown" && content.text ? (
        <div className="relative">
          <div className={cn("px-4 py-3", !more && "max-h-72 overflow-hidden")}>
            <Markdown content={content.text} className="text-sm leading-relaxed [&_img]:max-h-64 [&_img]:rounded-md [&_li]:text-sm [&_li:has(input[type=checkbox])]:list-none [&_p]:text-sm" />
          </div>
          {more ? null : (
            <div className="absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-background to-transparent pb-2">
              <button type="button" className={cn(OUTLINE_BUTTON, "bg-background")} onClick={() => setMore(true)}>
                Show more
              </button>
            </div>
          )}
        </div>
      ) : content?.type === "image" && content.url ? (
        <img src={content.url} alt={embed.title} loading="lazy" className="max-h-96 w-full bg-muted object-contain" />
      ) : (content?.type === "html" || content?.type === "pdf") && content.url ? (
        <iframe
          src={content.url}
          title={embed.title}
          loading="lazy"
          sandbox={content.type === "html" ? "allow-scripts" : undefined}
          className="h-96 w-full bg-white"
        />
      ) : embed.thumbnailUrl ? (
        <img src={embed.thumbnailUrl} alt="" loading="lazy" className="max-h-64 w-full bg-muted object-contain" />
      ) : null}
    </section>
  );
}

function LinkCard({ link }: { link: NonNullable<PostView["link"]> }) {
  return (
    <a href={link.url} target="_blank" rel="noreferrer" className="mt-4 flex max-w-xl overflow-hidden rounded-lg border border-border/70 hover:bg-state-hover">
      <span className="min-w-0 flex-1 p-3">
        <span className="line-clamp-2 block text-sm font-semibold">{link.title}</span>
        {link.description ? <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{link.description}</span> : null}
        <span className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Icon name="ArrowUpRight" className="size-3" /> {link.domain}
        </span>
      </span>
      <Picture src={link.image || null} className="w-28 shrink-0" />
    </a>
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
    <section className="mt-6">
      <h3 className="mb-3 text-sm font-semibold">Earlier updates</h3>
      <ol className="space-y-3">
        {earlier.map((each) => (
          <li key={each.id} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
            <time dateTime={new Date(each.createdAt).toISOString()} className="pt-0.5 text-xs text-muted-foreground">
              {shortDateTime(each.createdAt)}
            </time>
            <details className="group">
              <summary className="cursor-pointer list-none text-sm leading-snug font-medium hover:underline">{each.title}</summary>
              {each.preview ? <p className="mt-0.5 text-sm text-muted-foreground group-open:hidden">{each.preview}</p> : null}
              {each.body ? <Markdown content={each.body} className="mt-2 hidden text-sm group-open:block" /> : null}
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RailBox({ title, tone, children }: { title: string; tone?: "danger"; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-foreground/[0.04] p-4">
      <h2 className={cn("mb-2 text-sm font-semibold", tone === "danger" && "text-destructive")}>{title}</h2>
      <ol className="space-y-3">{children}</ol>
    </section>
  );
}

function RailItem({ post, detail, onOpen }: { post: PostView; detail: string; onOpen(): void }) {
  return (
    <li>
      <button type="button" className="group flex w-full items-start gap-2.5 text-left" onClick={onOpen}>
        <Avatar post={post} className="mt-px size-5 text-[11px]" />
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline">{post.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
      </button>
    </li>
  );
}

// A post's own page -------------------------------------------------------------

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
  // Opening it reads it.
  const unread = post?.read === false;
  useEffect(() => {
    if (unread) void rpc.call("read", { postId, read: true }).catch(() => undefined);
  }, [rpc, postId, unread]);
  const onRead = (read: boolean) => {
    setPost((current) => (current ? { ...current, read } : current));
    void rpc.call("read", { postId, read }).catch(() => undefined);
  };
  const back = () => navigate.toPluginPanel(PANEL_PATH);

  return (
    <PageColumn className="max-w-3xl">
      <button type="button" className={cn(GHOST_BUTTON, "-ml-3 mb-6")} onClick={back}>
        <Icon name="ArrowLeft" /> Feed
      </button>
      {post === undefined ? (
        <div className="h-24 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
      ) : post === null ? (
        <EmptyState icon={FEED_ICON} title="This post was removed" />
      ) : (
        <article>
          <h1 className="text-2xl leading-tight font-semibold text-balance">{post.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Avatar post={post} />
            <span className="font-medium text-foreground">{from(post)}</span>
            {post.topic ? <span>· {post.topic}</span> : null}
            <span>·</span>
            <time dateTime={new Date(post.createdAt).toISOString()}>{shortDateTime(post.createdAt)}</time>
            {urgent(post) ? <Badge label="Urgent" tone="danger" /> : null}
            {post.resolvedAt ? <Badge label="Resolved" tone="success" /> : null}
          </div>
          <PostActions post={post} onRead={onRead} onRemoved={back} className="my-5 border-y border-border/70 py-2" />
          <PostContent post={post} />
        </article>
      )}
    </PageColumn>
  );
}

/** Stories with an unread post, next to Feed in the sidebar. */
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
