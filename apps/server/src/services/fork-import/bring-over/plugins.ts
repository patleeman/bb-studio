import type Database from "better-sqlite3";
import { mkdir, readFile, rm } from "node:fs/promises";
import semver from "semver";
import { join } from "node:path";
import { BringOverError, errorDetail, exists } from "./files.js";
import { snapshotDatabases } from "./snapshot.js";

type Sqlite = Database.Database;

export const HIDDEN_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "studio",
  "studio-visual-chat",
  "mobile",
  "push-notifications",
  "automations",
  "storage-retention",
  "agent-annotations",
  "bb--connect-next",
  "bb--github-star",
  "bb--mcp",
  "bb--prompt-library",
  "bb--storage-retention",
  "bb-account",
  "bb-ai",
  "connect",
  "custom-instructions",
  "environment-modal-sandbox",
  "github",
  "inline-vis",
  "memory",
  "monaco-editor",
  "plugin-api-docs",
  "plugin-api-tester",
  "side-chat",
  "simple-notes",
  "tasks",
  "theme-preview",
  "workflows",
]);

export interface PluginItem {
  id: string;
  version: string | null;
  source: string;
  sourceKind: string;
  enabled: boolean;
  hasData: boolean;
  here: boolean;
  sourceMissing: boolean;
  needsNewer: string | null;
}

interface SourcePluginRow {
  id: string;
  version: string | null;
  source: string;
  source_kind: string;
  source_path: string | null;
  source_git_subdirectory: string | null;
  root_dir: string | null;
  enabled: number;
}

export interface PluginInstaller {
  install(
    source: string,
    selection: { kind: "root" } | { kind: "subdirectory"; path: string },
  ): Promise<{ id: string }>;
  installPath(path: string): Promise<{ id: string }>;
  reload(id?: string): Promise<unknown>;
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  listOpenPluginDatabases(): { pluginId: string }[];
}

function sourceRows(source: Sqlite): SourcePluginRow[] {
  try {
    return source
      .prepare<[], SourcePluginRow>(
        "SELECT id, version, source, source_kind, source_path, source_git_subdirectory, root_dir, enabled FROM plugins WHERE removed_at IS NULL ORDER BY id",
      )
      .all();
  } catch {
    return [];
  }
}

async function requiredBb(row: SourcePluginRow): Promise<string | null> {
  const directory =
    row.source_kind === "path" ? (row.source_path ?? row.source) : row.root_dir;
  if (directory === null) return null;
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { engines?: { bb?: unknown } };
    return typeof manifest.engines?.bb === "string"
      ? manifest.engines.bb
      : null;
  } catch {
    return null;
  }
}

export function fitsBb(range: string | null, appVersion: string): boolean {
  if (range === null || semver.validRange(range) === null) return true;
  const version = semver.coerce(appVersion);
  return (
    version === null ||
    semver.satisfies(version, range, { includePrerelease: true })
  );
}

function installedHere(target: Sqlite, id: string): boolean {
  return (
    target
      .prepare<[string], { found: number }>(
        "SELECT 1 AS found FROM plugins WHERE id = ? AND removed_at IS NULL",
      )
      .get(id) !== undefined
  );
}

function bundledHere(target: Sqlite, id: string): boolean {
  return (
    target
      .prepare<[string], { found: number }>(
        "SELECT 1 AS found FROM plugins WHERE id = ? AND source_kind = 'builtin'",
      )
      .get(id) !== undefined
  );
}

export async function listPlugins(
  source: Sqlite,
  target: Sqlite,
  sourceDataDir: string,
  appVersion: string,
): Promise<PluginItem[]> {
  const items: PluginItem[] = [];
  for (const row of sourceRows(source)) {
    if (
      row.source_kind === "builtin" ||
      HIDDEN_PLUGIN_IDS.has(row.id) ||
      bundledHere(target, row.id)
    ) {
      continue;
    }
    const range = await requiredBb(row);
    items.push({
      id: row.id,
      version: row.version,
      source: row.source,
      sourceKind: row.source_kind,
      enabled: row.enabled === 1,
      hasData: await exists(join(sourceDataDir, "plugins", row.id, "data.db")),
      here: installedHere(target, row.id),
      sourceMissing:
        row.source_kind === "path" &&
        !(await exists(row.source_path ?? row.source)),
      needsNewer: fitsBb(range, appVersion) ? null : range,
    });
  }
  return items;
}

