// Explore runs inside Pages. It keeps its own SQLite file (explore.db, next
// to Pages' data.db), its own settings (prefixed `explore_` in Pages'
// settings), its own RPC methods (prefixed `explore_`) and `bb pages explore …`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  BbPluginApi, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginCliRegistration,
  PluginRpcContract, PluginRpcHandlers, PluginSettingDescriptor, PluginSettingsHandle, StandardSchemaV1,
} from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import explore, { EXPLORE_SETTINGS } from "./server";

const PREFIX = "explore_";
const RPC_PREFIX = "explore_";

type Configure = (context: PluginAgentConfigurationContext) => PluginAgentConfiguration;
type Handlers = PluginRpcHandlers<PluginRpcContract>;

async function validate(schema: StandardSchemaV1, value: unknown): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) throw new Error(result.issues.map(issue => issue.message).join("; "));
  return result.value;
}

/** Register Pages, and Explore inside it. */
export async function registerPagesWithExplore(host: BbPluginApi, registerPages: (bb: BbPluginApi) => Promise<void>) {
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
    const explored = Object.fromEntries(Object.entries(EXPLORE_SETTINGS).map(([key, descriptor]) =>
      [PREFIX + key, { ...descriptor, label: `Explore: ${descriptor.label}` }]));
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

  const core = host.storage.database();
  const Constructor = core.constructor as new (path: string, options?: Database.Options) => Database.Database;
  const path = join(host.server.experimental_dataDir, "plugins", host.pluginId, "explore.db");
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new Constructor(path);
  db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
  host.onDispose(() => { if (db.open) db.close(); });

  const handle = defineCombined();
  const keys = Object.keys(EXPLORE_SETTINGS);
  let exploreCli: PluginCliRegistration | undefined;
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
