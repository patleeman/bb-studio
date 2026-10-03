import { migrateModuleRefs } from "@bb-studio/kit/modules/refs";
import { legacyReferencePluginIds } from "@bb-studio/kit/contract";
import type { BbPluginApi, PluginCliRegistration, PluginRpcContract, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { importModule } from "@bb-studio/kit/modules/import";
import { moduleSettings } from "@bb-studio/kit/modules/settings";
import { ModuleAgents } from "@bb-studio/kit/modules/agents";
import { ModuleServices } from "@bb-studio/kit/modules/services";
import { exploreStatusContract } from "./status";
import explore from "./server";

/** Pages and Explore share transport and agent registration, but retain separate stores. */
export async function registerPagesWithExplore(host: BbPluginApi, registerPages: (bb: BbPluginApi) => Promise<void>) {
  const agents = new ModuleAgents(host.agents);
  const services = new ModuleServices();
  const contract: PluginRpcContract = {};
  const handlers: PluginRpcHandlers<PluginRpcContract> = {};
  let pagesCli: PluginCliRegistration | undefined;
  let exploreCli: PluginCliRegistration | undefined;
  const sdk: BbPluginApi["sdk"] = { ...host.sdk, plugins: { ...host.sdk.plugins,
    callRpc: async (args) => {
      if (args.pluginId !== "pages") return host.sdk.plugins.callRpc(args);
      args.signal?.throwIfAborted();
      return args.outputSchema.parse(await services.call("pages", args.method, args.input));
    },
  } };
  await registerPages({ ...host, sdk, agents: agents.scope(), rpc: { register(methods, implementations, options) {
    Object.assign(contract, methods); Object.assign(handlers, implementations);
    host.rpc.register(methods, implementations, options);
  } }, cli: { register(command) { pagesCli = command; } } });
  services.register("pages", contract, handlers);
  const legacy = (await host.sdk.plugins.list()).plugins.find(plugin => plugin.id === "explore");
  const active = !legacy?.enabled;
  host.rpc.register(exploreStatusContract, { exploreStatus: () => ({ active, legacyInstalled: !!legacy }) });
  if (active) {
    const core = host.storage.database();
    const Constructor = core.constructor as new (path: string, options?: Database.Options) => Database.Database;
    const path = await importModule({ dataDir: host.server.experimental_dataDir, ownerPluginId: "pages",
      module: "explore", legacyPluginId: "explore", core, legacyRunning: false,
      open: (path, options) => new Constructor(path, options) });
    const db = new Constructor(path);
    db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
    host.onDispose(() => { if (db.open) db.close(); });
    const rewritten = migrateModuleRefs(db, legacyReferencePluginIds);
    if (rewritten) host.log.info("Explore references: rewrote " + rewritten + " cells");
    await explore({ ...host, sdk, agents: agents.scope(["explore"]),
      settings: moduleSettings(host.settings, db, "explore"),
      storage: { ...host.storage, database: () => db },
      rpc: { register(methods, implementations, options) {
        const prefixed = Object.fromEntries(Object.entries(methods).map(([key, schema]) => ["explore_" + key, schema]));
        const calls = Object.fromEntries(Object.entries(implementations).map(([key, handler]) => ["explore_" + key, handler]));
        Object.assign(contract, prefixed); Object.assign(handlers, calls);
        host.rpc.register(prefixed, calls, options);
      } }, cli: { register(command) { exploreCli = command; } },
    });
  }
  if (legacy) host.log.warn("Pages now includes Explore. Disable the old Explore plugin, then reload Pages to import its data and settings before uninstalling it.");
  agents.register();
  const pages = pagesCli;
  const moduleCli = exploreCli;
  if (pages) host.cli.register({ ...pages, commands: [
    ...pages.commands ?? [],
    ...(moduleCli ? [{ name: "explore", summary: moduleCli.summary, usage: "bb pages explore …" }] : []),
  ], run: (argv, ctx) => argv[0] === "explore" && moduleCli ? moduleCli.run(argv.slice(1), ctx) : pages.run(argv, ctx) });
}
