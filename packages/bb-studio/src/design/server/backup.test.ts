import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runBackup, runRestore } from "@bb-studio/kit/server";
import { designBackupHandlers } from "./backup";
import { DesignStore, MIGRATIONS } from "./store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "design-backup-"));
  dirs.push(dir);
  return dir;
}

function fileStore(now: () => number = Date.now) {
  const db = new Database(join(tempDir(), "design.sqlite"));
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = new DesignStore(db, now);
  const changed: string[] = [];
  const handlers = designBackupHandlers({ db, store, changed: (id) => changed.push(id) });
  return { db, store, handlers, changed };
}

const html = (text: string) => `<!doctype html><title>${text}</title><p>${text}</p>`;

function seed() {
  let clock = 1_000;
  const source = fileStore(() => clock++);
  const { store } = source;
  const a = store.create({ name: "Onboarding", projectId: "proj_old", by: "app" });
  store.setRound(a.id, 1, { title: "Layouts", intro: "Two ways in." }, "agent");
  store.writeScreen(a.id, { id: "1a", html: html("A"), caption: "Calm" }, "agent");
  store.writeScreen(a.id, { id: "1b", html: html("B"), viewport: "mobile" }, "agent");
  const comment = store.addComment(a.id, { screenId: "1a", selector: "p", elementHtml: "<p>A</p>", elementText: "A", body: "Bigger" });
  store.setResolved(comment.id, true);
  store.setThread(a.id, "thr_elsewhere");
  const b = store.create({ name: "Global", by: "app" });
  store.writeScreen(b.id, { id: "1a", html: html("G") }, "agent");
  store.setArchived(b.id, true);
  return { source, a: store.get(a.id)!, b: store.get(b.id)!, comment };
}

async function backupOf(source: ReturnType<typeof fileStore>) {
  const dir = join(tempDir(), "section");
  const result = await runBackup(dir, source.handlers);
  return { dir, result };
}

const restore = (target: ReturnType<typeof fileStore>, dir: string, options: { dryRun?: boolean; projects?: Record<string, string | null> } = {}) =>
  runRestore(dir, target.handlers, { dryRun: options.dryRun ?? false, version: 1, projects: options.projects ?? { proj_old: "proj_new" } });

const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("design backup", () => {
  it("writes one JSON per design and screen HTML as separate files", async () => {
    const { source, a } = seed();
    const { dir, result } = await backupOf(source);
    expect(result.counts).toEqual({ designs: 2, rounds: 1, screens: 3, comments: 1 });
    expect(readdirSync(join(dir, "items"))).toHaveLength(2);
    expect(readdirSync(join(dir, "files", a.id, "screens")).sort()).toEqual(["1a.html", "1b.html"]);
    expect(result.notes.join(" ")).toMatch(/thread/);
  });

  it("round-trips into an empty store, then a re-run changes nothing", async () => {
    const { source, a, b, comment } = seed();
    const { dir } = await backupOf(source);
    const target = fileStore();
    const report = await restore(target, dir);
    expect(report).toMatchObject({ created: 2, updated: 0, unchanged: 0, kept: 0, failed: 0, unmapped: 0 });
    expect(target.changed.sort()).toEqual([a.id, b.id].sort());

    const restored = target.store.get(a.id)!;
    expect(restored).toMatchObject({ name: "Onboarding", project_id: "proj_new", updated_at: a.updated_at, created_at: a.created_at, thread_id: null });
    expect(target.store.get(b.id)).toMatchObject({ archived_at: b.archived_at, project_id: null });
    expect(target.store.screens(a.id)).toEqual(source.store.screens(a.id));
    expect(target.store.comments(a.id, { includeResolved: true })).toEqual(source.store.comments(a.id, { includeResolved: true }));
    expect(target.store.comment(comment.id)!.resolved_at).not.toBeNull();
    expect(target.store.view(a.id)!.rounds[0]).toMatchObject({ title: "Layouts", intro: "Two ways in." });

    const again = await restore(target, dir);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, failed: 0 });
    expect(count(target.db, "design_screens")).toBe(3);
    expect(count(target.db, "design_comments")).toBe(1);
  });

  it("keeps a newer local copy and replaces an older one", async () => {
    const { source, a, b } = seed();
    const { dir } = await backupOf(source);
    const target = fileStore();
    await restore(target, dir);

    // Local edit to a: newer than the backup, so it stays.
    target.db.prepare("UPDATE designs SET name = 'Mine', updated_at = ? WHERE id = ?").run(a.updated_at + 100, a.id);
    // b here is older than the backup and has an extra screen the backup lacks.
    target.db.prepare("UPDATE designs SET name = 'Old', updated_at = ?, thread_id = 'thr_here' WHERE id = ?").run(b.updated_at - 100, b.id);
    target.db.prepare("INSERT INTO design_screens (design_id, id, round, html, created_at, updated_at) VALUES (?, '2a', 2, '', 1, 1)").run(b.id);

    const report = await restore(target, dir);
    expect(report).toMatchObject({ kept: 1, updated: 1, unchanged: 0, created: 0 });
    expect(report.problems.map((problem) => problem.id)).toEqual([a.id]);
    expect(target.store.get(a.id)!.name).toBe("Mine");
    expect(target.store.get(b.id)).toMatchObject({ name: "Global", updated_at: b.updated_at, thread_id: "thr_here" });
    expect(target.store.screens(b.id).map((screen) => screen.id)).toEqual(["1a"]);
  });

  it("writes nothing on a dry run but reports the same counts", async () => {
    const { source } = seed();
    const { dir } = await backupOf(source);
    const target = fileStore();
    const report = await restore(target, dir, { dryRun: true, projects: {} });
    expect(report).toMatchObject({ created: 2, unmapped: 1, failed: 0 });
    expect(count(target.db, "designs")).toBe(0);
    expect(target.changed).toEqual([]);
  });

  it("fails a malformed item and restores the rest", async () => {
    const { source, b } = seed();
    const { dir } = await backupOf(source);
    writeFileSync(join(dir, "items", "dsn_bad.json"), JSON.stringify({ id: "dsn_bad", name: 5 }));
    writeFileSync(join(dir, "items", "dsn_junk.json"), "{not json");
    const target = fileStore();
    const report = await restore(target, dir);
    expect(report).toMatchObject({ created: 2, failed: 2 });
    expect(report.problems.map((problem) => problem.id).sort()).toEqual(["dsn_bad", "dsn_junk"]);
    expect(target.store.get(b.id)).not.toBeNull();
  });

  it("fails a design whose screen HTML is missing", async () => {
    const { source, a } = seed();
    const { dir } = await backupOf(source);
    rmSync(join(dir, "files", a.id, "screens", "1b.html"));
    const target = fileStore();
    const report = await restore(target, dir);
    expect(report).toMatchObject({ created: 1, failed: 1 });
    expect(target.store.get(a.id)).toBeNull();
  });

  it("restores a design from an unknown project as a global item", async () => {
    const { source, a } = seed();
    const { dir } = await backupOf(source);
    const target = fileStore();
    const report = await restore(target, dir, { projects: { proj_old: null } });
    expect(report).toMatchObject({ created: 2, unmapped: 1 });
    expect(target.store.get(a.id)!.project_id).toBeNull();
  });
});
