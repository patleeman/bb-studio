import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import type { PostRow } from "./store";
import { discussionContext } from "./shared";

export async function startDiscussion(postId: string, request: NewThreadRequest, getPost: (id: string) => PostRow | null, spawn: (request: NewThreadRequest) => Promise<{ id: string }>): Promise<{ threadId: string }> {
  const post = getPost(postId);
  if (!post) throw new Error("That feed post is gone.");
  const context = discussionContext({ id: post.id, title: post.title, author: post.author });
  const thread = await spawn({ ...request, input: [...request.input, { type: "text", text: context, mentions: [] }] });
  return { threadId: thread.id };
}
