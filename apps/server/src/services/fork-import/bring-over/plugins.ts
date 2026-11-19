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
  source_git_url: string | null;
  git_resolved_commit: string | null;
  source_npm_package: string | null;
  source_npm_registry: string | null;
  npm_resolved_version: string | null;
  root_dir: string | null;
  enabled: number;
}

export interface InstalledPluginInfo {
  id: string;
  rootDir?: string | null;
}

export interface PluginInstaller {
  install(
    source: string,
    selection: { kind: "root" } | { kind: "subdirectory"; path: string },
  ): Promise<InstalledPluginInfo>;
  installPath(path: string): Promise<InstalledPluginInfo>;
  remove(id: string): Promise<unknown>;
  reload(id?: string): Promise<unknown>;
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  listOpenPluginDatabases(): { pluginId: string }[];
}

function sourceRows(source: Sqlite): SourcePluginRow[] {
  try {
    return source
      .prepare<[], SourcePluginRow>(
        "SELECT id, version, source, source_kind, source_path, source_git_subdirectory, source_git_url, git_resolved_commit, source_npm_package, source_npm_registry, npm_resolved_version, root_dir, enabled FROM plugins WHERE removed_at IS NULL ORDER BY id",
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
      !safeId(row.id) ||
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

const SAFE_ID = /^[A-Za-z0-9@][A-Za-z0-9@._-]*$/u;
const DEFAULT_NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org\/?$/u;

export function safeId(id: string): boolean {
  return SAFE_ID.test(id) && !id.includes("..");
}

function copyPluginRows(
  source: Sqlite,
  target: Sqlite,
  table: "plugin_kv" | "plugin_settings",
  pluginId: string,
): string[] {
  const rows = source
    .prepare<[string], { key: string; value: string; updated_at: number }>(
      `SELECT key, value, updated_at FROM ${table} WHERE plugin_id = ?`,
    )
    .all(pluginId);
  const insert = target.prepare(
    `INSERT OR IGNORE INTO ${table} (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
  );
  const written: string[] = [];
  for (const row of rows) {
    if (insert.run(pluginId, row.key, row.value, row.updated_at).changes > 0) {
      written.push(row.key);
    }
  }
  return written;
}

export interface PinnedSource {
  source: string;
  selection: { kind: "root" } | { kind: "subdirectory"; path: string };
  label: string;
}

export function pinnedSource(row: SourcePluginRow): PinnedSource {
  const selection = row.source_git_subdirectory
    ? { kind: "subdirectory" as const, path: row.source_git_subdirectory }
    : { kind: "root" as const };
  if (row.source_kind === "git") {
    if (!row.source_git_url || !row.git_resolved_commit) {
      throw new BringOverError(
        `bb did not record which commit of ${row.id} it had, so that version can't be installed`,
      );
    }
    return {
      source: `git:${row.source_git_url}@${row.git_resolved_commit}`,
      selection,
      label: `commit ${row.git_resolved_commit.slice(0, 12)}`,
    };
  }
  if (row.source_kind === "npm") {
    if (!row.source_npm_package || !row.npm_resolved_version) {
      throw new BringOverError(
        `bb did not record which version of ${row.id} it had, so that version can't be installed`,
      );
    }
    if (
      row.source_npm_registry &&
      !DEFAULT_NPM_REGISTRY.test(row.source_npm_registry)
    ) {
      throw new BringOverError(
        `${row.id} came from the npm registry ${row.source_npm_registry}, which BB Studio can't install from here`,
      );
    }
    return {
      source: `npm:${row.source_npm_package}@${row.npm_resolved_version}`,
      selection,
      label: `version ${row.npm_resolved_version}`,
    };
  }
  throw new BringOverError(
    `${row.id} is a ${row.source_kind} plugin, which can't be added`,
  );
}

const adding = new Set<string>();

export async function addPlugin(args: {
  id: string;
  source: Sqlite;
  target: Sqlite;
  sourceDataDir: string;
  dataDir: string;
  installer: Pick<
    PluginInstaller,
    "install" | "installPath" | "reload" | "remove"
  >;
  appVersion: string;
}): Promise<{ id: string; data: boolean }> {
  if (adding.has(args.id)) {
    throw new BringOverError(`${args.id} is already being added`);
  }
  adding.add(args.id);
  try {
    return await addPluginOnce(args);
  } finally {
    adding.delete(args.id);
  }
}

async function addPluginOnce(
  args: Parameters<typeof addPlugin>[0],
): Promise<{ id: string; data: boolean }> {
  const { source, target } = args;
  const row = sourceRows(source).find((plugin) => plugin.id === args.id);
  if (
    row === undefined ||
    !safeId(row.id) ||
    row.source_kind === "builtin" ||
    HIDDEN_PLUGIN_IDS.has(row.id) ||
    bundledHere(target, row.id)
  ) {
    throw new BringOverError(`bb has no plugin ${args.id} that can be added`);
  }
  if (installedHere(target, row.id)) {
    throw new BringOverError(`${row.id} is already installed`);
  }
  const path = row.source_path ?? row.source;
  let pinned: PinnedSource | null = null;
  if (row.source_kind === "path") {
    if (!(await exists(path))) {
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
  } else {
    pinned = pinnedSource(row);
  }
  const pluginDir = join(args.dataDir, "plugins", row.id);
  const sourceDatabase = join(args.sourceDataDir, "plugins", row.id, "data.db");
  const targetDatabase = join(pluginDir, "data.db");
  const copyDatabase =
    (await exists(sourceDatabase)) && !(await exists(targetDatabase));
  const createdDir = !(await exists(pluginDir));
  const written: { table: "plugin_kv" | "plugin_settings"; keys: string[] }[] =
    [];
  const undo = async () => {
    target.transaction(() => {
      for (const { table, keys } of written) {
        const remove = target.prepare(
          `DELETE FROM ${table} WHERE plugin_id = ? AND key = ?`,
        );
        for (const key of keys) remove.run(row.id, key);
      }
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
      for (const table of ["plugin_kv", "plugin_settings"] as const) {
        written.push({
          table,
          keys: copyPluginRows(source, target, table, row.id),
        });
      }
    })();
  } catch (error) {
    await undo();
    throw new BringOverError(
      `${row.id}'s data could not be copied: ${errorDetail(error)}`,
    );
  }
  const installedBefore = new Set(
    target
      .prepare<[], { id: string }>(
        "SELECT id FROM plugins WHERE removed_at IS NULL",
      )
      .all()
      .map((plugin) => plugin.id),
  );
  let installed: InstalledPluginInfo;
  try {
    installed =
      pinned === null
        ? await args.installer.installPath(path)
        : await args.installer.install(pinned.source, pinned.selection);
  } catch (error) {
    await undo();
    const detail =
      error instanceof Error ? error.message.slice(0, 300) : "unknown error";
    throw new BringOverError(
      pinned === null
        ? `${row.id} could not be installed from ${path}: ${detail}`
        : `bb's version of ${row.id} (${pinned.label}) can't be installed: ${detail}`,
    );
  }
  const problem =
    installed.id !== row.id
      ? `installs as ${installed.id}, not ${row.id}`
      : HIDDEN_PLUGIN_IDS.has(installed.id)
        ? `installs as ${installed.id}, which BB Studio bundles or removed`
        : await installedEnginesProblem(installed, args.appVersion);
  if (problem !== null) {
    if (!installedBefore.has(installed.id)) {
      await args.installer.remove(installed.id).catch(() => undefined);
    }
    await undo();
    throw new BringOverError(`${row.id} was not added: it ${problem}`);
  }
  await args.installer.reload(row.id).catch(() => undefined);
  return { id: row.id, data: copyDatabase };
}

async function installedEnginesProblem(
  installed: InstalledPluginInfo,
  appVersion: string,
): Promise<string | null> {
  if (!installed.rootDir) return null;
  try {
    const manifest = JSON.parse(
      await readFile(join(installed.rootDir, "package.json"), "utf8"),
    ) as { engines?: { bb?: unknown } };
    const range =
      typeof manifest.engines?.bb === "string" ? manifest.engines.bb : null;
    return fitsBb(range, appVersion)
      ? null
      : `needs a newer BB Studio (it asks for bb ${String(range)})`;
  } catch {
    return null;
  }
}
