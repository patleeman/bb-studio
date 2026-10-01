import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { PlaybookStore, renderPlaybook } from "./playbooks";

describe("playbooks", () => {
  it("lists built-ins, stores custom plans, and fills variables", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE studio_playbooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL)");
    const store = new PlaybookStore(db);
    expect(store.list().length).toBe(3);
    store.save({ id: "custom", name: "Custom", description: "", pages: [{ title: "{{name}}", markdown: "# {{name}}" }], tasks: [] });
    expect(renderPlaybook(store.get("custom")!, { name: "Review" }).pages[0]).toEqual({ title: "Review", markdown: "# Review" });
    store.remove("custom");
    expect(store.get("custom")).toBeNull();
    expect(() => store.remove("launch-review")).toThrow(/Built-in/);
  });
});