function copyPluginRows(
  source: Sqlite,
  target: Sqlite,
  table: "plugin_kv" | "plugin_settings",
  pluginId: string,
): number {
  const rows = source
    .prepare<[string], { key: string; value: string; updated_at: number }>(
      `SELECT key, value, updated_at FROM ${table} WHERE plugin_id = ?`,
    )
    .all(pluginId);
  const insert = target.prepare(
    `INSERT OR REPLACE INTO ${table} (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
  );
  for (const row of rows)
    insert.run(pluginId, row.key, row.value, row.updated_at);
  return rows.length;
}

export async function addPlugin(args: {
  id: string;
  source: Sqlite;
  target: Sqlite;
  sourceDataDir: string;
  dataDir: string;
  installer: Pick<PluginInstaller, "install" | "installPath" | "reload">;
  appVersion: string;
}): Promise<{ id: string; data: boolean }> {
  const { source, target } = args;
  const row = sourceRows(source).find((plugin) => plugin.id === args.id);
  if (
    row === undefined ||
    row.source_kind === "builtin" ||
    HIDDEN_PLUGIN_IDS.has(row.id)
  ) {
    throw new BringOverError(`bb has no plugin ${args.id} that can be added`);
  }
  if (installedHere(target, row.id)) {
    throw new BringOverError(`${row.id} is already installed`);
  }
  const path = row.source_path ?? row.source;
  if (row.source_kind === "path" && !(await exists(path))) {
    throw new BringOverError(
      `${row.id} was installed from ${path}, which is not found here`,
    );
  }
  const range = await requiredBb(row);
  if (!fitsBb(range, args.appVersion)) {
    throw new BringOverError(
      `${row.id} needs a newer BB Studio (it asks for bb ${String(range)})`,
    );
  }
  const pluginDir = join(args.dataDir, "plugins", row.id);
  const sourceDatabase = join(args.sourceDataDir, "plugins", row.id, "data.db");
  const targetDatabase = join(pluginDir, "data.db");
  const copyDatabase =
    (await exists(sourceDatabase)) && !(await exists(targetDatabase));
  const createdDir = !(await exists(pluginDir));
  const undo = async () => {
    target.transaction(() => {
      target.prepare("DELETE FROM plugin_kv WHERE plugin_id = ?").run(row.id);
      target
        .prepare("DELETE FROM plugin_settings WHERE plugin_id = ?")
        .run(row.id);
    })();
    if (copyDatabase) {
      for (const suffix of ["", "-wal", "-shm"]) {
        await rm(`${targetDatabase}${suffix}`, { force: true });
      }
    }
    if (createdDir) await rm(pluginDir, { force: true, recursive: true });
  };
  try {
    if (copyDatabase) {
      await mkdir(pluginDir, { recursive: true });
      await snapshotDatabases([{ from: sourceDatabase, to: targetDatabase }]);
    }
    target.transaction(() => {
      copyPluginRows(source, target, "plugin_kv", row.id);
      copyPluginRows(source, target, "plugin_settings", row.id);
    })();
  } catch (error) {
    await undo();
    throw new BringOverError(
      `${row.id}'s data could not be copied: ${errorDetail(error)}`,
    );
  }
  try {
    if (row.source_kind === "path") await args.installer.installPath(path);
    else {
      await args.installer.install(
        row.source,
        row.source_git_subdirectory
          ? { kind: "subdirectory", path: row.source_git_subdirectory }
          : { kind: "root" },
      );
    }
  } catch (error) {
    await undo();
    const detail =
      error instanceof Error ? error.message.slice(0, 300) : "unknown error";
    throw new BringOverError(
      `${row.id} could not be installed from ${row.source}: ${detail}`,
    );
  }
  await args.installer.reload(row.id).catch(() => undefined);
  return { id: row.id, data: copyDatabase };
}
