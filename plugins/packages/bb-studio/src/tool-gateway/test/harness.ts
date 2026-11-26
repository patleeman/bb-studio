// A small fake BB for Tool Gateway's tests: an in-memory database with Studio's
// migrations, plugin kv, captured RPC handlers, agent tools and routes, and a
// temp data folder. Stdio servers run in this process (no host worker).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../../migrations";
import type { ServerInput } from "../contract";
import { registerToolGateway, type ToolGateway } from "../server/register";
import type { Limits } from "../server/engine";

export const FIXTURE = fileURLToPath(new URL("./fixture-server.mjs", import.meta.url));
export const FAKE_SECRET = "sk-fake-tool-gateway-0123456789";
export const APP_WINDOW = { experimental_caller: { kind: "client", studioAppWindow: true } } as const;
export const CLIENT = { experimental_caller: { kind: "client" } } as const;
export const PLUGIN_CALLER = { experimental_caller: { kind: "plugin", pluginId: "other" } } as const;

type Tool = { name: string; execute(input: unknown, ctx: { threadId: string; projectId: string; signal: AbortSignal }): Promise<unknown> };

export interface Harness {
  gateway: ToolGateway;
  db: Database.Database;
  dataDir: string;
  kv: Map<string, unknown>;
  tools: Map<string, Tool>;
  routes: Map<string, (context: { req: { url: string } }) => Promise<Response>>;
  todos: { created: { title: string; why: string; requestId: string; threadId: string | null }[]; closed: { taskId: string; state: string }[] };
  threads: Map<string, { providerId: string; projectId: string }>;
  removedPlugins: string[];
  warnings: string[];
  rpc(method: string, input: unknown, context?: unknown): Promise<any>;
  /** Runs an agent tool as the given thread. */
  agent(tool: string, input: unknown, threadId?: string): Promise<any>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export function stdioServer(id: string, extra: Partial<ServerInput> = {}): ServerInput {
  return { id, label: `Fixture ${id}`, kind: "stdio", command: process.execPath, args: [FIXTURE], env: { FAKE_TOKEN: FAKE_SECRET }, ...extra };
}

export async function harness(options: { baseEnv?: Record<string, string | undefined>; limits?: Partial<Limits>; dataDir?: string; plugins?: string[] } = {}): Promise<Harness> {
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), "studio-tool-gateway-"));
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS.filter(Boolean)) db.exec(statement);
  const kv = new Map<string, unknown>();
  const todos: Harness["todos"] = { created: [], closed: [] };
  const threads = new Map<string, { providerId: string; projectId: string }>([
    ["thr_claude", { providerId: "claude-code", projectId: "prj_a" }],
    ["thr_codex", { providerId: "codex", projectId: "prj_a" }],
    ["thr_acp", { providerId: "acp-hermes", projectId: "prj_a" }],
    ["thr_other_project", { providerId: "claude-code", projectId: "prj_b" }],
  ]);
  const removedPlugins: string[] = [];
  const warnings: string[] = [];
  let tools = new Map<string, Tool>();
  let routes = new Map<string, (context: { req: { url: string } }) => Promise<Response>>();
  let gateway!: ToolGateway;
  let taskCount = 0;

  const start = async () => {
    tools = new Map();
    routes = new Map();
    const bb = {
      pluginId: "studio",
      storage: { kv: { get: async (key: string) => kv.get(key), set: async (key: string, value: unknown) => { kv.set(key, value); } } },
      rpc: { register: () => {} },
      agents: { registerTool: (tool: Tool) => { tools.set(tool.name, tool); } },
      http: { route: (_method: string, path: string, handler: (context: { req: { url: string } }) => Promise<Response>) => { routes.set(path, handler); } },
      realtime: { publish: async () => {} },
      server: { loopbackBaseUrl: "http://127.0.0.1:39999", experimental_dataDir: dataDir },
      sdk: {
        threads: { get: async ({ threadId }: { threadId: string }) => (threads.has(threadId) ? { id: threadId, ...threads.get(threadId) } : null) },
        providers: { catalog: async () => [{ id: "claude-code", displayName: "Claude Code", enabled: true }, { id: "codex", displayName: "Codex", enabled: true }, { id: "acp-hermes", displayName: "Hermes", enabled: true }, { id: "antigravity", displayName: "Google Antigravity", enabled: true, info: { family: "acp" } }] },
        plugins: { list: async () => ({ plugins: (options.plugins ?? []).filter((id) => !removedPlugins.includes(id)).map((id) => ({ id })) }), remove: async ({ pluginId }: { pluginId: string }) => { removedPlugins.push(pluginId); return {}; } },
      },
      log: { info: () => {}, warn: (message: string) => { warnings.push(message); }, error: () => {} },
      onDispose: () => {},
    };
    gateway = await registerToolGateway(bb as never, {
      db,
      dataDir,
      pluginId: "studio",
      baseEnv: options.baseEnv ?? { PATH: process.env.PATH, HOME: process.env.HOME, BB_SECRET_TEST: "bb-only", ANTHROPIC_API_KEY: "not-for-servers" },
      useHost: false,
      limits: options.limits,
      todos: {
        create: async (input) => { todos.created.push(input); taskCount += 1; return `task_${taskCount}`; },
        close: async (taskId, state) => { todos.closed.push({ taskId, state }); },
      },
    });
  };
  await start();

  return {
    get gateway() { return gateway; },
    db,
    dataDir,
    kv,
    get tools() { return tools; },
    get routes() { return routes; },
    todos,
    threads,
    removedPlugins,
    warnings,
    rpc: async (method, input, context = APP_WINDOW) => {
      const handler = gateway.handlers[method];
      if (!handler) throw new Error(`no handler ${method}`);
      return handler(input as never, context);
    },
    agent: async (tool, input, threadId = "thr_claude") => {
      const found = tools.get(tool);
      if (!found) throw new Error(`no tool ${tool}`);
      const thread = threads.get(threadId);
      return found.execute(input, { threadId, projectId: thread?.projectId ?? "prj_a", signal: new AbortController().signal });
    },
    restart: async () => {
      await gateway.dispose();
      await start();
    },
    close: async () => {
      await gateway.dispose();
      db.close();
      if (!options.dataDir) await rm(dataDir, { recursive: true, force: true });
    },
  } as Harness;
}

/** The JSON an agent tool answered with. */
export function json(result: unknown): any {
  if (typeof result === "string") return JSON.parse(result);
  const content = (result as { content?: { text?: string }[] }).content ?? [];
  return JSON.parse(content.map((block) => block.text ?? "").join(""));
}

export function text(result: unknown): string {
  if (typeof result === "string") return result;
  return ((result as { content?: { text?: string }[] }).content ?? []).map((block) => block.text ?? "").join("\n");
}
