import { join } from "node:path";
import { ModuleHooks } from "./hooks";
import { officeTrustAgents } from "../office/trust-agents";
import { ModuleAgents } from "./agents";
import { moduleSettings } from "./settings";
import { moduleStatusContract } from "./status";
import { migrateModuleRefs } from "./refs";
import type Database from "better-sqlite3";
import type { BbPluginApi, PluginCliRegistration, PluginRpcContract, PluginRpcHandlers, PluginStorage } from "@get-bb/plugin-sdk";
import { importModule } from "./import";
import { ModuleProvider, moduleProviderContract } from "./provider";
import { ModuleServices } from "./services";

export interface ModuleContext {
  bb: BbPluginApi;
  services: ModuleServices;
}
export interface ServerModule {
  name: string;
  legacyPluginId: string;
  skills?: string[];
  registerServer(context: ModuleContext): void | Promise<void>;
}

/** Distinct names avoid collisions among former plugins' get/list RPCs. */
export const moduleMethod = (module: string, method: string) => `${module}_${method}`;

/** Transitional SDK adapter lets moved implementations retain their contracts. */
export class ModuleRuntime {
  readonly services = new ModuleServices();
  readonly skipped: string[] = [];
  readonly legacyInstalled: string[] = [];
  readonly provider = new ModuleProvider(this.services);
  private readonly databases: Database.Database[] = [];
  private readonly activeIds: string[] = [];
  private readonly commands = new Map<string, PluginCliRegistration>();
  private coreCommand: PluginCliRegistration | undefined;
  private readonly coreContract: Record<string, PluginRpcContract[string]> = {};
  private readonly coreHandlers: PluginRpcHandlers<PluginRpcContract> = {};

  private readonly agents: ModuleAgents;
  private readonly hooks: ModuleHooks;
  constructor(private readonly host: BbPluginApi) { this.hooks = new ModuleHooks(host.experimental_hooks); this.agents = new ModuleAgents(officeTrustAgents(host, this.services)); }

  private sdk(): BbPluginApi["sdk"] {
    const sdk = this.host.sdk;
    return { ...sdk, plugins: { ...sdk.plugins, callRpc: async args => {
      if (!this.services.has(args.pluginId)) return sdk.plugins.callRpc(args);
      if (args.signal?.aborted) throw args.signal.reason;
      return args.outputSchema.parse(await this.services.call(args.pluginId, args.method, args.input));
    } } };
  }

  coreApi(): BbPluginApi {
    return { ...this.host, sdk: this.sdk(), experimental_hooks: this.hooks.scope(), agents: this.agents.scope(["studio"]), rpc: { register: (contract, handlers, options) => {
      Object.assign(this.coreContract, contract);
      Object.assign(this.coreHandlers, handlers);
      this.host.rpc.register(contract, handlers, options);
    } }, cli: { register: command => {
      if (this.coreCommand) throw new Error("Studio CLI already registered");
      this.coreCommand = command;
    } } };
  }

  async register(modules: readonly ServerModule[]): Promise<void> {
    this.services.register("studio", this.coreContract, this.coreHandlers);
    const installed = (await this.host.sdk.plugins.list()).plugins;
    for (const module of modules) {
      if (installed.some(plugin => plugin.id === module.legacyPluginId)) this.legacyInstalled.push(module.legacyPluginId);
      // Enabled legacy plugins may still be starting. Do not race their tools
      // or take a snapshot while they can continue writing their old store.
      if (installed.some(plugin => plugin.id === module.legacyPluginId && plugin.enabled)) {
        this.skipped.push(module.legacyPluginId);
        continue;
      }
      await this.registerModule(module);
    }
    if (this.legacyInstalled.length) this.host.log.warn(`Studio now includes ${this.legacyInstalled.join(", ")}. Disable those old plugins, then reload Studio to import their data and settings before uninstalling them.`);
    for (const database of [this.host.storage.database(), ...this.databases]) {
      const cells = migrateModuleRefs(database, this.activeIds);
      if (cells) this.host.log.info(`Studio module references: rewrote ${cells} cells`);
    }
    if (this.provider.kinds.length) {
      Object.assign(this.coreContract, moduleProviderContract);
      Object.assign(this.coreHandlers, this.provider.handlers);
      this.host.rpc.register(moduleProviderContract, this.provider.handlers);
    }
    this.host.rpc.register(moduleStatusContract, { modules_status: () => ({ active: modules.filter(module => this.activeIds.includes(module.legacyPluginId)).map(module => module.name), legacyInstalled: this.legacyInstalled }) });
    this.agents.register();
    this.hooks.register();
    const core = this.coreCommand;
    if (core) this.host.cli.register({ ...core, commands: [
      ...core.commands ?? [],
      ...[...this.commands].map(([name, command]) => ({ name, summary: command.summary, usage: `bb studio ${name} …` })),
    ], run: (argv, ctx) => {
      const module = this.commands.get(argv[0]);
      return module ? module.run(argv.slice(1), ctx) : core.run(argv, ctx);
    } });
  }

