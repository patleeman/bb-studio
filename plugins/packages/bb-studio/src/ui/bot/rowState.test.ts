import { expect, test } from "vitest";
import { botRowState, STATE_INDICATOR, threadState } from "./rowState";

type Chat = Parameters<typeof botRowState>[0]["chat"] & object;
const idle: Chat = { status: "idle", runtimeStatus: "idle", indicator: "none", hasPendingInteraction: false, isUnread: false } as Chat;
const chat = (patch: Partial<Chat>): Chat => ({ ...idle, ...patch }) as Chat;

test("an idle, read Bot shows nothing", () => {
  expect(botRowState({ chat: idle, attention: null })).toBe("idle");
  expect(botRowState({ chat: null, attention: undefined })).toBe("idle");
  expect(STATE_INDICATOR.idle).toBe("none");
});

test("working: its chat is busy, a thread its chat spawned is, or bot_activity counts threads in progress", () => {
  expect(botRowState({ chat: chat({ status: "active" } as Partial<Chat>), attention: null })).toBe("working");
  expect(botRowState({ chat: chat({ runtimeStatus: "provisioning" } as Partial<Chat>), attention: null })).toBe("working");
  expect(botRowState({ chat: idle, children: [{ status: "active", runtimeStatus: "active", indicator: "runtime" } as never], attention: null })).toBe("working");
  expect(botRowState({ chat: idle, children: [{ status: "idle", runtimeStatus: "idle", indicator: "unread-success" } as never], attention: null })).toBe("idle");
  expect(botRowState({ chat: idle, attention: null, running: 2 })).toBe("working");
  // BB's live view leaves the hidden chat out: bot_attention says it's busy.
  expect(botRowState({ chat: null, attention: null, chatWorking: true })).toBe("working");
  expect(botRowState({ chat: null, attention: { count: 1, unread: 1 }, chatWorking: true })).toBe("working");
  expect(botRowState({ chat: null, attention: { count: 1, unread: 0 }, chatWorking: true })).toBe("needs-you");
  expect(STATE_INDICATOR.working).toBe("runtime");
});

test("needs you: the chat waits on the user, or bot_attention has a question or a todo, over working", () => {
  expect(botRowState({ chat: chat({ status: "active", hasPendingInteraction: true } as Partial<Chat>), attention: null })).toBe("needs-you");
  expect(botRowState({ chat: chat({ status: "active" } as Partial<Chat>), attention: { count: 1, unread: 0 } })).toBe("needs-you");
  // Attention from before `unread` was counted: all of it waits on the user.
  expect(botRowState({ chat: idle, attention: { count: 2 } })).toBe("needs-you");
  expect(STATE_INDICATOR["needs-you"]).toBe("waiting-for-input");
});

test("unread: a reply the user hasn't read, from bot_attention; working wins over it", () => {
  expect(botRowState({ chat: idle, attention: { count: 2, unread: 2 } })).toBe("unread");
  expect(botRowState({ chat: chat({ status: "active" } as Partial<Chat>), attention: { count: 1, unread: 1 } })).toBe("working");
  // A pending question as well: needs you.
  expect(botRowState({ chat: idle, attention: { count: 3, unread: 2 } })).toBe("needs-you");
  expect(STATE_INDICATOR.unread).toBe("unread-success");
});

test("BB's unread flag alone isn't news: a check-in's [PASS] leaves the chat unread in BB", () => {
  expect(botRowState({ chat: chat({ isUnread: true, indicator: "unread-success" }), attention: null })).toBe("idle");
  // A thread row still shows it.
  expect(threadState(chat({ isUnread: true }))).toBe("unread");
});

test("error: the chat's last turn failed and isn't read", () => {
  expect(botRowState({ chat: chat({ isUnread: true, indicator: "unread-error" }), attention: null })).toBe("error");
  expect(botRowState({ chat: chat({ isUnread: true, indicator: "unread-error" }), attention: { count: 1, unread: 0 } })).toBe("needs-you");
  expect(STATE_INDICATOR.error).toBe("unread-error");
});
