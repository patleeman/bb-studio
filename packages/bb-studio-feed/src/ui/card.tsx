// `::post{id="…"}` at the end of a reply: the post it made, as a card
// in the thread or channel. The card finds its post by the directive line. It
// says what kind of post it is (urgent, its topic, which update of a story),
// and opens it in the Feed or marks it read without leaving the conversation.
import { Badge, GHOST_BUTTON, ItemDirectiveCard, cn } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { rpcContract } from "../contract";
import { FEED_ICON, REALTIME_CHANNEL } from "../shared";
import { feedEvent, useDiscuss, useMinuteTick, type PostView } from "./feed";

/** A reply's post is written when its thread goes idle, just after the reply renders: look again for a while. */
const RETRY_MS = 1_500;
const RETRIES = 8;

export function PostCard({ attributes, source }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const discuss = useDiscuss();
  useMinuteTick();
  const [post, setPost] = useState<PostView | null | undefined>(undefined);
  const [tries, setTries] = useState(0);

  // `::post{id="…"}` names a post feed_post made; an older `::post{title="…"}` line published one itself.
  const postId = attributes.id;
  const load = useCallback(() => {
    (postId ? rpc.call("post", { postId }) : rpc.call("forDirective", { source })).then(
      (result) => setPost(result.post),
      () => setPost(null),
    );
  }, [rpc, source, postId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (post !== null || tries >= RETRIES) return;
    const timer = setTimeout(() => {
      setTries((value) => value + 1);
      load();
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [post, tries, load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = feedEvent(payload);
    // "seen": read or unread changed, here or in the Feed.
    if (event?.type === "post" || event?.type === "seen" || (event?.type === "removed" && event.postId === post?.id)) load();
  });

  if (post === undefined || (post === null && tries < RETRIES)) {
    // Not published (yet): show what the line says, quietly.
    return <ItemDirectiveCard state="ready" kind="post" icon={FEED_ICON} title={attributes.title ?? "Post"} details={post === undefined ? "Feed" : "Posting to the feed…"} />;
  }
  if (!post) return <ItemDirectiveCard state="deleted" kind="post" icon={FEED_ICON} />;
  return <PostCardView post={post} onOpen={() => discuss.openPost(post)} onRead={(read) => markRead(post, read)} />;

  function markRead(current: PostView, read: boolean) {
    setPost({ ...current, read });
    void rpc.call("read", { postId: current.id, read }).catch(() => setPost(current));
  }
}

function PostCardView({ post, onOpen, onRead }: { post: PostView; onOpen(): void; onRead(read: boolean): void }) {
  const urgent = post.priority === "urgent" && !post.resolvedAt;
  // The reply above shows the body and its pictures; a picture from a linked page isn't there.
  const thumbnail = post.image && !post.body.includes(post.image) ? post.image : null;
  return (
    <article
      aria-label={`Feed post: ${post.title}`}
      className={cn("my-2 w-full max-w-md overflow-hidden rounded-lg border bg-background", urgent ? "border-destructive/50" : "border-border/70")}
    >
      <div className="flex items-start gap-3 px-3 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Icon name={FEED_ICON} className="size-3.5" />
            <span>Feed</span>
            {urgent ? <Badge label="Urgent" tone="danger" /> : null}
            {post.resolvedAt ? <Badge label="Resolved" tone="success" /> : null}
            {post.topic ? <span className="rounded bg-foreground/[0.06] px-1.5 py-px text-foreground/80">{post.topic}</span> : null}
            {post.storyPosts > 1 ? <span>Update {post.storyPosts}</span> : null}
            <span>· {relativeTime(post.createdAt)}</span>
          </div>
          <button type="button" onClick={onOpen} className="mt-1 flex items-center gap-1.5 text-left text-sm font-semibold hover:underline">
            {post.read ? null : <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
            {post.title}
          </button>
        </div>
        {thumbnail ? <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-0.5 h-12 w-16 shrink-0 rounded-md bg-muted object-cover" /> : null}
      </div>
      <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
        <button type="button" className={cn(GHOST_BUTTON, "h-7 px-2 text-xs")} onClick={onOpen}>
          <Icon name="ArrowUpRight" className="size-3.5" /> Open in Feed
        </button>
        <button type="button" className={cn(GHOST_BUTTON, "h-7 px-2 text-xs")} onClick={() => onRead(!post.read)}>
          <Icon name={post.read ? "Circle" : "Check"} className="size-3.5" /> {post.read ? "Mark unread" : "Mark read"}
        </button>
      </div>
    </article>
  );
}
