import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { cleanTitle, promptText, requestTexts, ThreadTitler, titleDue, titlePrompt, TitleStore, type TitleContext, type TitleThread } from "./thread-titles";

function setup(replies: (string | null)[] = []) {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  const store = new TitleStore(db);
  const threads = new Map<string, TitleThread>();
  let context: TitleContext = { prompts: ["Thread titles are long and never update. How do we fix this?"], promptCount: 1, output: null };
  const ask = vi.fn(async () => replies.shift() ?? null);
  const rename = vi.fn(async (threadId: string, title: string) => { threads.set(threadId, { ...threads.get(threadId)!, title }); });
  const titler = new ThreadTitler(store, {
    thread: async (threadId) => threads.get(threadId) ?? null,
    context: async () => context,
    ask,
    rename,
  });
  const add = (id: string, title: string | null = null, hidden = false) => {
    const thread = { id, title, hidden, archived: false };
    threads.set(id, thread);
    titler.created(thread);
  };
  return { store, threads, titler, ask, rename, add, setContext: (next: TitleContext) => { context = next; } };
}

it("retitles on a doubling schedule, then every eight requests", () => {
  expect([0, 1].map((n) => titleDue(0, n))).toEqual([false, true]);
  expect([1, 2].map((n) => titleDue(1, n))).toEqual([false, true]);
  expect([3, 4].map((n) => titleDue(2, n))).toEqual([false, true]);
  expect([15, 16].map((n) => titleDue(8, n))).toEqual([false, true]);
  expect([23, 24].map((n) => titleDue(16, n))).toEqual([false, true]);
});

it("accepts short titles and rejects long, cut or ID-laden ones", () => {
  expect(cleanTitle('Title: "Thread title quality."')).toBe("Thread title quality");
  expect(cleanTitle("**Sidebar drag-and-drop bug**\n\nBecause…")).toBe("Sidebar drag-and-drop bug");
  expect(cleanTitle("<think>hmm</think>\nTalk SDK pin")).toBe("Talk SDK pin");
  expect(cleanTitle("Improve thread title readability and keep it updated")).toBeNull();
  expect(cleanTitle("A".repeat(37))).toBeNull();
  expect(cleanTitle("Review thr_abc123")).toBeNull();
  expect(cleanTitle("  ")).toBeNull();
});

it("strips code, mentions and links from what the model sees", () => {
  expect(promptText("Continue @thread:thr_abc and fix ```ts\nconst x = 1\n``` see https://github.com/a/b", 200))
    .toBe("Continue and fix [code] see github.com");
  expect(promptText("x".repeat(20), 5)).toBe("xxxxx…");
});

it("shows the first and latest requests and the current title", () => {
  const prompt = titlePrompt({ prompts: ["first", "later one"], promptCount: 6, output: "done" }, "Old title");
  expect(prompt).toContain("Current title: Old title");
  expect(prompt).toContain("First request: first");
  expect(prompt).toContain("(4 more requests in between.)");
  expect(prompt).toContain("Later request: later one");
  expect(prompt).toContain("Agent's latest reply: done");
});

it("titles a new thread after its first turn, over BB's title", async () => {
  const { titler, threads, rename, add } = setup(["Thread title quality"]);
  add("t1");
  threads.set("t1", { ...threads.get("t1")!, title: "Improve thread title readability and updates" });
  await titler.idle("t1");
  expect(rename).toHaveBeenCalledWith("t1", "Thread title quality");
});

it("waits until the thread has grown before titling again, and keeps a title the model keeps", async () => {
  const { titler, rename, ask, add, setContext } = setup(["Thread title quality", "Thread title quality", "Studio title writer"]);
  add("t1");
  await titler.idle("t1");
  await titler.idle("t1");
  expect(ask).toHaveBeenCalledTimes(1);
  setContext({ prompts: ["a", "b"], promptCount: 2, output: null });
  await titler.idle("t1");
  expect(ask).toHaveBeenCalledTimes(2);
  expect(rename).toHaveBeenCalledTimes(1);
  setContext({ prompts: ["a", "b", "c", "d"], promptCount: 4, output: null });
  await titler.idle("t1");
  expect(rename).toHaveBeenLastCalledWith("t1", "Studio title writer");
});

it("never retitles a thread someone named", async () => {
  const { titler, threads, ask, add, setContext, store } = setup(["Thread title quality"]);
  add("spawned", "Atlas");
  await titler.idle("spawned");
  add("renamed");
  await titler.idle("renamed");
  threads.set("renamed", { ...threads.get("renamed")!, title: "My name" });
  setContext({ prompts: ["a", "b"], promptCount: 2, output: null });
  await titler.idle("renamed");
  expect(ask).toHaveBeenCalledTimes(1);
  expect(store.get("renamed")?.locked).toBe(true);
});

it("skips hidden threads and threads it never saw created", async () => {
  const { titler, threads, ask, add } = setup(["Anything"]);
  add("hidden", null, true);
  threads.set("old", { id: "old", title: "Old", hidden: false, archived: false });
  await titler.idle("hidden");
  await titler.idle("old");
  expect(ask).not.toHaveBeenCalled();
});

it("does not overwrite a rename made while the model was answering", async () => {
  const { titler, threads, rename, add, ask } = setup();
  add("t1");
  ask.mockImplementationOnce(async () => {
    threads.set("t1", { ...threads.get("t1")!, title: "Typed by hand" });
    return "Model title";
  });
  await titler.idle("t1");
  expect(rename).not.toHaveBeenCalled();
});

it("retitle takes over any thread, including renamed and older ones", async () => {
  const { titler, threads, rename, store } = setup(["Verizon credit claim"]);
  threads.set("old", { id: "old", title: "Claim our Verizon credit", hidden: false, archived: true });
  expect(await titler.retitle("old")).toBe("Verizon credit claim");
  expect(rename).toHaveBeenCalledWith("old", "Verizon credit claim");
  expect(store.get("old")).toMatchObject({ title: "Verizon credit claim", locked: false });
});

it("retitle waits out a run in progress instead of reporting the old title", async () => {
  const { titler, rename, add, ask } = setup();
  add("t1");
  let release!: (value: string) => void;
  ask.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
  ask.mockImplementationOnce(async () => "Invoice PDF overflow");
  const idle = titler.idle("t1");
  await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  const retitled = titler.retitle("t1");
  release("Stale title");
  expect(await retitled).toBe("Invoice PDF overflow");
  await idle;
  expect(rename.mock.calls).toEqual([["t1", "Invoice PDF overflow"]]);
});

it("reads requests from turn events and skips system notices", () => {
  const turn = (initiator: string, ...text: string[]) => ({ type: "client/turn/requested", data: { initiator, input: text.map((value) => ({ type: "text", text: value })) } });
  expect(requestTexts([
    { type: "client/thread/start", data: {} },
    turn("user", "Fix the invoice export", "it cuts off rows"),
    turn("system", "Child thread finished"),
    turn("agent", "Also check page two"),
    { type: "client/turn/requested", data: { initiator: "user", input: [{ type: "image" }] } },
  ])).toEqual(["Fix the invoice export\nit cuts off rows", "Also check page two"]);
});
