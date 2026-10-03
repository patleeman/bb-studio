import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS, PageStore } from "./store";

afterEach(() => vi.restoreAllMocks());

it("retains the newest versions at the live limit and supports keeping all", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const db = new Database(":memory:");
  try {
    for (const sql of MIGRATIONS) db.exec(sql);
    let limit = 2;
    const store = new PageStore(db, () => limit);
    const add = (page: string, label: string) => store.addSnapshot(page, new Uint8Array([1]), label, "user");
    add("page", "one");
    add("other", "keep me");
    add("page", "two");
    add("page", "three");
    expect(store.snapshots("page").map((item) => item.label)).toEqual(["three", "two"]);
    limit = 0;
    add("page", "four");
    add("page", "five");
    expect(store.snapshots("page")).toHaveLength(4);
    limit = 1;
    // Setting changes don't delete history until the next version is saved.
    expect(store.snapshots("page")).toHaveLength(4);
    add("page", "six");
    expect(store.snapshots("page").map((item) => item.label)).toEqual(["six"]);
    expect(store.snapshots("other").map((item) => item.label)).toEqual(["keep me"]);
  } finally {
    db.close();
  }
});
