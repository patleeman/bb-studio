// Explore runs inside Pages. It keeps its own SQLite file (explore.db, next
// to Pages' data.db), its own settings (prefixed `explore_` in Pages'
// settings), its own RPC methods (prefixed `explore_`) and `bb pages explore …`.
//
// While the standalone Explore plugin is enabled it stays in charge and this
// copy stays dormant, so both can be installed side by side. Once it is
// disabled or uninstalled, the first Pages load copies its database and
// settings once. The standalone plugin's files are never changed.
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  BbPluginApi, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginCliRegistration,
  PluginRpcContract, PluginRpcHandlers, PluginSettingDescriptor, PluginSettingsHandle, StandardSchemaV1,
} from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { exploreStatusContract } from "./status";
import explore, { EXPLORE_SETTINGS } from "./server";

export const LEGACY_PLUGIN_ID = "explore";
const PREFIX = "explore_";
const RPC_PREFIX = "explore_";

type Configure = (context: PluginAgentConfigurationContext) => PluginAgentConfiguration;
type Handlers = PluginRpcHandlers<PluginRpcContract>;

async function validate(schema: StandardSchemaV1, value: unknown): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) throw new Error(result.issues.map(issue => issue.message).join("; "));
  return result.value;
}

/**
 * Copy the standalone plugin's database once, as one consistent SQLite backup
 * published by rename. An existing explore.db is never replaced.
 */
export async function importExploreDatabase(dataDir: string, pluginId: string, open: (path: string, options?: Database.Options) => Database.Database): Promise<{ path: string; imported: boolean }> {
  const target = join(dataDir, "plugins", pluginId, "explore.db");
  if (existsSync(target)) return { path: target, imported: false };
  mkdirSync(dirname(target), { recursive: true });
  const source = join(dataDir, "plugins", LEGACY_PLUGIN_ID, "data.db");
  const temporary = `${target}.importing`;
  for (const suffix of ["", "-wal", "-shm"]) rmSync(temporary + suffix, { force: true });
  if (!existsSync(source)) return { path: target, imported: false };
  // Read-only: the standalone plugin's file is left exactly as it was.
  const legacy = open(source, { readonly: true, fileMustExist: true });
  try { await legacy.backup(temporary); } finally { legacy.close(); }
  renameSync(temporary, target);
  return { path: target, imported: true };
}

