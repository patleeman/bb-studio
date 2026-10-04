import { describe, expect, it } from "vitest";
import { makeSidebarThread as thread } from "../testing/fixtures.js";
import { backgroundThreadIds, backgroundUpdates } from "./background-threads.js";

describe("background thread visibility", () => {
  it("groups bot and automation trees, including attached existing threads", () => {
    const rows = [
      thread({ id: "bot", originPluginId: "bot-teams" }),
      thread({ id: "run", originPluginId: "automations" }),
      thread({ id: "child", parentThreadId: "run" }),
      thread({ id: "target" }),
      thread({ id: "target-child", parentThreadId: "target" }),
      thread({ id: "ordinary", originPluginId: "pages" }),
    ];
    expect([...backgroundThreadIds(rows, new Set(["target"]))].sort()).toEqual(["bot", "child", "run", "target", "target-child"]);
  });

  it("keeps pinned threads and their descendants in the main list", () => {
    const rows = [
      thread({ id: "run", originPluginId: "automations", isPinned: true }),
      thread({ id: "child", parentThreadId: "run" }),
      thread({ id: "other", originPluginId: "bot-teams" }),
      thread({ id: "pinned-child", parentThreadId: "other", isPinned: true }),
    ];
    expect([...backgroundThreadIds(rows, new Set())]).toEqual(["other"]);
  });

  it("only surfaces completed unread results, input requests, failed queues, and the selected thread", () => {
    const rows = [
      thread({ id: "read", isUnread: false }),
      thread({ id: "unread" }),
      thread({ id: "error", status: "error" }),
      thread({ id: "running", status: "active" }),
      thread({ id: "input", isUnread: false, hasPendingInteraction: true }),
      thread({ id: "queue", isUnread: false, queuedWork: "failed" }),
      thread({ id: "selected", isUnread: false }),
    ];
    expect(backgroundUpdates(rows, "selected").map((row) => row.id)).toEqual(["unread", "error", "input", "queue", "selected"]);
  });

  it("keeps ancestors of a child update and handles cyclic data", () => {
    const rows = [
      thread({ id: "root", isUnread: false }),
      thread({ id: "child", parentThreadId: "root" }),
      thread({ id: "a", parentThreadId: "b", isUnread: false }),
      thread({ id: "b", parentThreadId: "a" }),
    ];
    expect(backgroundUpdates(rows).map((row) => row.id)).toEqual(["root", "child", "a", "b"]);
    expect(backgroundThreadIds(rows, new Set(["a"]))).toEqual(new Set(["a", "b"]));
  });
});
