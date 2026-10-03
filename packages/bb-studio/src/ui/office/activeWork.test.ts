import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import { activeGroups, DEFAULT_VIEW, type Row } from "./activeWork";
import type { TreeFolder } from "./model";

const NOW = 1_000_000_000_000;

function thread(id: string, projectId: string, title: string, updatedAt: number): PluginSidebarThread {
  return { id, projectId, displayTitle: title, updatedAt, latestAttentionAt: 0, runtimeStatus: "idle", hasPendingInteraction: false, isUnread: false, isPinned: false, isHidden: false, isArchived: false, parentThreadId: null, lifecycleOwnerThreadId: null, originPluginId: null } as unknown as PluginSidebarThread;
}

function folder(id: string, name: string, items: { id: string; kind: string; title: string; updatedAt: number }[]): TreeFolder {
  return { id, name, archived: false, items: items.map((item) => ({ ...item, pluginId: "studio", href: `/x/${item.id}` })) } as unknown as TreeFolder;
}

const title = (row: Row) => (row.type === "thread" ? row.thread.displayTitle : row.item.title);

const folders = [
  folder("a", "Alpha", [{ id: "p1", kind: "page", title: "Zebra notes", updatedAt: NOW - 1000 }, { id: "b1", kind: "board", title: "Roadmap", updatedAt: NOW - 3000 }]),
  folder("b", "Beta", [{ id: "p2", kind: "page", title: "Apple plan", updatedAt: NOW - 2000 }, { id: "old", kind: "page", title: "Stale", updatedAt: 0 }]),
];
const threads = [thread("t1", "a", "Fix login", NOW - 500), thread("t2", "b", "Ask about deploy", NOW - 4000)];

describe("activeGroups", () => {
  it("groups by folder, newest first, by default", () => {
    const groups = activeGroups(folders, threads, {}, DEFAULT_VIEW, NOW);
    expect(groups.map((group) => group.label)).toEqual(["Alpha", "Beta"]);
    expect(groups[0]!.rows.map(title)).toEqual(["Fix login", "Zebra notes", "Roadmap"]);
    expect(groups[1]!.rows.map(title)).toEqual(["Apple plan", "Ask about deploy"]);
  });

  it("groups by type across folders, threads first", () => {
    const groups = activeGroups(folders, threads, {}, { groupBy: "type", sortBy: "recent" }, NOW);
    expect(groups.map((group) => group.label)).toEqual(["Threads", "Pages", "Boards"]);
    expect(groups[1]!.rows.map(title)).toEqual(["Zebra notes", "Apple plan"]);
    expect(groups[1]!.rows.map((row) => row.folder.name)).toEqual(["Alpha", "Beta"]);
  });

  it("lists everything in one group, sorted by name", () => {
    const groups = activeGroups(folders, threads, {}, { groupBy: "none", sortBy: "name" }, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map(title)).toEqual(["Apple plan", "Ask about deploy", "Fix login", "Roadmap", "Zebra notes"]);
  });

  it("leaves out closed rows and returns no groups when nothing is active", () => {
    const closed = { "thread:t1": NOW, "thread:t2": NOW, "item:studio:p1": NOW, "item:studio:p2": NOW, "item:studio:b1": NOW };
    expect(activeGroups(folders, threads, closed, { groupBy: "type", sortBy: "recent" }, NOW)).toEqual([]);
  });
});