/** The standalone plugin's saved settings, read from BB's database without writing to it. */
function legacySettings(dataDir: string, open: (path: string, options?: Database.Options) => Database.Database): Record<string, unknown> {
  const path = join(dataDir, "bb.db");
  if (!existsSync(path)) return {};
  const db = open(path, { readonly: true, fileMustExist: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plugin_settings'").get()) return {};
    const rows = db.prepare("SELECT key, value FROM plugin_settings WHERE plugin_id = ?").all(LEGACY_PLUGIN_ID) as { key: string; value: string }[];
    const values: Record<string, unknown> = {};
    for (const row of rows) {
      if (!(row.key in EXPLORE_SETTINGS)) continue;
      try { values[row.key] = JSON.parse(row.value); } catch { /* skip unreadable values */ }
    }
    return values;
  } catch { return {}; } finally { db.close(); }
}

/** Register Pages, and Explore inside it unless the standalone Explore plugin is enabled. */
export async function registerPagesWithExplore(host: BbPluginApi, registerPages: (bb: BbPluginApi) => Promise<void>) {
  const legacy = (await host.sdk.plugins.list()).plugins.find(plugin => plugin.id === LEGACY_PLUGIN_ID);
  const active = !legacy?.enabled;
  host.rpc.register(exploreStatusContract, { exploreStatus: () => ({ active, legacyInstalled: !!legacy }) });

  // Pages' own RPC handlers, so Explore's calls to Pages stay in process.
  const pagesContract: PluginRpcContract = {};
  const pagesHandlers: Handlers = {};
  const sdk: BbPluginApi["sdk"] = { ...host.sdk, plugins: { ...host.sdk.plugins,
    callRpc: async (args) => {
      const schema = args.pluginId === host.pluginId ? pagesContract[args.method] : undefined;
      const handler = pagesHandlers[args.method];
      if (!schema || !handler) return host.sdk.plugins.callRpc(args);
      args.signal?.throwIfAborted();
      const output = await validate(schema.output, await handler(await validate(schema.input, args.input) as never));
      return args.outputSchema.parse(output);
    },
  } } as BbPluginApi["sdk"];

  // One configure callback for the plugin; each part keeps its own selection.
  const configures: Configure[] = [];
  const agents = (): BbPluginApi["agents"] => ({ ...host.agents,
    registerTool: host.agents.registerTool.bind(host.agents),
    configure: (configure: Configure) => { configures.push(configure); },
  } as BbPluginApi["agents"]);

  // One settings definition: Pages' fields plus Explore's, prefixed.
  let pagesDescriptors: Record<string, PluginSettingDescriptor> | undefined;
  let combined: PluginSettingsHandle<Record<string, PluginSettingDescriptor>> | undefined;
  const project = (values: Record<string, unknown>, keys: string[], prefix = "") =>
    Object.fromEntries(keys.map(key => [key, values[prefix + key]]));
  const defineCombined = () => {
    if (combined) return combined;
    const explored = active ? Object.fromEntries(Object.entries(EXPLORE_SETTINGS).map(([key, descriptor]) =>
      [PREFIX + key, { ...descriptor, label: `Explore: ${descriptor.label}` }])) : {};
    combined = host.settings.define({ ...(pagesDescriptors ?? {}), ...explored });
    return combined;
  };

  let pagesCli: PluginCliRegistration | undefined;
  await registerPages({ ...host, sdk, agents: agents(),
    settings: { define(descriptors) {
      pagesDescriptors = descriptors;
      const handle = defineCombined();
      const keys = Object.keys(descriptors);
      return {
        get: async () => project(await handle.get(), keys) as never,
        experimental_set: async (values) => project(await handle.experimental_set(values as never), keys) as never,
        onChange: (listener) => handle.onChange((next, prev) => listener(project(next, keys) as never, project(prev, keys) as never)),
      };
    } },
    rpc: { register(methods, implementations, options) {
      Object.assign(pagesContract, methods); Object.assign(pagesHandlers, implementations);
      host.rpc.register(methods, implementations, options);
    } },
    cli: { register(command) { pagesCli = command; } },
  });

  let exploreCli: PluginCliRegistration | undefined;
  if (active) {
    const core = host.storage.database();
    const Constructor = core.constructor as new (path: string, options?: Database.Options) => Database.Database;
    const open = (path: string, options?: Database.Options) => new Constructor(path, options);
    const dataDir = host.server.experimental_dataDir;
    const { path, imported } = await importExploreDatabase(dataDir, host.pluginId, open);
    const db = open(path);
    db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
    host.onDispose(() => { if (db.open) db.close(); });
    if (imported) host.log.info("Explore: copied the standalone Explore plugin's explainers into Pages (explore.db). Its own database is unchanged.");

    const handle = defineCombined();
    const keys = Object.keys(EXPLORE_SETTINGS);
    db.exec("CREATE TABLE IF NOT EXISTS pages_explore_settings_import (id INTEGER PRIMARY KEY CHECK (id = 1), imported_at INTEGER NOT NULL)");
    if (!db.prepare("SELECT 1 FROM pages_explore_settings_import").get()) {
      const values = legacySettings(dataDir, open);
      if (Object.keys(values).length) {
        try { await handle.experimental_set(Object.fromEntries(Object.entries(values).map(([key, value]) => [PREFIX + key, value])) as never); }
        catch (error) { host.log.warn(`Explore: could not copy the standalone plugin's settings: ${error instanceof Error ? error.message : String(error)}`); }
      }
      db.prepare("INSERT INTO pages_explore_settings_import VALUES (1, ?)").run(Date.now());
    }

    await explore({ ...host, sdk, agents: agents(),
      settings: { define() {
        return {
          get: async () => project(await handle.get(), keys, PREFIX) as never,
          experimental_set: async (values) => project(await handle.experimental_set(Object.fromEntries(Object.entries(values).map(([key, value]) => [PREFIX + key, value])) as never), keys, PREFIX) as never,
          onChange: (listener) => handle.onChange((next, prev) => listener(project(next, keys, PREFIX) as never, project(prev, keys, PREFIX) as never)),
        };
      } },
      storage: { ...host.storage, database: () => db },
      rpc: { register(methods, implementations, options) {
        host.rpc.register(
          Object.fromEntries(Object.entries(methods).map(([key, schema]) => [RPC_PREFIX + key, schema])),
          Object.fromEntries(Object.entries(implementations).map(([key, handler]) => [RPC_PREFIX + key, handler])) as never,
          options,
        );
      } },
      cli: { register(command) { exploreCli = command; } },
    });
  } else {
    host.log.info("Explore: the standalone Explore plugin is enabled, so Explore in Pages stays off. Disable it and reload Pages to switch.");
  }

  host.agents.configure(context => {
    const selections = configures.map(configure => configure(context));
    const instructions = selections.map(selection => selection.instructions).filter(Boolean).join("\n\n");
    return {
      tools: selections.flatMap(selection => selection.tools ?? []),
      skills: [...new Set(selections.flatMap(selection => selection.skills ?? []))],
      ...(instructions ? { instructions } : {}),
    };
  });

  const pages = pagesCli;
  const nested = exploreCli;
  if (pages) host.cli.register({ ...pages, commands: [
    ...pages.commands ?? [],
    ...(nested ? [{ name: "explore", summary: nested.summary, usage: "bb pages explore <list|open|regenerate> …" }] : []),
  ], run: (argv, ctx) => argv[0] === "explore" && nested ? nested.run(argv.slice(1), ctx) : pages.run(argv, ctx) });
}
