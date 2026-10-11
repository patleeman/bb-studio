import { describe, expect, it } from "vitest";
import {
  ALL_SPACES,
  buildSpaceGroups,
  buildTrees,
  compactAge,
  createSpaceResolver,
  hiddenThreadIds,
  neighbourSpaceId,
  resolveCurrentSpace,
  spacesNeedingYou,
  threadLineIds,
  threadState,
  THREAD_LINES_LIMIT,
  type StudioSpace,
} from "./model.js";
import { thread } from "./test-thread.js";


const space = (id: string, extra: Partial<StudioSpace> = {}): StudioSpace =>
  ({ id, name: id, color: "red", icon: null, defaultProjectId: null, isDefault: false, projectIds: [], ...extra });

const home = space("home", { isDefault: true });
const launch = space("launch", { projectIds: ["proj_launch"] });
const spaces = [home, launch];

describe("Space placement", () => {
  it("puts a thread in its own Space, else its project's, else the default Space", () => {
    const threads = [thread("a"), thread("b", { projectId: "proj_launch" }), thread("c")];
    const resolve = createSpaceResolver(threads, { a: "launch", c: "gone" }, spaces);
    expect(threads.map(resolve)).toEqual(["launch", "launch", "home"]);
  });

  it("keeps a sub-thread with its root's Space", () => {
    const threads = [thread("root"), thread("child", { parentThreadId: "root" })];
    const resolve = createSpaceResolver(threads, { root: "launch", child: "home" }, spaces);
    expect(resolve(threads[1]!)).toBe("launch");
  });

  it("has no Space when Studio has none", () => {
    expect(createSpaceResolver([thread("a")], {}, [])(thread("a"))).toBeNull();
  });
});

describe("buildSpaceGroups", () => {
  it("lays a Space out as lead, pins in pin order, then threads that need you first", () => {
    const threads = [
      thread("old", { updatedAt: 1 }),
      thread("new", { updatedAt: 5 }),
      thread("asks", { updatedAt: 0, hasPendingInteraction: true }),
      thread("lead", { updatedAt: 0 }),
      thread("pin2", { isPinned: true, pinSortKey: "b" }),
      thread("pin1", { isPinned: true, pinSortKey: "a" }),
      thread("worker", { parentThreadId: "lead" }),
    ];
    const [homeGroup, launchGroup] = buildSpaceGroups(threads, spaces, {}, { home: "lead" });
    expect(launchGroup!.all).toEqual([]);
    expect(homeGroup!.lead?.thread.id).toBe("lead");
    expect(homeGroup!.lead?.children.map((node) => node.thread.id)).toEqual(["worker"]);
    expect(homeGroup!.pinned.map((node) => node.thread.id)).toEqual(["pin1", "pin2"]);
    expect(homeGroup!.rest.map((node) => node.thread.id)).toEqual(["asks", "new", "old"]);
  });

  it("ranks a tree by its most urgent sub-thread", () => {
    const threads = [thread("quiet", { updatedAt: 9 }), thread("parent"), thread("kid", { parentThreadId: "parent", indicator: "unread-error" })];
    const [group] = buildSpaceGroups(threads, [home], {}, {});
    expect(group!.rest.map((node) => node.thread.id)).toEqual(["parent", "quiet"]);
  });

  it("nests sub-threads under their parent and treats orphans as roots", () => {
    const trees = buildTrees([thread("a"), thread("b", { parentThreadId: "a" }), thread("c", { parentThreadId: "missing" })]);
    expect(trees.map((node) => [node.thread.id, node.children.map((child) => child.thread.id)])).toEqual([["a", ["b"]], ["c", []]]);
  });
});

describe("Space switcher", () => {
  it("steps through All, then each Space, wrapping", () => {
    expect(neighbourSpaceId(spaces, ALL_SPACES, 1)).toBe("home");
    expect(neighbourSpaceId(spaces, "launch", 1)).toBe(ALL_SPACES);
    expect(neighbourSpaceId(spaces, ALL_SPACES, -1)).toBe("launch");
    expect(neighbourSpaceId([], ALL_SPACES, 1)).toBeNull();
  });

  it("reads the stored Space, falling back to the default Space", () => {
    expect(resolveCurrentSpace(spaces, "launch")).toBe("launch");
    expect(resolveCurrentSpace(spaces, "deleted")).toBe("home");
    expect(resolveCurrentSpace(spaces, null)).toBe("home");
    expect(resolveCurrentSpace(spaces, ALL_SPACES)).toBe(ALL_SPACES);
  });

  it("marks the Spaces with a thread that needs you", () => {
    const threads = [thread("a", { hasPendingInteraction: true }), thread("b", { isUnread: true })];
    const resolve = createSpaceResolver(threads, { a: "launch" }, spaces);
    expect([...spacesNeedingYou(threads, resolve)]).toEqual(["launch"]);
  });
});

describe("two-line rows", () => {
  it("states a row by what it asks of the user, most urgent first", () => {
    expect(threadState(thread("a", { hasPendingInteraction: true, status: "active" }))).toBe("needs-you");
    expect(threadState(thread("a", { status: "active" }))).toBe("working");
    expect(threadState(thread("a", { indicator: "unread-error" }))).toBe("error");
    expect(threadState(thread("a", { isUnread: true }))).toBe("unread");
    expect(threadState(thread("a"))).toBe("idle");
  });

  it("asks for leads' lines first, then the newest, capped", () => {
    const rest = Array.from({ length: 80 }, (_, index) => thread(`t${index}`, { updatedAt: index }));
    const ids = threadLineIds([thread("lead")], rest);
    expect(ids).toHaveLength(THREAD_LINES_LIMIT);
    expect(ids.slice(0, 3)).toEqual(["lead", "t79", "t78"]);
  });

  it("shows compact ages", () => {
    const now = 400 * 86_400_000;
    expect(compactAge(now, now)).toBe("now");
    expect(compactAge(now - 5 * 60_000, now)).toBe("5m");
    expect(compactAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(compactAge(now - 366 * 86_400_000, now)).toBe("1y");
  });
});

describe("hidden threads", () => {
  it("hides a thread and its sub-threads, but never a pinned tree, a lead, or the open thread's ancestry", () => {
    const threads = [
      thread("a"), thread("a1", { parentThreadId: "a" }),
      thread("p", { isPinned: true }),
      thread("lead"),
      thread("b"), thread("open", { parentThreadId: "b" }),
    ];
    const ids = hiddenThreadIds(threads, ["a", "p", "lead", "b"], new Set(["lead", "open"]));
    expect([...ids].sort()).toEqual(["a", "a1"]);
  });
});
