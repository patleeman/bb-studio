// @vitest-environment jsdom
import { expect, test } from "vitest";
import { activeThreads, byAttention, claimsNewThreadKey, followThread, movePane, threadActivity } from "./command-layout";
import type { CommandThread } from "./command-contract";
const thread = (id: string, status: string, extra: Partial<CommandThread> = {}): CommandThread => ({ id, title: id, status, parentThreadId: null, updatedAt: 1, error: null, ...extra });
test("active view includes working ordinary threads and input requests, excluding unavailable and idle threads", () => {
  const rows = [thread("idle", "idle"), thread("start", "starting"), thread("run", "active"), thread("input", "idle", { hasPendingInteraction: true }), thread("gone", "active", { error: "Deleted" })];
  expect(activeThreads(rows).map(thread => thread.id)).toEqual(["start", "run", "input"]);
  expect(threadActivity(rows[3]!)).toBe("Needs input");
});
test("attention order puts input requests and failures ahead of work, then recency", () => {
  const rows = [thread("old", "idle", { updatedAt: 1 }), thread("new", "idle", { updatedAt: 5 }), thread("run", "active"), thread("fail", "error"), thread("ask", "idle", { hasPendingInteraction: true })];
  expect(byAttention(rows).map(thread => thread.id)).toEqual(["ask", "fail", "run", "new", "old"]);
});
test("panes move before or after another", () => {
  expect(movePane(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"]);
  expect(movePane(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
  const same = ["a", "b"];
  expect(movePane(same, "a", "a", "after")).toBe(same);
});
test("a lone pane stays on a working thread, moves to the next one at work, and otherwise keeps what it showed", () => {
  const rows = [thread("lead", "idle", { updatedAt: 1 }), thread("new", "idle", { updatedAt: 5 }), thread("run", "active"), thread("ask", "idle", { hasPendingInteraction: true })];
  expect(followThread(rows, null, "lead")?.id).toBe("ask");
  expect(followThread(rows, "run", "lead")?.id).toBe("run");
  expect(followThread(rows, "new", "lead")?.id).toBe("ask");
  const idle = rows.map(row => ({ ...row, status: "idle", hasPendingInteraction: false }));
  expect(followThread(idle, "run", "lead")?.id).toBe("run");
  expect(followThread(idle, null, "lead")?.id).toBe("lead");
  expect(followThread(idle, "deleted", null)?.id).toBe("new");
  expect(followThread([], null, null)).toBeUndefined();
});

test("⌘N belongs to a Command view only while it's in use, visible, and not composing", () => {
  document.body.innerHTML = `<div id="view" data-command-view><textarea id="inside"></textarea></div><div id="other"><input id="outside"></div>`;
  const doc = document;
  const view = doc.getElementById("view")!;
  const key = (init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: "n", metaKey: true, ...init });
  // Nothing focused: only if the last click was in the view.
  expect(claimsNewThreadKey(key(), view, false)).toBe(false);
  expect(claimsNewThreadKey(key(), view, true)).toBe(true);
  // Focus elsewhere (another split's composer) leaves it to BB, whatever was clicked.
  (doc.getElementById("outside") as HTMLElement).focus();
  expect(claimsNewThreadKey(key(), view, true)).toBe(false);
  (doc.getElementById("inside") as HTMLElement).focus();
  expect(claimsNewThreadKey(key(), view, false)).toBe(true);
  expect(claimsNewThreadKey(key({ key: "O", shiftKey: true }), view, false)).toBe(true);
  expect(claimsNewThreadKey(key({ metaKey: false }), view, false)).toBe(false);
  expect(claimsNewThreadKey(key({ isComposing: true }), view, false)).toBe(false);
  expect(claimsNewThreadKey(key({ repeat: true }), view, false)).toBe(false);
  // A hidden view, or one behind a dialog, doesn't take it.
  view.setAttribute("hidden", "");
  expect(claimsNewThreadKey(key(), view, false)).toBe(false);
  view.removeAttribute("hidden");
  doc.body.insertAdjacentHTML("beforeend", `<div role="dialog"></div>`);
  expect(claimsNewThreadKey(key(), view, false)).toBe(false);
});
