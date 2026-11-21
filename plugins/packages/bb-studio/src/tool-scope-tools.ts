// studio_tool_search, studio_tool_describe and studio_tool_call: how a session
// on a provider that loads every tool up front (Pi, ACP agents), or in lean
// mode, reaches the Studio tools its kind has on demand (src/tool-scope.ts).
// Same shape as Tool Gateway's trio (query; ids; id + args). When the thread
// also has Tool Gateway, these reach its MCP tools too: search merges its
// matches (ids tg_…), and describe and call pass those ids to it.
// A call runs the tool's own handler with its own zod check, as BB would.
import { z } from "zod";
import { ALIASES, presentScope } from "./merged-tools";
import { searchScoped, type Scope } from "./tool-scope";

interface BookTool { name: string; description: string; parameters: { toJSONSchema?: () => unknown } }
interface Book { get(name: string): BookTool | null; run(name: string, input: unknown, ctx: unknown, as?: string): Promise<unknown> }
interface ToolCtx { threadId?: string; projectId?: string }
interface Registrar { agents: { registerTool(tool: never): unknown } }

const MAX_SCOPES = 500;
const MAX_DESCRIBE = 8;
const GATEWAY_ID = /^tg_/;

/** The last scope each thread's session was configured with. */
export class ScopeMemory {
  private readonly scopes = new Map<string, { scope: Scope; providerId: string; model: string | null }>();

  /** Keeps the provider and model the scope was worked out for. */
  remember(threadId: string, scope: Scope, session: { providerId: string; model: string | null }): void {
    this.scopes.delete(threadId);
    this.scopes.set(threadId, { scope, ...session });
    while (this.scopes.size > MAX_SCOPES) this.scopes.delete(this.scopes.keys().next().value!);
  }

  get(threadId: string): Scope | undefined {
    return this.scopes.get(threadId)?.scope;
  }

  session(threadId: string): { providerId: string; model: string | null } | undefined {
    const entry = this.scopes.get(threadId);
    return entry ? { providerId: entry.providerId, model: entry.model } : undefined;
  }
}

const text = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value);
const parse = (value: unknown): Record<string, unknown> | null => {
  try { const parsed = JSON.parse(text(value)); return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null; } catch { return null; }
};

