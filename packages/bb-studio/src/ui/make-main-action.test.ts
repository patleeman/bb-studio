import { expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { makeMainAction } = await import("./thread-header");

const bots = [{ id: "bot_dot", name: "Dot", threadId: "thr_main" }, { id: "bot_scout", name: "Scout", threadId: "thr_scout" }];
const item = (threadId: string, owner: string | null, call = vi.fn(async () => ({}))) =>
  makeMainAction.item({ thread: { id: threadId } as never, data: { owners: new Map([[threadId, owner]]), bots, call: call as never } } as never);

it("offers Make this the Main on a Bot's conversation, not on its Main or a thread that is no Bot's conversation", () => {
  expect(item("thr_main", "bot_dot")).toBeNull();
  expect(item("thr_other", null)).toBeNull();
  expect(item("thr_conv", "bot_dot")).toMatchObject({ label: "Make this the Main", detail: "Dot's Main" });
});

it("makes it the Main, and says why when it can't", async () => {
  const call = vi.fn(async () => ({}));
  await item("thr_conv", "bot_dot", call)!.run(undefined as never);
  expect(call).toHaveBeenCalledWith("bot_make_main", { botId: "bot_dot", threadId: "thr_conv" });
  expect(toast.success).toHaveBeenCalledWith("This is Dot's Main now.");
  const refused = vi.fn(async () => { throw new Error("That conversation is archived. Unarchive it first, then make it the Main."); });
  await item("thr_conv", "bot_dot", refused)!.run(undefined as never);
  expect(toast.error).toHaveBeenCalledWith("That conversation is archived. Unarchive it first, then make it the Main.");
});
