import { expect, it } from "vitest";
import { loadFeedWindow } from "./window";
import { rpcContract, type PostView } from "./contract";

const posts = (start: number, count: number) => Array.from({ length: count }, (_, n) => ({ id: `post_${start + n}` }) as PostView);

it("refreshes three reader pages through valid bounded requests", async () => {
  const calls: { limit: number; cursor?: string }[] = [];
  const result = await loadFeedWindow(async (input) => {
    rpcContract.list.input.parse(input);
    calls.push(input);
    const start = Number(input.cursor ?? 0);
    return { posts: posts(start, input.limit), nextCursor: String(start + input.limit) };
  }, 120);
  expect(calls).toEqual([{ limit: 100 }, { limit: 20, cursor: "100" }]);
  expect(result.posts).toHaveLength(120);
  expect(result.nextCursor).toBe("120");
});

it("finishes when deletions leave a shorter window", async () => {
  const result = await loadFeedWindow(async () => ({ posts: posts(0, 3), nextCursor: null }), 120);
  expect(result.posts).toHaveLength(3);
  expect(result.nextCursor).toBeNull();
});

it("deduplicates moving stories and rejects a cursor that stops advancing", async () => {
  let call = 0;
  const result = await loadFeedWindow(async () => ++call === 1
    ? { posts: posts(0, 100), nextCursor: "next" }
    : { posts: posts(99, 21), nextCursor: null }, 120);
  expect(result.posts).toHaveLength(120);
  await expect(loadFeedWindow(async () => ({ posts: [], nextCursor: "stuck" }), 120)).rejects.toThrow("could not advance");
});