export function registerScopedTools(bb: Registrar, deps: {
  book: Book;
  scopes: ScopeMemory;
  /** The input schema the agent reads: the slimmed one when smaller; a merged tool's, for the ops this thread may run. */
  schemaFor(name: string, ops: ReadonlyMap<string, string[]>): unknown;
  /** Works a thread's scope out again (after Studio reloaded mid-session). */
  recompute(threadId: string, projectId: string | undefined): Promise<Scope | null>;
}): void {
  const scopeOf = async (ctx: ToolCtx): Promise<Scope | null> => (ctx.threadId ? deps.scopes.get(ctx.threadId) ?? await deps.recompute(ctx.threadId, ctx.projectId) : null);
  // The trio reaches the on-demand tools and, for an agent that searches anyway, the loaded ones.
  const own = (name: string) => !name.startsWith("studio_tool_") && !name.startsWith("tool_gateway_");
  /** Old names in the thread's scope: still callable by name for one release (src/merged-tools.ts ALIASES). */
  const reachable = (scope: Scope | null): string[] => (scope ? [...scope.onDemand, ...scope.loaded].filter((name) => own(name) && deps.book.get(name)) : []);
  /** What the thread sees: merged names, on demand first, then loaded. */
  const presented = (scope: Scope | null) => {
    const view = presentScope(scope ?? { loaded: [], onDemand: [] });
    return { names: [...view.onDemand, ...view.loaded].filter((name) => own(name) && deps.book.get(name)), loaded: new Set(view.loaded), ops: view.ops };
  };
  const error = (message: string) => JSON.stringify({ error: message });

  bb.agents.registerTool({
    name: "studio_tool_search",
    description: "Find tools this thread can use: Studio's (pages, memory, designs, apps, recordings…) and, when on, your MCP servers'. Returns id, name and a one-line summary (loaded: true when you can also call it directly); empty query lists all. Next: studio_tool_describe, then studio_tool_call.",
    parameters: z.object({ query: z.string().max(500).optional().describe("Words to match; empty lists every tool") }),
    presentation: { label: { pending: "Finding tools", completed: "Found tools" } },
    execute: async (input: { query?: string }, ctx: ToolCtx) => {
      const scope = await scopeOf(ctx);
      const view = presented(scope);
      const names = view.names;
      const loaded = view.loaded;
      const tools: unknown[] = searchScoped(names.map((name) => deps.book.get(name)!).map((tool) => ({ name: tool.name, description: tool.description })), input.query)
        .map((hit) => (loaded.has(hit.id) ? { ...hit, loaded: true } : hit));
      let total = names.length;
      if (scope?.gateway) {
        const found = parse(await deps.book.run("tool_gateway_search", { query: input.query, limit: 25 }, ctx));
        const more = Array.isArray(found?.tools) ? found.tools : [];
        tools.push(...more);
        total += typeof found?.total === "number" ? found.total : more.length;
      }
      return JSON.stringify({ tools, total });
    },
  } as never);

  bb.agents.registerTool({
    name: "studio_tool_describe",
    description: `Input schemas for up to ${MAX_DESCRIBE} tool ids from studio_tool_search.`,
    parameters: z.object({ ids: z.array(z.string().min(1).max(100)).min(1).max(MAX_DESCRIBE).describe("Tool ids from studio_tool_search") }),
    presentation: { label: { pending: "Reading tool schemas", completed: "Read tool schemas" } },
    execute: async (input: { ids: string[] }, ctx: ToolCtx) => {
      const scope = await scopeOf(ctx);
      const view = presented(scope);
      const names = new Set(view.names);
      const aliases = new Set(reachable(scope).filter((name) => !names.has(name)));
      const allowed = new Set([...names, ...aliases]);
      const tools: unknown[] = input.ids.filter((id) => allowed.has(id)).map((id) => {
        const tool = deps.book.get(id)!;
        const alias = aliases.has(id) ? ALIASES.get(id) : undefined;
        return { id, name: id, description: tool.description, inputSchema: deps.schemaFor(id, view.ops), ...(alias ? { replacedBy: `${alias.merged} { op: "${alias.op}" }` } : {}) };
      });
      const notFound = input.ids.filter((id) => !allowed.has(id) && !(scope?.gateway && GATEWAY_ID.test(id)));
      const gatewayIds = scope?.gateway ? input.ids.filter((id) => GATEWAY_ID.test(id)) : [];
      if (gatewayIds.length) {
        const found = parse(await deps.book.run("tool_gateway_describe", { ids: gatewayIds }, ctx));
        if (Array.isArray(found?.tools)) tools.push(...found.tools);
        if (Array.isArray(found?.notFound)) notFound.push(...found.notFound.filter((id): id is string => typeof id === "string"));
      }
      return JSON.stringify({ tools, notFound });
    },
  } as never);

  bb.agents.registerTool({
    name: "studio_tool_call",
    description: "Run one tool by its id from studio_tool_search, with arguments that match its input schema (studio_tool_describe).",
    parameters: z.object({ id: z.string().min(1).max(100), args: z.record(z.string(), z.unknown()).optional() }),
    presentation: { label: { pending: "Running a tool", completed: "Ran a tool" } },
    execute: async (input: { id: string; args?: Record<string, unknown> }, ctx: ToolCtx) => {
      const scope = await scopeOf(ctx);
      if (scope?.gateway && GATEWAY_ID.test(input.id)) return await deps.book.run("tool_gateway_call", { id: input.id, args: input.args ?? {} }, ctx);
      if (!presented(scope).names.includes(input.id) && !reachable(scope).includes(input.id)) return error(`${input.id} isn't available in this thread. Search with studio_tool_search.`);
      return await deps.book.run(input.id, input.args ?? {}, ctx, input.id);
    },
  } as never);
}
