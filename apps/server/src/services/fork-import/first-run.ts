import Database from "better-sqlite3";
import { resetForkRailPreferences } from "./fork-rail-reset.js";
import { recordPluginBaselines } from "./plugin-sync.js";
import { setForkImportDataDir } from "./index.js";
import {
  closeForkImportDatabase,
  FORK_IMPORT_DATABASE_FILE_NAME,
  FORK_IMPORT_STATE_FILE_NAME,
  openForkImportDatabase,
  type ForkImportState,
} from "./state.js";
import {
  copyFilesInParallel,
  failureAttempts,
  failureDetail,
  FIRST_RUN_FAILED_FILE_NAME,
  firstRunFailureMessage,
  FirstRunImportError,
  FirstRunImportTimeoutError,
  firstRunRetryPending,
  hasFirstRunJournal,
  readFirstRunFailure,
  ImportDeadline,
  moveIntoDataDir,
  recoverInterruptedFirstRunImport,
  stagingDirPrefix,
  sweepFirstRunStaging,
  writeFirstRunFailure,
} from "./first-run-install.js";
import { snapshotDatabases, type SnapshotJob } from "./first-run-snapshot.js";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  bbAppManagedEnvFileSchema,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import {
  listServerOwnedEntries,
  mergeImportedManagedConfig,
  SERVER_CONNECT_HOLD_FILE_NAME,
  SERVER_IMPORT_FILE_NAME,
  SERVER_IMPORT_JOURNAL_FILE_NAME,
  writeServerConnectHoldFile,
  writeServerImportFile,
} from "@bb/server-archive";
import type { ServerLogger } from "../../types.js";
import { readPrimaryHostIdFromDataDir } from "../hosts/primary-host.js";

export const FORK_IMPORT_SOURCE_ENV = "BB_STUDIO_IMPORT_FROM";
export const FORK_IMPORT_TIMEOUT_ENV = "BB_STUDIO_IMPORT_TIMEOUT_MS";

const DEFAULT_IMPORT_TIMEOUT_MS = 30_000;
const MAX_IMPORT_TIMEOUT_MS = 45_000;
const RETRY_BACKUP_DIR_NAME = "fork-import-retry-backup";
const CLEAN_START_EXTRA_PATHS = [
  "auth.json",
  "host-id",
  "fork-rail-reset.json",
  "server-import.json",
  "server-connect-hold.json",
];
const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];

const DATABASE_FILE_NAME = "bb.db";
const MANAGED_CONFIG_FILE_NAME = "config.json";
const MANAGED_ENV_FILE_NAME = "env.json";
const PRODUCTION_DATA_DIR_NAME = ".bb-studio";
const DEFAULT_SOURCE_DIR_NAME = ".bb";

type ImportedManagedConfig = Parameters<
  typeof mergeImportedManagedConfig
>[0]["importedConfig"];

const EXCLUDED_PATHS = [
  "auth-secret",
  "telemetry-id",
  "plugins/mobile",
  "plugins/push-notifications",
  "plugins/account-pool/secrets",
  "plugins/snapshots",
];
const JUNK_FILE_NAMES = new Set([".DS_Store"]);

const AFTER_START_PATHS = ["attachments"];

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
  "UPDATE plugins SET provenance = 'direct', catalog_entry_id = NULL, catalog_marketplace_name = NULL, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE provenance = 'catalog' AND catalog_marketplace_name = 'bb-community' AND removed_at IS NULL",
  "DELETE FROM plugin_marketplace_icons WHERE marketplace_name = 'bb-community'",
  "DELETE FROM plugin_marketplaces WHERE name = 'bb-community'",
  "DELETE FROM plugin_state_snapshots",
  "DELETE FROM apikey",
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
  timeoutMs?: number;
}

function isExcluded(path: string): boolean {
  return EXCLUDED_PATHS.some(
    (excluded) => path === excluded || path.startsWith(`${excluded}/`),
  );
}

