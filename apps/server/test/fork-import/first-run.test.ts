import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedConnection } from "@bb/db/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveForkImportSource,
  runForkFirstRunImport,
} from "../../src/services/fork-import/first-run.js";
import { copyMissingThreadStorage } from "../../src/services/fork-import/sync.js";
import {
  closeForkImportDatabases,
  FORK_IMPORT_STATE_FILE_NAME,
} from "../../src/services/fork-import/state.js";

const roots: string[] = [];
const logger = { info: () => {}, warn: () => {} };

async function makeSource(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-fork-import-"));
  roots.push(root);
  const source = join(root, "source");
  await mkdir(join(source, "plugins", "studio", "secrets"), {
    recursive: true,
  });
  await mkdir(join(source, "plugins", "mobile", "secrets"), {
    recursive: true,
  });
  await mkdir(join(source, "thread-storage", "thr_one"), { recursive: true });
  const memory = createMigratedConnection();
  await memory.$client.backup(join(source, "bb.db"));
  memory.$client.close();
  const db = new Database(join(source, "bb.db"));
  const insert = db.prepare(
    "INSERT INTO plugin_kv (plugin_id, key, value, updated_at) VALUES (?, ?, ?, 1)",
  );
  insert.run("push-notifications", "subscription:phone", '"token"');
  insert.run("studio", "kept", '"yes"');
  const preference = db.prepare(
    "INSERT INTO ui_preferences (key, value_json, revision, updated_at) VALUES (?, ?, 1, 1)",
  );
  preference.run("sidebar.visiblePluginPanels", '["studio/visual-chat"]');
  preference.run("sidebar.sort", '"recent"');
  db.close();
  const plugin = new Database(join(source, "plugins", "studio", "data.db"));
  plugin.exec(
    "CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('hi')",
  );
  plugin.close();
  await writeFile(join(source, "plugins", "studio", "secrets", "key"), "s");
  await writeFile(join(source, "plugins", "mobile", "secrets", "apnsKey"), "k");
  await writeFile(join(source, "telemetry-id"), "source-telemetry");
  await writeFile(join(source, "host-id"), "host_source\n");
  await writeFile(join(source, "thread-storage", "thr_one", "note.txt"), "n");
  await writeFile(join(source, "thread-storage", "loose.png"), "p");
  return root;
}

