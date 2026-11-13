import Database from "better-sqlite3";
import { resetForkRailPreferences } from "./fork-rail-reset.js";
import { recordPluginBaselines } from "./plugin-sync.js";
import { setForkImportDataDir } from "./index.js";
import {
  FORK_IMPORT_STATE_FILE_NAME,
  openForkImportDatabase,
  type ForkImportState,
} from "./state.js";
import { createHash } from "node:crypto";
import {
  createReadStream,
  constants as fsConstants,
  readFileSync,
} from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  discardImportBackups,
  installImportedServerFiles,
  listServerOwnedEntries,
  removeServerImportJournalFile,
  rollBackServerImport,
  writeServerConnectHoldFile,
  writeServerImportFile,
  type ServerArchiveManifest,
} from "@bb/server-archive";
import type { ServerLogger } from "../../types.js";
import { readPrimaryHostIdFromDataDir } from "../hosts/primary-host.js";

export const FORK_IMPORT_SOURCE_ENV = "BB_STUDIO_IMPORT_FROM";

const DATABASE_FILE_NAME = "bb.db";
const PRODUCTION_DATA_DIR_NAME = ".bb-studio";
const DEFAULT_SOURCE_DIR_NAME = ".bb";

const EXCLUDED_PATHS = [
  "telemetry-id",
  "plugins/mobile",
  "plugins/push-notifications",
  "plugins/account-pool/secrets",
];

const DATABASE_SCRUB_STATEMENTS = [
  "DELETE FROM plugin_kv WHERE plugin_id IN ('push-notifications', 'mobile')",
  "DELETE FROM plugin_kv WHERE plugin_id = 'account-pool' AND (key LIKE 'rejected-refresh:%' OR key LIKE 'routed:%' OR key LIKE 'retry-route:%')",
  "DELETE FROM host_daemon_sessions",
  "DELETE FROM queued_thread_messages",
  "DELETE FROM pending_interactions",
  "DELETE FROM terminal_sessions",
  "DELETE FROM ui_preferences WHERE key IN ('sidebar.pluginPanelOrder', 'sidebar.visiblePluginPanels', 'sidebar.hiddenFooterItems', 'sidebar.footerOrder')",
  "UPDATE plugin_settings SET value = 'false' WHERE plugin_id = 'studio' AND key = 'loopsEnabled'",
  "UPDATE plugins SET enabled = 0 WHERE id IN ('mobile', 'push-notifications', 'automations', 'storage-retention', 'bb--storage-retention', 'bb-account', 'connect')",
  "UPDATE plugins SET enabled_follows_default = 0 WHERE id IN ('mobile', 'push-notifications', 'automations', 'storage-retention', 'bb--storage-retention', 'bb-account', 'connect')",
  "UPDATE threads SET status = 'idle' WHERE status IN ('starting', 'active', 'stopping')",
];

const PLUGIN_DATABASE_SCRUB_STATEMENTS: Readonly<
  Record<string, readonly string[]>
> = {
  "plugins/automations/data.db": ["UPDATE automations SET enabled = 0"],
  "plugins/account-pool/data.db": [
    "DELETE FROM account_quota",
    "DELETE FROM pool_affinity",
    "DELETE FROM pool_active_account",
  ],
  "plugins/studio/data.db": [
    "UPDATE bots SET state = 'stopped', heartbeat_was_on = 0",
    "UPDATE bot_runners SET state = 'paused'",
    "UPDATE bot_automations SET state = 'paused'",
    "UPDATE bot_cache_settings SET enabled = 0",
  ],
};

export interface RunForkFirstRunImportArgs {
  dataDir: string;
  env: Readonly<Record<string, string | undefined>>;
  logger: Pick<ServerLogger, "info" | "warn">;
  now: number;
  appVersion: string;
}

