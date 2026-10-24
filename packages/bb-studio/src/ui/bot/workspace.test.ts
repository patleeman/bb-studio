import { expect, test } from "vitest";
import type { BotActivityView, BotThreadView } from "../../contract";
import { forgetThreadStrips, sidebarGroups } from "./workspace";

test("the removed Threads tab's saved strips are forgotten, nothing else", () => {
  const store = new Map([["studio.bot.bot_main.threads", "{}"], ["studio.bot.bot_x.threads", "{}"], ["studio.bot.sidebar", "{}"], ["studio.bot.previousThreadList", "x"]]);
  forgetThreadStrips({ get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null, removeItem: (key) => { store.delete(key); } });
  expect([...store.keys()]).toEqual(["studio.bot.sidebar", "studio.bot.previousThreadList"]);
});

const t = (id: string, extra: Partial<BotThreadView> = {}): BotThreadView => ({ id, title: id, status: "idle", projectId: null, updatedAt: 1, relation: "started", parentId: null, ...extra });
const view = (patch: Partial<BotActivityView>): BotActivityView => ({ attention: null, inProgress: [], waiting: [], scheduled: [], completed: [], latest: null, ...patch });

test("sidebar groups: no Needs you; trees placed by their root; grandchildren nest; its own thread and check-in left out", () => {
  const groups = sidebarGroups(view({
    attention: { reason: "Asked you a question", count: 1, since: 1 },
    inProgress: [t("self", { relation: "self", status: "active" }), t("grand", { status: "active", parentId: "child", updatedAt: 5 }), t("ask", { status: "active", waitingFor: "Waiting for an answer", parentId: "root", updatedAt: 1 })],
    completed: [t("root", { updatedAt: 2 }), t("child", { parentId: "root", updatedAt: 3 }), t("other", { updatedAt: 9 }), t("orphan", { parentId: "gone", updatedAt: 1 })],
    scheduled: [{ id: "h", kind: "heartbeat", name: "Check-in", cron: null, enabled: true, nextRunAt: null }, { id: "a", kind: "automation", name: "Sweep", cron: null, enabled: true, nextRunAt: null }],
  }));
  expect(groups).not.toHaveProperty("needsYou");
  expect(groups.running.map((node) => node.thread.id)).toEqual(["root"]);
  const root = groups.running[0]!;
  // Children newest first: child (3) before ask (1).
  expect(root.children.map((node) => node.thread.id)).toEqual(["child", "ask"]);
  expect(root.children[0]!.children.map((node) => node.thread.id)).toEqual(["grand"]);
  expect(groups.recent.map((node) => node.thread.id)).toEqual(["other", "orphan"]);
  expect(groups.recurring.map((each) => each.id)).toEqual(["a"]);
  expect(sidebarGroups(null)).toEqual({ running: [], waiting: [], recurring: [], recent: [] });
});

test("a thread waiting on an answer is under Running by its state, the Bot's to handle", () => {
  const groups = sidebarGroups(view({ inProgress: [t("ask", { status: "idle", waitingFor: "Waiting for approval" })], completed: [t("done")] }));
  expect(groups.running.map((node) => [node.thread.id, node.thread.waitingFor])).toEqual([["ask", "Waiting for approval"]]);
  expect(groups.recent.map((node) => node.thread.id)).toEqual(["done"]);
});

test("a parent cycle can't loop the tree", () => {
  const groups = sidebarGroups(view({ completed: [t("a", { parentId: "b" }), t("b", { parentId: "a" }), t("c")] }));
  expect(groups.recent.map((node) => node.thread.id)).toEqual(["c"]);
});

test("a queued thread waits to start in its own group, not under Running", () => {
  const groups = sidebarGroups(view({ inProgress: [t("run", { status: "active" })], waiting: [t("queued", { status: "pending" })], completed: [t("done")] }));
  expect(groups.running.map((node) => node.thread.id)).toEqual(["run"]);
  expect(groups.waiting.map((node) => node.thread.id)).toEqual(["queued"]);
  expect(groups.recent.map((node) => node.thread.id)).toEqual(["done"]);
});