function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(async () => {
  closeForkImportDatabases();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("first-run import from another bb data dir", () => {
  it("copies the data, leaves out push credentials and identity, and never changes the source", async () => {
    const root = await makeSource();
    const source = join(root, "source");
    const target = join(root, "target");
    const sourceHash = hashOf(join(source, "bb.db"));

    const state = await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: source },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });

    expect(state?.sourceDataDir).toBe(source);
    const db = new Database(join(target, "bb.db"), { readonly: true });
    const rows = db
      .prepare("SELECT plugin_id FROM plugin_kv ORDER BY plugin_id")
      .all();
    db.close();
    const kept = new Database(join(target, "bb.db"), { readonly: true });
    expect(kept.prepare("SELECT key FROM ui_preferences").all()).toEqual([
      { key: "sidebar.sort" },
    ]);
    kept.close();
    expect(rows).toEqual([]);
    expect(existsSync(join(target, "plugins"))).toBe(false);
    expect(existsSync(join(target, "telemetry-id"))).toBe(false);
    expect(existsSync(join(target, "host-id"))).toBe(false);
    expect(existsSync(join(target, "thread-storage"))).toBe(false);
    expect(await copyMissingThreadStorage({ dataDir: target, logger })).toBe(2);
    expect(
      readFileSync(join(target, "thread-storage", "loose.png"), "utf8"),
    ).toBe("p");
    expect(
      readFileSync(
        join(target, "thread-storage", "thr_one", "note.txt"),
        "utf8",
      ),
    ).toBe("n");
    expect(
      await copyMissingThreadStorage({ dataDir: target, logger }),
    ).toBeNull();
    const marker = JSON.parse(
      readFileSync(join(target, "server-import.json"), "utf8"),
    ) as { kind: string; sourceDataDir: string; sourceServerHostId: string };
    expect(marker.kind).toBe("manual");
    expect(marker.sourceDataDir).toBe(source);
    expect(marker.sourceServerHostId).toBe("host_source");
    expect(existsSync(join(target, FORK_IMPORT_STATE_FILE_NAME))).toBe(true);
    expect(hashOf(join(source, "bb.db"))).toBe(sourceHash);
    expect(
      existsSync(join(source, "plugins", "mobile", "secrets", "apnsKey")),
    ).toBe(true);
  });

  it("does nothing when the target already has a database", async () => {
    const root = await makeSource();
    const target = join(root, "target");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "bb.db"), "existing");

    const state = await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: join(root, "source") },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });

    expect(state).toBeNull();
    expect(readFileSync(join(target, "bb.db"), "utf8")).toBe("existing");
  });

  it("imports only into the packaged data dir unless a source is named, and can be turned off", () => {
    expect(
      resolveForkImportSource({ dataDir: "/tmp/dev-data", env: {} }),
    ).toBeNull();
    expect(
      resolveForkImportSource({ dataDir: "/Users/x/.bb-studio", env: {} }),
    ).toMatch(/\.bb$/u);
    expect(
      resolveForkImportSource({
        dataDir: "/Users/x/.bb-studio",
        env: { BB_STUDIO_IMPORT_FROM: "off" },
      }),
    ).toBeNull();
  });

  it("brings no plugins, records the old ones, and applies the import file's UI preferences", async () => {
    const root = await makeSource();
    const source = join(root, "source");
    const target = join(root, "target");
    const seed = new Database(join(source, "bb.db"));
    const columns = seed
      .prepare<
        [],
        {
          name: string;
          notnull: number;
          dflt_value: string | null;
          type: string;
        }
      >(
        "SELECT name, \"notnull\", dflt_value, type FROM pragma_table_info('plugins')",
      )
      .all();
    const required = columns.filter(
      (column) => column.notnull === 1 && column.dflt_value === null,
    );
    const insert = (
      id: string,
      kind: string,
      path: string,
      enabled: number,
    ) => {
      const values: Record<string, unknown> = {};
      for (const column of required) {
        values[column.name] = /INT/i.test(column.type) ? 1 : "x";
      }
      Object.assign(values, {
        id,
        source: path,
        root_dir: path,
        enabled,
        version: "1.2.3",
        source_kind: kind,
        source_path: kind === "path" ? path : null,
      });
      const names = Object.keys(values);
      seed
        .prepare(
          `INSERT INTO plugins (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")})`,
        )
        .run(values);
    };
    insert("studio", "path", "/old/studio", 1);
    insert("other-tool", "path", "/old/other", 0);
    seed
      .prepare(
        "INSERT INTO plugin_settings (plugin_id, key, value, updated_at) VALUES ('other-tool', 'k', '1', 1)",
      )
      .run();
    seed.close();
    await writeFile(
      join(root, "target-import.json"),
      JSON.stringify({
        uiPreferences: { "sidebar.threadListProvider": "studio/everything" },
      }),
    );

    await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: source },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });

    const db = new Database(join(target, "bb.db"), { readonly: true });
    for (const table of [
      "plugins",
      "plugin_artifacts",
      "plugin_kv",
      "plugin_settings",
      "plugin_schedules",
      "plugin_state_snapshots",
      "thread_plugin_metadata",
    ]) {
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 0 });
    }
    expect(
      db
        .prepare(
          "SELECT value_json FROM ui_preferences WHERE key = 'sidebar.threadListProvider'",
        )
        .get(),
    ).toEqual({ value_json: '"studio/everything"' });
    db.close();
    expect(existsSync(join(target, "plugins"))).toBe(false);
    const record = JSON.parse(
      readFileSync(join(target, "fork-import-plugins.json"), "utf8"),
    ) as { sourceDataDir: string; plugins: unknown[] };
    expect(record.sourceDataDir).toBe(source);
    expect(record.plugins).toEqual([
      {
        id: "other-tool",
        version: "1.2.3",
        source: "/old/other",
        sourceKind: "path",
        enabled: false,
        catalog: null,
        hadData: false,
      },
      {
        id: "studio",
        version: "1.2.3",
        source: "/old/studio",
        sourceKind: "path",
        enabled: true,
        catalog: null,
        hadData: true,
      },
    ]);
  });

  it("leaves out bb's Community catalog and records the plugins installed from catalogs", async () => {
    const root = await makeSource();
    const source = join(root, "source");
    const target = join(root, "target");
    const seed = new Database(join(source, "bb.db"));
    const insertRow = (table: string, values: Record<string, unknown>) => {
      const row: Record<string, unknown> = {};
      for (const column of seed
        .prepare<
          [],
          {
            name: string;
            notnull: number;
            dflt_value: string | null;
            type: string;
          }
        >(
          `SELECT name, "notnull", dflt_value, type FROM pragma_table_info('${table}')`,
        )
        .all()) {
        if (column.notnull === 1 && column.dflt_value === null) {
          row[column.name] = /INT/i.test(column.type) ? 1 : "x";
        }
      }
      Object.assign(row, values);
      const names = Object.keys(row);
      seed
        .prepare(
          `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")})`,
        )
        .run(row);
    };
    for (const name of ["bb-community", "acme"]) {
      insertRow("plugin_marketplaces", {
        name,
        source_kind: "https",
        manifest_url: `https://${name}.test/marketplace.json`,
        manifest_json: JSON.stringify({ schemaVersion: 1, name, plugins: [] }),
      });
      insertRow("plugin_marketplace_icons", { marketplace_name: name });
    }
    insertRow("plugins", {
      id: "hover-cards",
      enabled: 1,
      provenance: "catalog",
      catalog_entry_id: "hover-cards",
      catalog_marketplace_name: "bb-community",
      source_kind: "git",
    });
    insertRow("plugins", {
      id: "acme-notes",
      enabled: 1,
      provenance: "catalog",
      catalog_entry_id: "notes",
      catalog_marketplace_name: "acme",
      source_kind: "git",
    });
    seed.close();

    await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: source },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });

    const db = new Database(join(target, "bb.db"), { readonly: true });
    const marketplaces = db
      .prepare("SELECT name FROM plugin_marketplaces ORDER BY name")
      .all();
    const icons = db
      .prepare(
        "SELECT marketplace_name FROM plugin_marketplace_icons ORDER BY marketplace_name",
      )
      .all();
    const plugins = db.prepare("SELECT id FROM plugins").all();
    db.close();
    expect(marketplaces).toEqual([{ name: "acme" }]);
    expect(icons).toEqual([{ marketplace_name: "acme" }]);
    expect(plugins).toEqual([]);
    const record = JSON.parse(
      readFileSync(join(target, "fork-import-plugins.json"), "utf8"),
    ) as { plugins: { id: string; catalog: unknown }[] };
    expect(record.plugins.map(({ id, catalog }) => ({ id, catalog }))).toEqual([
      { id: "acme-notes", catalog: { marketplace: "acme", entryId: "notes" } },
      {
        id: "hover-cards",
        catalog: { marketplace: "bb-community", entryId: "hover-cards" },
      },
    ]);
  });
});
