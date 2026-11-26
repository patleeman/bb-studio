// Tool Gateway in Studio's server: the store, the secret store, the engine,
// the RPCs (reads for everyone, changes for the app window only), requests
// that become Todos, the 3 agent tools and their gate in configure(), the
// OAuth callback route and `bb studio tool-gateway`.
import { chmodSync, existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Tool } from "@modelcontextprotocol/client";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  GATED_METHODS,
  TOOL_GATEWAY_TOOLS,
  serverInputSchema,
  toolGatewayContract,
  toolGatewayPublicContract,
  type ImportPreview,
  type ProviderAccess,
  type ProviderView,
  type RequestInput,
  type RequestView,
  type ServerInput,
  type ServerView,
} from "../contract";
import { isAcpAgent, noteCatalog } from "../../provider-family";
import { pluginSecretsDir } from "../../settings/key-store";
import { isAppWindow, requireAppWindow } from "./caller";
import { oauthCallbackUrl, OAUTH_CALLBACK_PATH, validatePastedCallback } from "./callback-url";
import {
  ConfigError,
  checkEnvValue,
  checkHeaderValue,
  checkUrl,
  configHash,
  defaultConfig,
  hasMask,
  MASK,
  redact,
  redactDeep,
  resolveCommand,
  type SecretValues,
  type ServerConfig,
} from "./config";
import { capResult, opaqueToolId, toolDigest, ToolGatewayEngine, ToolNotFoundError, type CallResult, type CatalogTool, type EngineDeps, type JsonRecord, type StdioHost } from "./engine";
import { importSources, OLD_PLUGIN_ID, oldPluginDatabase, previewOf, readAgentPlugins, type ImportRow } from "./import";
import { DeferredOAuthCredentialStore, McpOAuthProvider } from "./oauth";
import { ToolGatewaySecrets } from "./secrets";
import { ToolGatewayStore, type RequestRecord, type ServerRecord } from "./store";
import { describeTools, MAX_DESCRIBE_TOOLS, searchTools } from "./tool-search";
import { toolGatewayHostContract, toolGatewayHostSignals } from "../host-contract";

export const TOOL_GATEWAY_CHANNEL = "studio-tool-gateway";
export const TOOL_GATEWAY_INSTRUCTIONS = "Your MCP servers' tools: find one with tool_gateway_search, read its input schema with tool_gateway_describe, then run it by id with tool_gateway_call.";

export interface ToolGatewayTodos {
  /** Opens a Todo for the user; returns its id. */
  create(input: { title: string; why: string; requestId: string; threadId: string | null }): Promise<string | null>;
  close(taskId: string, state: "done" | "dropped"): Promise<void>;
}

export interface ToolGatewayOptions {
  db: Database.Database;
  dataDir: string;
  pluginId: string;
  todos?: ToolGatewayTodos;
  /** The environment the allow-list is taken from; BB's own by default. */
  baseEnv?: Record<string, string | undefined>;
  /** false: run stdio servers in this process (tests, a BB without host workers). */
  useHost?: boolean;
  limits?: EngineDeps["limits"];
}

type CliResult = { exitCode: number; stdout?: string; stderr?: string };

export interface ToolGateway {
  /** For Studio's configure(): the 3 tools and one line of instructions, or nothing. */
  agentConfiguration(context: { providerId: string; projectId: string }): { tools: string[]; instructions: string };
  cli(argv: readonly string[], ctx: { threadId?: string | null; projectId?: string | null }): Promise<CliResult>;
  store: ToolGatewayStore;
  engine: ToolGatewayEngine;
  /** Every server's secret values and tokens, for other features to keep out of what they send (strands). */
  secretValues(): string[];
  /** For tests: the RPC handlers as registered. */
  handlers: Record<string, (input: never, context?: unknown) => Promise<unknown>>;
  ready(): Promise<void>;
  dispose(): Promise<void>;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const PROVIDER_CACHE_MS = 60_000;
export const MAX_PENDING_REQUESTS = 20;
const IMPORT_CACHE_MS = 30_000;

/** MCP content blocks as agent tool content: text and images as they are, anything else as JSON text. */
export function agentContent(result: CallResult): { type: "text"; text: string }[] | ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] {
  const out: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
  for (const block of result.content) {
    if (block.type === "text" && typeof block.text === "string") out.push({ type: "text", text: block.text });
    else if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") out.push({ type: "image", data: block.data, mimeType: block.mimeType });
    else out.push({ type: "text", text: JSON.stringify(block) });
  }
  if (result.structuredContent !== undefined && !out.some((block) => block.type === "text")) out.push({ type: "text", text: JSON.stringify(result.structuredContent) });
  if (out.length === 0) out.push({ type: "text", text: result.isError ? "The tool failed with no message." : "The tool returned nothing." });
  return out;
}

