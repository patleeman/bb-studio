import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedConnection } from "@bb/db/testing";
import { afterEach, describe, expect, it } from "vitest";
import { runForkFirstRunImport } from "../../src/services/fork-import/first-run.js";
import { runForkPluginSync } from "../../src/services/fork-import/plugin-sync.js";
import {
  closeForkImportDatabases,
  openForkImportDatabase,
} from "../../src/services/fork-import/state.js";

const roots: string[] = [];
const open: Database.Database[] = [];
const logger = { info: () => {}, warn: () => {} };

afterEach(async () => {
  for (const database of open.splice(0)) database.close();
  closeForkImportDatabases();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function importedStudio(): Promise<{
  source: Database.Database;
  target: Database.Database;
  dataDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "bb-fork-plugin-sync-"));
  roots.push(root);
  const sourceDir = join(root, "source");
  const dataDir = join(root, "target");
  await mkdir(join(sourceDir, "plugins", "studio"), { recursive: true });
  const memory = createMigratedConnection();
  await memory.$client.backup(join(sourceDir, "bb.db"));
  memory.$client.close();
  const seed = new Database(join(sourceDir, "plugins", "studio", "data.db"));
  seed.exec(`
    CREATE TABLE pages (id TEXT PRIMARY KEY, body TEXT, updated_at INTEGER);
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE notes (body TEXT);
    CREATE TABLE bot_loops (id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE loop_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, loop_id TEXT, type TEXT);
    CREATE TABLE loop_scheduler (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE bot_runners (id TEXT PRIMARY KEY, state TEXT, updated_at INTEGER);
    INSERT INTO pages VALUES ('p1', 'one', 10), ('p2', 'two', 10);
    INSERT INTO tags VALUES ('t1', 'red');
    INSERT INTO notes VALUES ('first');
    INSERT INTO bot_loops VALUES ('loop_childcare', '{"status":"surfaced","closedAt":null}');
    INSERT INTO loop_events (loop_id, type) VALUES ('loop_childcare', 'created');
    INSERT INTO loop_scheduler VALUES ('places', '[]');
    INSERT INTO bot_runners VALUES ('r1', 'active', 10);
  `);
  seed.close();
  await runForkFirstRunImport({
    dataDir,
    env: { BB_STUDIO_IMPORT_FROM: sourceDir },
    logger,
    now: 1000,
    appVersion: "1.0.0",
  });
  const source = new Database(join(sourceDir, "plugins", "studio", "data.db"));
  const target = new Database(join(dataDir, "plugins", "studio", "data.db"));
  open.push(source, target);
  return { source, target, dataDir };
}

function ids(database: Database.Database, table: string): string[] {
  return database
    .prepare<[], { id: string }>(`SELECT id FROM ${table} ORDER BY id`)
    .all()
    .map((row) => row.id);
}

