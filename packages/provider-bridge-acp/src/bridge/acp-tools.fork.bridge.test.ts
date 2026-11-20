// End to end through the real bridge and the repo's fake ACP agent: which BB
// tools an ACP session offers, what reaches the agent in session/new, and the
// checks BB runs before it relays a call. See acp-tools.fork.ts.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DynamicTool } from "@bb/domain";
import {
  killProcessesReferencingPath,
  trackChildProcesses,
  type ChildProcessTracker,
} from "@bb/test-helpers";
import {
  assembleCapturedThreadEvents,
  captureBridgeJsonRpcOutput,
  type BridgeJsonRpcOutputMessage,
  type CapturedBridgeJsonRpcOutput,
} from "@bb/provider-bridge-protocol/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleLine } from "./bridge.js";
import { ACP_BRIDGE_MCP_SERVER_NAME } from "./tool-proxy-mcp.js";

const FAKE_AGENT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fake-acp-agent.mjs",
);
const FAKE_SECRET = "fake-secret-value-6d1f";

let output: CapturedBridgeJsonRpcOutput;
let children: ChildProcessTracker;
let workspaceDir: string;
let nextId = 9_000;
let serial = 0;
const started: { threadId: string; providerThreadId: string }[] = [];

function send(method: string, params: object): number {
  nextId += 1;
  handleLine(JSON.stringify({ jsonrpc: "2.0", id: nextId, method, params }));
  return nextId;
}

async function waitFor<T>(
  get: () => T | undefined,
  what: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = get();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function response(id: number): Promise<BridgeJsonRpcOutputMessage> {
  return waitFor(
    () => output.messages.find((m) => m.id === id && m.method === undefined),
    `response ${id}`,
  );
}

const TOOLS: DynamicTool[] = [
  {
    name: "pages_read",
    description: "Read a page.",
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        pattern: { type: "string", maxLength: 8 },
        format: { enum: ["md", "html"] },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_plugins_call",
    description:
      "Call one Agent Plugin MCP tool by opaque ID through the static bridge.",
    inputSchema: {
      type: "object",
      properties: {
        opaqueId: { type: "string", minLength: 1 },
        args: { type: "object" },
      },
      required: ["opaqueId"],
      additionalProperties: false,
    },
  },
];

async function startThread(
  providerOptions: Record<string, unknown>,
): Promise<{ threadId: string; providerThreadId: string }> {
  serial += 1;
  const threadId = `fork-tools-thread-${serial}`;
  const id = send("thread/start", {
    threadId,
    cwd: workspaceDir,
    instructionMode: "append",
    options: {
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
      providerOptions: {
        acpLaunchSpec: {
          displayName: "Fake ACP",
          command: process.execPath,
          args: [FAKE_AGENT_PATH],
          env: {},
        },
        ...providerOptions,
      },
    },
    dynamicTools: TOOLS,
  });
  const res = await response(id);
  if (res.error) throw new Error(`thread/start failed: ${res.error.message}`);
  const providerThreadId = (res.result as { providerThreadId: string })
    .providerThreadId;
  started.push({ threadId, providerThreadId });
  return { threadId, providerThreadId };
}

type McpServerConfig = {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
};

function agentText(): string {
  return (
    assembleCapturedThreadEvents(output.messages, "acp") as unknown as Record<
      string,
      unknown
    >[]
  )
    .filter((event) => event.type === "item/agentMessage/delta")
    .map((event) => String(event.delta ?? ""))
    .join("");
}

async function sessionMcpServers(
  threadId: string,
  providerThreadId: string,
): Promise<McpServerConfig[]> {
  const reportsBefore = agentText().split("mcp-server-config:").length;
  send("turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_abcdefghjk",
    input: [{ type: "text", text: "echo-mcp-server-config", mentions: [] }],
    options: {
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    },
  });
  const prefix = "mcp-server-config:";
  const json = await waitFor(() => {
    const text = agentText();
    if (text.split(prefix).length <= reportsBefore) return undefined;
    const start = text.lastIndexOf(prefix);
    try {
      return JSON.parse(text.slice(start + prefix.length)) as McpServerConfig[];
    } catch {
      return undefined;
    }
  }, "the fake agent's MCP server report");
  return json;
}

function callBridge(
  server: McpServerConfig,
  tool: string,
  args: Record<string, unknown>,
  threadIdOverride?: string,
): Promise<{ ok: boolean; error?: string }> {
  const env = new Map(server.env.map(({ name, value }) => [name, value]));
  return new Promise((resolveCall, reject) => {
    const socket = createConnection({
      host: env.get("BB_ACP_DYNAMIC_TOOL_HOST")!,
      port: Number(env.get("BB_ACP_DYNAMIC_TOOL_PORT")),
    });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          kind: "toolCall",
          arguments: args,
          callId: `fork-call-${tool}`,
          threadId:
            threadIdOverride ?? env.get("BB_ACP_DYNAMIC_TOOL_THREAD_ID"),
          token: env.get("BB_ACP_DYNAMIC_TOOL_TOKEN"),
          tool,
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end === -1) return;
      socket.end();
      resolveCall(
        JSON.parse(buffer.slice(0, end)) as { ok: boolean; error?: string },
      );
    });
    socket.on("error", reject);
  });
}

