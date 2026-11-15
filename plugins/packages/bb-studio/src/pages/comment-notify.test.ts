import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { MIGRATIONS } from "../migrations";
import { StudioServices } from "../services";
import { createThread, listThreads, reply, setResolved } from "./comments";
import { userCommentMessage, watchUserComments, type UserComment } from "./comment-notify";
import { HUMAN_USER_ID } from "./constants";
import { readBlocks, seedMarkdown } from "./doc";
import { registerPages } from "./server";

afterEach(() => vi.useRealTimers());

function pageDoc(markdown: string) {
  const doc = new Y.Doc();
  seedMarkdown(doc, markdown);
  return { doc, block: readBlocks(doc)[0]!.id! };
}

describe("watchUserComments", () => {
  it("reports the user's new threads and replies once, and not the agent's or resolving", async () => {
    vi.useFakeTimers();
    const { doc, block } = pageDoc("The launch is on Friday.\n");
    const seen: UserComment[][] = [];
    const stop = watchUserComments(doc, (comments) => seen.push(comments), 500);
    const human = { client: "editor" };

    const { threadId } = await createThread(doc, HUMAN_USER_ID, { block, quote: "Friday", text: "Can we move it?" }, human);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([[expect.objectContaining({ threadId, reply: false, quote: "Friday", text: "Can we move it?" })]]);

    reply(doc, "agent:thr_maker", threadId, "Moved to Monday.", "agent:thr_maker");
    setResolved(doc, HUMAN_USER_ID, threadId, true, human);
    setResolved(doc, HUMAN_USER_ID, threadId, false, human);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toHaveLength(1);

    reply(doc, HUMAN_USER_ID, threadId, "Thanks", human);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen[1]).toEqual([expect.objectContaining({ threadId, reply: true, text: "Thanks" })]);

    stop();
    reply(doc, HUMAN_USER_ID, threadId, "After stop", human);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toHaveLength(2);
  });

  it("does not report comments that were in the page when it opened", async () => {
    vi.useFakeTimers();
    const { doc, block } = pageDoc("Text\n");
    await createThread(doc, HUMAN_USER_ID, { block, text: "Old" }, { client: "editor" });
    const onComments = vi.fn();
    watchUserComments(doc, onComments, 100);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(copy), { client: "editor" });
    await vi.advanceTimersByTimeAsync(100);
    expect(onComments).not.toHaveBeenCalled();
    expect(listThreads(doc)).toHaveLength(1);
  });
});

it("tells the user's comment to the page's agent", () => {
  const text = userCommentMessage({ id: "pg_a", title: "Plan" }, [
    { threadId: "t1", commentId: "c1", reply: false, quote: "Friday", blockId: "b1", text: "Move it\nplease" },
  ]);
  expect(text).toContain('The user left a comment on the page "Plan" (id pg_a');
  expect(text).toContain('New thread t1 on "Friday":\n> Move it\n> please');
  expect(text).toContain("pages_comment_reply");
});

describe("comments on a page an agent made", () => {
  async function setup() {
    vi.useFakeTimers();
    const send = vi.fn(async (_input: { threadId: string; input: { text: string }[]; mode: string }) => ({}));
    const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { send: send as never } } });
    const db = host.bb.storage.database();
    for (const sql of MIGRATIONS) db.exec(sql);
    const services = new StudioServices(db);
    const pages = registerPages(host.bb, db, { snapshotsPerPage: () => 10 }, services, async () => {}, {
      items: async () => [], create: async () => { throw new Error("not in this test"); },
      drawing: () => null, saveDrawing: () => { throw new Error("not in this test"); },
      artifact: () => null, artifactText: () => ({ text: null, truncated: false }), recording: () => null,
    });
    const call = (method: string, input: unknown) => host.harness.behavior.callRpc(method, input);
    const firstBlock = async (id: string) => ((await call("pages.commentBlocks", { id })) as { blocks: { id: string }[] }).blocks[0]!.id;
    const dispose = async () => { pages.dispose(); await host.harness.lifecycle.dispose(); };
    return { send, services, pages, call, firstBlock, dispose, host };
  }

  it("sends the user's comment and reply to the thread that made the page, and nothing for the agent's own", async () => {
    const { send, services, pages, call, firstBlock, dispose, host } = await setup();
    try {
      const id = pages.createPage({ projectId: null, title: "Plan", markdown: "Ship on Friday.\n" });
      services.created({ pluginId: "pages", id }, "thr_maker");
      const block = await firstBlock(id);

      const { threadId } = (await call("pages.commentCreate", { id, block, quote: "Friday", text: "Can it be Monday?" })) as { threadId: string };
      await vi.advanceTimersByTimeAsync(1500);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toMatchObject({ threadId: "thr_maker", mode: "queue-if-active" });
      expect(send.mock.calls[0]![0].input[0]!.text).toContain(`New thread ${threadId} on "Friday":\n> Can it be Monday?`);

      await host.harness.behavior.callAgentTool("pages_comment_reply", { page: id, thread: threadId, text: "Done." }, { threadId: "thr_maker" });
      await call("pages.commentResolve", { id, thread: threadId, resolved: true });
      await call("pages.commentResolve", { id, thread: threadId, resolved: false });
      await vi.advanceTimersByTimeAsync(1500);
      expect(send).toHaveBeenCalledTimes(1);

      await call("pages.commentReply", { id, thread: threadId, text: "One more thing" });
      await vi.advanceTimersByTimeAsync(1500);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1]![0].input[0]!.text).toContain(`Reply in thread ${threadId} on "Friday":\n> One more thing`);
    } finally { await dispose(); }
  });

  it("tells no one about a comment on the user's own page, and keeps a comment it couldn't send", async () => {
    const { send, services, pages, call, firstBlock, dispose, host } = await setup();
    try {
      const mine = pages.createPage({ projectId: null, title: "Mine", markdown: "Hello\n" });
      await call("pages.commentCreate", { id: mine, block: await firstBlock(mine), text: "Note to self" });
      await vi.advanceTimersByTimeAsync(1500);
      expect(send).not.toHaveBeenCalled();

      const made = pages.createPage({ projectId: null, title: "Made", markdown: "Hello\n" });
      services.created({ pluginId: "pages", id: made }, "thr_gone");
      send.mockRejectedValueOnce(new Error("thread is gone"));
      await call("pages.commentCreate", { id: made, block: await firstBlock(made), text: "Hi" });
      await vi.advanceTimersByTimeAsync(1500);
      expect(send).toHaveBeenCalledTimes(1);
      const { threads } = (await call("pages.comments", { id: made })) as { threads: { comments: { text: string }[] }[] };
      expect(threads[0]!.comments[0]!.text).toBe("Hi");
      expect(host.harness.logEntries.some((entry) => entry.message.includes("couldn't be sent to thr_gone"))).toBe(true);
    } finally { await dispose(); }
  });
});
