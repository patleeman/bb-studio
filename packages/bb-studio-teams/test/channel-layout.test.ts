import { expect, test } from "vitest";
import { activeThreads, arrangeGrid, byAttention, movePane, channelLayout, focusedThread, threadActivity } from "../channel-layout";
import type { ViewThread } from "../view-contract";
const thread = (id: string, status: string, extra: Partial<ViewThread> = {}): ViewThread => ({ id, title: id, status, botId: null, parentThreadId: null, updatedAt: 1, error: null, ...extra });
test("unknown preferences preserve the existing merged view", () => {
  expect(channelLayout(null)).toBe("merged");
  expect(channelLayout("removed-mode")).toBe("merged");
  expect(channelLayout("active")).toBe("active");
});
test("active view includes working ordinary threads and input requests, excluding unavailable and idle threads", () => {
  const rows = [thread("idle", "idle"), thread("start", "starting"), thread("run", "active"), thread("input", "idle", { hasPendingInteraction: true }), thread("gone", "active", { error: "Deleted" })];
  expect(activeThreads(rows).map(thread => thread.id)).toEqual(["start", "run", "input"]);
  expect(threadActivity(rows[3]!)).toBe("Needs input");
});
test("focus keeps the selected idle or child thread and recovers if it disappears", () => {
  const rows = [thread("idle", "idle"), thread("child", "active", { parentThreadId: "idle" })];
  expect(focusedThread(rows, "idle")?.id).toBe("idle");
  expect(focusedThread(rows, "child")?.id).toBe("child");
  expect(focusedThread(rows, "deleted")?.id).toBe("child");
  expect(focusedThread([], null)).toBeUndefined();
});
test("attention order puts input requests and failures ahead of work, then recency", () => {
  const rows = [thread("old", "idle", { updatedAt: 1 }), thread("new", "idle", { updatedAt: 5 }), thread("run", "active"), thread("fail", "error"), thread("ask", "idle", { hasPendingInteraction: true })];
  expect(byAttention(rows).map(thread => thread.id)).toEqual(["ask", "fail", "run", "new", "old"]);
});
test("arranged grid panes keep their places while new ones follow in attention order", () => {
  const rows = [thread("a", "idle"), thread("b", "idle"), thread("c", "active"), thread("d", "idle", { hasPendingInteraction: true })];
  expect(arrangeGrid(rows, ["b", "gone", "a"]).map(thread => thread.id)).toEqual(["b", "a", "d", "c"]);
  expect(movePane(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"]);
  expect(movePane(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
  const same = ["a", "b"];
  expect(movePane(same, "a", "a", "after")).toBe(same);
});
