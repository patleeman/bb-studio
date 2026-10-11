import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { IMPORT_BATCH, IMPORT_BATCH_BYTES, type ImportPage } from "@bb-studio/kit/pages-contract";
import { batches, MIGRATED, migrate, MIGRATIONS, NEXT_MIGRATED, type StudioImport } from "./migrate";

function oldPlugin() {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}

function memoryMarkers() {
  const map = new Map<string, unknown>();
  return { map, get: async (key: string) => map.get(key), set: async (key: string, value: unknown) => { map.set(key, value); } };
}

function fakeStudio(options: { has?: string[]; skip?: Record<string, string> } = {}) {
  const has = new Set(options.has ?? []);
  const log: string[] = [];
  const next: unknown[] = [];
  const studio: StudioImport = {
    missingFiles: async (ids) => { log.push(`missing ${ids.join(",")}`); return { missing: ids.filter((id) => !has.has(id)) }; },
    importFile: async (file) => { log.push(`file ${file.id}`); has.add(file.id); return { ok: true }; },
    importSnapshots: async (snapshots) => { log.push(`snapshots ${snapshots.map((each) => each.id).join(",")}`); return { imported: snapshots.map((each) => each.id), existing: [], skipped: [] }; },
    importRows: async (pages) => {
      log.push(`pages ${pages.map((each) => each.id).join(",")}`);
      const skipped = pages.filter((page) => options.skip?.[page.id]).map((page) => ({ id: page.id, reason: options.skip![page.id]! }));
      const imported = pages.filter((page) => !options.skip?.[page.id] && !has.has(page.id)).map((page) => page.id);
      const existing = pages.filter((page) => has.has(page.id)).map((page) => page.id);
      return { imported, existing, skipped };
    },
    importNext: async (rows) => { next.push(...rows); return { imported: rows.length, existing: 0 }; },
    importSettings: async (settings) => { log.push(`settings ${JSON.stringify(settings)}`); return { applied: [] }; },
  };
  return { studio, log, next };
}

const addPage = (db: Database.Database, id: string, at: number, extra: Partial<Record<string, unknown>> = {}) =>
  db.prepare("INSERT INTO pages (id, title, created_at, updated_at, markdown, state) VALUES (?, ?, ?, ?, ?, ?)").run(id, extra.title ?? id, at, at, extra.markdown ?? "", extra.state ?? null);

describe("copying Pages into Studio", () => {
  it("sends each page's files and versions before the page, then the click log and settings once", async () => {
    const db = oldPlugin();
    addPage(db, "pg_000000000001", 1, { state: Buffer.from([1, 2]) });
    addPage(db, "pg_000000000002", 2);
    db.prepare("INSERT INTO files (id, page_id, name, mime, size, data, created_at) VALUES ('file_1', 'pg_000000000001', 'a', 'text/plain', 1, X'61', 1)").run();
    db.prepare("INSERT INTO snapshots (id, page_id, state, label, actor, created_at) VALUES ('snap_1', 'pg_000000000001', X'00', 'v1', 'user', 1)").run();
    db.prepare("INSERT INTO chats (thread_id, page_id, created_at) VALUES ('thr_1', 'pg_000000000002', 5)").run();
    const explore = new Database(":memory:");
    explore.exec("CREATE TABLE next_suggestions (key TEXT PRIMARY KEY, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, kind TEXT NOT NULL, emoji TEXT NOT NULL, label TEXT NOT NULL, shown_at INTEGER NOT NULL, clicked_at INTEGER, clicks INTEGER NOT NULL DEFAULT 0)");
    explore.prepare("INSERT INTO next_suggestions VALUES ('k1', 'thr_1', 'msg_1', 'do', '📄', 'Write it up', 10, 11, 2)").run();
    const markers = memoryMarkers();
    const { studio, log, next } = fakeStudio();
    const result = await migrate(db, studio, markers, { explore, settings: async () => ({ snapshotsPerPage: 10 }) });
    expect(result).toEqual({ complete: true, total: 2, copied: 2, skipped: [] });
    expect(log).toEqual(["missing file_1", "file file_1", "snapshots snap_1", "pages pg_000000000001,pg_000000000002", 'settings {"snapshotsPerPage":10}']);
    expect(next).toEqual([{ key: "k1", threadId: "thr_1", messageId: "msg_1", kind: "do", emoji: "📄", label: "Write it up", shownAt: 10, clickedAt: 11, clicks: 2 }]);
    expect(markers.map.has(`${MIGRATED}pg_000000000001`) && markers.map.has(NEXT_MIGRATED)).toBe(true);

    // A rerun sends nothing but the settings (Studio takes them once).
    log.length = 0;
    next.length = 0;
    expect(await migrate(db, studio, markers, { explore, settings: async () => ({}) })).toMatchObject({ complete: true, copied: 2 });
    expect(log).toEqual(["settings {}"]);
    expect(next).toEqual([]);
  });

  it("lists malformed pages and ones Studio refuses, and still completes", async () => {
    const db = oldPlugin();
    addPage(db, "pg_000000000001", 1);
    db.prepare("INSERT INTO pages (id, title, created_at, updated_at, markdown) VALUES ('pg_bad', 'Bad', -5, 1, '')").run();
    addPage(db, "pg_000000000003", 3);
    const { studio } = fakeStudio({ skip: { pg_000000000003: "Its content can't be read" } });
    const result = await migrate(db, studio, memoryMarkers(), { explore: null, settings: async () => ({}) });
    expect(result.complete).toBe(true);
    expect(result.copied).toBe(1);
    expect(result.skipped.map((each) => each.id).sort()).toEqual(["pg_000000000003", "pg_bad"]);
  });

  it("batches pages by count and size, a large page alone", () => {
    const page = (id: string, bytes: number) => ({ id, state: "x".repeat(bytes), markdown: "" }) as ImportPage;
    const size = (item: ImportPage) => item.state!.length;
    expect(batches([page("a", IMPORT_BATCH_BYTES + 1), page("b", 1)], size).map((batch) => batch.map((each) => each.id))).toEqual([["a"], ["b"]]);
    expect(batches(Array.from({ length: IMPORT_BATCH + 1 }, (_, index) => page(`p${index}`, 1)), size).map((batch) => batch.length)).toEqual([IMPORT_BATCH, 1]);
  });
});
