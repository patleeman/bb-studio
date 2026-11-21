// Lean context, per provider (Settings › Agent context). Lean: a session loads
// only what a turn needs (strand_note, runner_report) and reaches the rest through studio_tool_*, and lists
// none of Studio's skills. Auto is lean for an ACP agent whose model runs
// locally, judged by the model id (inkling-local/…, ollama/…, lmstudio/…).

export type LeanMode = "auto" | "lean" | "full";
export const LEAN_KEY = "context:lean";

interface Kv { get(key: string): Promise<unknown> | unknown; set(key: string, value: unknown): Promise<void> | void }

const LOCAL_MODEL = /(^|[/:_.\-\s])(local|localhost|127\.0\.0\.1|lmstudio|lm-studio|ollama|llama\.?cpp|llamacpp|llama-server|vllm|mlx|desktop)([/:_.\-\s]|$)/i;

/** True for a model id that names a local endpoint. */
export function isLocalModel(model: string | null | undefined): boolean {
  return !!model && LOCAL_MODEL.test(model);
}

/** Whether a session of this provider and model runs lean. */
export function leanFor(modes: Readonly<Record<string, LeanMode>>, providerId: string, model: string | null | undefined): boolean {
  const mode = modes[providerId] ?? "auto";
  if (mode === "lean") return true;
  if (mode === "full") return false;
  return providerId.startsWith("acp-") && isLocalModel(model);
}

export class LeanStore {
  current: Record<string, LeanMode> = {};
  constructor(private readonly kv: Kv) {}

  async load(): Promise<void> {
    const value = await this.kv.get(LEAN_KEY);
    this.current = parse(value);
  }

  async set(providerId: string, mode: LeanMode): Promise<Record<string, LeanMode>> {
    const next = { ...this.current };
    if (mode === "auto") delete next[providerId];
    else next[providerId] = mode;
    await this.kv.set(LEAN_KEY, next);
    this.current = next;
    return next;
  }
}

function parse(value: unknown): Record<string, LeanMode> {
  const raw = typeof value === "string" ? safeJson(value) : value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, LeanMode] => entry[1] === "lean" || entry[1] === "full" || entry[1] === "auto"));
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
