import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { StudioServices } from "./services";

describe("who made an item", () => {
  it("is the actor of the item's first recorded activity", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE item_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL, actor TEXT NOT NULL, verb TEXT NOT NULL, at INTEGER NOT NULL, summary TEXT NOT NULL)");
    const add = db.prepare("INSERT INTO item_activity (plugin_id, item_id, actor, verb, at, summary) VALUES ('studio', ?, ?, 'updated', 1, '')");
    add.run("p1", JSON.stringify({ kind: "agent", id: "thr_1" }));
    add.run("p1", JSON.stringify({ kind: "user" }));
    add.run("p2", JSON.stringify({ kind: "user" }));
    add.run("p3", "not json");
    const creators = (StudioServices.prototype.creators as () => Map<string, string>).call({ db });
    expect([...creators]).toEqual([["studio:p1", "agent"], ["studio:p2", "user"]]);
  });
});
