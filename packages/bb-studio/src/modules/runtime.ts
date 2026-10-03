import type Database from "better-sqlite3";
import type { BbPluginApi, PluginCliRegistration, PluginRpcContract, PluginRpcHandlers, PluginStorage } from "@get-bb/plugin-sdk";
import { importModule } from "./import";
import { ModuleServices } from "./services";

export interface ModuleContext {
  bb: BbPluginApi;
  services: ModuleServices;
}
export interface ServerModule {
  name: string;
  legacyPluginId: string;
  registerServer(context: ModuleContext): void | Promise<void>;
}

/** Distinct names avoid collisions among former plugins' get/list RPCs. */
export const moduleMethod = (module: string, method: string) => `${module}_${method}`;

/** Transitional SDK adapter lets moved implementations retain their contracts. */
export class ModuleRuntime {
  readonly services = new ModuleServices();
  readonly skipped: string[] = [];
  private readonly commands = new Map<string, PluginCliRegistration>();
  private coreCommand: PluginCliRegistration | undefined;
  private readonly coreContract: Record<string, PluginRpcContract[string]> = {};
  private readonly coreHandlers: PluginRpcHandlers<PluginRpcContract> = {};

  constructor(private readonly host: BbPluginApi) {}

  private sdk(): BbPluginApi["sdk"] {
    const sdk = this.host.sdk;
    return { ...sdk, plugins: { ...sdk.plugins, callRpc: async args => {
      if (!this.services.has(args.pluginId)) return sdk.plugins.callRpc(args);
      if (args.signal?.aborted) throw args.signal.reason;
      return args.outputSchema.parse(await this.services.call(args.pluginId, args.method, args.input));
    } } };
  }

  coreApi(): BbPluginApi {
    return { ...this.host, sdk: this.sdk(), rpc: { register: (contract, handlers, options) => {
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
      // Enabled legacy plugins may still be starting. Do not race their tools
      // or take a snapshot while they can continue writing their old store.
      if (installed.some(plugin => plugin.id === module.legacyPluginId && plugin.enabled)) {
        this.skipped.push(module.legacyPluginId);
        continue;
      }
      await this.registerModule(module);
    }
    if (this.skipped.length) this.host.log.warn(`Studio now includes ${this.skipped.join(", ")}. Uninstall those old plugins, then reload Studio to import their data.`);
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
    db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
    this.host.onDispose(() => { if (db.open) db.close(); });
    const contract: Record<string, PluginRpcContract[string]> = {};
    const handlers: Record<string, PluginRpcHandlers<PluginRpcContract>[string]> = {};
    const api: BbPluginApi = { ...this.host, sdk: this.sdk(), storage: {
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
      this.host.rpc.register(exposed, publicHandlers, options);
    } }, cli: { register: command => {
      if (this.commands.has(module.legacyPluginId)) throw new Error(`Duplicate module CLI: ${module.name}`);
      this.commands.set(module.legacyPluginId, command);
    } } };
    await module.registerServer({ bb: api, services: this.services });
    this.services.register(module.legacyPluginId, contract, handlers);
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
