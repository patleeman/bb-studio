import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  deleteInstalledPlugin,
  getInstalledPluginRegistration,
  type DbConnection,
} from "@bb/db";
import {
  resolveBuiltinPluginRootPath,
  type BundledPluginDefinition,
  type BundledPluginRegistration,
} from "./builtin-registry.js";
import { readPluginManifest } from "./manifest.js";

export const FORK_BUNDLED_PLUGINS: readonly BundledPluginDefinition[] = [
  {
    name: "bb-studio",
    pluginId: "studio",
    autoInstall: true,
    defaultEnabled: true,
  },
];

export function withForkBundledPlugins(
  registrations: readonly BundledPluginRegistration[],
  resolveRoot: (name: string) => string = resolveBuiltinPluginRootPath,
): BundledPluginRegistration[] {
  const names = new Set(registrations.map((plugin) => plugin.name));
  return [
    ...registrations,
    ...FORK_BUNDLED_PLUGINS.filter((plugin) => !names.has(plugin.name)).map(
      (plugin) => ({ ...plugin, rootDir: resolveRoot(plugin.name) }),
    ),
  ];
}

const replacedInstalls = new Map<string, string>();

/**
 * A bundled plugin's id can also hold a path install, which wins while its
 * folder is there. A path install whose folder is gone, or a removed install
 * from another source, gives the id back to the bundled copy: its row is
 * dropped here, before bb reconciles the bundled plugins, so reconciling
 * installs the bundled copy in its place. Settings and data keyed by the id
 * stay. The dropped source stays as a note on the plugin's status until the
 * server restarts.
 */
export async function releaseDeadBundledInstalls(args: {
  db: DbConnection;
  bundledPlugins: readonly BundledPluginRegistration[];
  logger: { warn(message: string): void };
}): Promise<void> {
  for (const bundled of args.bundledPlugins) {
    let id: string;
    try {
      id = (await readPluginManifest(bundled.rootDir)).id;
    } catch {
      continue;
    }
    const row = getInstalledPluginRegistration(args.db, id);
    if (row === undefined || row.sourceKind === "builtin") continue;
    const removed = row.removedAt !== null;
    const missing =
      row.sourceKind === "path" &&
      !existsSync(join(row.rootDir, "package.json"));
    if (!removed && !missing) continue;
    deleteInstalledPlugin(args.db, id);
    const note = `bundled copy; ${row.source} was ${removed ? "removed" : "not found"}`;
    replacedInstalls.set(id, note);
    args.logger.warn(`plugin ${id}: ${note}`);
  }
}

export function forkReplacedInstallNote(id: string): string | null {
  return replacedInstalls.get(id) ?? null;
}

export function forgetReplacedInstallNotes(): void {
  replacedInstalls.clear();
}
