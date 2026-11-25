// Tool Gateway's host worker: a separate process, apart from Studio's server,
// that runs each stdio MCP server with one MCP client per server. Ported from
// Agent Plugins' host.ts, tools only. Studio's server picks the command, the
// working folder and the environment (src/tool-gateway/server/config.ts); this
// process only runs what it is given.
import { execFile } from "node:child_process";
import { experimental_defineHostEntry, type ExperimentalHostRpcContext } from "@get-bb/plugin-sdk/host";
import { Client, type Tool } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { toolGatewayHostContract, toolGatewayHostSignals, type HostCatalog } from "./src/tool-gateway/host-contract";
import { capResult } from "./src/tool-gateway/cap";

const CONNECT_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 2_000;
const MCP_CLIENT_INFO = { name: "bb-studio-tool-gateway", version: "1.0.0" };
/** The longest message a server may send, a few MB over the result cap. */
const MAX_BUFFER = 8 * 1024 * 1024;

type Context = ExperimentalHostRpcContext<typeof toolGatewayHostSignals>;
type HostConnection = {
  key: string;
  client: Client;
  transport: StdioClientTransport;
  catalog: HostCatalog;
  expectedClose: boolean;
  lease: { dispose(): Promise<void> };
};

const connections = new Map<string, HostConnection>();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item));
}

function cancelled(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Tool Gateway host request cancelled");
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal, onAbort: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort();
    return Promise.reject(cancelled(signal));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      onAbort();
      reject(cancelled(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then((value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      reject(error);
    });
  });
}

async function closeConnection(connection: HostConnection): Promise<void> {
  connection.expectedClose = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      connection.client.close(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("MCP stdio close timed out")), CLOSE_TIMEOUT_MS); }),
    ]);
  } catch {
    // The daemon owns this worker. If a close stalls, returning lets the
    // worker supervisor reap the process and its child.
  } finally {
    if (timer) clearTimeout(timer);
    await connection.lease.dispose().catch(() => {});
  }
}

async function refresh(connection: HostConnection, signal: AbortSignal): Promise<HostCatalog> {
  if (signal.aborted) throw cancelled(signal);
  let tools: Tool[] = [];
  try {
    tools = (await connection.client.listTools(undefined, { signal, timeout: LIST_TIMEOUT_MS, cacheMode: "refresh" })).tools;
  } catch (error) {
    // A server with no tools capability answers METHOD_NOT_FOUND.
    if (!/method not found/i.test(errorText(error)) && (error as { code?: unknown }).code !== -32601) throw error;
  }
  connection.catalog = { tools: records(tools) };
  return connection.catalog;
}

async function start(input: { key: string; command: string; args: string[]; cwd: string; env: Record<string, string> }, context: Context): Promise<HostCatalog> {
  if (context.signal.aborted) throw cancelled(context.signal);
  // A start always runs what it is given: an old process under the same key
  // (a close that failed, a worker that outlived a Studio reload) is replaced.
  const existing = connections.get(input.key);
  if (existing) {
    connections.delete(input.key);
    await closeConnection(existing);
  }
  const lease = context.experimental_retainWorker();
  const client = new Client(MCP_CLIENT_INFO, {
    capabilities: {},
    versionNegotiation: { mode: "auto" },
    listChanged: {
      tools: { autoRefresh: true, onChanged: (error) => void context.experimental_emitSignal("catalogChanged", { key: input.key, error: error ? errorText(error) : null }).catch(() => {}) },
    },
  });
  const transport = new StdioClientTransport({ command: input.command, args: input.args, cwd: input.cwd, env: input.env, stderr: "pipe", maxBufferSize: MAX_BUFFER });
  let pending = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    if (pending.length > 8000) { lines.push(pending); pending = ""; }
    for (const line of lines) {
      const text = line.trim();
      if (text) void context.experimental_emitSignal("stderr", { key: input.key, line: text.slice(0, 2000) }).catch(() => {});
    }
  });
  const connection: HostConnection = { key: input.key, client, transport, catalog: { tools: [] }, expectedClose: false, lease };
  connections.set(input.key, connection);
  transport.onclose = () => {
    if (connection.expectedClose || connections.get(input.key) !== connection) return;
    connections.delete(input.key);
    void context.experimental_emitSignal("connectionChanged", { key: input.key, status: "closed", error: "The server stopped." }).catch(() => {});
    void lease.dispose().catch(() => {});
  };
  transport.onerror = (error) => {
    if (connection.expectedClose || connections.get(input.key) !== connection) return;
    void context.experimental_emitSignal("connectionChanged", { key: input.key, status: "error", error: errorText(error) }).catch(() => {});
  };
  try {
    await abortable(client.connect(transport, { signal: context.signal, timeout: CONNECT_TIMEOUT_MS }), context.signal, () => { void client.close().catch(() => {}); });
    return await refresh(connection, context.signal);
  } catch (error) {
    if (connections.get(input.key) === connection) connections.delete(input.key);
    await closeConnection(connection);
    throw new Error(errorText(error));
  }
}