function isJunk(path: string): boolean {
  return JUNK_FILE_NAMES.has(basename(path));
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

function scrubDatabase(path: string, scrub: readonly string[]): void {
  const snapshot = new Database(path, { fileMustExist: true });
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

export function importTimeoutMs(args: {
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
}): number {
  const configured =
    args.timeoutMs ?? Number(args.env[FORK_IMPORT_TIMEOUT_ENV]);
  const timeout =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_IMPORT_TIMEOUT_MS;
  return Math.min(timeout, MAX_IMPORT_TIMEOUT_MS);
}

function parseManagedConfig(value: unknown): ImportedManagedConfig {
  const config: ImportedManagedConfig = { ...parseBbAppManagedConfig(value) };
  const raw = value as { customModels?: unknown };
  if (Array.isArray(raw.customModels)) config.customModels = raw.customModels;
  return config;
}

async function readManaged<T>(
  path: string,
  label: string,
  parse: (value: unknown) => T,
): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new FirstRunImportError(`${label} is not valid JSON`);
  }
  try {
    return parse(value);
  } catch {
    throw new FirstRunImportError(`${label} is not in the expected form`);
  }
}

async function mergeManagedFiles(
  dataDir: string,
  filesDir: string,
): Promise<void> {
  const config = join(dataDir, MANAGED_CONFIG_FILE_NAME);
  const stagedConfig = join(filesDir, MANAGED_CONFIG_FILE_NAME);
  if ((await exists(config)) && (await exists(stagedConfig))) {
    const merged = mergeImportedManagedConfig({
      importedConfig: await readManaged(
        stagedConfig,
        "bb's config.json",
        parseManagedConfig,
      ),
      existingConfig: await readManaged(
        config,
        "BB Studio's config.json",
        parseManagedConfig,
      ),
      localServerUrl: null,
    });
    await writeFile(stagedConfig, `${JSON.stringify(merged, null, 2)}\n`);
  }
  const env = join(dataDir, MANAGED_ENV_FILE_NAME);
  const stagedEnv = join(filesDir, MANAGED_ENV_FILE_NAME);
  if ((await exists(env)) && (await exists(stagedEnv))) {
    const parseEnv = (value: unknown) => bbAppManagedEnvFileSchema.parse(value);
    const existing = await readManaged(env, "BB Studio's env.json", parseEnv);
    const imported = await readManaged(stagedEnv, "bb's env.json", parseEnv);
    const merged = { ...existing.env, ...imported.env };
    await writeFile(
      stagedEnv,
      `${JSON.stringify(Object.keys(merged).length > 0 ? { env: merged } : {}, null, 2)}\n`,
    );
  }
}

async function setAsideCleanStart(
  dataDir: string,
  now: number,
): Promise<string> {
  const backup = join(dataDir, RETRY_BACKUP_DIR_NAME, String(now));
  const inventory = await listServerOwnedEntries(dataDir);
  const paths = new Set<string>(CLEAN_START_EXTRA_PATHS);
  for (const entry of inventory.entries) {
    if (
      entry.path === MANAGED_CONFIG_FILE_NAME ||
      entry.path === MANAGED_ENV_FILE_NAME
    ) {
      continue;
    }
    paths.add(entry.path);
  }
  for (const path of [...paths]) {
    if (path.endsWith(".db")) {
      for (const suffix of SQLITE_SIDECAR_SUFFIXES)
        paths.add(`${path}${suffix}`);
    }
  }
  for (const path of [...paths].sort()) {
    const from = join(dataDir, ...path.split("/"));
    if (!(await exists(from))) continue;
    const to = join(backup, ...path.split("/"));
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  }
  return backup;
}

