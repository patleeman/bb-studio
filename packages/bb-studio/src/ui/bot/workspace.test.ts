import { expect, test } from "vitest";
import type { BotActivityView, BotThreadView } from "../../contract";
import { EMPTY_STRIP, parseStrip, sidebarGroups, STRIP_LIMIT, type Strip, stripClose, stripMove, stripOpen, THREADS_TAB } from "./workspace";

test("the strip opens, focuses, closes to the right-hand neighbor, and reorders", () => {
  let strip = stripOpen(stripOpen(stripOpen(EMPTY_STRIP, "a"), "b"), "c");
  expect(strip).toEqual({ open: ["a", "b", "c"], active: "c" });
  expect(stripOpen(strip, "a")).toEqual({ open: ["a", "b", "c"], active: "a" });
  strip = stripClose({ ...strip, active: "b" }, "b");
  expect(strip).toEqual({ open: ["a", "c"], active: "c" });
  expect(stripClose(strip, "c")).toEqual({ open: ["a"], active: "a" });
  expect(stripClose({ open: ["a"], active: "a" }, "a")).toEqual({ open: [], active: null });
  expect(stripMove({ open: ["a", "b", "c"], active: "a" }, "c", 0).open).toEqual(["c", "a", "b"]);
  expect(stripMove({ open: ["a", "b", "c"], active: "a" }, "a", 99).open).toEqual(["b", "c", "a"]);
});

test("the strip keeps at most STRIP_LIMIT, dropping the oldest it isn't showing", () => {
  let strip: Strip = { open: Array.from({ length: STRIP_LIMIT }, (_, i) => `t${i}`), active: "t0" };
  strip = stripOpen(strip, "new");
  expect(strip.open).toHaveLength(STRIP_LIMIT);
  expect(strip.open).toContain("t0");
  expect(strip.open).not.toContain("t1");
  expect(strip.active).toBe("new");
});

test("a saved strip is read defensively and stable for the same text", () => {
  expect(parseStrip("")).toBe(EMPTY_STRIP);
  expect(parseStrip("{bad")).toBe(EMPTY_STRIP);
  expect(parseStrip('{"open":["a",3,"b"],"active":"zz"}')).toEqual({ open: ["a", "b"], active: "b" });
  expect(parseStrip('{"open":["a"],"active":"a"}')).toBe(parseStrip('{"open":["a"],"active":"a"}'));
});

test("the Threads tab only accepts a thread id as its target", () => {
  const { validate } = THREADS_TAB.experimental_target;
  expect(validate({ threadId: "thr_1" })).toBe(true);
  expect(validate({ threadId: 3 })).toBe(false);
  expect(validate({ threadId: "../x" })).toBe(false);
  expect(validate(null)).toBe(false);
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