  private async registerModule(module: ServerModule): Promise<void> {
    const core = this.host.storage.database();
    const Constructor = core.constructor as new (path: string, options?: Database.Options) => Database.Database;
    const path = await importModule({ dataDir: this.host.server.experimental_dataDir, module: module.name,
      legacyPluginId: module.legacyPluginId, core, open: (path, options) => new Constructor(path, options), legacyRunning: false });
    const db = new Constructor(path);
    this.databases.push(db); this.activeIds.push(module.legacyPluginId);
    db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
    this.host.onDispose(() => { if (db.open) db.close(); });
    const contract: Record<string, PluginRpcContract[string]> = {};
    const handlers: Record<string, PluginRpcHandlers<PluginRpcContract>[string]> = {};
    const api: BbPluginApi = { ...this.host, sdk: this.sdk(), experimental_hooks: this.hooks.scope(), agents: this.agents.scope(module.skills), settings: moduleSettings(this.host.settings, db, module.name, join(this.host.server.experimental_dataDir, "plugins", module.legacyPluginId, "secrets")), storage: {
      ...this.host.storage, database: () => db, kv: moduleKv(db),
    }, rpc: { register: (methods, implementations, options) => {
      const exposed: Record<string, PluginRpcContract[string]> = {};
      const publicHandlers: Record<string, PluginRpcHandlers<PluginRpcContract>[string]> = {};
      for (const name of Object.keys(methods)) {
        if (contract[name]) throw new Error(`Duplicate module method: ${module.name}.${name}`);
        contract[name] = methods[name]; handlers[name] = implementations[name];
        exposed[moduleMethod(module.name, name)] = methods[name];
        publicHandlers[moduleMethod(module.name, name)] = implementations[name];
      }
      Object.assign(this.coreContract, exposed);
      Object.assign(this.coreHandlers, publicHandlers);
      this.host.rpc.register(exposed, publicHandlers, options);
    } }, cli: { register: command => {
      if (this.commands.has(module.legacyPluginId)) throw new Error(`Duplicate module CLI: ${module.name}`);
      this.commands.set(module.legacyPluginId, command);
    } } };
    await module.registerServer({ bb: api, services: this.services });
    this.services.register(module.legacyPluginId, contract, handlers);
    if (contract.studio_describe) await this.provider.add(module.legacyPluginId);
  }
}

/** Imported KV remains isolated even when two old plugins used the same key. */
export function moduleKv(db: Database.Database): PluginStorage["kv"] {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const row = db.prepare("SELECT value FROM studio_module_state WHERE kind = 'kv' AND key = ?").get(key) as { value: string } | undefined;
      return row ? JSON.parse(row.value) as T : undefined;
    },
    async set(key, value) {
      const json = JSON.stringify(value);
      if (json === undefined || Buffer.byteLength(json) > 256 * 1024) throw new Error("Module KV requires JSON no larger than 256KB");
      db.prepare(`INSERT INTO studio_module_state (kind, key, value, updated_at) VALUES ('kv', ?, ?, ?)
        ON CONFLICT(kind, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, json, Date.now());
    },
    async delete(key) { db.prepare("DELETE FROM studio_module_state WHERE kind = 'kv' AND key = ?").run(key); },
    async list(prefix = "") {
      return (db.prepare("SELECT key FROM studio_module_state WHERE kind = 'kv' ORDER BY key").all() as { key: string }[])
        .map(row => row.key).filter(key => key.startsWith(prefix));
    },
  };
}
