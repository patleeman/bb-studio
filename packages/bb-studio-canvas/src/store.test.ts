import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CANVAS_MIGRATIONS } from "./migrations";
import { CANVAS_LIMITS } from "./shared";
import { CanvasStore, clipCaption, dropBoardTalk } from "./store";

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

  it("keeps placement: scale, region, pin, side and bleed; set replaces them", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a", look: "editorial" });
    store.edit(id, [
      { op: "add", item: { id: "chart", kind: "line", data: [{ x: "a", y: 1 }, { x: "b", y: 2 }], scale: "hero", bleed: true } },
      { op: "add", item: { id: "fact", kind: "stat", data: 4, region: "top-right", pinnedTo: "chart", point: { x: 1, y: 0.2 }, side: "right", scale: "small" } },
    ], "agent");
    expect(store.items(id).find((item) => item.id === "chart")).toMatchObject({ scale: "hero", bleed: true, region: null });
    expect(store.items(id).find((item) => item.id === "fact")).toMatchObject({ region: "top-right", pinnedTo: "chart", side: "right", scale: "small", point: { x: 1, y: 0.2 } });
    store.edit(id, [{ op: "update", patch: { id: "fact", region: null } }], "agent");
    expect(store.items(id).find((item) => item.id === "fact")).toMatchObject({ region: null, pinnedTo: "chart" });
    store.edit(id, [{ op: "set", items: [{ id: "fact", kind: "stat", data: 5 }] }], "agent");
    expect(store.items(id)[0]).toMatchObject({ id: "fact", region: null, pinnedTo: null, scale: null, side: null, bleed: null });
  });

  it("keeps the title on the topic: the agent's, else the board's headline or hero, and a new board renames it", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a", title: "give me a rundown of the election yesterday", look: "editorial" });
    store.edit(id, [{ op: "set", items: [{ id: "h", kind: "headline", data: { text: "Democrats take the House" } }, { id: "seats", kind: "stat", data: 221, importance: 5 }] }], "agent");
    expect(store.get(id)!.title).toBe("Democrats take the House");
    // The agent names it: that sticks through follow-ups on the same board.
    store.edit(id, [{ op: "board", title: "Election 2026" }], "agent");
    store.edit(id, [{ op: "update", patch: { id: "h", data: { text: "Democrats hold the House" } } }], "agent");
    expect(store.get(id)!.title).toBe("Election 2026");
    // A new topic (nothing of the old board stays) takes the new board's hero, unless the agent names it.
    store.edit(id, [{ op: "set", items: [{ id: "studio", kind: "custom", title: "BB Studio at a glance", html: "<p>x</p>", importance: 5 }] }], "agent");
    expect(store.get(id)!.title).toBe("BB Studio at a glance");
    store.edit(id, [{ op: "clear" }, { op: "board", title: "Week plan" }], "agent");
    expect(store.get(id)!.title).toBe("Week plan");
  });

  it("keeps the board as one page: a new page replaces old items, its heading titles it, and parts patch by id", () => {
    const { store } = memory();
    const { id } = store.create({ threadId: "thr_a", title: "give me a rundown", look: "editorial" });
    store.edit(id, [{ op: "add", item: { id: "old", kind: "stat", data: 1 } }], "agent");
    const page = '<header data-cv-id="title"><h1>Democrats take the House</h1></header><section data-cv-id="seats"><b>221</b></section>';
    expect(store.setPage(id, page, "agent")).toMatchObject({ parts: 2 });
    const view = store.view(id)!;
    expect(view).toMatchObject({ page, title: "Democrats take the House", items: [] });
    expect(view.changes.at(-1)).toMatchObject({ op: "page", summary: "New page (2 parts)" });
    // A part changes in place; a missing one lists the parts there are.
    store.patchPage(id, "seats", '<section data-cv-id="seats"><b>223</b></section>', "agent");
    expect(store.view(id)!.page).toContain("<b>223</b>");
    expect(() => store.patchPage(id, "nope", "<p>x</p>", "agent")).toThrow(/Its parts: title, seats/);
    // "" removes it; the agent's title wins over the heading.
    store.patchPage(id, "seats", "", "agent");
    expect(store.view(id)!.page).not.toContain("seats");
    store.setPage(id, "<h1>Next</h1>", "agent", "Election 2026");
    expect(store.get(id)!.title).toBe("Election 2026");
    expect(() => store.setPage(id, "x".repeat(300 * 1024), "agent")).toThrow(/over 200 KB/);
  });


  it("drops caption sentences that describe the board, and keeps the rest", () => {
    expect(clipCaption("The board has the overview. I built it from the tools this session exposes, so some details may be off.")).toBe("I built it from the tools this session exposes, so some details may be off.");
    expect(dropBoardTalk("I've laid out a proposed week on the board. Book the dentist before Wednesday.")).toBe("Book the dentist before Wednesday.");
    expect(dropBoardTalk("Fix chat first. The page shows both queues. In-app needs an owner too.")).toBe("Fix chat first. In-app needs an owner too.");
    expect(dropBoardTalk("Democrats took the House; check AP before quoting it.")).toBe("Democrats took the House; check AP before quoting it.");
    // Nothing but board talk stays, rather than an empty caption.
    expect(dropBoardTalk("The board shows the results.")).toBe("The board shows the results.");
  });
});
