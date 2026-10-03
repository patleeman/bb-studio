import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { importModule } from "./import";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "studio-import-")); roots.push(dataDir);
  mkdirSync(join(dataDir, "plugins", "studio-tables"), { recursive: true });
  const source = join(dataDir, "plugins", "studio-tables", "data.db");
  const legacy = new Database(source);
  legacy.pragma("journal_mode = WAL");
  legacy.exec("CREATE TABLE items (id TEXT PRIMARY KEY, body BLOB); INSERT INTO items VALUES ('one', X'0001FF')");
  const host = new Database(join(dataDir, "bb.db"));
  for (const table of ["plugin_settings", "plugin_kv"]) {
    host.exec(`CREATE TABLE ${table} (plugin_id TEXT, key TEXT, value TEXT, updated_at INTEGER)`);
    host.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`).run("studio-tables", "same-key", '{"keep": [1, 2]}', 42);
    host.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`).run("pages", "other", '"untouched"', 43);
  }
  host.close();
  const core = new Database(":memory:");
  const options = { dataDir, module: "tables", legacyPluginId: "studio-tables", core,
    open: (path: string, options?: Database.Options) => new Database(path, options), legacyRunning: false };
  return { options, legacy, source, core };
}

it("imports committed WAL bytes, settings and KV without deleting or rewriting source rows", async () => {
  const { options, legacy, source, core } = fixture();
  try {
    const path = await importModule(options);
    const imported = new Database(path);
    try {
      expect(imported.prepare("SELECT body FROM items").get()).toEqual({ body: Buffer.from([0, 1, 255]) });
      expect(imported.prepare("SELECT * FROM studio_module_state ORDER BY kind").all()).toEqual([
        { kind: "kv", key: "same-key", value: '{"keep": [1, 2]}', updated_at: 42 },
        { kind: "settings", key: "same-key", value: '{"keep": [1, 2]}', updated_at: 42 },
      ]);
      expect(core.prepare("SELECT settings_count, kv_count FROM module_imports").get()).toEqual({ settings_count: 1, kv_count: 1 });
      expect(existsSync(source)).toBe(true);
      expect(legacy.prepare("SELECT count(*) AS n FROM items").get()).toEqual({ n: 1 });
    } finally { imported.close(); }
  } finally { legacy.close(); core.close(); }
});

it("never reimports over module edits and repairs the core receipt after interrupted publication", async () => {
  const { options, legacy, core } = fixture();
  try {
    const path = await importModule(options);
    const imported = new Database(path);
    imported.exec("UPDATE items SET body = X'02'"); imported.close();
    core.exec("DELETE FROM module_imports");
    legacy.exec("DELETE FROM items");
    expect(await importModule(options)).toBe(path);
    const reopened = new Database(path);
    expect(reopened.prepare("SELECT body FROM items").get()).toEqual({ body: Buffer.from([2]) });
    reopened.close();
    expect(core.prepare("SELECT count(*) AS n FROM module_imports").get()).toEqual({ n: 1 });
  } finally { legacy.close(); core.close(); }
});

it("refuses a running legacy plugin and leaves no partial destination", async () => {
  const { options, legacy, core } = fixture();
  try {
    await expect(importModule({ ...options, legacyRunning: true })).rejects.toThrow("Stop studio-tables");
    expect(existsSync(join(options.dataDir, "plugins/studio/tables.db"))).toBe(false);
    await expect(importModule({ ...options, module: "../escape" })).rejects.toThrow("Invalid module identity");
  } finally { legacy.close(); core.close(); }
});

it("imports KV-only modules when no legacy SQLite file exists", async () => {
  const { options, legacy, source, core } = fixture();
  legacy.close(); rmSync(source);
  try {
    const path = await importModule(options);
    const imported = new Database(path);
    expect(imported.prepare("SELECT count(*) AS n FROM studio_module_state").get()).toEqual({ n: 2 });
    expect(core.prepare("SELECT source FROM module_imports").get()).toEqual({ source: null });
    imported.close();
  } finally { core.close(); }
});

it("keeps the old database and retries after a metadata read failure", async () => {
  const { options, legacy, core } = fixture();
  const target = join(options.dataDir, "plugins/studio/tables.db");
  try {
    await expect(importModule({ ...options, open(path, flags) {
      if (path === join(options.dataDir, "bb.db")) throw new Error("injected read failure");
      return options.open(path, flags);
    } })).rejects.toThrow("injected read failure");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.importing`)).toBe(false);
    expect(core.prepare("SELECT count(*) AS n FROM module_imports").get()).toEqual({ n: 0 });
    expect(legacy.prepare("SELECT body FROM items").get()).toEqual({ body: Buffer.from([0, 1, 255]) });
    expect(await importModule(options)).toBe(target);
  } finally { legacy.close(); core.close(); }
});

it("leaves an existing unmarked module database untouched", async () => {
  const { options, legacy, core } = fixture();
  const target = join(options.dataDir, "plugins/studio/tables.db");
  mkdirSync(join(options.dataDir, "plugins/studio"), { recursive: true });
  const existing = new Database(target);
  existing.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('mine')"); existing.close();
  try {
    expect(await importModule(options)).toBe(target);
    const db = new Database(target);
    expect(db.prepare("SELECT * FROM preserved").all()).toEqual([{ value: "mine" }]); db.close();
    expect(core.prepare("SELECT count(*) AS n FROM module_imports").get()).toEqual({ n: 0 });
  } finally { legacy.close(); core.close(); }
});

it("imports into Pages without creating a Studio-owned database", async () => {
  const { options, legacy, core } = fixture();
  try {
    const path = await importModule({ ...options, ownerPluginId: "pages" });
    expect(path).toBe(join(options.dataDir, "plugins/pages/tables.db"));
    expect(existsSync(join(options.dataDir, "plugins/studio/tables.db"))).toBe(false);
    const imported = new Database(path);
    try { expect(imported.prepare("SELECT body FROM items").get()).toEqual({ body: Buffer.from([0, 1, 255]) }); }
    finally { imported.close(); }
    await expect(importModule({ ...options, ownerPluginId: "../escape" })).rejects.toThrow("Invalid module identity");
  } finally { legacy.close(); core.close(); }
});