describe("plugin database sync", () => {
  it("copies rows changed at the source and keeps rows edited only here", async () => {
    const { source, target, dataDir } = await importedStudio();
    source.exec(
      "UPDATE pages SET body = 'one, edited in bb', updated_at = 20 WHERE id = 'p1'",
    );
    source.exec("INSERT INTO pages VALUES ('p3', 'three', 21)");
    target.exec(
      "UPDATE pages SET body = 'two, edited here', updated_at = 30 WHERE id = 'p2'",
    );

    const summary = runForkPluginSync({ dataDir });

    expect(summary?.rowsWritten).toBe(2);
    expect(
      target.prepare("SELECT id, body FROM pages ORDER BY id").all(),
    ).toEqual([
      { id: "p1", body: "one, edited in bb" },
      { id: "p2", body: "two, edited here" },
      { id: "p3", body: "three" },
    ]);
  });

  it("closes a Todo that was closed at the source after it was mirrored", async () => {
    const { source, target, dataDir } = await importedStudio();
    runForkPluginSync({ dataDir });
    source.exec(`
      UPDATE bot_loops SET record = '{"status":"done","closedAt":1794361647841}' WHERE id = 'loop_childcare';
      INSERT INTO loop_events (loop_id, type) VALUES ('loop_childcare', 'closed');
      UPDATE loop_scheduler SET value = '["Home"]' WHERE key = 'places';
    `);

    runForkPluginSync({ dataDir });

    expect(target.prepare("SELECT record FROM bot_loops").pluck().get()).toBe(
      '{"status":"done","closedAt":1794361647841}',
    );
    expect(
      target.prepare("SELECT type FROM loop_events ORDER BY seq").pluck().all(),
    ).toEqual(["created", "closed"]);
    expect(
      target.prepare("SELECT value FROM loop_scheduler").pluck().get(),
    ).toBe("[]");
  });

  it("deletes rows deleted at the source and keeps rows that exist only here", async () => {
    const { source, target, dataDir } = await importedStudio();
    target.exec("INSERT INTO tags VALUES ('local', 'mine')");
    source.exec(
      "DELETE FROM tags WHERE id = 't1'; DELETE FROM pages WHERE id = 'p1'",
    );
    target.exec(
      "UPDATE pages SET body = 'one, edited here', updated_at = 40 WHERE id = 'p1'",
    );

    const summary = runForkPluginSync({ dataDir });

    expect(summary?.rowsDeleted).toBe(1);
    expect(summary?.rowsKeptHere).toBe(1);
    expect(ids(target, "tags")).toEqual(["local"]);
    expect(ids(target, "pages")).toEqual(["p1", "p2"]);
  });

  it("keeps a row edited here later than the source edited it", async () => {
    const { source, target, dataDir } = await importedStudio();
    source.exec(
      "UPDATE pages SET body = 'from bb', updated_at = 20 WHERE id = 'p1'",
    );
    target.exec(
      "UPDATE pages SET body = 'from here', updated_at = 30 WHERE id = 'p1'",
    );

    expect(runForkPluginSync({ dataDir })?.rowsKeptHere).toBe(1);
    expect(
      target.prepare("SELECT body FROM pages WHERE id = 'p1'").pluck().get(),
    ).toBe("from here");
  });

  it("updates rows whose table has triggers that replace rows in a table only this side has", async () => {
    const { source, target, dataDir } = await importedStudio();
    target.exec(`
      CREATE TABLE items (plugin_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT, PRIMARY KEY (plugin_id, id));
      CREATE TRIGGER items_pages_insert AFTER INSERT ON pages BEGIN
        INSERT OR REPLACE INTO items VALUES ('pages', NEW.id, NEW.body);
      END;
      CREATE TRIGGER items_pages_update AFTER UPDATE ON pages BEGIN
        INSERT OR REPLACE INTO items VALUES ('pages', NEW.id, NEW.body);
      END;
      CREATE TRIGGER items_pages_delete AFTER DELETE ON pages BEGIN
        DELETE FROM items WHERE plugin_id = 'pages' AND id = OLD.id;
      END;
      INSERT INTO items SELECT 'pages', id, body FROM pages;
    `);
    source.exec(`
      UPDATE pages SET body = 'renamed', updated_at = 20 WHERE id = 'p1';
      INSERT INTO pages VALUES ('p3', 'three', 21);
      DELETE FROM pages WHERE id = 'p2';
    `);

    const summary = runForkPluginSync({ dataDir });

    expect(summary?.notes).toEqual([]);
    expect(
      target.prepare("SELECT id, title FROM items ORDER BY id").all(),
    ).toEqual([
      { id: "p1", title: "renamed" },
      { id: "p3", title: "three" },
    ]);
  });

  it("catches up rows an earlier sync missed, without deleting rows only here", async () => {
    const { source, target, dataDir } = await importedStudio();
    source.exec(
      `UPDATE bot_loops SET record = '{"status":"done"}' WHERE id = 'loop_childcare'`,
    );
    target.exec("INSERT INTO tags VALUES ('local', 'mine')");
    const fork = openForkImportDatabase(dataDir);
    fork.exec(
      "DELETE FROM plugin_rows; DELETE FROM cursors WHERE key LIKE 'plugin:%'",
    );

    runForkPluginSync({ dataDir });

    expect(target.prepare("SELECT record FROM bot_loops").pluck().get()).toBe(
      '{"status":"done"}',
    );
    expect(ids(target, "tags")).toEqual(["local", "t1"]);
  });

  it("reloads a table without a key when only the source changed it", async () => {
    const { source, target, dataDir } = await importedStudio();
    source.exec("UPDATE notes SET body = 'tenth'");

    expect(runForkPluginSync({ dataDir })?.tablesReloaded).toBe(1);
    expect(target.prepare("SELECT body FROM notes").pluck().all()).toEqual([
      "tenth",
    ]);

    source.exec("INSERT INTO notes VALUES ('from bb')");
    target.exec("INSERT INTO notes VALUES ('from here')");
    const summary = runForkPluginSync({ dataDir });

    expect(summary?.tablesReloaded).toBe(0);
    expect(summary?.notes).toHaveLength(1);
    expect(target.prepare("SELECT body FROM notes").pluck().all()).toEqual([
      "tenth",
      "from here",
    ]);
  });

  it("never mirrors the Account Pooler's quota, pins or routing", async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-fork-plugin-sync-pool-"));
    roots.push(root);
    const sourceDir = join(root, "source");
    const dataDir = join(root, "target");
    await mkdir(join(sourceDir, "plugins", "account-pool"), {
      recursive: true,
    });
    const memory = createMigratedConnection();
    await memory.$client.backup(join(sourceDir, "bb.db"));
    memory.$client.close();
    const seed = new Database(
      join(sourceDir, "plugins", "account-pool", "data.db"),
    );
    seed.exec(`
      CREATE TABLE account_quota (account_id TEXT PRIMARY KEY, error TEXT, observed_at INTEGER);
      CREATE TABLE pool_active_account (provider TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    `);
    seed.close();
    await runForkFirstRunImport({
      dataDir,
      env: { BB_STUDIO_IMPORT_FROM: sourceDir },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });
    const target = new Database(
      join(dataDir, "plugins", "account-pool", "data.db"),
    );
    const source = new Database(
      join(sourceDir, "plugins", "account-pool", "data.db"),
    );
    open.push(source, target);
    target.exec(
      "INSERT INTO account_quota VALUES ('a1', 'OAuth refresh failed with HTTP 400. invalid_grant.', 5)",
    );
    source.exec(
      "INSERT INTO account_quota VALUES ('a1', NULL, 9), ('a2', NULL, 9)",
    );
    source.exec("INSERT INTO pool_active_account VALUES ('claude', 'a2')");

    const summary = runForkPluginSync({ dataDir });

    expect(summary?.plugins).toBe(0);
    expect(
      target.prepare("SELECT account_id, error FROM account_quota").all(),
    ).toEqual([
      {
        account_id: "a1",
        error: "OAuth refresh failed with HTTP 400. invalid_grant.",
      },
    ]);
    expect(
      target.prepare("SELECT COUNT(*) AS count FROM pool_active_account").get(),
    ).toEqual({ count: 0 });
  });

  it("never copies the Bot's runners or schedules", async () => {
    const { source, target, dataDir } = await importedStudio();
    source.exec("INSERT INTO bot_runners VALUES ('r2', 'active', 50)");

    runForkPluginSync({ dataDir });

    expect(target.prepare("SELECT id FROM bot_runners").all()).toEqual([
      { id: "r1" },
    ]);
  });
});
