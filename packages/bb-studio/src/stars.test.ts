import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { compileQuery, parseQuery } from "./query";
import { StarStore } from "./stars";

function store() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return new StarStore(db);
}

const page = { pluginId: "studio", id: "pg_1" };
const board = { pluginId: "studio", id: "dr_1" };
const artifact = { pluginId: "artifacts", id: "art_1" };

describe("stars", () => {
  it("lists newest-starred first, across add-ons", () => {
    const stars = store();
    stars.set([page], true, 100);
    stars.set([artifact], true, 300);
    stars.set([board], true, 200);
    expect(stars.list()).toEqual([
      { ...artifact, starredAt: 300 },
      { ...board, starredAt: 200 },
      { ...page, starredAt: 100 },
    ]);
  });

  it("keeps when an item was first starred, and unstars", () => {
    const stars = store();
    stars.set([page, board], true, 100);
    stars.set([page], true, 500);
    expect(stars.map().get("studio:pg_1")).toBe(100);
    // One call keeps the order it was given, the last newest.
    expect(stars.list().map((star) => star.id)).toEqual(["dr_1", "pg_1"]);
    stars.set([page], false);
    expect(stars.list().map((star) => star.id)).toEqual(["dr_1"]);
    stars.set([page], false);
    expect(stars.list()).toHaveLength(1);
  });

  it("is keyed by id, so a rename keeps the star", () => {
    const stars = store();
    stars.set([page], true, 100);
    // Titles are read from the item when listed; nothing here holds one.
    expect(stars.map()).toEqual(new Map([["studio:pg_1", 100]]));
  });

  it("drops stars of deleted items and of items an add-on no longer lists", () => {
    const stars = store();
    stars.set([page, board, artifact], true, 100);
    stars.forget("studio", ["pg_1"]);
    expect(stars.prune("studio", new Set(["dr_1"]))).toBe(false);
    expect(stars.prune("artifacts", new Set())).toBe(true);
    expect(stars.list().map((star) => star.id)).toEqual(["dr_1"]);
  });

  it("filters with is:starred", () => {
    const vocabulary = { kinds: [{ id: "page", label: "Page", plural: "Pages" }], projects: [], tags: [] };
    const starred = compileQuery(parseQuery("is:starred"), vocabulary);
    expect(starred.unknown).toEqual([]);
    expect(starred.test({ kind: "page", projectId: null, archived: false, starredAt: 1 })).toBe(true);
    expect(starred.test({ kind: "page", projectId: null, archived: false, starredAt: null })).toBe(false);
    expect(starred.test({ kind: "page", projectId: null, archived: false })).toBe(false);
    expect(compileQuery(parseQuery("-is:starred"), vocabulary).test({ kind: "page", projectId: null, archived: false, starredAt: 1 })).toBe(false);
  });
});

describe("is:starred in the query bar", () => {
  it("reads as Starred", async () => {
    const { describeFilter } = await import("./query");
    expect(describeFilter({ field: "is", value: "starred" }, { kinds: [], projects: [], tags: [] }).value).toBe("Starred");
  });
});
