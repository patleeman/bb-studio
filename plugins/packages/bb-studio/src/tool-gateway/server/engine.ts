/**
 * Tool Gateway's engine, ported from Agent Plugins' McpGateway (tools only).
 *
 * The protocol and transports are the official MCP client SDK's. This class
 * owns the BB Studio side: the approval gate (it starts only a server whose
 * config still has its approved hash), process isolation (stdio servers run
 * in the host worker), OAuth, and the limits: 15 s to connect, a per-server
 * call timeout, 4 calls at once per server, a 1 MB result cap, restart
 * backoff from 5 s doubling to 5 min, and an idle stop after 15 min.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type OAuthClientProvider,
  type Tool,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { ServerRecord } from "./store";
import { serverEnvironment, type SecretValues } from "./config";
import type { McpOAuthProvider } from "./oauth";
import { capResult, type CallResult } from "../cap";

export { capResult, type CallResult };

export type JsonRecord = Record<string, unknown>;

export interface CatalogTool {
  opaqueId: string;
  serverId: string;
  serverLabel: string;
  name: string;
  description: string;
  inputSchema: JsonRecord;
  outputSchema?: JsonRecord;
  annotations?: JsonRecord;
  status: "ready" | "error";
  error?: string;
}


export interface StdioConfig { key: string; command: string; args: string[]; cwd: string; env: Record<string, string> }

export interface StdioHost {
  start(config: StdioConfig, signal?: AbortSignal): Promise<{ tools: Tool[] }>;
  refresh(key: string, signal?: AbortSignal): Promise<{ tools: Tool[] }>;
  close(key: string, signal?: AbortSignal): Promise<void>;
  callTool(key: string, name: string, args: JsonRecord, toolDefinition: Tool | undefined, timeoutMs: number, maxBytes: number, signal?: AbortSignal): Promise<unknown>;
  stats?(): Promise<{ key: string; pid: number | null; rssBytes: number | null }[]>;
  onWorkerExit?(handler: () => void): () => void;
  onCatalogChanged?(handler: (key: string, error: string | null) => void): () => void;
  onConnectionChanged?(handler: (key: string, status: "closed" | "error", error: string | null) => void): () => void;
  onStderr?(handler: (key: string, line: string) => void): () => void;
}

export interface EngineDeps {
  server(id: string): ServerRecord | null;
  secrets(id: string): SecretValues;
  /** null when the server may start; otherwise why not ("needs approval", "off"). */
  blocked(record: ServerRecord): string | null;
  /** The server's own private folder, its working folder unless the user picked one. */
  serverDir(id: string): string;
  baseEnv: Record<string, string | undefined>;
  /** Hides every known secret value. */
  redact(text: string): string;
  log(serverId: string, kind: string, text: string): void;
  setStatus(serverId: string, status: ServerRecord["status"], error: string | null): void;
  changed(): void;
  oauth?: { getProvider(serverId: string, serverUrl: URL): Promise<McpOAuthProvider> };
  stdioHost?: StdioHost;
  limits?: Partial<Limits>;
}

export interface Limits {
  connectMs: number;
  maxConcurrent: number;
  resultBytes: number;
  backoffMs: number;
  maxBackoffMs: number;
  idleMs: number;
  catalogTtlMs: number;
  /** The sign-in code exchange. */
  oauthMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  connectMs: 15_000,
  maxConcurrent: 4,
  resultBytes: 1024 * 1024,
  backoffMs: 5_000,
  maxBackoffMs: 5 * 60_000,
  idleMs: 15 * 60_000,
  catalogTtlMs: 5 * 60_000,
  oauthMs: 15_000,
};

const MCP_CLIENT_INFO = { name: "bb-studio-tool-gateway", version: "1.0.0" };
/** The longest message a stdio server may send: a few MB over the result cap. */
export const STDIO_MAX_BUFFER = 8 * 1024 * 1024;
const OAUTH_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 2_000;

export class AuthenticationRequiredError extends Error {
  constructor(readonly authorizationUrl: string) {
    super("This server needs you to sign in.");
    this.name = "AuthenticationRequiredError";
  }
}

export class ToolNotFoundError extends Error {}
export class InvalidArgumentsError extends Error {}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** A stable id for a tool, the same across restarts: `tg_` and 16 hex characters of server id + tool name. */
export function opaqueToolId(serverId: string, toolName: string): string {
  return `tg_${createHash("sha256").update(JSON.stringify([serverId, toolName])).digest("hex").slice(0, 16)}`;
}

