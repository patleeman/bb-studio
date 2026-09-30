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

describe("tabs", () => {
  it("open once each, in the order opened", () => {
    const tabs = store();
    expect(tabs.open(page)).toBe(true);
    expect(tabs.open(drawing)).toBe(true);
    expect(tabs.open(page)).toBe(false);
    expect(tabs.list()).toEqual([page, drawing]);
  });

  it("close, and reopen at the end", () => {
    const tabs = store();
    tabs.open(page);
    tabs.open(drawing);
    expect(tabs.close(page)).toBe(true);
    expect(tabs.close(page)).toBe(false);
    tabs.open(page);
    expect(tabs.list()).toEqual([drawing, page]);
  });

  it("close tabs of items that are gone", () => {
    const tabs = store();
    tabs.open(page);
    tabs.open({ pluginId: "pages", id: "pg_2" });
    tabs.open(drawing);
    expect(tabs.prune("pages", new Set(["pg_2"]))).toBe(true);
    expect(tabs.prune("pages", new Set(["pg_2"]))).toBe(false);
    expect(tabs.list()).toEqual([{ pluginId: "pages", id: "pg_2" }, drawing]);
    expect(tabs.forget("excalidraw", ["d1"])).toBe(true);
  });

  it("close the oldest past the limit", () => {
    const tabs = store();
    for (let index = 0; index <= MAX_TABS; index++) tabs.open({ pluginId: "pages", id: `pg_${index}` });
    const list = tabs.list();
    expect(list).toHaveLength(MAX_TABS);
    expect(list[0]!.id).toBe("pg_1");
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
