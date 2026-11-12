import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS, PageStore } from "./store";

afterEach(() => vi.restoreAllMocks());

it("compares a recovered title in the same SQL write and preserves other writers", () => {
  const db = new Database(":memory:");
  try {
    for (const sql of MIGRATIONS) db.exec(sql);
    const store = new PageStore(db);
    const page = store.create({ title: "Original", projectId: null, parentId: null, actor: "user" });
    store.update(page.id, { title: "Remote" }, "other");
    expect(() => store.update(page.id, { title: "Recovered", icon: "📄" }, "user", "Original")).toThrow("Page title changed");
    expect(store.meta(page.id)).toMatchObject({ title: "Remote", icon: "", updated_by: "other" });
    expect(store.update(page.id, { title: "Recovered" }, "user", "Remote")?.title).toBe("Recovered");
    expect(store.update(page.id, { icon: "📄" }, "user")?.title).toBe("Recovered");
  } finally { db.close(); }
});

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

it("settles retired bot workers while preserving request history and completed results", () => {
  const db = new Database(":memory:");
  try {
    for (const sql of MIGRATIONS.slice(0, -1)) db.exec(sql);
    const insert = db.prepare(`INSERT INTO requests
      (id, page_id, bot_id, bot_name, kind, summary, status, result, dedupe_key, created_at, updated_at)
      VALUES (?, 'page', 'former_bot', 'Scribe', 'refresh', 'Historical request', ?, ?, ?, 1, 2)`);
    for (const status of ["queued", "working", "done"]) insert.run(status, status, `${status} result`, status);
    db.exec(MIGRATIONS.at(-1)!);
    const requests = new PageStore(db).requests("page");
    expect(requests).toHaveLength(3);
    for (const status of ["queued", "working"]) {
      expect(requests.find(request => request.id === status)).toMatchObject({ status: "failed", bot_name: "Scribe", result: `${status} result`, error: expect.stringContaining("retired") });
    }
    expect(requests.find(request => request.id === "done")).toMatchObject({ status: "done", result: "done result", error: null, updated_at: 2 });
  } finally { db.close(); }
});

it("keeps the retired refresh columns in the table but out of page metadata", () => {
  const db = new Database(":memory:");
  try {
    for (const sql of MIGRATIONS) db.exec(sql);
    const store = new PageStore(db);
    const page = store.create({ title: "Report", projectId: null, parentId: null, actor: "user" });
    db.prepare("UPDATE pages SET refresh_cron = '0 9 * * *' WHERE id = ?").run(page.id);
    expect(Object.keys(store.meta(page.id)!).filter((key) => key.startsWith("refresh_"))).toEqual([]);
    expect(db.prepare("SELECT refresh_cron FROM pages WHERE id = ?").get(page.id)).toEqual({ refresh_cron: "0 9 * * *" });
  } finally { db.close(); }
});
