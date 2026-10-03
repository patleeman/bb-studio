import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";

/** Kept separate from the host's and each module's append-only migrations. */
const IMPORTS = `CREATE TABLE IF NOT EXISTS module_imports (
  module TEXT PRIMARY KEY, legacy_plugin_id TEXT NOT NULL, source TEXT,
  imported_at INTEGER NOT NULL, settings_count INTEGER NOT NULL, kv_count INTEGER NOT NULL
)`;
const STATE = `CREATE TABLE IF NOT EXISTS studio_module_state (
  kind TEXT NOT NULL CHECK(kind IN ('settings', 'kv')), key TEXT NOT NULL,
  value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind, key)
)`;
type StateRow = { key: string; value: string; updated_at: number };
type Receipt = { module: string; legacy_plugin_id: string; source: string | null; imported_at: number; settings_count: number; kv_count: number };

export interface ModuleImportOptions {
  /** The actual server directory, never an inferred ~/.bb. */
  dataDir: string;
  module: string;
  /** Owning plugin; Studio by default, Pages for Explore. */
  ownerPluginId?: string;
  legacyPluginId: string;
  core: Database.Database;
  /** Uses the host's SQLite implementation; no second native runtime. */
  open: (path: string, options?: Database.Options) => Database.Database;
  /** Import must wait until the legacy writer is stopped. */
  legacyRunning: boolean;
}

/**
 * Publish a complete SQLite snapshot atomically. A receipt inside the snapshot
 * repairs a crash between the rename and recording the import in core.
 * Settings/KV retain exact stored JSON and timestamps in the module's file.
 */
export async function importModule(options: ModuleImportOptions): Promise<string> {
  const { dataDir, module, legacyPluginId, core, open } = options;
  for (const name of [module, legacyPluginId, options.ownerPluginId ?? "studio"]) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid module identity: ${name}`);
  }
  const target = join(dataDir, "plugins", options.ownerPluginId ?? "studio", `${module}.db`);
  core.exec(IMPORTS);
  const record = (receipt: Receipt) => core.prepare(`INSERT OR IGNORE INTO module_imports
    (module, legacy_plugin_id, source, imported_at, settings_count, kv_count)
    VALUES (@module, @legacy_plugin_id, @source, @imported_at, @settings_count, @kv_count)`).run(receipt);
  if (existsSync(target)) {
    const existing = open(target, { readonly: true, fileMustExist: true });
    try {
      const hasReceipt = existing.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'module_imports'").get();
      const receipt = hasReceipt ? existing.prepare("SELECT * FROM module_imports WHERE module = ?").get(module) as Receipt | undefined : undefined;
      if (receipt) record(receipt);
    } finally { existing.close(); }
    // Never replace an existing module database, including one without a receipt.
    return target;
  }
  if (options.legacyRunning) throw new Error(`Stop ${legacyPluginId} before importing ${module}`);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.importing`;
  // An interrupted import never became authoritative. Rebuild it from source.
  for (const suffix of ["", "-wal", "-shm"]) rmSync(temporary + suffix, { force: true });
  const source = join(dataDir, "plugins", legacyPluginId, "data.db");
  let snapshot: Database.Database | undefined;
  try {
    if (existsSync(source)) {
      const legacy = open(source, { fileMustExist: true });
      try {
        const checkpoint = legacy.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[];
        if (checkpoint.some(result => result.busy !== 0)) throw new Error(`Busy legacy database: ${legacyPluginId}`);
        // SQLite backup copies every committed page, including WAL state, into
        // one consistent standalone file rather than racing three file copies.
        await legacy.backup(temporary);
      } finally { legacy.close(); }
    }
    snapshot = open(temporary);
    snapshot.exec(IMPORTS);
    snapshot.exec(STATE);
    let settings: StateRow[] = [], kv: StateRow[] = [];
    const hostPath = join(dataDir, "bb.db");
    if (existsSync(hostPath)) {
      const host = open(hostPath, { readonly: true, fileMustExist: true });
      try {
        host.transaction(() => {
          const read = (table: "plugin_settings" | "plugin_kv") => {
            if (!host.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) return [];
            return host.prepare(`SELECT key, value, updated_at FROM ${table} WHERE plugin_id = ?`).all(legacyPluginId) as StateRow[];
          };
          settings = read("plugin_settings"); kv = read("plugin_kv");
        })();
      } finally { host.close(); }
    }
    const receipt: Receipt = { module, legacy_plugin_id: legacyPluginId, source: existsSync(source) ? source : null,
      imported_at: Date.now(), settings_count: settings.length, kv_count: kv.length };
    snapshot.transaction(() => {
      const insert = snapshot!.prepare("INSERT INTO studio_module_state (kind, key, value, updated_at) VALUES (?, ?, ?, ?)");
      for (const [kind, rows] of [["settings", settings], ["kv", kv]] as const) {
        for (const row of rows) insert.run(kind, row.key, row.value, row.updated_at);
      }
      snapshot!.prepare(`INSERT INTO module_imports
        (module, legacy_plugin_id, source, imported_at, settings_count, kv_count)
        VALUES (@module, @legacy_plugin_id, @source, @imported_at, @settings_count, @kv_count)`).run(receipt);
    })();
    snapshot.pragma("wal_checkpoint(TRUNCATE)");
    snapshot.close(); snapshot = undefined;
    renameSync(temporary, target);
    record(receipt);
    return target;
  } finally {
    snapshot?.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(temporary + suffix, { force: true });
  }
}
