import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { attach, isTabActive, type Tab } from "./tabs";

function tab(ref: string, kind: Tab["kind"], patch: Partial<Tab> = {}): Tab {
  return { ref, kind, title: null, icon: null, href: null, zone: "today", folderId: null, openedAt: 1, archivedAt: null, ...patch };
}

function thread(id: string, title: string, patch: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return { id, displayTitle: title, isUnread: false, hasPendingInteraction: false, runtimeStatus: "idle", ...patch } as unknown as PluginSidebarThread;
}

describe("attach", () => {
  const threads = new Map([["t1", thread("t1", "Fix login", { isUnread: true, hasPendingInteraction: true })]]);

  it("gives thread tabs their title and state from BB's thread list", () => {
    const [shown] = attach([tab("thread:t1", "thread")], threads);
    expect(shown).toMatchObject({ title: "Fix login", unread: true, needsYou: true });
    expect(shown!.thread?.id).toBe("t1");
  });

  it("drops thread tabs BB no longer lists, and names untitled items", () => {
    const shown = attach([tab("thread:gone", "thread"), tab("item:studio:p1", "item", { href: "/p1" })], threads);
    expect(shown.map((entry) => entry.title)).toEqual(["Untitled"]);
  });
});

describe("isTabActive", () => {
  const [page] = attach([tab("item:studio:p1", "item", { href: "/plugins/studio/p1" })], new Map());
  const [bot] = attach([tab("bot:b1", "bot", { href: "/plugins/studio/office-team/b1", title: "Dot" })], new Map());
  const [chat] = attach([tab("thread:t1", "thread")], new Map([["t1", thread("t1", "Chat")]]));

  it("matches pages by path, and never while a thread is open", () => {
    expect(isTabActive(page!, null, "/plugins/studio/p1")).toBe(true);
    expect(isTabActive(page!, "t9", "/plugins/studio/p1")).toBe(false);
    expect(isTabActive(page!, null, "/plugins/studio/p1/child")).toBe(false);
  });

  it("matches a bot on any of its desk tabs, and threads by id", () => {
    expect(isTabActive(bot!, null, "/plugins/studio/office-team/b1/profile")).toBe(true);
    expect(isTabActive(chat!, "t1", "/anything")).toBe(true);
  });
});

describe("split tabs", () => {
  const threads = new Map([["t1", thread("t1", "Plan", { isUnread: true })], ["t2", thread("t2", "Notes")]]);
  const split = tab("split:s1", "split", { members: [tab("thread:t1", "thread"), tab("item:pages:p", "item", { title: "Doc", href: "/p" })] });

  it("titles a split from its members and carries their state", () => {
    const [shown] = attach([split], threads);
    expect(shown).toMatchObject({ title: "Plan | Doc", unread: true });
    expect(shown!.members?.map((member) => member.title)).toEqual(["Plan", "Doc"]);
  });

  it("drops a split whose members are all gone, and is active when any member shows", () => {
    expect(attach([tab("split:s2", "split", { members: [tab("thread:gone", "thread")] })], threads)).toEqual([]);
    const [shown] = attach([split], threads);
    expect(isTabActive(shown!, "t1", "/x")).toBe(true);
    expect(isTabActive(shown!, null, "/p")).toBe(true);
    expect(isTabActive(shown!, "t2", "/x")).toBe(false);
  });
});