export async function runForkFirstRunImport(
  args: RunForkFirstRunImportArgs,
): Promise<ForkImportState | null> {
  const dataDir = resolve(args.dataDir);
  await recoverInterruptedFirstRunImport(dataDir, args.logger);
  const sourceDataDir = resolveForkImportSource(args);
  if (sourceDataDir === null || sourceDataDir === dataDir) return null;
  if (await exists(join(dataDir, FORK_IMPORT_STATE_FILE_NAME))) return null;
  if (await exists(join(dataDir, SERVER_IMPORT_JOURNAL_FILE_NAME))) return null;
  const failure = readFirstRunFailure(dataDir);
  if (failure !== null) {
    if (!firstRunRetryPending(dataDir, failure)) return null;
    if (!(await exists(join(sourceDataDir, DATABASE_FILE_NAME)))) return null;
    const backup = await setAsideCleanStart(dataDir, args.now);
    args.logger.info(
      { attempt: failureAttempts(failure) + 1, backup },
      "First-run import trying again; the empty start is set aside",
    );
  }
  for (const name of [DATABASE_FILE_NAME, FORK_IMPORT_STATE_FILE_NAME]) {
    if (await exists(join(dataDir, name))) return null;
  }
  if (!(await exists(join(sourceDataDir, DATABASE_FILE_NAME)))) {
    args.logger.info(
      { sourceDataDir },
      "First-run import skipped: no bb database at the source",
    );
    return null;
  }

  const startedAt = Date.now();
  const deadline = new ImportDeadline(importTimeoutMs(args), startedAt);
  args.logger.info({ sourceDataDir, dataDir }, "First-run import started");
  await mkdir(dataDir, { recursive: true });
  const stagingDir = await mkdtemp(
    join(dirname(dataDir), stagingDirPrefix(dataDir)),
  );
  const filesDir = join(stagingDir, "files");
  let finished = false;
  try {
    const inventory = await listServerOwnedEntries(sourceDataDir);
    deadline.check();
    const snapshots: SnapshotJob[] = [
      {
        from: join(sourceDataDir, DATABASE_FILE_NAME),
        to: join(filesDir, DATABASE_FILE_NAME),
      },
    ];
    const scrubs = new Map<string, readonly string[]>([
      [DATABASE_FILE_NAME, DATABASE_SCRUB_STATEMENTS],
    ]);
    const copies: { from: string; to: string }[] = [];
    const roots: string[] = [];
    const excluded: string[] = [];
    let afterStart = 0;
    for (const entry of inventory.entries) {
      if (entry.path === DATABASE_FILE_NAME) continue;
      if (isExcluded(entry.path)) {
        excluded.push(entry.path);
        continue;
      }
      if (AFTER_START_PATHS.includes(entry.path)) {
        afterStart += entry.files.length;
        continue;
      }
      let kept = 0;
      for (const file of entry.files) {
        if (isExcluded(file.path) || isJunk(file.path)) continue;
        const to = join(filesDir, ...file.path.split("/"));
        if (file.sqliteDatabase) {
          snapshots.push({ from: file.absolutePath, to });
          const scrub = PLUGIN_DATABASE_SCRUB_STATEMENTS[file.path];
          if (scrub !== undefined) scrubs.set(file.path, scrub);
        } else {
          copies.push({ from: file.absolutePath, to });
        }
        kept += 1;
      }
      if (kept > 0) roots.push(entry.path);
    }

    for (const job of snapshots) {
      await mkdir(dirname(job.to), { recursive: true });
    }
    await snapshotDatabases(snapshots, deadline);
    for (const [path, statements] of scrubs) {
      scrubDatabase(join(filesDir, ...path.split("/")), statements);
    }
    const databaseSnapshotPath = join(filesDir, DATABASE_FILE_NAME);
    applyPluginOptions(databaseSnapshotPath, readForkImportOptions(dataDir));
    const facts = readSnapshotFacts(databaseSnapshotPath);
    deadline.check();
    await copyFilesInParallel(copies, deadline);
    deadline.check();
    await mergeManagedFiles(dataDir, filesDir);

    const sourceServerHostId = readPrimaryHostIdFromDataDir({
      dataDir: sourceDataDir,
    });
    await writeServerConnectHoldFile(filesDir, {
      version: 1,
      reason: "manual-import",
      createdAt: args.now,
    });
    await writeServerImportFile(filesDir, {
      version: 1,
      kind: "manual",
      moveId: null,
      activationToken: null,
      sourceDataDir,
      sourceServerHostId,
      targetHostId: null,
      serverUrl: null,
      importedEntries: [...roots, DATABASE_FILE_NAME],
      createdAt: args.now,
      fixupsAppliedAt: null,
    });
    seedMirroredThreads(filesDir, join(sourceDataDir, DATABASE_FILE_NAME));
    recordPluginBaselines(filesDir);
    closeForkImportDatabase(filesDir);
    const forkDatabaseFiles = [
      FORK_IMPORT_DATABASE_FILE_NAME,
      `${FORK_IMPORT_DATABASE_FILE_NAME}-wal`,
      `${FORK_IMPORT_DATABASE_FILE_NAME}-shm`,
    ];
    const forkDatabasePaths: string[] = [];
    for (const name of forkDatabaseFiles) {
      if (await exists(join(filesDir, name))) forkDatabasePaths.push(name);
    }
    deadline.check();

    const state: ForkImportState = {
      version: 1,
      sourceDataDir,
      sourceServerHostId,
      importedAt: args.now,
      sourceEventRowid: facts.eventRowid,
    };
    await moveIntoDataDir({
      dataDir,
      stagingDir,
      filesDir,
      paths: [
        ...roots,
        SERVER_CONNECT_HOLD_FILE_NAME,
        SERVER_IMPORT_FILE_NAME,
        ...forkDatabasePaths,
        DATABASE_FILE_NAME,
      ],
      replaceable: new Set([MANAGED_CONFIG_FILE_NAME, MANAGED_ENV_FILE_NAME]),
      commit: async () => {
        const path = join(dataDir, FORK_IMPORT_STATE_FILE_NAME);
        await writeFile(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
        await rename(`${path}.tmp`, path);
      },
    });
    finished = true;
    await rm(join(dataDir, FIRST_RUN_FAILED_FILE_NAME), { force: true });
    args.logger.info(
      {
        sourceDataDir,
        files: copies.length + snapshots.length,
        excluded,
        attachmentsAfterStart: afterStart,
        skippedPaths: inventory.skippedPaths.length,
        durationMs: Date.now() - startedAt,
        serverUptimeMs: Math.round(process.uptime() * 1000),
      },
      "First-run import finished",
    );
    return state;
  } finally {
    closeForkImportDatabase(filesDir);
    if (!(await hasFirstRunJournal(dataDir))) {
      const removal = rm(stagingDir, { force: true, recursive: true });
      if (finished) await removal;
      else void removal.catch(() => undefined);
    }
  }
}

export async function forkBeforeDatabase(
  serverConfig: { BB_DATA_DIR: string; BB_APP_VERSION: string },
  logger: Pick<ServerLogger, "info" | "warn">,
): Promise<void> {
  const dataDir = resolve(serverConfig.BB_DATA_DIR);
  setForkImportDataDir(dataDir);
  try {
    await runForkFirstRunImport({
      dataDir,
      env: process.env,
      logger,
      now: Date.now(),
      appVersion: serverConfig.BB_APP_VERSION,
    });
  } catch (error) {
    const sourceDataDir =
      resolveForkImportSource({ dataDir, env: process.env }) ?? "";
    const reason =
      error instanceof FirstRunImportTimeoutError ? "timed-out" : "error";
    const previous = readFirstRunFailure(dataDir);
    const attempts = previous === null ? 1 : failureAttempts(previous) + 1;
    const message = firstRunFailureMessage(sourceDataDir, reason, attempts);
    const detail = failureDetail(error);
    logger.warn({ sourceDataDir, detail, attempts }, message);
    try {
      await writeFirstRunFailure(dataDir, {
        version: 1,
        sourceDataDir,
        failedAt: Date.now(),
        reason,
        detail,
        message,
        attempts,
      });
    } catch (writeError) {
      logger.warn(
        { detail: failureDetail(writeError) },
        "could not record the failed import",
      );
    }
  }
  if (await hasFirstRunJournal(dataDir)) {
    await recoverInterruptedFirstRunImport(dataDir, logger).catch(
      () => undefined,
    );
    if (await hasFirstRunJournal(dataDir)) {
      throw new FirstRunImportError(
        `BB Studio could not undo an unfinished copy of your bb data in ${dataDir}, so it will not start on half-copied data. Move ${dataDir} aside and open BB Studio again.`,
      );
    }
  }
  void sweepFirstRunStaging(dataDir)
    .then((removed) => {
      if (removed > 0) {
        logger.info({ removed }, "Removed staging left by a stopped import");
      }
    })
    .catch((error: unknown) => {
      logger.warn(
        { detail: failureDetail(error) },
        "could not remove old import staging",
      );
    });
  try {
    resetForkRailPreferences(dataDir, Date.now());
  } catch (error) {
    logger.warn({ error }, "fork rail preferences were not reset");
  }
}