function isExcluded(path: string): boolean {
  return EXCLUDED_PATHS.some(
    (excluded) => path === excluded || path.startsWith(`${excluded}/`),
  );
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function seedMirroredThreads(
  dataDir: string,
  sourceDatabasePath: string,
): void {
  const source = new Database(sourceDatabasePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    const imported = new Database(join(dataDir, DATABASE_FILE_NAME), {
      fileMustExist: true,
      readonly: true,
    });
    try {
      const statusOf = source.prepare<[string], { status: string }>(
        "SELECT status FROM threads WHERE id = ?",
      );
      const insert = openForkImportDatabase(dataDir).prepare(
        "INSERT OR IGNORE INTO mirrored_threads (thread_id, source_updated_at, source_status) VALUES (?, ?, ?)",
      );
      const rows = imported
        .prepare<[], { id: string; updated_at: number }>(
          "SELECT id, updated_at FROM threads",
        )
        .all();
      openForkImportDatabase(dataDir).transaction(() => {
        for (const row of rows) {
          insert.run(
            row.id,
            row.updated_at,
            statusOf.get(row.id)?.status ?? "idle",
          );
        }
      })();
    } finally {
      imported.close();
    }
  } finally {
    source.close();
  }
}

export interface ForkImportOptions {
  keepPlugins: string[] | null;
  pluginPaths: Record<string, string>;
  uiPreferences: Record<string, unknown>;
}

export function forkImportOptionsPath(dataDir: string): string {
  const resolved = resolve(dataDir);
  return join(dirname(resolved), `${basename(resolved)}-import.json`);
}

export function readForkImportOptions(dataDir: string): ForkImportOptions {
  const options: ForkImportOptions = {
    keepPlugins: null,
    pluginPaths: {},
    uiPreferences: {},
  };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(forkImportOptionsPath(dataDir), "utf8"));
  } catch {
    return options;
  }
  if (typeof raw !== "object" || raw === null) return options;
  const { keepPlugins, pluginPaths, uiPreferences } = raw as Record<
    string,
    unknown
  >;
  if (typeof uiPreferences === "object" && uiPreferences !== null) {
    options.uiPreferences = { ...(uiPreferences as Record<string, unknown>) };
  }
  if (Array.isArray(keepPlugins)) {
    options.keepPlugins = keepPlugins.filter(
      (id): id is string => typeof id === "string",
    );
  }
  if (typeof pluginPaths === "object" && pluginPaths !== null) {
    for (const [id, path] of Object.entries(pluginPaths)) {
      if (typeof path === "string" && path.startsWith("/")) {
        options.pluginPaths[id] = path;
      }
    }
  }
  return options;
}

function applyPluginOptions(
  databasePath: string,
  options: ForkImportOptions,
): void {
  if (
    options.keepPlugins === null &&
    Object.keys(options.pluginPaths).length === 0 &&
    Object.keys(options.uiPreferences).length === 0
  ) {
    return;
  }
  const snapshot = new Database(databasePath, { fileMustExist: true });
  try {
    for (const [id, path] of Object.entries(options.pluginPaths)) {
      snapshot
        .prepare(
          "UPDATE plugins SET root_dir = ?, source_path = ?, source = ? WHERE id = ? AND source_kind = 'path'",
        )
        .run(path, path, path, id);
    }
    const setPreference = snapshot.prepare(
      `INSERT INTO ui_preferences (key, value_json, revision, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, revision = revision + 1, updated_at = excluded.updated_at`,
    );
    for (const [key, value] of Object.entries(options.uiPreferences)) {
      setPreference.run(key, JSON.stringify(value), Date.now());
    }
    if (options.keepPlugins !== null) {
      const keep = new Set(options.keepPlugins);
      const rows = snapshot
        .prepare<[], { id: string }>(
          "SELECT id FROM plugins WHERE source_kind != 'builtin' AND enabled = 1",
        )
        .all();
      const disable = snapshot.prepare(
        "UPDATE plugins SET enabled = 0, enabled_follows_default = 0 WHERE id = ?",
      );
      for (const row of rows) {
        if (!keep.has(row.id)) disable.run(row.id);
      }
    }
    snapshot.pragma("journal_mode = DELETE");
  } finally {
    snapshot.close();
  }
}

export function resolveForkImportSource(args: {
  dataDir: string;
  env: Readonly<Record<string, string | undefined>>;
}): string | null {
  const configured = args.env[FORK_IMPORT_SOURCE_ENV]?.trim();
  if (configured === "off") return null;
  if (configured !== undefined && configured.length > 0) {
    return resolve(configured);
  }
  return basename(resolve(args.dataDir)) === PRODUCTION_DATA_DIR_NAME
    ? join(homedir(), DEFAULT_SOURCE_DIR_NAME)
    : null;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function snapshotDatabase(
  sourcePath: string,
  destinationPath: string,
  scrub: readonly string[],
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const source = new Database(sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    await source.backup(destinationPath);
  } finally {
    source.close();
  }
  if (scrub.length === 0) return;
  const snapshot = new Database(destinationPath, { fileMustExist: true });
  try {
    for (const statement of scrub) {
      try {
        snapshot.exec(statement);
      } catch (error) {
        if (!/no such (table|column)/u.test(String(error))) throw error;
      }
    }
    snapshot.pragma("journal_mode = DELETE");
  } finally {
    snapshot.close();
  }
}

function readSnapshotFacts(databasePath: string): {
  migrationCount: number;
  eventRowid: number;
} {
  const snapshot = new Database(databasePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    const migrations = snapshot
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM __drizzle_migrations",
      )
      .get();
    const events = snapshot
      .prepare<[], { rowid: number | null }>(
        "SELECT MAX(rowid) AS rowid FROM events",
      )
      .get();
    return {
      migrationCount: migrations?.count ?? 0,
      eventRowid: events?.rowid ?? 0,
    };
  } finally {
    snapshot.close();
  }
}

