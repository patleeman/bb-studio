import { useModuleRpc } from "../../../app";
import { NewConversationComposer, useOpenCompanion } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useEffect, useState } from "react";
import type { PostView, rpcContract } from "../contract";
import { discussionPrompt, postHref } from "../shared";

export function PostDiscussion({ postId }: { postId: string }) {
  const rpc = useModuleRpc<typeof rpcContract>("feed");
  const open = useOpenCompanion();
  const [post, setPost] = useState<PostView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null); setPost(null);
    rpc.call("post", { postId }).then(
      result => { if (live) { setPost(result.post); if (!result.post) setError("That feed post is gone."); } },
      cause => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
  }, [rpc, postId, attempt]);
  if (error) return <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-4 text-sm"><p>{error}</p><button type="button" className="rounded border border-border px-3 py-1.5 hover:bg-state-hover" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!post) return <p className="p-4 text-sm text-muted-foreground">Loading conversation…</p>;
  return <NewConversationComposer key={post.id} title={`Chat about "${post.title}"`} composerClassName="feed-discussion-composer"
    moveTarget={{ href: `${postHref(post.id)}/discussion`, title: `Chat about "${post.title}"` }}
    draftKey={`feed:discussion:${post.id}`} initialPrompt={discussionPrompt(post)} focusRequest={1}
    {...(post.projectId ? { defaultProjectId: post.projectId } : {})}
    onSubmit={async request => {
      const { threadId } = await rpc.call("discussion", { postId: post.id, request });
      open({ kind: "thread", threadId });
    }} />;
}
