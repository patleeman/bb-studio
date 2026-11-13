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
    expect(rows).toEqual([{ plugin_id: "studio" }]);
    const plugin = new Database(join(target, "plugins", "studio", "data.db"), {
      readonly: true,
    });
    expect(plugin.prepare("SELECT body FROM notes").all()).toEqual([
      { body: "hi" },
    ]);
    plugin.close();
    expect(
      readFileSync(join(target, "plugins", "studio", "secrets", "key"), "utf8"),
    ).toBe("s");
    expect(existsSync(join(target, "plugins", "mobile"))).toBe(false);
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

  it("leaves out the Account Pooler's logins, quota, pins and refresh records", async () => {
    const root = await makeSource();
    const source = join(root, "source");
    const target = join(root, "target");
    const account = "56ef0dab-0b49-4ce3-aae4-70bb3e7c3eb4";
    await mkdir(
      join(source, "plugins", "account-pool", "secrets", "accounts"),
      {
        recursive: true,
      },
    );
    await writeFile(
      join(
        source,
        "plugins",
        "account-pool",
        "secrets",
        "accounts",
        `account-${account}.json`,
      ),
      "{}",
    );
    await writeFile(
      join(
        source,
        "plugins",
        "account-pool",
        "secrets",
        "hub-token-host_source.json",
      ),
      "{}",
    );
    const pool = new Database(
      join(source, "plugins", "account-pool", "data.db"),
    );
    pool.exec(`
      CREATE TABLE account_quota (account_id TEXT PRIMARY KEY, error TEXT);
      CREATE TABLE pool_affinity (affinity_key TEXT PRIMARY KEY, account_id TEXT NOT NULL, last_used_at INTEGER NOT NULL);
      CREATE TABLE pool_active_account (provider TEXT PRIMARY KEY, account_id TEXT NOT NULL);
      INSERT INTO account_quota VALUES ('${account}', NULL);
      INSERT INTO pool_affinity VALUES ('["claude","host_source","session:s1"]', '${account}', 1);
      INSERT INTO pool_active_account VALUES ('claude', '${account}');
    `);
    pool.close();
    const db = new Database(join(source, "bb.db"));
    const insert = db.prepare(
      "INSERT INTO plugin_kv (plugin_id, key, value, updated_at) VALUES ('account-pool', ?, ?, 1)",
    );
    insert.run("accounts:v1", "[]");
    insert.run("routing.claude", "true");
    insert.run("bypass:thr_one", "true");
    insert.run(`rejected-refresh:${account}`, '{"message":"invalid_grant"}');
    insert.run("routed:thr_one", "{}");
    insert.run("retry-route:thr_one", '"claude"');
    db.close();

    await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: source },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });

    expect(existsSync(join(target, "plugins", "account-pool", "secrets"))).toBe(
      false,
    );
    const imported = new Database(
      join(target, "plugins", "account-pool", "data.db"),
      {
        readonly: true,
      },
    );
    for (const table of [
      "account_quota",
      "pool_affinity",
      "pool_active_account",
    ]) {
      expect(
        imported.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 0 });
    }
    imported.close();
    const kv = new Database(join(target, "bb.db"), { readonly: true });
    expect(
      kv
        .prepare(
          "SELECT key FROM plugin_kv WHERE plugin_id = 'account-pool' ORDER BY key",
        )
        .all(),
    ).toEqual([
      { key: "accounts:v1" },
      { key: "bypass:thr_one" },
      { key: "routing.claude" },
    ]);
    kv.close();
    expect(
      existsSync(
        join(
          source,
          "plugins",
          "account-pool",
          "secrets",
          "accounts",
          `account-${account}.json`,
        ),
      ),
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

  it("applies the optional import file: plugin folders to load from and which added plugins stay on; bb account and bb connect come in off", async () => {
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
    const insert = (id: string, kind: string, path: string) => {
      const values: Record<string, unknown> = {};
      for (const column of required) {
        values[column.name] = /INT/i.test(column.type) ? 1 : "x";
      }
      Object.assign(values, {
        id,
        source: path,
        root_dir: path,
        enabled: 1,
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
    insert("studio", "path", "/old/studio");
    insert("other-tool", "path", "/old/other");
    insert("bb-account", "builtin", "/old/bb-account");
    insert("connect", "builtin", "/old/connect");
    seed.close();
    await writeFile(
      join(root, "target-import.json"),
      JSON.stringify({
        keepPlugins: ["studio"],
        pluginPaths: { studio: "/new/studio" },
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
    const rows = db
      .prepare(
        "SELECT id, enabled, root_dir FROM plugins WHERE id IN ('studio', 'other-tool') ORDER BY id",
      )
      .all();
    const getbb = db
      .prepare(
        "SELECT id, enabled, enabled_follows_default FROM plugins WHERE id IN ('bb-account', 'connect') ORDER BY id",
      )
      .all();
    db.close();
    expect(getbb).toEqual([
      { id: "bb-account", enabled: 0, enabled_follows_default: 0 },
      { id: "connect", enabled: 0, enabled_follows_default: 0 },
    ]);
    const imported = new Database(join(target, "bb.db"), { readonly: true });
    expect(
      imported
        .prepare(
          "SELECT value_json FROM ui_preferences WHERE key = 'sidebar.threadListProvider'",
        )
        .get(),
    ).toEqual({ value_json: '"studio/everything"' });
    imported.close();
    expect(rows).toEqual([
      { id: "other-tool", enabled: 0, root_dir: "/old/other" },
      { id: "studio", enabled: 1, root_dir: "/new/studio" },
    ]);
  });
});
