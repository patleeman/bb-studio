import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { AuthPool } from "../auth/service";
import { poolCancelSchema, poolClaudeStartSchema, poolCodexPollSchema, poolCodexStartSchema, poolSavedSchema } from "../auth/contract";
import { poolStatusSchema, type PoolStatusView } from "./pool-view";

const TIMEOUT_MS = 4_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const READ_METHODS = ["status.get"] as const;
const SIGN_IN_METHODS = ["login.start", "login.complete", "codexLogin.start", "codexLogin.poll", "codexLogin.cancel"] as const;
export const LIVE_BB_METHODS: readonly string[] = [...READ_METHODS, ...SIGN_IN_METHODS];

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function serverUrlIn(path: string): string | null {
  try {
    const value = (JSON.parse(readFileSync(path, "utf8")) as { serverUrl?: unknown }).serverUrl;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function loopbackUrl(candidate: string | null): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function liveBbUrl(sourceDir: string | null, ownDataDir: string, ownUrl: string | null): string | null {
  if (!sourceDir || resolve(sourceDir) === resolve(ownDataDir)) return null;
  const url = loopbackUrl(serverUrlIn(join(sourceDir, "bb-app-runtime.json"))) ?? loopbackUrl(serverUrlIn(join(sourceDir, "config.json")));
  if (!url) return null;
  if (ownUrl && loopbackUrl(ownUrl) === url) return null;
  return url;
}

const envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), error: z.unknown().optional() });

export class LiveBbPool {
  constructor(private readonly url: () => string | null, private readonly fetchImpl: Fetch = fetch as unknown as Fetch) {}

  available(): boolean {
    return this.url() !== null;
  }

  private async call<T>(method: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
    if (!LIVE_BB_METHODS.includes(method)) throw new Error(`bb's ${method} is not called from BB Studio.`);
    const base = this.url();
    if (!base) throw new Error("bb is not running on this Mac.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${base}/api/v1/plugins/account-pool/rpc/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const body = envelope.parse(await response.json());
      if (!response.ok || !body.ok) {
        const error = body.error;
        const message = typeof error === "string" ? error : typeof (error as { message?: unknown } | undefined)?.message === "string" ? (error as { message: string }).message : `HTTP ${response.status}`;
        throw new Error(`bb: ${message}`);
      }
      return schema.parse(body.result);
    } finally {
      clearTimeout(timer);
    }
  }

  status(): Promise<PoolStatusView> {
    return this.call("status.get", null, poolStatusSchema);
  }

  signIn(): AuthPool {
    const relogin = (accountId: string) => ({ kind: "relogin", accountId });
    return {
      list: async () => (await this.status()).accounts.map((account) => ({ id: account.id, provider: account.provider === "codex" ? "codex" as const : "claude" as const, kind: account.kind === "api-key" ? "api-key" as const : "oauth" as const, label: account.label, email: account.email, enabled: account.enabled, status: account.status, error: null })),
      codexStart: (accountId) => this.call("codexLogin.start", relogin(accountId), poolCodexStartSchema),
      codexPoll: (sessionId) => this.call("codexLogin.poll", { sessionId }, poolCodexPollSchema),
      codexCancel: (sessionId) => this.call("codexLogin.cancel", { sessionId }, poolCancelSchema),
      claudeStart: (accountId) => this.call("login.start", relogin(accountId), poolClaudeStartSchema),
      claudeComplete: (sessionId, pasted) => this.call("login.complete", { sessionId, pasted }, poolSavedSchema),
    };
  }
}
