import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DesignStore, MIGRATIONS, displayName } from "./store";

function memoryStore(now: () => number = Date.now) {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { db, store: new DesignStore(db, now) };
}

const html = (text: string) => `<!doctype html><title>${text}</title><p>${text}</p>`;

describe("the design store", () => {
  it("creates untitled designs in a project", () => {
    const { store } = memoryStore(() => 1_000);
    const row = store.create({ name: "", projectId: "proj_a", by: "app" });
    expect(row).toMatchObject({ name: "", project_id: "proj_a", updated_at: 1_000, updated_by: "user" });
    expect(displayName(row)).toBe("Untitled design");
  });

  it("files screens under the round their id names", () => {
    const { store } = memoryStore();
    const row = store.create({ name: "Onboarding", by: "app" });
    store.writeScreen(row.id, { id: "1a", html: html("A"), caption: "Calm" }, "agent");
    store.writeScreen(row.id, { id: "1b", html: html("B"), viewport: "mobile" }, "agent");
    store.writeScreen(row.id, { id: "2a", html: html("C") }, "agent");
    const view = store.view(row.id)!;
    expect(view.rounds.map((round) => round.round)).toEqual([2, 1]);
    expect(view.rounds[1]!.screens.map((screen) => [screen.id, screen.option, screen.viewport, screen.caption])).toEqual([
      ["1a", "a", "desktop", "Calm"],
      ["1b", "b", "mobile", ""],
    ]);
  });

  it("rejects screen ids that don't name a round and an option", () => {
    const { store } = memoryStore();
    const row = store.create({ name: "", by: "app" });
    for (const id of ["a1", "0a", "1", "1ab", "1A"]) expect(() => store.writeScreen(row.id, { id, html: "" }, "agent")).toThrow(/look like "1a"/);
  });

  it("keeps a screen's caption and size when only its HTML changes", () => {
    const { store } = memoryStore();
    const row = store.create({ name: "", by: "app" });
    store.writeScreen(row.id, { id: "1a", html: html("old"), caption: "Dense", viewport: "mobile" }, "agent");
    store.writeScreen(row.id, { id: "1a", html: html("new") }, "agent");
    expect(store.screen(row.id, "1a")).toMatchObject({ html: html("new"), caption: "Dense", viewport: "mobile" });
  });

  it("gives every change a newer revision, even within one millisecond", () => {
    const { store } = memoryStore(() => 5_000);
    const row = store.create({ name: "", by: "app" });
    const first = store.writeScreen(row.id, { id: "1a", html: "" }, "agent");
    const second = store.setRound(row.id, 1, { title: "Layouts" }, "agent");
    expect(first).toBeGreaterThan(row.updated_at);
    expect(second).toBeGreaterThan(first);
    expect(store.get(row.id)).toMatchObject({ updated_at: second, updated_by: "agent" });
  });

  it("updates only the round fields it's given", () => {
    const { store } = memoryStore();
    const row = store.create({ name: "", by: "app" });
    store.setRound(row.id, 1, { title: "Layouts", intro: "Three ways in." }, "agent");
    store.setRound(row.id, 1, { intro: "Two ways in." }, "agent");
    expect(store.view(row.id)!.rounds[0]).toMatchObject({ title: "Layouts", intro: "Two ways in." });
  });

  it("deletes a design's screens and rounds with it", () => {
    const { db, store } = memoryStore();
    const row = store.create({ name: "", by: "app" });
    store.setRound(row.id, 1, { title: "One" }, "agent");
    store.writeScreen(row.id, { id: "1a", html: "" }, "agent");
    expect(store.delete(row.id)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM design_screens").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM design_rounds").get()).toEqual({ n: 0 });
  });
});
