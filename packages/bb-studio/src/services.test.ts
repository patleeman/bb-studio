import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { StudioServices, type Ref } from "./services";

const page: Ref = { pluginId: "pages", id: "opaque-page" };
const task: Ref = { pluginId: "talk", id: "opaque-task" };
const actor = { kind: "user" as const };

function setup() {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  return { db, services: new StudioServices(db) };
}

describe("Studio services", () => {
  it("drops the Spaces feature's leftover space_folders table", () => {
    const { db } = setup();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'space_folders'").get()).toBeUndefined();
  });

  it("takes an item's origin thread from its earliest created link, ignoring other roles", () => {
    const { services } = setup();
    services.linkThread({ threadId: "thr_chat", ref: page, role: "chat", state: "idle", createdAt: 1, updatedAt: 1, metadata: {} });
    services.linkThread({ threadId: "thr_late", ref: page, role: "created", state: "idle", createdAt: 9, updatedAt: 9, metadata: {} });
    services.linkThread({ threadId: "thr_maker", ref: page, role: "created", state: "idle", createdAt: 5, updatedAt: 5, metadata: {} });
    services.linkThread({ threadId: "thr_talk", ref: task, role: "new-thread", state: "idle", createdAt: 1, updatedAt: 1, metadata: {} });
    expect(services.originThreads()).toEqual(new Map([["pages:opaque-page", "thr_maker"]]));
  });

  it("keeps existing item threads when adding multiple item refs", () => {
    const { services } = setup();
    services.linkThread({ threadId: "thr_old", ref: page, role: "chat", state: "idle", createdAt: 1, updatedAt: 1, metadata: {} });
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

  it("keeps live item inserts independent of table column order", () => {
    const { db, services } = setup();
    for (const table of ["item_links", "item_threads", "item_comments", "item_blobs", "item_versions"]) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN future TEXT NOT NULL DEFAULT ''`);
    }
    services.replaceLinks(page, "pages", [{ from: page, to: task, kind: "mention", source: "pages" }]);
    services.linkThread({ threadId: "thr_1", ref: page, role: "created", state: "idle", createdAt: 1, updatedAt: 1, metadata: {} });
    services.addComment({ ref: page, parentId: null, anchor: null, actor, body: "Comment" });
    services.addVersion(page, Buffer.from("version"), "Snapshot", actor);
    expect(services.links(page).outgoing).toHaveLength(1);
    expect(services.threads(page)).toHaveLength(1);
    expect(services.comments(page)).toHaveLength(1);
    expect(services.versions(page)).toHaveLength(1);
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

  it("forgets a deleted item's versions and the blobs only it used", () => {
    const { db, services } = setup();
    const shared = new Uint8Array([1, 2, 3]);
    services.addVersion(page, shared, "Shared", actor);
    services.addVersion(page, new Uint8Array([4]), "Own", actor);
    services.addVersion(task, shared, "Copy", actor);
    services.forgetVersions(page.pluginId, [page.id]);
    expect(services.versions(page)).toEqual([]);
    expect(services.versions(task)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM item_blobs").get()).toEqual({ count: 1 });
  });
});

it("preserves every item link through an unavailable thread lookup and retries confirmed states", async () => {
  const { services } = setup();
  for (const ref of [page, task]) services.linkThread({ threadId: "thr_1", ref, role: "chat", state: "working", createdAt: 1, updatedAt: 2, metadata: {} });
  const before = services.threadsForThread("thr_1");
  const errors: unknown[] = [];
  const log = (error: unknown) => { errors.push(error); };
  expect(await services.reconcileThread("thr_1", async () => { throw new Error("offline"); }, log)).toBe(false);
  expect(errors).toHaveLength(1);
  expect(services.threadsForThread("thr_1")).toEqual(before);
  expect(await services.reconcileThread("thr_1", async () => ({ archivedAt: 1 }), log)).toBe(true);
  expect(services.threadsForThread("thr_1").map((thread) => thread.state)).toEqual(["archived", "archived"]);
  await services.reconcileThread("thr_1", async () => { throw { status: 404 }; }, log);
  expect(services.threadsForThread("thr_1").map((thread) => thread.state)).toEqual(["deleted", "deleted"]);
});

it("keeps a live thread event that arrives during a reconciliation read", async () => {
  const { services } = setup();
  const thread = { threadId: "thr_1", ref: page, role: "chat", state: "idle", createdAt: 1, updatedAt: 2, metadata: {} };
  services.linkThread(thread);
  await services.reconcileThread("thr_1", async () => {
    services.linkThread({ ...thread, state: "working", updatedAt: 3 });
    return { archivedAt: 1 };
  }, () => {});
  expect(services.threadsForThread("thr_1")[0]?.state).toBe("working");
});