function toolNamesIn(server: McpServerConfig): string[] {
  const file = server.env.find(
    ({ name }) => name === "BB_ACP_DYNAMIC_TOOLS_FILE",
  )?.value;
  if (!file) throw new Error("no tools file");
  return (JSON.parse(readFileSync(file, "utf8")) as DynamicTool[]).map(
    (t) => t.name,
  );
}

beforeEach(() => {
  children = trackChildProcesses();
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-fork-tools-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  for (const { threadId, providerThreadId } of started.splice(0)) {
    await response(
      send("thread/stop", {
        threadId,
        providerThreadId,
        intent: "interrupt",
        activeTurnId: null,
      }),
    );
  }
  children.dispose();
  delete process.env.FAKE_MCP_SECRET;
  output.restore();
  await killProcessesReferencingPath(workspaceDir);
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("ACP agent tools (fork)", () => {
  it("sends the agent only bb-bridge, with no server command, env or secret", async () => {
    process.env.FAKE_MCP_SECRET = FAKE_SECRET;
    const { threadId, providerThreadId } = await startThread({});
    const servers = await sessionMcpServers(threadId, providerThreadId);
    expect(servers.map((s) => s.name)).toEqual([ACP_BRIDGE_MCP_SERVER_NAME]);
    expect(servers[0]?.env.map((e) => e.name).sort()).toEqual(
      expect.arrayContaining([
        "BB_ACP_DYNAMIC_TOOLS_FILE",
        "BB_ACP_DYNAMIC_TOOL_HOST",
        "BB_ACP_DYNAMIC_TOOL_PORT",
        "BB_ACP_DYNAMIC_TOOL_THREAD_ID",
        "BB_ACP_DYNAMIC_TOOL_TOKEN",
      ]),
    );
    expect(
      servers[0]?.env.every(
        (e) =>
          e.name.startsWith("BB_ACP_") || e.name === "ELECTRON_RUN_AS_NODE",
      ),
    ).toBe(true);
    expect(JSON.stringify(servers)).not.toContain(FAKE_SECRET);
  });

  it("refuses a tool the session wasn't offered, even with the bridge token", async () => {
    const { threadId, providerThreadId } = await startThread({});
    const [server] = await sessionMcpServers(threadId, providerThreadId);
    expect(toolNamesIn(server!)).toEqual(["pages_read", "agent_plugins_call"]);
    const before = output.messages.filter(
      (m) => m.method === "item/tool/call",
    ).length;
    // The agent holds the bridge token, so it could ask for any tool by name.
    await expect(
      callBridge(server!, "tool_gateway_call", { opaqueId: "x" }),
    ).resolves.toEqual({
      ok: false,
      error: 'Tool "tool_gateway_call" is not available in this session.',
    });
    expect(
      output.messages.filter((m) => m.method === "item/tool/call"),
    ).toHaveLength(before);
  });

  it("relays a tool the session was offered", async () => {
    const { threadId, providerThreadId } = await startThread({});
    const [server] = await sessionMcpServers(threadId, providerThreadId);
    expect(toolNamesIn(server!)).toEqual(["pages_read", "agent_plugins_call"]);
    void callBridge(server!, "agent_plugins_call", {
      opaqueId: "op_1",
      args: { q: "hi" },
    });
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (m) => m.method === "item/tool/call" && m.id !== undefined,
        ),
      "relayed tool call",
    );
    expect(forwarded.params).toMatchObject({
      tool: "agent_plugins_call",
      arguments: { opaqueId: "op_1", args: { q: "hi" } },
    });
  });

  it("relays arguments as sent and leaves them to the tool, as upstream does", async () => {
    const { threadId, providerThreadId } = await startThread({});
    const [server] = await sessionMcpServers(threadId, providerThreadId);
    void callBridge(server!, "pages_read", {
      pattern: "much-too-long",
      n: "5",
    });
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (m) => m.method === "item/tool/call" && m.id !== undefined,
        ),
      "relayed tool call",
    );
    expect(forwarded.params).toMatchObject({
      tool: "pages_read",
      arguments: { pattern: "much-too-long", n: "5" },
    });
  });

  it("refuses a call aimed at another thread of the same agent", async () => {
    const a = await startThread({});
    const b = await startThread({});
    const [serverA] = await sessionMcpServers(a.threadId, a.providerThreadId);
    const [serverB] = await sessionMcpServers(b.threadId, b.providerThreadId);
    const tokenOf = (server: McpServerConfig) =>
      server.env.find(({ name }) => name === "BB_ACP_DYNAMIC_TOOL_TOKEN")!
        .value;
    // Both threads share one bridge process, but each gets its own token.
    expect(tokenOf(serverA!)).not.toBe(tokenOf(serverB!));
    const before = output.messages.filter(
      (m) => m.method === "item/tool/call",
    ).length;
    await expect(
      callBridge(serverA!, "pages_read", { pattern: "a" }, b.threadId),
    ).resolves.toEqual({ ok: false, error: "Invalid dynamic tool request" });
    expect(
      output.messages.filter((m) => m.method === "item/tool/call"),
    ).toHaveLength(before);
  });
});
