import { expect, test } from "vitest";
import type { BotActivityView, BotThreadView } from "../../contract";
import { forgetThreadStrips, sidebarGroups } from "./workspace";

test("the removed Threads tab's saved strips are forgotten, nothing else", () => {
  const store = new Map([["studio.bot.bot_main.threads", "{}"], ["studio.bot.bot_x.threads", "{}"], ["studio.bot.sidebar", "{}"], ["studio.bot.previousThreadList", "x"]]);
  forgetThreadStrips({ get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null, removeItem: (key) => { store.delete(key); } });
  expect([...store.keys()]).toEqual(["studio.bot.sidebar", "studio.bot.previousThreadList"]);
});

const t = (id: string, extra: Partial<BotThreadView> = {}): BotThreadView => ({ id, title: id, status: "idle", projectId: null, updatedAt: 1, relation: "started", needsYou: false, parentId: null, ...extra });
const view = (patch: Partial<BotActivityView>): BotActivityView => ({ needsYou: [], inProgress: [], waiting: [], scheduled: [], completed: [], latest: null, ...patch });

test("sidebar groups: Needs you flat; trees placed by their root; grandchildren nest; its own thread and check-in left out", () => {
  const groups = sidebarGroups(view({
    needsYou: [t("self", { relation: "self", needsYou: true }), t("ask", { needsYou: true, parentId: "root" })],
    inProgress: [t("grand", { status: "active", parentId: "child", updatedAt: 5 })],
    completed: [t("root", { updatedAt: 2 }), t("child", { parentId: "root", updatedAt: 3 }), t("other", { updatedAt: 9 }), t("orphan", { parentId: "gone", updatedAt: 1 })],
    scheduled: [{ id: "h", kind: "heartbeat", name: "Check-in", cron: null, enabled: true, nextRunAt: null }, { id: "a", kind: "automation", name: "Sweep", cron: null, enabled: true, nextRunAt: null }],
  }));
  expect(groups.needsYou.map((each) => each.id)).toEqual(["ask"]);
  expect(groups.running.map((node) => node.thread.id)).toEqual(["root"]);
  const root = groups.running[0]!;
  // Children newest first: child (3) before ask (1).
  expect(root.children.map((node) => node.thread.id)).toEqual(["child", "ask"]);
  expect(root.children[0]!.children.map((node) => node.thread.id)).toEqual(["grand"]);
  expect(groups.recent.map((node) => node.thread.id)).toEqual(["other", "orphan"]);
  expect(groups.recurring.map((each) => each.id)).toEqual(["a"]);
  expect(sidebarGroups(null)).toEqual({ needsYou: [], running: [], recurring: [], recent: [] });
});

test("a thread that needs the user isn't repeated in the trees unless it holds children", () => {
  const groups = sidebarGroups(view({ needsYou: [t("ask", { needsYou: true }), t("parent", { needsYou: true })], completed: [t("kid", { parentId: "parent" })] }));
  expect(groups.needsYou.map((each) => each.id)).toEqual(["ask", "parent"]);
  expect(groups.recent.map((node) => node.thread.id)).toEqual(["parent"]);
});

test("a parent cycle can't loop the tree", () => {
  const groups = sidebarGroups(view({ completed: [t("a", { parentId: "b" }), t("b", { parentId: "a" }), t("c")] }));
  expect(groups.recent.map((node) => node.thread.id)).toEqual(["c"]);
});
