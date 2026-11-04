import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CANVAS_MIGRATIONS } from "./migrations";
import { CANVAS_LIMITS } from "./shared";
import { CanvasStore, clipCaption } from "./store";

function memory() {
  const db = new Database(":memory:");
  for (const migration of CANVAS_MIGRATIONS) db.exec(migration);
  let clock = 1_000;
  const store = new CanvasStore(db, () => clock);
  return { db, store, tick: (ms = 1000) => { clock += ms; } };
}

describe("canvas store", () => {
  it("keeps a canvas's look, classic when it has none", () => {
    const { store } = memory();
    store.create({ threadId: "thr_a", look: "instrument" });
    store.create({ threadId: "thr_b" });
    expect(store.list().map((each) => [each.threadId, each.look]).sort()).toEqual([["thr_a", "instrument"], ["thr_b", "classic"]]);
  });

  it("leaves out note items and link fields saved before notes were removed, and drops them on the next edit", () => {
    const { db, store } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    store.edit(id, [{ op: "add", item: { id: "map", kind: "map", data: { PA: 2 } } }], "agent");
    // Rows as an older Canvas wrote them: a note anchored to the map, and the map's connectors.
    db.prepare("INSERT INTO canvas_items (canvas_id, id, kind, title, data, options, html, size, importance, created_at, updated_at, rev, rel) VALUES (?, 'why', 'note', NULL, '\"Flipped\"', '{}', NULL, 's', 2, 1, 1, 1, ?)").run(id, JSON.stringify({ anchor: "map", point: { x: 0.7, y: 0.4 }, relatedTo: [] }));
    db.prepare("UPDATE canvas_items SET rel = ? WHERE id = 'map'").run(JSON.stringify({ relatedTo: ["why"], anchor: null, point: null }));
    db.prepare("INSERT INTO canvas_changes (canvas_id, rev, turn, op, item_id, summary, by, at) VALUES (?, 1, 0, 'add', 'why', 'Added note \"why\"', 'agent', 1)").run(id);
    expect(store.items(id).map((item) => item.id)).toEqual(["map"]);
    expect(Object.keys(store.items(id)[0]!)).not.toEqual(expect.arrayContaining(["relatedTo"]));
    expect(store.items(id)[0]).not.toHaveProperty("anchor");
    const view = store.view(id)!;
    expect(view.items.map((item) => item.id)).toEqual(["map"]);
    expect(view.itemCount).toBe(1);
    expect(view.changes.some((change) => change.summary.includes("note"))).toBe(false);
    // An item can take the old note's id; the next edit drops the old rows and links.
    store.edit(id, [{ op: "add", item: { id: "why", kind: "caption", data: "It flipped" } }], "agent");
    expect((db.prepare("SELECT id, kind, rel FROM canvas_items WHERE canvas_id = ? ORDER BY id").all(id))).toEqual([{ id: "map", kind: "map", rel: null }, { id: "why", kind: "caption", rel: null }]);
  });

  it("checks the new kinds' data", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    expect(() => store.edit(id, [{ op: "add", item: { kind: "quote", data: { by: "nobody" } } }], "agent")).toThrow(/quote needs data/);
    expect(() => store.edit(id, [{ op: "add", item: { kind: "timeline" } }], "agent")).toThrow(/timeline needs data/);
    expect(store.edit(id, [{ op: "add", item: { kind: "quote", data: "Every vote counts" } }], "agent").items[0]).toMatchObject({ kind: "quote", size: "m" });
  });

  it("keeps one board per thread", () => {
    const { store } = memory();
    const row = store.create({ threadId: "thr_a", title: "Election" });
    expect(store.byThread("thr_a")?.id).toBe(row.id);
    expect(() => store.create({ threadId: "thr_a" })).toThrow();
    expect(store.list().map((each) => each.title)).toEqual(["Election"]);
  });

  it("adds, updates and removes items, bumping the revision once per edit", () => {
    const { store, tick } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    const added = store.edit(id, [
      { op: "add", item: { kind: "headline", data: { text: "Democrats take the House" }, importance: 5 } },
      { op: "add", item: { id: "turnout", kind: "stat", title: "Turnout", data: { value: 51, delta: "+2" }, options: { unit: "%" } } },
    ], "agent");
    expect(added.rev).toBe(1);
    expect(added.items.map((item) => item.id).sort()).toEqual(["headline", "turnout"]);
    expect(added.items.find((item) => item.id === "turnout")).toMatchObject({ size: "s", importance: 3, rev: 1 });

    tick();
    const updated = store.edit(id, [{ op: "update", patch: { id: "turnout", data: { value: 52 }, options: { unit: null, decimals: 1 } } }], "voice");
    expect(updated.rev).toBe(2);
    const turnout = updated.items.find((item) => item.id === "turnout")!;
    expect(turnout).toMatchObject({ data: { value: 52 }, options: { decimals: 1 }, rev: 2, updatedAt: 2000, createdAt: 1000 });
    expect(updated.changes[0]).toMatchObject({ op: "update", itemId: "turnout", by: "voice" });
    expect(updated.changes[0]!.summary).toContain("data, options");

    const removed = store.edit(id, [{ op: "remove", id: "turnout" }], "agent");
    expect(removed.items.map((item) => item.id)).toEqual(["headline"]);
  });

  it("applies all ops or none", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    store.edit(id, [{ op: "add", item: { id: "a", kind: "stat", data: 1 } }], "agent");
    expect(() => store.edit(id, [{ op: "add", item: { id: "b", kind: "stat", data: 2 } }, { op: "remove", id: "missing" }], "agent")).toThrow(/No item "missing"/);
    expect(store.items(id).map((item) => item.id)).toEqual(["a"]);
    expect(store.get(id)!.rev).toBe(1);
  });

  it("replaces the board with set: same ids update in place, others leave and arrive", () => {
    const { store, tick } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    store.edit(id, [{ op: "add", item: { id: "a", kind: "stat", data: 1 } }, { op: "add", item: { id: "b", kind: "stat", data: 2 } }], "agent");
    tick();
    const result = store.edit(id, [{ op: "set", items: [{ id: "a", kind: "stat", data: 10 }, { id: "c", kind: "caption", data: "New topic" }] }], "agent");
    expect(result.items.map((item) => item.id).sort()).toEqual(["a", "c"]);
    expect(result.items.find((item) => item.id === "a")).toMatchObject({ data: 10, createdAt: 1000, updatedAt: 2000 });
    expect(result.changes.map((change) => `${change.op}:${change.itemId}`)).toEqual(["remove:b", "update:a", "add:c"]);
  });

  it("logs each change with the turn it happened in, and clears", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    store.beginTurn(id, "user", "How did the election go?");
    store.edit(id, [{ op: "add", item: { id: "a", kind: "stat", data: 1 } }], "agent");
    store.beginTurn(id, "user", "What's the weather?");
    store.edit(id, [{ op: "clear" }], "agent");
    const log = store.changes(id);
    expect(log.map((change) => [change.turn, change.op])).toEqual([[1, "add"], [2, "clear"]]);
    expect(store.items(id)).toEqual([]);
    expect(store.history(id).map((line) => line.text)).toEqual(["How did the election go?", "What's the weather?"]);
  });

  it("prunes the change log to the last few hundred", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    for (let n = 0; n < CANVAS_LIMITS.changesKept + 20; n++) store.edit(id, [{ op: "set", items: [{ id: "a", kind: "stat", data: n }] }], "agent");
    expect(store.changes(id, 1000)).toHaveLength(CANVAS_LIMITS.changesKept);
  });

  it("refuses more items than a board holds", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a" });
    const items = Array.from({ length: CANVAS_LIMITS.items + 1 }, (_, n) => ({ id: `s${n}`, kind: "stat" as const, data: n }));
    expect(() => store.edit(id, [{ op: "set", items }], "agent")).toThrow(/at most 24/);
  });

  it("clips the caption to one line of text", () => {
    expect(clipCaption("Democrats held the Senate.\n\n```js\ncode\n```\n::next{reply=\"x\"}")).toBe("Democrats held the Senate.");
    expect(clipCaption("x".repeat(1000))).toHaveLength(CANVAS_LIMITS.captionChars);
  });
});
