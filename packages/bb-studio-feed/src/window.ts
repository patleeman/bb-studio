import type { PostView } from "./contract";

type FeedPage = { posts: PostView[]; nextCursor: string | null };

/** Reload the reader's visible window without exceeding the per-request limit. */
export async function loadFeedWindow(
  read: (input: { limit: number; cursor?: string }) => Promise<FeedPage>,
  count: number,
): Promise<FeedPage> {
  const posts = new Map<string, PostView>();
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await read({ limit: Math.min(100, Math.max(1, count - posts.size)), ...(cursor ? { cursor } : {}) });
    for (const post of page.posts) if (!posts.has(post.id)) posts.set(post.id, post);
    if (!page.nextCursor || posts.size >= count) return { posts: [...posts.values()], nextCursor: page.nextCursor };
    if (cursors.has(page.nextCursor)) throw new Error("The feed could not advance to older posts. Try again.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);
}
