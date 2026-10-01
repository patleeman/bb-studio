// `::post{title="…"}` at the end of a reply: the post it published, as a card
// in the thread or channel. The card finds its post by the directive line.
import { ItemDirectiveCard } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
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

  const load = useCallback(() => {
    rpc.call("forDirective", { source }).then(
      (result) => setPost(result.post),
      () => setPost(null),
    );
  }, [rpc, source]);
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
    if (event?.type === "post" || (event?.type === "removed" && event.postId === post?.id)) load();
  });

  if (post === undefined || (post === null && tries < RETRIES)) {
    // Not published (yet): show what the line says, quietly.
    return <ItemDirectiveCard state="ready" kind="post" icon={FEED_ICON} title={attributes.title ?? "Post"} details={post === undefined ? "Feed" : "Posting to the feed…"} />;
  }
  if (!post) return <ItemDirectiveCard state="deleted" kind="post" icon={FEED_ICON} />;
  const details = ["Posted to the feed", post.topic, relativeTime(post.createdAt), post.storyPosts > 1 ? `update ${post.storyPosts}` : null, post.resolvedAt ? "resolved" : null]
    .filter(Boolean)
    .join(" · ");
  return <ItemDirectiveCard state="ready" kind="post" icon={FEED_ICON} title={post.title} details={details} onOpen={() => discuss.openPost(post)} />;
}
