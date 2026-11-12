import { expect, it, vi } from "vitest";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { toast } from "sonner";
import { isBotThread, noteBotThread, resetBotThreadsForTest } from "./bot-thread-owners";
import { FORK_FROM_HERE, forkFromHere, registerForkFromHere } from "./fork-from-here";

const message = { threadId: "main", messageId: "msg_1", turnId: "turn_1", role: "assistant" as const, sourceSeqEnd: 12 };

it("puts Fork conversation from here in a message's ··· menu in place of BB's own Fork, on a Bot's threads only and only where BB has message actions", () => {
  const deps = { call: vi.fn(), open: vi.fn() };
  expect(registerForkFromHere({}, deps)).toBe(false);
  const registered: { title: string; experimental_replaces?: string; isAvailable(m: typeof message): boolean }[] = [];
  expect(registerForkFromHere({ experimental_messageAction: (registration: (typeof registered)[number]) => { registered.push(registration); } }, deps)).toBe(true);
  expect(registered[0]!.title).toBe(FORK_FROM_HERE);
  resetBotThreadsForTest();
  expect(registered).toHaveLength(1);
  expect(registered[0]!.experimental_replaces).toBe("thread.fork");
  expect(isBotThread("main")).toBe(false);
  expect(registered[0]!.isAvailable(message)).toBe(false);
  noteBotThread("main", true);
  noteBotThread("thr_plain", false);
  expect(registered[0]!.isAvailable(message)).toBe(true);
  expect(registered[0]!.isAvailable({ ...message, threadId: "thr_plain" })).toBe(false);
  expect(registered[0]!.isAvailable({ ...message, threadId: "thr_unknown" })).toBe(false);
  expect(registered[0]!.isAvailable({ ...message, sourceSeqEnd: Number.NaN })).toBe(false);
});

it("forks after the message and opens the fork beside its conversation; a refusal is a plain toast and opens nothing", async () => {
  const call = vi.fn(async () => ({ threadId: "fork_1" }));
  const open = vi.fn();
  expect(await forkFromHere(message, { call, open })).toBe("fork_1");
  expect(call).toHaveBeenCalledWith("bot_fork_conversation", { threadId: "main", messageId: "msg_1", turnId: "turn_1", sourceSeqEnd: 12 });
  expect(open).toHaveBeenCalledWith("fork_1", "main");
  open.mockClear();
  expect(await forkFromHere(message, { call: vi.fn(async () => { throw new Error("That thread isn't one of a Bot's conversations."); }), open })).toBeNull();
  expect(open).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Couldn't fork the conversation.");
});
