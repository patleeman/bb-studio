// Lean context, per provider (Settings › Agent context). Lean: a session loads
// only what a turn needs (strand_note, runner_report) and reaches the rest through studio_tool_*, and lists
// none of Studio's skills. Auto is lean for an ACP agent whose model runs
// locally, judged by the model id (inkling-local/…, ollama/…, qwen3:8b, mlx-community/…)
// or the agent's provider slug (acp-ollama). An ACP agent is an acp-* agent or
// a provider plugin of the ACP family (src/provider-family.ts).

import { isAcpAgent } from "./provider-family";

export type LeanMode = "auto" | "lean" | "full";
export const LEAN_KEY = "context:lean";

interface Kv { get(key: string): Promise<unknown> | unknown; set(key: string, value: unknown): Promise<void> | void }

/** A token that names a local server, anywhere in a model id or an ACP agent's provider slug. */
const LOCAL_TOKEN = /(^|[/:_.\-\s])(local|localhost|127\.0\.0\.1|lmstudio|lm-studio|ollama|llama\.?cpp|llamacpp|llama-server|vllm)([/:_.\-\s]|$)/i;
/** MLX models run on this Mac: "mlx/…" or "mlx-community/…" as the first segment only (cloud ids can contain "mlx" elsewhere). */
const MLX = /^mlx(-community)?\//i;
/** Ollama's name:tag ids with no host prefix ("qwen3:8b", "llama3.1:latest", "qwen2.5:7b-instruct-q4_K_M"). */
const OLLAMA_TAG = /^[a-z0-9][a-z0-9._-]*:(latest|\d+(\.\d+)?[bkm]\b[a-z0-9._-]*|q\d[a-z0-9._-]*|fp16|f16|[a-z0-9._-]*-q\d[a-z0-9._-]*)$/i;

/** True for a model id that names a local endpoint. */
export function isLocalModel(model: string | null | undefined): boolean {
  return !!model && (LOCAL_TOKEN.test(model) || MLX.test(model) || OLLAMA_TAG.test(model));
}

/** True for an ACP agent whose provider slug names a local server (acp-ollama, acp-lmstudio…), whatever its model id says ("acp-default"). */
export function isLocalAcpProvider(providerId: string): boolean {
  return isAcpAgent(providerId) && LOCAL_TOKEN.test(providerId.startsWith("acp-") ? providerId.slice("acp-".length) : providerId);
}

/** Whether a session of this provider and model runs lean. */
export function leanFor(modes: Readonly<Record<string, LeanMode>>, providerId: string, model: string | null | undefined): boolean {
  const mode = modes[providerId] ?? "auto";
  if (mode === "lean") return true;
  if (mode === "full") return false;
  return isAcpAgent(providerId) && (isLocalModel(model) || isLocalAcpProvider(providerId));
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
