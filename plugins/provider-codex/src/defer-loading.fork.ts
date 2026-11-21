// Codex loads a dynamic tool's schema only when the model searches for it
// (`deferLoading`, Codex's tool_search) when the plugin that offers the tool
// asks for that. A plugin asks through configure()'s `parameters` override,
// with the JSON Schema vendor key `x-bb-defer-loading` at the top of the
// schema: `true`, or a namespace name such as "studio" (BB passes the override
// through as the tool's inputSchema). Codex accepts a deferred tool only
// inside a namespace, so the deferred tools are grouped into one namespace per
// name ("bb" for `true`). Codex's tool call still names the bare tool, which
// the bridge forwards as before. Only on a Codex this was checked on
// (DEFER_LOADING_MIN_CODEX, the version its app-server reports at initialize):
// on an older or unknown one the key comes out and every tool goes eagerly.
import type { DynamicToolSpec } from "./generated/codex-app-server/schema/v2/DynamicToolSpec.js";

export const FORK_DEFER_LOADING_KEY = "x-bb-defer-loading";
/** The oldest Codex the namespace + deferLoading shape was checked on (staged run, 21 Nov 2026). */
export const DEFER_LOADING_MIN_CODEX = "0.171.0";

let codexVersion: string | null = null;
/** initializeChild (bridge.ts) records the app-server's version here. */
export function forkNoteCodexVersion(version: string | null): void {
  codexVersion = version;
}

function atLeast(version: string | null, minimum: string): boolean {
  const parts = (text: string) => text.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10));
  if (version === null) return false;
  const [a, b] = [parts(version), parts(minimum)];
  if (a.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  // 0.171.0-alpha comes before 0.171.0.
  return !/^\d+\.\d+\.\d+-/.test(version);
}
const NAMESPACE = /^[A-Za-z0-9_-]{1,64}$/;

export function forkCodexDeferLoading(inputSchema: unknown): { inputSchema: unknown; deferNamespace?: string } {
  if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) return { inputSchema };
  const marker = (inputSchema as Record<string, unknown>)[FORK_DEFER_LOADING_KEY];
  const namespace = marker === true ? "bb" : typeof marker === "string" && NAMESPACE.test(marker) ? marker : null;
  if (namespace === null) return { inputSchema };
  const { [FORK_DEFER_LOADING_KEY]: _marker, ...schema } = inputSchema as Record<string, unknown>;
  return { inputSchema: schema, deferNamespace: namespace };
}

/** Eager tools stay as they are; marked ones go, deferred and without the key, into one namespace per name. */
export function forkGroupDeferredCodexTools(specs: DynamicToolSpec[] | undefined): DynamicToolSpec[] | undefined {
  if (specs === undefined) return undefined;
  const defer = atLeast(codexVersion, DEFER_LOADING_MIN_CODEX);
  const out: DynamicToolSpec[] = [];
  const groups = new Map<string, Extract<DynamicToolSpec, { type: "namespace" }>>();
  for (const spec of specs) {
    const marked = spec.type === "function" ? forkCodexDeferLoading(spec.inputSchema) : { inputSchema: undefined };
    if (spec.type !== "function" || marked.deferNamespace === undefined) { out.push(spec); continue; }
    if (!defer) { out.push({ ...spec, inputSchema: marked.inputSchema as typeof spec.inputSchema }); continue; }
    let group = groups.get(marked.deferNamespace);
    if (!group) {
      group = { type: "namespace", name: marked.deferNamespace, description: `More ${marked.deferNamespace} tools, loaded when searched for.`, tools: [] };
      groups.set(marked.deferNamespace, group);
      out.push(group);
    }
    group.tools.push({ ...spec, inputSchema: marked.inputSchema as typeof spec.inputSchema, deferLoading: true });
  }
  return out;
}