export async function registerToolGateway(bb: BbPluginApi, options: ToolGatewayOptions): Promise<ToolGateway> {
  const store = new ToolGatewayStore(options.db, bb.storage.kv as never);
  await store.loadProviders().catch((error) => bb.log.warn(`Tool Gateway: provider access unreadable: ${errorText(error)}`));
  const secretsDir = join(pluginSecretsDir(options.dataDir, options.pluginId), "tool-gateway");
  const secrets = new ToolGatewaySecrets(secretsDir);
  // Never throws: a file that can't be read only means nothing is approved until it is fixed.
  for (const problem of await secrets.load()) bb.log.warn(`Tool Gateway: a secrets file can't be read, so no server is approved until it is fixed: ${problem}`);
  const baseEnv = options.baseEnv ?? process.env;
  /** Logs, errors, descriptions: every server's secret-looking values. */
  const hide = (text: string) => redact(text, secrets.values());
  /** A server's own values, masked string by string in its results. */
  const hideFor = <T,>(serverId: string, value: T): T => redactDeep(value, secrets.values(serverId));

  // ── Readiness: what configure() and the agent tools see ──────────────
  const approvedNow = (record: ServerRecord): boolean => {
    const key = secrets.approvalKey();
    return key !== null && record.approvedHash !== null && record.approvedHash === configHash(record.config, secrets.get(record.id), key);
  };
  // Read from the database each time: a row edited outside Studio must not stay ready.
  const readyServers = (): ServerRecord[] => store.freshServers().filter((record) => record.enabled && approvedNow(record));
  /**
   * The servers a caller may use. A thread gets what its provider may use; a
   * caller with no thread (a shell) only what every provider may use.
   */
  const visibleServers = (providerId: string | null, projectId: string | null): ServerRecord[] => {
    const rules = providerId ? [store.providerAccessFor(providerId)] : Object.values(store.providers());
    if (rules.some((rule) => !rule.access)) return [];
    return readyServers().filter((record) =>
      rules.every((rule) => rule.servers === "all" || rule.servers.includes(record.id)) &&
      (record.projects === null || (projectId !== null && record.projects.includes(projectId))));
  };

  let configureFailureLogged = false;

  // ── Change notice ─────────────────────────────────────────────────────
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  // After dispose (a reload: the database is closed) a late store change arms no timer, and one already armed does nothing.
  let disposed = false;
  const changed = () => {
    if (disposed || publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      if (disposed) return;
      recordApprovedTools();
      void Promise.resolve(bb.realtime.publish(TOOL_GATEWAY_CHANNEL, {} as never)).catch(() => {});
    }, 100);
    publishTimer.unref?.();
  };
  store.onChange(changed);

  /** The first tool list seen after an approval is the one the user approved. */
  function recordApprovedTools(): void {
    for (const record of store.listServers()) {
      if (record.approvedTools !== null || !approvedNow(record)) continue;
      const tools = engine.knownTools(record.id);
      if (engine.liveStatus(record.id).status !== "running") continue;
      store.saveServer({ ...record, approvedTools: tools.map((tool) => ({ name: tool.name, digest: toolDigest(tool) })) });
    }
  }

  // ── The host worker for stdio servers ────────────────────────────────
  let stdioHost: StdioHost | undefined;
  const hosts = (bb as unknown as { hosts?: { experimental_client?: unknown } }).hosts;
  if (options.useHost !== false && typeof hosts?.experimental_client === "function") {
    const client = (hosts as { experimental_client(args: unknown): unknown }).experimental_client({ contract: toolGatewayHostContract, experimental_signals: toolGatewayHostSignals }) as {
      call(name: string, value: unknown, options: { hostId: string; signal?: AbortSignal }): Promise<unknown>;
      experimental_onWorkerExit(handler: (event: { hostId: string }) => void): () => void;
      experimental_onSignal(name: string, handler: (event: { payload: Record<string, unknown> }) => void): () => void;
    };
    let hostId: Promise<string> | null = null;
    const primaryHost = () => (hostId ??= (async () => {
      const config = await bb.sdk.system.config() as unknown as { primaryHostId?: string | null };
      if (config.primaryHostId) return config.primaryHostId;
      const first = (await bb.sdk.hosts.list())[0]?.id;
      if (!first) throw new Error("No host to run MCP servers on.");
      return first;
    })().catch((error) => { hostId = null; throw error; }));
    const call = async (method: string, input: unknown, signal?: AbortSignal) => client.call(method, input, { hostId: await primaryHost(), ...(signal ? { signal } : {}) });
    stdioHost = {
      start: async (config, signal) => await call("start", config, signal) as { tools: Tool[] },
      refresh: async (key, signal) => await call("refresh", { key }, signal) as { tools: Tool[] },
      close: async (key, signal) => { await call("close", { key }, signal); },
      callTool: (key, name, args, toolDefinition, timeoutMs, maxBytes, signal) => call("callTool", { key, name, args, timeoutMs, maxBytes, ...(toolDefinition ? { toolDefinition } : {}) }, signal),
      stats: async () => ((await call("stats", {})) as { servers: { key: string; pid: number | null; rssBytes: number | null }[] }).servers,
      onWorkerExit: (handler) => client.experimental_onWorkerExit(() => handler()),
      onCatalogChanged: (handler) => client.experimental_onSignal("catalogChanged", ({ payload }) => handler(String(payload.key), (payload.error as string | null) ?? null)),
      onConnectionChanged: (handler) => client.experimental_onSignal("connectionChanged", ({ payload }) => handler(String(payload.key), payload.status as "closed" | "error", (payload.error as string | null) ?? null)),
      onStderr: (handler) => client.experimental_onSignal("stderr", ({ payload }) => handler(String(payload.key), String(payload.line))),
    };
  }

  // ── OAuth ─────────────────────────────────────────────────────────────
  const oauthStore = new DeferredOAuthCredentialStore(secrets.oauthBackend(), (error) => bb.log.warn(`Tool Gateway: sign-in not saved: ${errorText(error)}`));
  const callbackFor = (serverId: string) => oauthCallbackUrl(bb.server.loopbackBaseUrl, options.pluginId, serverId);

  const engine = new ToolGatewayEngine({
    server: (id) => store.reloadServer(id),
    secrets: (id) => secrets.get(id),
    blocked: (record) => (!record.enabled ? `${record.label} is off.` : approvedNow(record) ? null : `${record.label} needs approval in BB Studio.`),
    serverDir: (id) => join(options.dataDir, "plugins", options.pluginId, "tool-gateway", "servers", id),
    baseEnv,
    redact: hide,
    log: (serverId, kind, text) => {
      try { store.log(serverId, kind, hide(text)); } catch { /* A log write never fails a call. */ }
    },
    setStatus: (serverId, status, error) => store.setStatus(serverId, status, error === null ? null : hide(error)),
    changed,
    oauth: { getProvider: async (serverId, serverUrl) => new McpOAuthProvider(serverId, serverUrl, callbackFor(serverId), oauthStore) },
    stdioHost,
    limits: options.limits,
  });

  // ── Views ─────────────────────────────────────────────────────────────
  async function serverView(record: ServerRecord): Promise<ServerView> {
    const approved = approvedNow(record);
    const live = engine.liveStatus(record.id);
    const known = engine.knownTools(record.id);
    const status: ServerView["status"] = !approved ? "needs-approval" : !record.enabled ? "off"
      : live.status === "stopped" && record.status === "needs-sign-in" ? "needs-sign-in"
      : live.status === "stopped" && record.status === "error" ? "error"
      : live.status;
    const approvedTools = new Map((record.approvedTools ?? []).map((tool) => [tool.name, tool.digest]));
    const toolsChanged = record.approvedTools !== null && known.length > 0 && (known.length !== approvedTools.size || known.some((tool) => approvedTools.get(tool.name) !== toolDigest(tool)));
    let signIn: ServerView["signIn"] = "none";
    try { signIn = await engine.signInStatus(record.id); } catch { /* Shown as none. */ }
    return {
      id: record.id,
      label: record.label,
      kind: record.config.kind,
      command: record.config.command,
      args: record.config.args.map(hide),
      cwd: record.config.cwd,
      url: record.config.url ? hide(record.config.url) : null,
      envNames: record.config.envNames,
      headerNames: record.config.headerNames,
      enabled: record.enabled,
      approved,
      status,
      lastError: live.error ?? record.lastError,
      tools: known.length || live.tools,
      disabledTools: record.disabledTools,
      projects: record.projects,
      toolsChanged,
      signIn,
      memoryBytes: engine.memoryBytes(record.id),
      callTimeoutMs: record.config.callTimeoutMs,
      source: record.source,
      createdAt: record.createdAt,
      approvedAt: record.approvedAt,
    };
  }

  function requestView(record: RequestRecord): RequestView {
    const input = record.input;
    const kind = input.kind ?? (input.url ? "streamable-http" : "stdio");
    return {
      id: record.id,
      name: input.name,
      label: input.label ?? input.name,
      kind,
      command: input.command ?? null,
      args: input.args ?? [],
      url: input.url ?? null,
      envNames: input.envNames ?? [],
      headerNames: input.headerNames ?? [],
      why: input.why,
      threadId: record.threadId,
      state: record.state,
      taskId: record.taskId,
      createdAt: record.createdAt,
    };
  }

  let providerCatalog: { at: number; list: { id: string; name: string }[] } | null = null;
  async function providerViews(): Promise<ProviderView[]> {
    if (!providerCatalog || Date.now() - providerCatalog.at > 30_000) {
      let list: { id: string; name: string }[] = [];
      try {
        const catalog = await bb.sdk.providers.catalog() as { id: string; displayName?: string; enabled?: boolean; info?: { family?: string | null } | null }[];
        noteCatalog(catalog);
        list = catalog.filter((entry) => entry.enabled !== false).map((entry) => ({ id: entry.id, name: entry.displayName || entry.id }));
      } catch { /* No catalog: the stored rows only. */ }
      providerCatalog = { at: Date.now(), list };
    }
    const stored = store.providers();
    const ids = new Map(providerCatalog.list.map((entry) => [entry.id, entry.name]));
    for (const id of Object.keys(stored)) if (!ids.has(id)) ids.set(id, id);
    return [...ids].map(([id, name]) => ({ id, name, acp: isAcpAgent(id), ...store.providerAccessFor(id) }))
      .sort((a, b) => Number(a.acp) - Number(b.acp) || a.name.localeCompare(b.name));
  }

  /** What a caller without the app window sees: names, kinds and status. */
  const briefServer = (view: ServerView): ServerView => ({ ...view, command: null, args: [], cwd: null, url: null, lastError: view.lastError === null ? null : "Open the server in the BB Studio app for details." });
  const briefRequest = (view: RequestView): RequestView => ({ ...view, command: null, args: [], url: null });

  // ── Building a config from the app window's form ─────────────────────
  function buildConfig(input: ServerInput, previous: SecretValues | null): { config: ServerConfig; secrets: SecretValues } {
    const config = defaultConfig(input.kind);
    if (input.callTimeoutMs) config.callTimeoutMs = input.callTimeoutMs;
    const next: SecretValues = { env: {}, headers: {} };
    if (input.kind === "stdio") {
      if (!input.command) throw new ConfigError("A stdio server needs a command.");
      config.command = resolveCommand(input.command, baseEnv.PATH);
      config.args = input.args ?? [];
      if (input.cwd) {
        if (!isAbsolute(input.cwd)) throw new ConfigError("The working folder must be an absolute path.");
        if (!existsSync(input.cwd) || !statSync(input.cwd).isDirectory()) throw new ConfigError(`${input.cwd} isn't a folder.`);
        config.cwd = input.cwd;
      }
      for (const [name, value] of Object.entries(input.env ?? {})) {
        const kept = value ?? previous?.env[name];
        if (kept === undefined) throw new ConfigError(`Give a value for ${name}.`);
        checkEnvValue(name, kept);
        next.env[name] = kept;
      }
      config.envNames = Object.keys(next.env).sort();
      if (input.url || Object.keys(input.headers ?? {}).length) throw new ConfigError("A stdio server has no URL or headers.");
    } else {
      if (!input.url) throw new ConfigError("This server needs a URL.");
      config.url = checkUrl(input.url);
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        const kept = value ?? previous?.headers[name];
        if (kept === undefined) throw new ConfigError(`Give a value for the ${name} header.`);
        checkHeaderValue(name, kept);
        next.headers[name] = kept;
      }
      config.headerNames = Object.keys(next.headers).sort();
      if (input.command || (input.args?.length ?? 0) > 0 || Object.keys(input.env ?? {}).length) throw new ConfigError("A URL server has no command, args or env.");
    }
    return { config, secrets: next };
  }

  async function approveRecord(record: ServerRecord, values: SecretValues): Promise<ServerRecord> {
    if (secrets.approvalKey() === null) throw new ConfigError("Tool Gateway's approval key can't be read. Fix or remove it in the secrets folder, then reload Studio.");
    await secrets.set(record.id, values);
    const now = Date.now();
    const key = secrets.approvalKey();
    if (key === null) throw new ConfigError("Tool Gateway's approval key can't be read. Fix or remove it in the secrets folder, then reload Studio.");
    return store.saveServer({ ...record, approvedHash: configHash(record.config, values, key), approvedAt: now, status: "stopped", lastError: null });
  }

  async function closeRequest(requestId: string, state: "approved" | "declined"): Promise<void> {
    const request = store.getRequest(requestId);
    if (!request || request.state !== "pending") return;
    store.writeRequest({ ...request, state, decidedAt: Date.now() });
    if (request.taskId) await options.todos?.close(request.taskId, state === "approved" ? "done" : "dropped").catch((error) => bb.log.warn(`Tool Gateway: Todo not closed: ${errorText(error)}`));
  }

  async function addRequest(input: RequestInput, context: { threadId: string | null; projectId: string | null }): Promise<RequestRecord> {
    const pending = store.listRequests("pending").find((request) => request.input.name === input.name && request.threadId === context.threadId);
    if (pending) return pending;
    if (store.listRequests("pending").length >= MAX_PENDING_REQUESTS) throw new ConfigError(`There are already ${MAX_PENDING_REQUESTS} requests waiting for the user. Wait for them to be approved or declined.`);
    const record = store.addRequest(input, context);
    const label = input.label ?? input.name;
    try {
      const taskId = await options.todos?.create({ title: `Approve MCP server ${label}?`, why: input.why, requestId: record.id, threadId: context.threadId }) ?? null;
      if (taskId) return store.writeRequest({ ...record, taskId });
    } catch (error) {
      bb.log.warn(`Tool Gateway: no Todo for request ${record.id}: ${errorText(error)}`);
    }
    return record;
  }

  // ── Import ────────────────────────────────────────────────────────────
  async function oldPluginInstalled(): Promise<boolean> {
    try {
      const { plugins } = await bb.sdk.plugins.list();
      return plugins.some((plugin) => plugin.id === OLD_PLUGIN_ID);
    } catch {
      return false;
    }
  }

  const stagedImport = () => secrets.stagedImportPath();

  /** The checks addServer runs, for an imported row; a row that fails is not imported. */
  function importInput(row: ImportRow): ServerInput {
    return {
      id: row.candidate.id,
      label: row.candidate.label,
      kind: row.candidate.kind,
      ...(row.candidate.kind === "stdio"
        ? { command: row.command ?? "", args: row.args, cwd: row.cwd, env: row.env }
        : { url: row.url ?? "", headers: row.headers }),
    };
  }

  function checkImportRow(row: ImportRow): string | null {
    if (row.candidate.needsNewCommand) return row.candidate.needsNewCommand;
    const parsed = serverInputSchema.safeParse(importInput(row));
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "It doesn't pass the server checks.";
    try {
      buildConfig(parsed.data, null);
      return null;
    } catch (error) {
      return errorText(error);
    }
  }

  let importCache: { at: number; value: ReturnType<typeof readImportRows> } | null = null;
  function readImportRows(): { source: ReturnType<typeof importSources>[number] | null; rows: ImportRow[]; skills: string[] } {
    const existing = new Set(store.listServers().map((record) => record.id));
    for (const source of importSources(options.dataDir, stagedImport())) {
      try {
        if (source.kind === "bb") chmodSync(source.path, 0o600);
        const { rows, skills } = readAgentPlugins(source, existing);
        for (const row of rows) {
          const problem = row.candidate.exists ? null : checkImportRow(row);
          if (problem) row.candidate.needsNewCommand = problem;
        }
        if (rows.length > 0 || skills.length > 0) return { source, rows, skills };
      } catch (error) {
        bb.log.warn(`Tool Gateway: can't read Agent Plugins' data (${source.kind}): ${errorText(error)}`);
      }
    }
    return { source: null, rows: [], skills: [] };
  }
  const importRows = (fresh = false) => {
    if (fresh || !importCache || Date.now() - importCache.at > IMPORT_CACHE_MS) importCache = { at: Date.now(), value: readImportRows() };
    return importCache.value;
  };

  async function importPreview(full: boolean): Promise<ImportPreview> {
    const { source, rows, skills } = importRows(true);
    const preview = previewOf(source, rows, skills, await oldPluginInstalled());
    if (full) return preview;
    return { ...preview, servers: preview.servers.map((server) => ({ ...server, command: null, args: [], cwd: null, url: null, digest: "" })) };
  }

  const importableCount = () => {
    try { return importRows().rows.filter((row) => !row.candidate.exists && !row.candidate.needsNewCommand).length; } catch { return 0; }
  };

  /** The staged copy holds plain-text values: it goes once the import has run, or failed. */
  async function deleteStagedImport(): Promise<void> {
    for (const suffix of ["", "-wal", "-shm"]) await rm(`${stagedImport()}${suffix}`, { force: true });
    importCache = null;
  }

  // ── Agent tools ───────────────────────────────────────────────────────
  const providerByThread = new Map<string, { providerId: string; at: number }>();
  async function providerOf(threadId: string): Promise<string> {
    const cached = providerByThread.get(threadId);
    if (cached && Date.now() - cached.at < PROVIDER_CACHE_MS) return cached.providerId;
    const thread = await bb.sdk.threads.get({ threadId }) as { providerId?: string } | null;
    if (!thread?.providerId) throw new Error("Tool Gateway can't tell which agent this thread runs.");
    providerByThread.set(threadId, { providerId: thread.providerId, at: Date.now() });
    return thread.providerId;
  }

  async function catalogFor(threadId: string | null, projectId: string | null): Promise<CatalogTool[]> {
    const providerId = threadId ? await providerOf(threadId) : null;
    return engine.catalog(visibleServers(providerId, projectId));
  }

  /** Finds a tool by id among the servers this thread may use, without starting servers it doesn't need. */
  async function findTool(opaqueId: string, threadId: string | null, projectId: string | null): Promise<{ serverId: string; name: string } | null> {
    const providerId = threadId ? await providerOf(threadId) : null;
    const servers = visibleServers(providerId, projectId);
    for (const record of servers) {
      for (const tool of engine.knownTools(record.id)) {
        if (opaqueToolId(record.id, tool.name) === opaqueId && !record.disabledTools.includes(tool.name)) return { serverId: record.id, name: tool.name };
      }
    }
    const entry = (await engine.catalog(servers)).find((tool) => tool.opaqueId === opaqueId && tool.status === "ready");
    return entry ? { serverId: entry.serverId, name: entry.name } : null;
  }

  async function runCall(opaqueId: string, args: JsonRecord, context: { threadId: string | null; projectId: string | null; signal?: AbortSignal }): Promise<CallResult> {
    const found = await findTool(opaqueId, context.threadId, context.projectId);
    if (!found) throw new ToolNotFoundError(`Tool not found: ${opaqueId}. Search again with tool_gateway_search.`);
    const started = Date.now();
    const argsBytes = Buffer.byteLength(JSON.stringify(args), "utf8");
    try {
      const result = await engine.call(found.serverId, found.name, args, { signal: context.signal });
      const clean = hideResult(found.serverId, result);
      store.log(found.serverId, "call", `${found.name} by ${context.threadId ?? "cli"}: ${Date.now() - started} ms, ${result.isError ? "error" : "ok"}, args ${argsBytes} B, result ${Buffer.byteLength(JSON.stringify(result), "utf8")} B${result.truncated ? " (capped)" : ""}`);
      return clean;
    } catch (error) {
      store.log(found.serverId, "call", `${found.name} by ${context.threadId ?? "cli"}: ${Date.now() - started} ms, error, args ${argsBytes} B: ${hide(errorText(error)).slice(0, 300)}`);
      throw new Error(hide(errorText(error)));
    }
  }

  /** A result never carries the server's own secret values back to an agent. */
  function hideResult(serverId: string, result: CallResult): CallResult {
    return hideFor(serverId, result);
  }

  const toolError = (error: unknown) => ({ content: [{ type: "text" as const, text: hide(errorText(error)) }], isError: true });

  bb.agents.registerTool({
    name: "tool_gateway_search",
    description: "Search the tools of the user's MCP servers (approved in BB Studio's Tool Gateway). Returns compact matches: id, server, tool name and a one-line summary, plus each server's tool count. Next: tool_gateway_describe for input schemas, then tool_gateway_call.",
    parameters: z.object({
      query: z.string().max(500).optional().describe("Words to match in tool names, servers and descriptions; empty lists every tool"),
      server: z.string().max(200).optional().describe("Only this server (its id from a previous result)"),
      limit: z.number().int().min(1).max(200).optional().describe("Default 25"),
      offset: z.number().int().min(0).optional(),
    }),
    presentation: { label: { pending: "Searching MCP tools", completed: "Searched MCP tools" } },
    execute: async (input, ctx) => {
      try {
        const catalog = await catalogFor(ctx.threadId, ctx.projectId);
        const result = searchTools(catalog, { query: input.query, serverId: input.server, limit: input.limit, offset: input.offset });
        return JSON.stringify({ ...result, tools: result.tools.map(({ opaqueId, ...rest }) => ({ id: opaqueId, ...rest })) });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.registerTool({
    name: "tool_gateway_describe",
    description: `Full input (and output) schemas for up to ${MAX_DESCRIBE_TOOLS} tool ids from tool_gateway_search.`,
    parameters: z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_DESCRIBE_TOOLS).describe("Tool ids, tg_…") }),
    presentation: { label: { pending: "Reading MCP tool schemas", completed: "Read MCP tool schemas" } },
    execute: async (input, ctx) => {
      try {
        const catalog = await catalogFor(ctx.threadId, ctx.projectId);
        const { tools, notFound } = describeTools(catalog.filter((tool) => tool.status === "ready"), input.ids);
        return JSON.stringify({
          tools: tools.map((tool) => ({ id: tool.opaqueId, server: tool.serverId, serverLabel: tool.serverLabel, name: tool.name, description: tool.description, inputSchema: tool.inputSchema, ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}), ...(tool.annotations ? { annotations: tool.annotations } : {}) })),
          notFound,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.registerTool({
    name: "tool_gateway_call",
    description: "Run one MCP tool by its id from tool_gateway_search, with arguments that match its input schema (tool_gateway_describe).",
    parameters: z.object({
      id: z.string().min(1).max(64).describe("Tool id, tg_…"),
      args: z.record(z.string(), z.unknown()).optional().describe("Arguments object; {} when the tool takes none"),
    }),
    presentation: { label: { pending: "Running an MCP tool", completed: "Ran an MCP tool" } },
    execute: async (input, ctx) => {
      try {
        const result = await runCall(input.id, (input.args ?? {}) as JsonRecord, { threadId: ctx.threadId, projectId: ctx.projectId, signal: ctx.signal });
        return { content: agentContent(result), ...(result.isError ? { isError: true } : {}) };
      } catch (error) {
        return toolError(error);
      }
    },
  });

  // ── RPCs ──────────────────────────────────────────────────────────────
  const gated = new Set<string>(GATED_METHODS);
  const view = async (id: string) => serverView(store.requireServer(id));
  const handlers: Record<string, (input: never, context?: unknown) => Promise<unknown>> = {
    "toolGateway.snapshot": async (_input: null, context?: unknown) => {
      await engine.refreshMemory().catch(() => {});
      const full = isAppWindow(context);
      return {
        servers: (await Promise.all(store.freshServers().map(serverView))).map((view) => (full ? view : briefServer(view))),
        requests: store.listRequests("pending").map(requestView).map((view) => (full ? view : briefRequest(view))),
        providers: await providerViews(),
        ready: readyServers().length,
        importable: importableCount(),
        problems: secrets.loadProblems(),
      };
    },
    "toolGateway.server": async ({ id }: { id: string }, context?: unknown) => {
      const record = store.requireServer(id);
      const full = isAppWindow(context);
      const known = engine.knownTools(id);
      const approved = new Map((record.approvedTools ?? []).map((tool) => [tool.name, tool.digest]));
      return {
        server: full ? await serverView(record) : briefServer(await serverView(record)),
        tools: known.map((tool) => ({
          name: tool.name,
          description: full ? hide(tool.description ?? "") : "",
          enabled: !record.disabledTools.includes(tool.name),
          inputSchema: full ? (tool.inputSchema ?? {}) as Record<string, unknown> : {},
          added: record.approvedTools !== null && !approved.has(tool.name),
        })),
        removedTools: record.approvedTools ? [...approved.keys()].filter((name) => !known.some((tool) => tool.name === name)) : [],
        log: full ? store.logLines(id, 200) : [],
      };
    },
    "toolGateway.providers": async () => ({ providers: await providerViews() }),
    "toolGateway.whoami": async (_input: null, context?: unknown) => ({ appWindow: isAppWindow(context) }),
    "toolGateway.request": async (input: RequestInput) => requestView(await addRequest(input, { threadId: null, projectId: null })),
    "toolGateway.importPreview": async (_input: null, context?: unknown) => importPreview(isAppWindow(context)),
    "toolGateway.overview": async () => ({
      servers: await Promise.all(store.freshServers().map(async (record) => {
        const server = await serverView(record);
        return { id: server.id, label: server.label, kind: server.kind, status: server.status, enabled: server.enabled, tools: server.tools };
      })),
      requests: store.listRequests("pending").map((request) => ({ id: request.id, label: request.input.label ?? request.input.name, why: request.input.why, createdAt: request.createdAt })),
    }),
    "toolGateway.addServer": async ({ server, requestId }: { server: ServerInput; requestId?: string }) => {
      if (store.getServer(server.id)) throw new ConfigError(`There's already a server called ${server.id}.`);
      const built = buildConfig(server, null);
      const now = Date.now();
      const record = await approveRecord({
        id: server.id, label: server.label, config: built.config, enabled: true, approvedHash: null, approvedAt: null,
        disabledTools: [], projects: null, source: requestId ? "request" : "added", status: "stopped", lastError: null,
        approvedTools: null, createdAt: now, updatedAt: now,
      }, built.secrets);
      store.log(record.id, "event", "added and approved");
      if (requestId) await closeRequest(requestId, "approved");
      return serverView(record);
    },
    "toolGateway.editServer": async ({ server }: { server: ServerInput }) => {
      const current = store.requireServer(server.id);
      // A field that holds the mask came from a masked view: saving it would store ••• as the value.
      if ([server.command, server.cwd, server.url, ...(server.args ?? [])].some(hasMask)) throw new ConfigError(`A field still holds ${MASK}. Open Edit again to load the stored values.`);
      const built = buildConfig(server, secrets.get(server.id));
      await engine.resetServer(server.id);
      // A new address must not get the old one's sign-in.
      if (current.config.url !== built.config.url) await oauthStore.delete(server.id);
      const record = await approveRecord({ ...current, label: server.label, config: built.config, approvedTools: null }, built.secrets);
      store.log(record.id, "event", "edited and approved");
      return serverView(record);
    },
    "toolGateway.approve": async ({ id }: { id: string }) => {
      const current = store.requireServer(id);
      const hashChanged = !approvedNow(current);
      if (hashChanged) await engine.resetServer(id);
      const known = engine.knownTools(id);
      const record = await approveRecord({ ...current, approvedTools: known.length ? known.map((tool) => ({ name: tool.name, digest: toolDigest(tool) })) : null }, secrets.get(id));
      store.log(id, "event", hashChanged ? "approved" : "tool changes accepted");
      return serverView(record);
    },
    "toolGateway.decline": async ({ requestId }: { requestId: string }) => {
      await closeRequest(requestId, "declined");
      return { ok: true as const };
    },
    "toolGateway.setEnabled": async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const record = store.requireServer(id);
      if (!enabled) await engine.closeServer(id);
      store.saveServer({ ...record, enabled });
      store.log(id, "event", enabled ? "switched on" : "switched off");
      return view(id);
    },
    "toolGateway.setToolEnabled": async ({ id, tool, enabled }: { id: string; tool: string; enabled: boolean }) => {
      const record = store.requireServer(id);
      const disabled = new Set(record.disabledTools);
      if (enabled) disabled.delete(tool); else disabled.add(tool);
      store.saveServer({ ...record, disabledTools: [...disabled].sort() });
      return view(id);
    },
    "toolGateway.setScope": async ({ id, projects }: { id: string; projects: string[] | null }) => {
      const record = store.requireServer(id);
      store.saveServer({ ...record, projects: projects === null ? null : [...new Set(projects)].sort() });
      return view(id);
    },
    "toolGateway.remove": async ({ id }: { id: string }) => {
      store.requireServer(id);
      await engine.resetServer(id);
      await secrets.delete(id);
      store.removeServer(id);
      return { ok: true as const };
    },
    "toolGateway.signIn": async ({ id }: { id: string }) => ({ url: await engine.signIn(id) }),
    "toolGateway.finishSignIn": async ({ id, callbackUrl }: { id: string; callbackUrl: string }) => {
      const params = validatePastedCallback(callbackUrl, callbackFor(id));
      await engine.finishSignIn(id, params);
      return view(id);
    },
    "toolGateway.signOut": async ({ id }: { id: string }) => {
      await engine.signOut(id);
      return view(id);
    },
    "toolGateway.testTool": async ({ id, tool, args }: { id: string; tool: string; args: Record<string, unknown> }) => {
      const started = Date.now();
      store.requireServer(id);
      try {
        const result = await engine.call(id, tool, args, {});
        store.log(id, "call", `${tool} by the settings page: ${Date.now() - started} ms, ${result.isError ? "error" : "ok"}`);
        return { ok: !result.isError, result: hideResult(id, result), error: null, ms: Date.now() - started };
      } catch (error) {
        return { ok: false, result: null, error: hide(errorText(error)), ms: Date.now() - started };
      }
    },
    "toolGateway.setProvider": async ({ providerId, access, servers }: { providerId: string } & ProviderAccess) => {
      await store.setProvider(providerId, { access, servers });
      return { providers: await providerViews() };
    },
    "toolGateway.import": async ({ servers }: { servers: { id: string; digest: string }[] }) => {
      const imported: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      try {
        const { rows } = importRows(true);
        for (const { id, digest } of servers) {
          const row = rows.find((candidate) => candidate.candidate.id === id);
          if (!row) { skipped.push({ id, reason: "Not in Agent Plugins' data." }); continue; }
          if (row.candidate.digest !== digest) { skipped.push({ id, reason: "It changed since you reviewed it." }); continue; }
          if (row.candidate.exists || store.getServer(id)) { skipped.push({ id, reason: "Already here." }); continue; }
          // The same checks as Add server: the command is resolved, the URL, folder, names and values checked.
          const problem = checkImportRow(row);
          if (problem) { skipped.push({ id, reason: problem }); continue; }
          const built = buildConfig(serverInputSchema.parse(importInput(row)), null);
          const now = Date.now();
          await approveRecord({
            id, label: row.candidate.label, config: built.config, enabled: row.candidate.wasEnabled, approvedHash: null, approvedAt: null,
            disabledTools: [], projects: null, source: "import", status: "stopped", lastError: null, approvedTools: null, createdAt: now, updatedAt: now,
          }, built.secrets);
          store.log(id, "event", "imported from Agent Plugins and approved");
          imported.push(id);
        }
      } finally {
        await deleteStagedImport();
      }
      return { imported, skipped };
    },
    "toolGateway.discardImport": async () => {
      await deleteStagedImport();
      return { ok: true as const };
    },
    "toolGateway.removeOldPlugin": async () => {
      await bb.sdk.plugins.remove({ pluginId: OLD_PLUGIN_ID });
      // Its database holds the values in plain text; they are in the secret store now.
      for (const suffix of ["", "-wal", "-shm"]) await rm(`${oldPluginDatabase(options.dataDir)}${suffix}`, { force: true });
      importCache = null;
      return { ok: true as const };
    },
    "toolGateway.serverConfig": async ({ id }: { id: string }) => {
      const { config } = store.requireServer(id);
      return { command: config.command, args: config.args, cwd: config.cwd, url: config.url };
    },
  };
  for (const name of Object.keys(handlers)) {
    if (!gated.has(name)) continue;
    const inner = handlers[name]!;
    handlers[name] = async (input: never, context?: unknown) => {
      requireAppWindow(context);
      return inner(input, context);
    };
  }
  bb.rpc.register({ ...toolGatewayContract, ...toolGatewayPublicContract }, handlers as never);

  // The provider's redirect has no BB session. OAuth state and PKCE, not route auth, authorize this one-use callback.
  bb.http.route("GET", OAUTH_CALLBACK_PATH, async (context: { req: { url: string } }) => {
    const url = new URL(context.req.url);
    const serverId = url.searchParams.get("serverId");
    const page = (text: string, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><p>${text}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
    if (!serverId || !store.getServer(serverId)) return page("Unknown server.", 400);
    try {
      await engine.finishSignIn(serverId, url.searchParams);
      return page("Signed in. You can close this window.");
    } catch (error) {
      bb.log.warn(`Tool Gateway: sign-in to ${serverId} failed: ${hide(errorText(error))}`);
      return page("Sign-in failed. Go back to BB Studio and try again.", 400);
    }
  }, { auth: "none" } as never);

  // ── CLI ───────────────────────────────────────────────────────────────
  const USAGE = [
    "bb studio tool-gateway <list|tools|describe|call|request|status> …",
    "  list                                  servers and their status",
    "  status                                how many servers are ready, and pending requests",
    "  tools [query…] [--server <id>]        search tools",
    "  describe <tool id>…                   input schemas",
    "  call <tool id> [--args <json>]         run a tool",
    "  request --name <id> (--command <cmd> [--arg <a>]… | --url <url>) [--env <NAME>]… [--header <Name>]… --why <text>",
    "                                        ask the user to add a server (approved only in the BB Studio app)",
    "  Add --json for JSON.",
  ].join("\n");

  function parse(argv: readonly string[], repeated: readonly string[], single: readonly string[]): { ok: true; positional: string[]; values: Map<string, string[]>; json: boolean } | { ok: false; error: string } {
    const positional: string[] = [];
    const values = new Map<string, string[]>();
    let json = false;
    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index]!;
      if (arg === "--json") { json = true; continue; }
      if (!arg.startsWith("--")) { positional.push(arg); continue; }
      const name = arg.slice(2);
      if (!repeated.includes(name) && !single.includes(name)) return { ok: false, error: `Unknown option ${arg}.` };
      const value = argv[index + 1];
      if (value === undefined) return { ok: false, error: `${arg} needs a value.` };
      if (single.includes(name) && values.has(name)) return { ok: false, error: `${arg} was given twice.` };
      values.set(name, [...(values.get(name) ?? []), value]);
      index++;
    }
    return { ok: true, positional, values, json };
  }

  async function cli(argv: readonly string[], ctx: { threadId?: string | null; projectId?: string | null }): Promise<CliResult> {
    const [command, ...rest] = argv;
    const usage = (): CliResult => ({ exitCode: 2, stderr: `${USAGE}\n` });
    const threadId = ctx.threadId ?? null;
    let projectId = ctx.projectId ?? null;
    if (threadId && !projectId) {
      try { projectId = ((await bb.sdk.threads.get({ threadId })) as { projectId?: string } | null)?.projectId ?? null; } catch { /* No project: unscoped servers only. */ }
    }
    try {
      switch (command) {
        case "list": {
          const parsed = parse(rest, [], []);
          if (!parsed.ok) return { exitCode: 2, stderr: `${parsed.error}\n` };
          const servers = await Promise.all(store.listServers().map(serverView));
          if (parsed.json) return { exitCode: 0, stdout: `${JSON.stringify(servers.map(({ id, label, kind, status, enabled, tools }) => ({ id, label, kind, status, enabled, tools })), null, 2)}\n` };
          return { exitCode: 0, stdout: servers.length ? `${servers.map((server) => `${server.id}\t${server.label}\t${server.kind}\t${server.status}\t${server.tools} tools`).join("\n")}\n` : "No servers.\n" };
        }
        case "status": {
          const ready = readyServers().length;
          const pending = store.listRequests("pending");
          return { exitCode: 0, stdout: `${ready} ready, ${store.listServers().length} servers, ${pending.length} pending requests\n` };
        }
        case "tools": {
          const parsed = parse(rest, [], ["server", "limit"]);
          if (!parsed.ok) return { exitCode: 2, stderr: `${parsed.error}\n` };
          const result = searchTools(await catalogFor(threadId, projectId), { query: parsed.positional.join(" "), serverId: parsed.values.get("server")?.[0], limit: Number(parsed.values.get("limit")?.[0] ?? 25) });
          if (parsed.json) return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
          return { exitCode: 0, stdout: `${result.tools.map((tool) => `${tool.opaqueId}\t${tool.serverId}\t${tool.name}\t${tool.summary}`).join("\n") || "No tools."}\n` };
        }
        case "describe": {
          const parsed = parse(rest, [], []);
          if (!parsed.ok || (parsed.ok && parsed.positional.length === 0)) return usage();
          const result = describeTools(await catalogFor(threadId, projectId), parsed.positional.slice(0, MAX_DESCRIBE_TOOLS));
          return { exitCode: result.tools.length ? 0 : 1, stdout: `${JSON.stringify(result, null, 2)}\n` };
        }
        case "call": {
          const parsed = parse(rest, [], ["args"]);
          if (!parsed.ok) return { exitCode: 2, stderr: `${parsed.error}\n` };
          const id = parsed.positional[0];
          if (!id || parsed.positional.length !== 1) return usage();
          let args: JsonRecord = {};
          const raw = parsed.values.get("args")?.[0];
          if (raw !== undefined) {
            try { args = JSON.parse(raw) as JsonRecord; } catch { return { exitCode: 2, stderr: "--args must be a JSON object.\n" }; }
          }
          const result = await runCall(id, args, { threadId, projectId });
          return { exitCode: result.isError ? 1 : 0, stdout: `${JSON.stringify(capResult(result, 1024 * 1024), null, 2)}\n` };
        }
        case "request": {
          const parsed = parse(rest, ["arg", "env", "header"], ["name", "label", "command", "url", "why", "kind"]);
          if (!parsed.ok) return { exitCode: 2, stderr: `${parsed.error}\n` };
          const one = (name: string) => parsed.values.get(name)?.[0];
          const input = {
            name: one("name"), label: one("label"), command: one("command"), args: parsed.values.get("arg"), url: one("url"),
            kind: one("kind") ?? (one("url") ? "streamable-http" : "stdio"),
            envNames: parsed.values.get("env"), headerNames: parsed.values.get("header"), why: one("why"),
          };
          if (!input.name || !input.why || (!input.command && !input.url)) return usage();
          const request = await addRequest(toolGatewayContract["toolGateway.request"].input.parse(input), { threadId, projectId });
          const text = `Asked the user to approve ${request.input.label ?? request.input.name} (${request.id}). Only the user can approve it, in the BB Studio app; until then its tools aren't available.`;
          return { exitCode: 0, stdout: `${parsed.json ? JSON.stringify(requestView(request), null, 2) : text}\n` };
        }
        default:
          return usage();
      }
    } catch (error) {
      return { exitCode: 1, stderr: `${hide(errorText(error))}\n` };
    }
  }

  return {
    secretValues: () => secrets.values(),
    agentConfiguration: ({ providerId, projectId }) => {
      // A Tool Gateway failure only hides its own tools; it never breaks the session or Studio's other tools.
      try {
        return visibleServers(providerId, projectId).length > 0 ? { tools: [...TOOL_GATEWAY_TOOLS], instructions: TOOL_GATEWAY_INSTRUCTIONS } : { tools: [], instructions: "" };
      } catch (error) {
        if (!configureFailureLogged) {
          configureFailureLogged = true;
          bb.log.warn(`Tool Gateway: its tools are hidden from agents because it failed: ${hide(errorText(error))}`);
        }
        return { tools: [], instructions: "" };
      }
    },
    cli,
    store,
    engine,
    handlers,
    ready: async () => { await oauthStore.flush().catch(() => {}); },
    dispose: async () => {
      disposed = true;
      if (publishTimer) clearTimeout(publishTimer);
      await engine.close();
    },
  };
}
