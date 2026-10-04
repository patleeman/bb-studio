import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { itemAtPath, MAX_TABS, TabStore } from "./tabs";

function store() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return new TabStore(db);
}

const page = { pluginId: "pages", id: "pg_1" };
const drawing = { pluginId: "excalidraw", id: "d1" };
const ids = (tabs: TabStore) => tabs.list().map((tab) => tab.id);

describe("tabs", () => {
  it("open once each, in the order opened", () => {
    const tabs = store();
    expect(tabs.open(page)).toBe(true);
    expect(tabs.open(drawing)).toBe(true);
    expect(tabs.open(page)).toBe(false);
    expect(tabs.list()).toEqual([{ ...page, pinned: false }, { ...drawing, pinned: false }]);
  });

  it("close, and reopen at the end", () => {
    const tabs = store();
    tabs.open(page);
    tabs.open(drawing);
    expect(tabs.close(page)).toBe(true);
    expect(tabs.close(page)).toBe(false);
    tabs.open(page);
    expect(ids(tabs)).toEqual(["d1", "pg_1"]);
  });

  it("close tabs of items that are gone", () => {
    const tabs = store();
    tabs.open(page);
    tabs.open({ pluginId: "pages", id: "pg_2" });
    tabs.open(drawing);
    expect(tabs.prune("pages", new Set(["pg_2"]))).toBe(true);
    expect(tabs.prune("pages", new Set(["pg_2"]))).toBe(false);
    expect(ids(tabs)).toEqual(["pg_2", "d1"]);
    expect(tabs.forget("excalidraw", ["d1"])).toBe(true);
  });

  it("close the oldest past the limit", () => {
    const tabs = store();
    for (let index = 0; index <= MAX_TABS; index++) tabs.open({ pluginId: "pages", id: `pg_${index}` });
    const list = tabs.list();
    expect(list).toHaveLength(MAX_TABS);
    expect(list[0]!.id).toBe("pg_1");
  });

  it("list pinned tabs first, keeping their opened order", () => {
    const tabs = store();
    for (const id of ["a", "b", "c", "d"]) tabs.open({ pluginId: "pages", id });
    expect(tabs.pin({ pluginId: "pages", id: "c" }, true)).toBe(true);
    expect(tabs.pin({ pluginId: "pages", id: "c" }, true)).toBe(false);
    tabs.pin({ pluginId: "pages", id: "b" }, true);
    expect(tabs.list().map((tab) => [tab.id, tab.pinned])).toEqual([["b", true], ["c", true], ["a", false], ["d", false]]);
    expect(tabs.pin({ pluginId: "pages", id: "b" }, false)).toBe(true);
    expect(ids(tabs)).toEqual(["c", "a", "b", "d"]);
    // Pinning an item that isn't open opens it.
    expect(tabs.pin({ pluginId: "pages", id: "e" }, true)).toBe(true);
    expect(ids(tabs)).toEqual(["c", "e", "a", "b", "d"]);
    expect(tabs.pin({ pluginId: "pages", id: "f" }, false)).toBe(false);
  });

  it("never close pinned tabs to make room", () => {
    const tabs = store();
    tabs.open({ pluginId: "pages", id: "pinned" });
    tabs.pin({ pluginId: "pages", id: "pinned" }, true);
    for (let index = 0; index < MAX_TABS + 5; index++) tabs.open({ pluginId: "pages", id: `pg_${index}` });
    const list = tabs.list();
    expect(list).toHaveLength(MAX_TABS);
    expect(list[0]).toEqual({ pluginId: "pages", id: "pinned", pinned: true });
    expect(list[1]!.id).toBe("pg_6");
    expect(list.at(-1)!.id).toBe(`pg_${MAX_TABS + 4}`);
  });

  it("close pinned tabs of deleted items", () => {
    const tabs = store();
    tabs.pin(page, true);
    tabs.pin(drawing, true);
    expect(tabs.forget("pages", ["pg_1"])).toBe(true);
    expect(tabs.prune("excalidraw", new Set())).toBe(true);
    expect(tabs.list()).toEqual([]);
  });
});

describe("itemAtPath", () => {
  const items = [
    { id: "a", href: "/plugins/pages/pages/pg_1" },
    { id: "b", href: "/plugins/pages/pages/pg_10" },
    { id: "c", href: "/plugins/talk/talk/rec_1?view=notes" },
  ];
  it("matches a link or a path below it, not a prefix of another id", () => {
    expect(itemAtPath(items, "/plugins/pages/pages/pg_1")?.id).toBe("a");
    expect(itemAtPath(items, "/plugins/pages/pages/pg_10/")?.id).toBe("b");
    expect(itemAtPath(items, "/plugins/pages/pages/pg_1/comments")?.id).toBe("a");
    expect(itemAtPath(items, "/plugins/talk/talk/rec_1")?.id).toBe("c");
    expect(itemAtPath(items, "/plugins/pages/pages")).toBeNull();
  });
});