function connectionFor(key: string): HostConnection {
  const connection = connections.get(key);
  if (!connection) throw new Error(`MCP stdio connection not found: ${key}`);
  return connection;
}

function rssOf(pids: number[]): Promise<Map<number, number>> {
  if (pids.length === 0) return Promise.resolve(new Map());
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-o", "pid=,rss=", "-p", pids.join(",")], { timeout: 5000 }, (error, stdout) => {
      const out = new Map<number, number>();
      if (!error) {
        for (const line of stdout.split("\n")) {
          const [pid, rss] = line.trim().split(/\s+/u).map(Number);
          if (pid && Number.isFinite(rss)) out.set(pid, rss! * 1024);
        }
      }
      resolve(out);
    });
  });
}

/** The handlers, exported for tests. */
export const hostHandlers = {
    start: (input: Parameters<typeof start>[0], context: Context) => start(input, context),
    refresh: async ({ key }: { key: string }, context: Context) => refresh(connectionFor(key), context.signal),
    close: async ({ key }: { key: string }) => {
      const connection = connections.get(key);
      if (!connection) return { closed: false };
      connections.delete(key);
      await closeConnection(connection);
      return { closed: true };
    },
    callTool: async ({ key, name, args, toolDefinition, timeoutMs, maxBytes }: { key: string; name: string; args: Record<string, unknown>; toolDefinition?: Record<string, unknown>; timeoutMs: number; maxBytes: number }, context: Context) => {
      const connection = connectionFor(key);
      const result = await connection.client.callTool(
        { name, arguments: args },
        { signal: context.signal, timeout: timeoutMs, ...(toolDefinition ? { toolDefinition: toolDefinition as Tool } : {}) },
      );
      // Cut here, so a huge result never crosses to Studio's server whole.
      return capResult(result, maxBytes) as unknown as Record<string, unknown>;
    },
    stats: async () => {
      const entries = [...connections.values()].map((connection) => ({ key: connection.key, pid: connection.transport.pid ?? null }));
      const rss = await rssOf(entries.flatMap((entry) => (entry.pid ? [entry.pid] : [])));
      return { servers: entries.map((entry) => ({ key: entry.key, pid: entry.pid, rssBytes: entry.pid ? rss.get(entry.pid) ?? null : null })) };
    },
};

export async function closeAllForTests(): Promise<void> {
  const values = [...connections.values()];
  connections.clear();
  await Promise.all(values.map((connection) => closeConnection(connection)));
}

export default experimental_defineHostEntry({
  contract: toolGatewayHostContract,
  experimental_signals: toolGatewayHostSignals,
  handlers: hostHandlers,
  dispose: async () => {
    const values = [...connections.values()];
    connections.clear();
    await Promise.all(values.map((connection) => closeConnection(connection)));
  },
});