export function toolDigest(tool: { name: string; description?: string; inputSchema?: unknown }): string {
  return createHash("sha256").update(JSON.stringify([tool.name, tool.description ?? "", tool.inputSchema ?? null])).digest("hex").slice(0, 16);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`));
    }, ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function isJsonRpcBody(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") return false;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed.some((item) => asRecord(item)?.jsonrpc === "2.0");
    return asRecord(parsed)?.jsonrpc === "2.0";
  } catch {
    return false;
  }
}

function isMcpRequest(url: URL, configuredUrl: URL, input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  // Legacy SSE servers advertise a second, session-specific POST endpoint.
  // Keep the configured headers on it, while telling it apart from
  // same-origin OAuth endpoints by an MCP JSON-RPC body or an event-stream GET.
  const requestHeaders = new Headers(init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  const exactConfiguredEndpoint = url.origin === configuredUrl.origin && url.pathname === configuredUrl.pathname && url.search === configuredUrl.search;
  if (method === "GET" && requestHeaders.get("accept")?.toLowerCase().includes("text/event-stream")) return true;
  if (method === "POST" && isJsonRpcBody(init?.body ?? null)) return true;
  return exactConfiguredEndpoint && method === "DELETE";
}

/**
 * fetch for an HTTP server: redirects are refused, and the configured headers
 * go only to the configured MCP endpoint, never to OAuth discovery,
 * registration or token endpoints, even on the same origin.
 */
export function redirectGuardFetch(url: URL, baseHeaders: Record<string, string> | undefined, timeoutMs = OAUTH_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const useMcpHeaders = isMcpRequest(requestUrl, url, input, init);
    const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    if (useMcpHeaders) new Headers(baseHeaders).forEach((value, name) => headers.set(name, value));
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const controller = new AbortController();
    const sourceSignals = [init?.signal, typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined].filter((signal): signal is AbortSignal => signal !== undefined && signal !== null);
    const listeners = sourceSignals.map((signal) => {
      const listener = () => controller.abort(signal.reason);
      if (signal.aborted) listener();
      else signal.addEventListener("abort", listener, { once: true });
      return { signal, listener };
    });
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error(`MCP HTTP request timed out after ${timeoutMs}ms`)), timeoutMs) : undefined;
    try {
      const response = await fetch(input as URL | RequestInfo, { ...(init as RequestInit), headers, signal: controller.signal, redirect: "manual" });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        throw new Error(`redirect blocked for ${url.origin}`);
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
      for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
    }
  };
}


interface Connected {
  kind: "local" | "host";
  client?: Client;
  transport?: StreamableHTTPClientTransport | SSEClientTransport | StdioClientTransport;
  hostKey?: string;
  tools: Tool[];
  expectedClose: boolean;
  lastUsed: number;
  active: number;
  waiting: Array<() => void>;
  configKey: string;
}

interface PendingAuth {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  provider: McpOAuthProvider;
}

interface Failure { message: string; at: number; count: number }

interface CatalogCache { configKey: string; tools: Tool[]; updatedAt: number; error: string | null }

export type LiveStatus = "running" | "starting" | "needs-sign-in" | "error" | "stopped";

export class ToolGatewayEngine {
  private readonly conns = new Map<string, Connected>();
  private readonly pending = new Map<string, Promise<Connected>>();
  private readonly connectControllers = new Map<string, AbortController>();
  private readonly oauthPending = new Map<string, PendingAuth>();
  private readonly providers = new Map<string, McpOAuthProvider>();
  private readonly failures = new Map<string, Failure>();
  private readonly catalogCache = new Map<string, CatalogCache>();
  private readonly epochs = new Map<string, number>();
  private readonly unsubscribe: Array<() => void> = [];
  private readonly validators = new AjvJsonSchemaValidator();
  private readonly validatorCache = new Map<string, ((input: unknown) => { valid: boolean; errorMessage?: string }) | null>();
  private readonly loggedSchemaFallback = new Set<string>();
  private readonly limits: Limits;
  private readonly idleTimer: ReturnType<typeof setInterval>;
  private memory = new Map<string, number | null>();
  private closed = false;

  constructor(private readonly deps: EngineDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
    const host = deps.stdioHost;
    if (host) {
      const exit = host.onWorkerExit?.(() => this.hostWorkerExited());
      const catalog = host.onCatalogChanged?.((key, error) => this.hostCatalogChanged(key, error));
      const connection = host.onConnectionChanged?.((key, status, error) => this.hostConnectionChanged(key, status, error));
      const stderr = host.onStderr?.((key, line) => this.deps.log(key, "stderr", line));
      for (const off of [exit, catalog, connection, stderr]) if (off) this.unsubscribe.push(off);
    }
    this.idleTimer = setInterval(() => void this.stopIdle(), Math.min(60_000, Math.max(1_000, Math.floor(this.limits.idleMs / 4))));
    this.idleTimer.unref?.();
  }

  // ── Status ────────────────────────────────────────────────────────────

  liveStatus(id: string): { status: LiveStatus; error: string | null; tools: number } {
    const conn = this.conns.get(id);
    if (conn) return { status: "running", error: null, tools: conn.tools.length };
    if (this.oauthPending.has(id)) return { status: "needs-sign-in", error: null, tools: 0 };
    if (this.pending.has(id)) return { status: "starting", error: null, tools: 0 };
    const failure = this.failures.get(id);
    const cached = this.catalogCache.get(id);
    if (failure) return { status: "error", error: failure.message, tools: cached?.tools.length ?? 0 };
    return { status: "stopped", error: null, tools: cached && !cached.error ? cached.tools.length : 0 };
  }

  memoryBytes(id: string): number | null {
    return this.memory.get(id) ?? null;
  }

  async refreshMemory(): Promise<void> {
    const stats = await this.deps.stdioHost?.stats?.().catch(() => []) ?? [];
    this.memory = new Map(stats.map((entry) => [entry.key, entry.rssBytes]));
  }

  /** The tools last listed for a server, live or cached. */
  knownTools(id: string): Tool[] {
    return this.conns.get(id)?.tools ?? this.catalogCache.get(id)?.tools ?? [];
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.idleTimer);
    for (const controller of this.connectControllers.values()) controller.abort(new Error("Tool Gateway closing"));
    const ids = new Set([...this.conns.keys(), ...this.oauthPending.keys(), ...this.pending.keys()]);
    await Promise.all([...ids].map((id) => this.closeServer(id).catch(() => {})));
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** Stops a server and forgets its state. The next call starts it again. */
  async closeServer(id: string): Promise<void> {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    this.connectControllers.get(id)?.abort(new Error(`Start of ${id} cancelled`));
    const inFlight = this.pending.get(id);
    if (inFlight) {
      await withTimeout(inFlight, CLOSE_TIMEOUT_MS, `wait for ${id}`).catch(() => {});
      if (this.pending.get(id) === inFlight) this.pending.delete(id);
    }
    const conn = this.conns.get(id);
    const auth = this.oauthPending.get(id);
    this.conns.delete(id);
    this.oauthPending.delete(id);
    this.failures.delete(id);
    this.memory.delete(id);
    if (conn) await this.closeConnected(id, conn).catch((error) => this.deps.log(id, "event", `close: ${this.deps.redact(errorText(error))}`));
    if (auth) await this.closePendingAuth(id, auth);
    if (conn) this.deps.log(id, "event", "stopped");
  }

  /** Stops a server and drops its catalog and OAuth state, after an edit or removal. */
  async resetServer(id: string): Promise<void> {
    await this.closeServer(id);
    this.catalogCache.delete(id);
    const provider = this.providers.get(id);
    if (provider) await provider.clearPending().catch(() => {});
    this.providers.delete(id);
  }

  private wakeDead(conn: Connected): void {
    conn.expectedClose = true;
    for (const wake of conn.waiting.splice(0)) wake();
  }

  private async closeConnected(id: string, conn: Connected): Promise<void> {
    this.wakeDead(conn);
    if (conn.kind === "host") {
      const controller = new AbortController();
      await withTimeout(this.deps.stdioHost!.close(conn.hostKey!, controller.signal), CLOSE_TIMEOUT_MS, `stop ${id}`, () => controller.abort());
      return;
    }
    if (conn.client) await withTimeout(conn.client.close(), CLOSE_TIMEOUT_MS, `stop ${id}`);
  }

  private async closePendingAuth(id: string, pending: PendingAuth): Promise<void> {
    if (this.oauthPending.get(id) === pending) this.oauthPending.delete(id);
    await withTimeout(pending.transport.close(), CLOSE_TIMEOUT_MS, `close sign-in ${id}`).catch(() => {});
    await withTimeout(pending.client.close(), CLOSE_TIMEOUT_MS, `close sign-in ${id}`).catch(() => {});
  }

  private async stopIdle(): Promise<void> {
    if (this.closed) return;
    const now = Date.now();
    for (const [id, conn] of [...this.conns]) {
      if (conn.active > 0 || now - conn.lastUsed < this.limits.idleMs) continue;
      this.deps.log(id, "event", `idle for ${Math.round(this.limits.idleMs / 60_000)} min`);
      await this.closeServer(id).catch(() => {});
      this.deps.setStatus(id, "stopped", null);
      this.deps.changed();
    }
  }

  private hostWorkerExited(): void {
    if (this.closed) return;
    let any = false;
    for (const [id, conn] of [...this.conns]) {
      if (conn.kind !== "host") continue;
      this.conns.delete(id);
      this.wakeDead(conn);
      this.fail(id, "The server process stopped; it starts again on the next call.");
      any = true;
    }
    if (any) this.deps.changed();
  }

  private hostConnectionChanged(key: string, status: "closed" | "error", error: string | null): void {
    if (this.closed) return;
    const conn = this.conns.get(key);
    if (!conn || conn.kind !== "host") return;
    this.conns.delete(key);
    this.wakeDead(conn);
    this.fail(key, error ?? `The server ${status === "closed" ? "stopped" : "failed"}.`);
    this.deps.changed();
  }

  private hostCatalogChanged(key: string, error: string | null): void {
    if (this.closed) return;
    const conn = this.conns.get(key);
    if (!conn || conn.kind !== "host" || error) return;
    void this.deps.stdioHost!.refresh(conn.hostKey!).then((catalog) => {
      if (this.conns.get(key) !== conn) return;
      conn.tools = catalog.tools;
      this.catalogCache.set(key, { configKey: conn.configKey, tools: conn.tools, updatedAt: Date.now(), error: null });
      this.deps.log(key, "event", `tools changed: ${conn.tools.length}`);
      this.deps.changed();
    }).catch(() => {});
  }

  private fail(id: string, message: string): void {
    const previous = this.failures.get(id);
    const clean = this.deps.redact(message);
    this.failures.set(id, { message: clean, at: Date.now(), count: (previous?.count ?? 0) + 1 });
    this.deps.setStatus(id, "error", clean);
    this.deps.log(id, "error", clean);
  }

  /** How long after a failure the next start may try: 5 s, doubling to 5 min. */
  backoffMs(id: string): number {
    const failure = this.failures.get(id);
    if (!failure) return 0;
    return Math.min(this.limits.maxBackoffMs, this.limits.backoffMs * 2 ** Math.max(0, failure.count - 1));
  }

  // ── Connecting ────────────────────────────────────────────────────────

  private configKey(record: ServerRecord): string {
    return record.approvedHash ?? "";
  }

  async ensureServer(id: string, options: { retryNow?: boolean } = {}): Promise<Connected> {
    if (this.closed) throw new Error("Tool Gateway is closing");
    const record = this.deps.server(id);
    if (!record) throw new ToolNotFoundError(`There's no server called ${id}.`);
    const blocked = this.deps.blocked(record);
    if (blocked) {
      const conn = this.conns.get(id);
      if (conn) await this.closeServer(id);
      throw new Error(blocked);
    }
    const existing = this.conns.get(id);
    if (existing && existing.configKey === this.configKey(record)) return existing;
    if (existing) await this.closeServer(id);
    const auth = this.oauthPending.get(id);
    if (auth) throw new AuthenticationRequiredError(auth.provider.getAuthorizationUrl() ?? "");
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;
    const failure = this.failures.get(id);
    if (failure && !options.retryNow && Date.now() - failure.at < this.backoffMs(id)) throw new Error(failure.message);
    const controller = new AbortController();
    this.connectControllers.set(id, controller);
    const connecting = this.connect(record, controller);
    this.pending.set(id, connecting);
    this.deps.changed();
    try {
      return await connecting;
    } finally {
      if (this.pending.get(id) === connecting) this.pending.delete(id);
      if (this.connectControllers.get(id) === controller) this.connectControllers.delete(id);
    }
  }

  private async connect(record: ServerRecord, controller: AbortController): Promise<Connected> {
    const { signal } = controller;
    const id = record.id;
    const epoch = this.epochs.get(id) ?? 0;
    const config = record.config;
    const secrets = this.deps.secrets(id);
    let client: Client | undefined;
    let transport: Connected["transport"];
    let provider: McpOAuthProvider | undefined;
    let conn: Connected | undefined;
    let hostStarted = false;
    this.deps.log(id, "event", "starting");
    try {
      if (config.kind === "stdio") {
        if (!config.command) throw new Error("A stdio server needs a command.");
        const cwd = config.cwd ?? this.deps.serverDir(id);
        if (!config.cwd) {
          await mkdir(cwd, { recursive: true, mode: 0o700 });
          await chmod(cwd, 0o700);
        }
        const stdio: StdioConfig = { key: id, command: config.command, args: config.args, cwd, env: serverEnvironment(this.deps.baseEnv, secrets, config.envNames) };
        if (this.deps.stdioHost) {
          hostStarted = true;
          const catalog = await withTimeout(this.deps.stdioHost.start(stdio, signal), this.limits.connectMs, `Starting ${id}`, () => controller.abort(new Error(`Starting ${id} timed out`)));
          conn = { kind: "host", hostKey: id, tools: catalog.tools, expectedClose: false, lastUsed: Date.now(), active: 0, waiting: [], configKey: this.configKey(record) };
        } else {
          // Tests and a BB without host workers: the same client, in this process.
          client = new Client(MCP_CLIENT_INFO, { capabilities: {}, versionNegotiation: { mode: "auto" } });
          const stdioTransport = new StdioClientTransport({ command: stdio.command, args: stdio.args, cwd: stdio.cwd, env: stdio.env, stderr: "pipe", maxBufferSize: STDIO_MAX_BUFFER });
          stdioTransport.stderr?.on("data", (chunk: Buffer) => {
            for (const line of chunk.toString("utf8").split(/\r?\n/u)) if (line.trim()) this.deps.log(id, "stderr", line.trim().slice(0, 2000));
          });
          transport = stdioTransport;
        }
      } else {
        if (!config.url) throw new Error("This server needs a URL.");
        client = new Client(MCP_CLIENT_INFO, {
          capabilities: {},
          versionNegotiation: { mode: "auto" },
          listChanged: { tools: { autoRefresh: true, onChanged: (error, items) => this.localCatalogChanged(id, error, items) } },
        });
        provider = await this.providerFor(id, new URL(config.url));
        transport = this.httpTransport(record, secrets, provider);
      }
      if (!conn) {
        conn = { kind: "local", client, transport, tools: [], expectedClose: false, lastUsed: Date.now(), active: 0, waiting: [], configKey: this.configKey(record) };
        const local = conn;
        transport!.onerror = (error) => this.deps.log(id, "error", this.deps.redact(errorText(error)));
        transport!.onclose = () => {
          if (local.expectedClose || this.closed || this.conns.get(id) !== local) return;
          this.conns.delete(id);
          this.wakeDead(local);
          this.fail(id, "The connection closed.");
          this.deps.changed();
        };
        await withTimeout(client!.connect(transport!, { signal, timeout: this.limits.connectMs }), this.limits.connectMs, `Connecting to ${id}`, () => { void client?.close().catch(() => {}); });
        const listed = await withTimeout(this.listTools(client!, signal), this.limits.connectMs, `Listing ${id}'s tools`);
        conn.tools = listed;
      }
      if (provider) await provider.clearPending();
      if (this.closed) throw new Error("Tool Gateway is closing");
      if ((this.epochs.get(id) ?? 0) !== epoch) throw new Error(`Start of ${id} cancelled`);
      this.conns.set(id, conn);
      this.catalogCache.set(id, { configKey: conn.configKey, tools: conn.tools, updatedAt: Date.now(), error: null });
      this.oauthPending.delete(id);
      this.failures.delete(id);
      this.deps.setStatus(id, "stopped", null);
      this.deps.log(id, "event", `running, ${conn.tools.length} tools`);
      this.deps.changed();
      return conn;
    } catch (error) {
      const message = this.deps.redact(errorText(error));
      const cleanupPartial = async () => {
        if (conn) {
          await this.closeConnected(id, conn).catch(() => {});
        } else if (client) {
          await withTimeout(client.close(), CLOSE_TIMEOUT_MS, `close ${id}`).catch(() => {});
        } else if (hostStarted && this.deps.stdioHost) {
          const ownAttempt = !this.conns.has(id) && (!this.connectControllers.has(id) || this.connectControllers.get(id)?.signal === signal);
          if (ownAttempt) {
            const controller = new AbortController();
            await withTimeout(this.deps.stdioHost.close(id, controller.signal), CLOSE_TIMEOUT_MS, `stop ${id}`, () => controller.abort()).catch(() => {});
          }
        }
      };
      const cancelled = this.closed || signal.aborted || (this.epochs.get(id) ?? 0) !== epoch;
      if (cancelled) {
        await cleanupPartial();
        throw new Error(this.closed ? "Tool Gateway is closing" : `Start of ${id} cancelled`);
      }
      const authorizationUrl = provider ? await provider.authorizationUrlValue() : undefined;
      if (provider && client && transport && authorizationUrl && !(transport instanceof StdioClientTransport)) {
        this.oauthPending.set(id, { client, transport, provider });
        this.failures.delete(id);
        this.deps.setStatus(id, "needs-sign-in", null);
        this.deps.log(id, "event", "needs sign-in");
        this.deps.changed();
        throw new AuthenticationRequiredError(authorizationUrl);
      }
      await cleanupPartial();
      this.conns.delete(id);
      this.fail(id, message);
      this.deps.changed();
      throw new Error(message);
    }
  }

  private async listTools(client: Client, signal: AbortSignal): Promise<Tool[]> {
    try {
      return (await client.listTools(undefined, { signal, cacheMode: "refresh" })).tools;
    } catch (error) {
      if (/method not found/i.test(errorText(error)) || (error as { code?: unknown }).code === -32601) return [];
      throw error;
    }
  }

  private localCatalogChanged(id: string, error: Error | null, items: unknown): void {
    if (this.closed) return;
    const conn = this.conns.get(id);
    if (!conn || error || !Array.isArray(items)) return;
    conn.tools = items as Tool[];
    this.catalogCache.set(id, { configKey: conn.configKey, tools: conn.tools, updatedAt: Date.now(), error: null });
    this.deps.log(id, "event", `tools changed: ${conn.tools.length}`);
    this.deps.changed();
  }

  private async providerFor(id: string, serverUrl: URL): Promise<McpOAuthProvider> {
    const existing = this.providers.get(id);
    if (existing) return existing;
    if (!this.deps.oauth) throw new Error("Sign-in storage isn't set up.");
    const provider = await this.deps.oauth.getProvider(id, serverUrl);
    this.providers.set(id, provider);
    return provider;
  }

  private httpTransport(record: ServerRecord, secrets: SecretValues, provider: McpOAuthProvider): StreamableHTTPClientTransport | SSEClientTransport {
    const url = new URL(record.config.url!);
    const headers: Record<string, string> = {};
    for (const name of record.config.headerNames) {
      const value = secrets.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const guarded = redirectGuardFetch(url, headers, Math.max(OAUTH_TIMEOUT_MS + 1_000, record.config.callTimeoutMs + 1_000));
    const options = { authProvider: provider as OAuthClientProvider, requestInit: { redirect: "manual" as const }, fetch: guarded };
    return record.config.kind === "sse" ? new SSEClientTransport(url, options) : new StreamableHTTPClientTransport(url, options);
  }

  // ── Catalog ───────────────────────────────────────────────────────────

  /** A server's tools, starting it if needed. Cached for 5 minutes. */
  async tools(id: string): Promise<Tool[]> {
    const record = this.deps.server(id);
    if (!record) throw new ToolNotFoundError(`There's no server called ${id}.`);
    const conn = this.conns.get(id);
    const cached = this.catalogCache.get(id);
    if (conn && conn.configKey === this.configKey(record)) return conn.tools;
    if (cached && cached.configKey === this.configKey(record) && !cached.error && Date.now() - cached.updatedAt < this.limits.catalogTtlMs) return cached.tools;
    return (await this.ensureServer(id)).tools;
  }

  /** Catalog entries for the given servers; a server that fails gives one error entry. */
  async catalog(records: ServerRecord[]): Promise<CatalogTool[]> {
    const out: CatalogTool[] = [];
    await Promise.all(records.map(async (record) => {
      try {
        const disabled = new Set(record.disabledTools);
        for (const tool of await this.tools(record.id)) {
          if (disabled.has(tool.name)) continue;
          out.push(this.catalogTool(record, tool));
        }
      } catch (error) {
        out.push({
          opaqueId: opaqueToolId(record.id, "__error__"),
          serverId: record.id,
          serverLabel: record.label,
          name: `__error_${record.id}`,
          description: `${record.label} isn't available: ${this.deps.redact(errorText(error))}`,
          inputSchema: { type: "object", properties: {} },
          status: "error",
          error: error instanceof AuthenticationRequiredError ? "The user needs to sign in to this server in BB Studio." : this.deps.redact(errorText(error)),
        });
      }
    }));
    const order = new Map(records.map((record, index) => [record.id, index]));
    return out.sort((a, b) => (order.get(a.serverId)! - order.get(b.serverId)!) || 0);
  }

  private catalogTool(record: ServerRecord, tool: Tool): CatalogTool {
    const raw = tool as unknown as JsonRecord;
    const entry: CatalogTool = {
      opaqueId: opaqueToolId(record.id, tool.name),
      serverId: record.id,
      serverLabel: record.label,
      name: tool.name,
      description: this.deps.redact(tool.description?.trim() || `Run ${tool.name} on ${record.label}`),
      inputSchema: asRecord(tool.inputSchema) ?? { type: "object", properties: {}, additionalProperties: true },
      status: "ready",
    };
    const output = asRecord(tool.outputSchema);
    if (output) entry.outputSchema = output;
    const annotations = asRecord(raw.annotations);
    if (annotations) entry.annotations = annotations;
    return entry;
  }

  // ── Calls ─────────────────────────────────────────────────────────────

  /** Checks args against the tool's input schema. A schema that can't be compiled falls back to "must be an object". */
  checkArgs(serverId: string, tool: Tool, args: unknown): void {
    if (args === null || typeof args !== "object" || Array.isArray(args)) throw new InvalidArgumentsError(`Arguments for ${tool.name} must be an object.`);
    const schema = asRecord(tool.inputSchema);
    if (!schema) return;
    const key = `${serverId}\u0000${tool.name}\u0000${JSON.stringify(schema)}`;
    let validate = this.validatorCache.get(key);
    if (validate === undefined) {
      try {
        validate = this.validators.getValidator(schema as never) as (input: unknown) => { valid: boolean; errorMessage?: string };
      } catch (error) {
        validate = null;
        if (!this.loggedSchemaFallback.has(key)) {
          this.loggedSchemaFallback.add(key);
          this.deps.log(serverId, "event", `${tool.name}'s input schema can't be compiled (${errorText(error).slice(0, 200)}); arguments are only checked to be an object`);
        }
      }
      this.validatorCache.set(key, validate);
    }
    if (!validate) return;
    const result = validate(args);
    if (!result.valid) throw new InvalidArgumentsError(`Invalid arguments for ${tool.name}: ${result.errorMessage ?? "they don't match its input schema"}`);
  }

  private async acquire(conn: Connected, signal?: AbortSignal): Promise<void> {
    while (conn.active >= this.limits.maxConcurrent) {
      if (conn.expectedClose) throw new Error("The server stopped.");
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Call cancelled");
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal?.removeEventListener("abort", wake);
          // A cancelled waiter leaves the queue, so it never uses up a later release.
          const at = conn.waiting.indexOf(wake);
          if (at >= 0) conn.waiting.splice(at, 1);
          resolve();
        };
        conn.waiting.push(wake);
        signal?.addEventListener("abort", wake, { once: true });
      });
    }
    if (conn.expectedClose) throw new Error("The server stopped.");
    conn.active += 1;
  }

  private release(conn: Connected): void {
    conn.active = Math.max(0, conn.active - 1);
    conn.lastUsed = Date.now();
    conn.waiting.shift()?.();
  }

  /** Runs one tool. Checks arguments first, waits for a free slot, and caps the result. */
  async call(serverId: string, toolName: string, args: JsonRecord, options: { signal?: AbortSignal } = {}): Promise<CallResult> {
    const record = this.deps.server(serverId);
    if (!record) throw new ToolNotFoundError(`Tool not found.`);
    if (record.disabledTools.includes(toolName)) throw new ToolNotFoundError(`Tool not found.`);
    const conn = await this.ensureServer(serverId);
    const tool = conn.tools.find((item) => item.name === toolName);
    if (!tool) throw new ToolNotFoundError(`Tool not found.`);
    this.checkArgs(serverId, tool, args);
    await this.acquire(conn, options.signal);
    const timeoutMs = record.config.callTimeoutMs;
    try {
      conn.lastUsed = Date.now();
      let raw: unknown;
      if (conn.kind === "host") {
        raw = await this.deps.stdioHost!.callTool(conn.hostKey!, toolName, args, tool, timeoutMs, this.limits.resultBytes, options.signal);
      } else {
        raw = await conn.client!.callTool({ name: toolName, arguments: args }, { timeout: timeoutMs, ...(options.signal ? { signal: options.signal } : {}), toolDefinition: tool });
      }
      return capResult(raw, this.limits.resultBytes);
    } catch (error) {
      const provider = this.providers.get(serverId);
      if (provider && await provider.authorizationUrlValue()) {
        this.deps.setStatus(serverId, "needs-sign-in", null);
        this.deps.changed();
      }
      throw new Error(this.deps.redact(errorText(error)));
    } finally {
      this.release(conn);
    }
  }

  // ── Sign-in ───────────────────────────────────────────────────────────

  async signInStatus(id: string): Promise<"none" | "signed-out" | "signing-in" | "signed-in"> {
    const record = this.deps.server(id);
    if (!record || record.config.kind === "stdio" || !record.config.url || !this.deps.oauth) return "none";
    const provider = await this.providerFor(id, new URL(record.config.url));
    const status = await provider.status();
    return status === "authenticated" ? "signed-in" : status === "authorizing" ? "signing-in" : "signed-out";
  }

  /** Starts the server; returns the sign-in URL when it needs one. */
  async signIn(id: string): Promise<string | null> {
    const record = this.deps.server(id);
    if (!record) throw new Error(`There's no server called ${id}.`);
    if (record.config.kind === "stdio") return null;
    await this.closeServer(id);
    try {
      await this.ensureServer(id, { retryNow: true });
      return null;
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) return error.authorizationUrl || null;
      throw error;
    }
  }

  async finishSignIn(id: string, params: URLSearchParams): Promise<void> {
    const record = this.deps.server(id);
    if (!record || record.config.kind === "stdio" || !record.config.url) throw new Error("Sign-in is only for URL servers.");
    const pending = this.oauthPending.get(id);
    const provider = pending?.provider ?? await this.providerFor(id, new URL(record.config.url));
    await provider.validateState(params.get("state"));
    if (params.get("error")) {
      const message = `Sign-in failed: ${params.get("error")}${params.get("error_description") ? ` — ${params.get("error_description")}` : ""}`;
      await provider.clearPending().catch(() => {});
      if (pending) await this.closePendingAuth(id, pending);
      this.deps.setStatus(id, "needs-sign-in", this.deps.redact(message));
      this.deps.changed();
      throw new Error(message);
    }
    const transport = pending?.transport ?? this.httpTransport(record, this.deps.secrets(id), provider);
    try {
      await withTimeout(transport.finishAuth(params), this.limits.oauthMs, `Sign-in to ${id}`, () => { void transport.close().catch(() => {}); });
    } catch (error) {
      await provider.clearPending().catch(() => {});
      if (pending) await this.closePendingAuth(id, pending);
      else await transport.close().catch(() => {});
      this.deps.setStatus(id, "needs-sign-in", this.deps.redact(errorText(error)));
      this.deps.changed();
      throw new Error(this.deps.redact(errorText(error)));
    }
    await provider.clearPending();
    if (pending) await this.closePendingAuth(id, pending);
    else await withTimeout(transport.close(), CLOSE_TIMEOUT_MS, `close sign-in ${id}`).catch(() => {});
    this.deps.log(id, "event", "signed in");
    this.failures.delete(id);
    await this.ensureServer(id, { retryNow: true });
  }

  async signOut(id: string): Promise<void> {
    const record = this.deps.server(id);
    if (!record || record.config.kind === "stdio" || !record.config.url) return;
    await this.closeServer(id);
    const provider = await this.providerFor(id, new URL(record.config.url));
    await provider.invalidateCredentials("all");
    this.deps.setStatus(id, "stopped", null);
    this.deps.log(id, "event", "signed out");
    this.deps.changed();
  }
}
