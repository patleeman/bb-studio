import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { StudioServices, type Ref } from "./services";

const page: Ref = { pluginId: "pages", id: "opaque-page" };
const task: Ref = { pluginId: "studio-tasks", id: "opaque-task" };
const actor = { kind: "user" as const };

function setup() {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  return { db, services: new StudioServices(db) };
}

describe("Studio services", () => {
  it("keeps existing item threads when adding multiple item refs", () => {
    const db = new Database(":memory:");
    for (const migration of MIGRATIONS.slice(0, -1)) db.exec(migration);
    db.prepare("INSERT INTO item_threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("thr_old", page.pluginId, page.id, "chat", "idle", 1, 1, "{}");
    db.exec(MIGRATIONS.at(-1)!);
    const services = new StudioServices(db);
    services.linkThread({ threadId: "thr_old", ref: task, role: "new-thread", state: "idle", createdAt: 1, updatedAt: 1, metadata: {} });
    expect(services.threadsForThread("thr_old").map((thread) => thread.ref)).toEqual(expect.arrayContaining([page, task]));
  });

  it("replaces one source's outgoing links and preserves backlinks from another", () => {
    const { services } = setup();
    const link = { from: page, to: task, kind: "mention" as const, source: "pages" };
    services.replaceLinks(page, "pages", [link]);
    expect(services.links(task).backlinks).toEqual([link]);
    services.replaceLinks(page, "pages", []);
    expect(services.links(task).backlinks).toEqual([]);
    expect(() => services.replaceLinks(task, "pages", [link])).toThrow(/source/);
  });

  it("tracks threads and filters activity by item and cursor", () => {
    const { services } = setup();
    services.linkThread({ threadId: "thr_1", ref: page, role: "work", state: "working", createdAt: 1, updatedAt: 1, metadata: { source: "page" } });
    services.linkThread({ threadId: "thr_1", ref: task, role: "work", state: "working", createdAt: 1, updatedAt: 1, metadata: {} });
    services.linkThread({ threadId: "thr_1", ref: page, role: "work", state: "idle", createdAt: 1, updatedAt: 2, metadata: {} });
    expect(services.threads(page)).toMatchObject([{ threadId: "thr_1", state: "idle", metadata: { source: "page" } }]);
    expect(services.threadsForThread("thr_1")).toHaveLength(2);
    const first = services.recordActivity({ ref: page, actor, verb: "edited", at: 1, summary: "One" });
    services.recordActivity({ ref: task, actor, verb: "edited", at: 2, summary: "Two" });
    expect(services.activity(page, 0, 10).map((event) => event.summary)).toEqual(["One"]);
    expect(services.activity(null, first, 10).map((event) => event.summary)).toEqual(["Two"]);
  });

  it("keeps comments on their item and deduplicates version bytes", () => {
    const { db, services } = setup();
    const root = services.addComment({ ref: page, parentId: null, anchor: "block-1", actor, body: "Review this" });
    services.addComment({ ref: page, parentId: root.id, anchor: null, actor, body: "Done" });
    expect(() => services.addComment({ ref: task, parentId: root.id, anchor: null, actor, body: "Wrong item" })).toThrow();
    expect(services.resolveComment(page, root.id, true)).toBe(true);
    expect(services.comments(page)[0]?.resolvedAt).toBeTypeOf("number");
    const bytes = Buffer.from("snapshot");
    const first = services.addVersion(page, bytes, "First", actor);
    services.addVersion(task, bytes, "Copy", actor);
    expect(services.versionBytes(page, first.id)).toEqual(bytes);
    expect(db.prepare("SELECT COUNT(*) AS count FROM item_blobs").get()).toEqual({ count: 1 });
  });
});