export async function runForkFirstRunImport(
  args: RunForkFirstRunImportArgs,
): Promise<ForkImportState | null> {
  const dataDir = resolve(args.dataDir);
  const sourceDataDir = resolveForkImportSource(args);
  if (sourceDataDir === null || sourceDataDir === dataDir) return null;
  if (await exists(join(dataDir, DATABASE_FILE_NAME))) return null;
  if (await exists(join(dataDir, FORK_IMPORT_STATE_FILE_NAME))) return null;
  if (!(await exists(join(sourceDataDir, DATABASE_FILE_NAME)))) {
    args.logger.info(
      { sourceDataDir },
      "First-run import skipped: no bb database at the source",
    );
    return null;
  }

  args.logger.info({ sourceDataDir, dataDir }, "First-run import started");
  await mkdir(dirname(dataDir), { recursive: true });
  const stagingDir = await mkdtemp(
    join(dirname(dataDir), `.${basename(dataDir)}-first-run-import-`),
  );
  const filesDir = join(stagingDir, "files");
  try {
    const databaseSnapshotPath = join(filesDir, DATABASE_FILE_NAME);
    await snapshotDatabase(
      join(sourceDataDir, DATABASE_FILE_NAME),
      databaseSnapshotPath,
      DATABASE_SCRUB_STATEMENTS,
    );
    applyPluginOptions(databaseSnapshotPath, readForkImportOptions(dataDir));
    const facts = readSnapshotFacts(databaseSnapshotPath);
    const inventory = await listServerOwnedEntries(sourceDataDir);
    const paths = [DATABASE_FILE_NAME];
    for (const entry of inventory.entries) {
      for (const file of entry.files) {
        if (file.path === DATABASE_FILE_NAME || isExcluded(file.path)) continue;
        const stagedPath = join(filesDir, ...file.path.split("/"));
        if (file.sqliteDatabase) {
          await snapshotDatabase(
            file.absolutePath,
            stagedPath,
            PLUGIN_DATABASE_SCRUB_STATEMENTS[file.path] ?? [],
          );
        } else {
          await mkdir(dirname(stagedPath), { recursive: true });
          await copyFile(
            file.absolutePath,
            stagedPath,
            fsConstants.COPYFILE_FICLONE,
          );
        }
        paths.push(file.path);
      }
    }
    const entries: ServerArchiveManifest["entries"] = [];
    for (const path of paths) {
      const stagedPath = join(filesDir, ...path.split("/"));
      entries.push({
        path,
        size: (await stat(stagedPath)).size,
        sha256: await sha256OfFile(stagedPath),
      });
    }
    const manifest: ServerArchiveManifest = {
      format: "bb-server-archive",
      version: 2,
      createdAt: args.now,
      bbVersion: args.appVersion,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      migrationCount: facts.migrationCount,
      sourceDataDir,
      sourceServerHostId: readPrimaryHostIdFromDataDir({
        dataDir: sourceDataDir,
      }),
      serverMoveExperiment: true,
      entries,
    };
    const installed = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    });
    const state: ForkImportState = {
      version: 1,
      sourceDataDir,
      sourceServerHostId: manifest.sourceServerHostId,
      importedAt: args.now,
      sourceEventRowid: facts.eventRowid,
    };
    try {
      await writeServerConnectHoldFile(dataDir, {
        version: 1,
        reason: "manual-import",
        createdAt: args.now,
      });
      await writeServerImportFile(dataDir, {
        version: 1,
        kind: "manual",
        moveId: null,
        activationToken: null,
        sourceDataDir,
        sourceServerHostId: manifest.sourceServerHostId,
        targetHostId: null,
        serverUrl: null,
        importedEntries: installed.importedEntries,
        createdAt: args.now,
        fixupsAppliedAt: null,
      });
      await writeFile(
        join(dataDir, FORK_IMPORT_STATE_FILE_NAME),
        `${JSON.stringify(state, null, 2)}\n`,
      );
    } catch (error) {
      await rollBackServerImport(dataDir);
      throw error;
    }
    await removeServerImportJournalFile(dataDir);
    await discardImportBackups(dataDir);
    seedMirroredThreads(dataDir, join(sourceDataDir, DATABASE_FILE_NAME));
    recordPluginBaselines(dataDir);

    args.logger.info(
      {
        sourceDataDir,
        files: entries.length,
        skippedPaths: inventory.skippedPaths.length,
      },
      "First-run import finished",
    );
    return state;
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
}

export async function forkBeforeDatabase(
  serverConfig: { BB_DATA_DIR: string; BB_APP_VERSION: string },
  logger: Pick<ServerLogger, "info" | "warn">,
): Promise<void> {
  setForkImportDataDir(serverConfig.BB_DATA_DIR);
  await runForkFirstRunImport({
    dataDir: serverConfig.BB_DATA_DIR,
    env: process.env,
    logger,
    now: Date.now(),
    appVersion: serverConfig.BB_APP_VERSION,
  });
  try {
    resetForkRailPreferences(serverConfig.BB_DATA_DIR, Date.now());
  } catch (error) {
    logger.warn({ error }, "fork rail preferences were not reset");
  }
}
