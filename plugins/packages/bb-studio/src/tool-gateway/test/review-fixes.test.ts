// The fixes from the Tool Gateway review (20 Nov), one block per finding.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GATED_METHODS, MAX_CALL_TIMEOUT_MS, READ_METHODS, toolGatewayContract, toolGatewayPublicContract } from "../contract";
import { configHash, looksSecret, redactDeep } from "../server/config";
import { MAX_PENDING_REQUESTS } from "../server/register";
import { closeAllForTests, hostHandlers } from "../../../tool-gateway-host";
import { CLIENT, FAKE_SECRET, FIXTURE, harness, json, stdioServer, text, type Harness } from "./harness";

const STRUCTURED = fileURLToPath(new URL("./structured-server.mjs", import.meta.url));
let h: Harness | null = null;
afterEach(async () => { await h?.close(); h = null; });

const secretsDir = (h: Harness) => join(h.dataDir, "plugins", "studio", "secrets", "tool-gateway");

async function idOf(h: Harness, server: string, name: string, threadId = "thr_claude"): Promise<string> {
  const found = json(await h.agent("tool_gateway_search", { server, limit: 50 }, threadId));
  const tool = found.tools.find((each: { name: string }) => each.name === name);
  if (!tool) throw new Error(`no ${name}`);
  return tool.id;
}

describe("1. masking hides secrets only, string by string", () => {
  it("keeps ordinary env values (READ_ONLY=true, LOG_LEVEL=info) out of the mask, so results stay whole", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: { id: "s", label: "S", kind: "stdio", command: process.execPath, args: [STRUCTURED], env: { READ_ONLY: "true", LOG_LEVEL: "info", PORT: "8080" } } });
    await h.rpc("toolGateway.addServer", { server: stdioServer("other") });
    const result = await h.agent("tool_gateway_call", { id: await idOf(h, "s", "status"), args: {} });
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe("ok: info");
    const tested = await h.rpc("toolGateway.testTool", { id: "s", tool: "status", args: {} });
    expect(tested.result.structuredContent).toEqual({ ok: true, level: "info" });
  });

  it("masks a secret with quotes and backslashes, keys and structure untouched", async () => {
    const secret = 'sk-"quoted\\value-12345';
    expect(looksSecret(secret)).toBe(true);
    expect(redactDeep({ text: `a ${secret} b`, type: "text", nested: [{ value: secret }] }, [secret])).toEqual({ text: "a ••• b", type: "text", nested: [{ value: "•••" }] });
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("q", { env: { FAKE_TOKEN: secret } }) });
    const result = await h.agent("tool_gateway_call", { id: await idOf(h, "q", "leak"), args: {} });
    expect(text(result)).toBe("the token is •••");
  });

  it("masks a server's own values in its results, not every server's", async () => {
    h = await harness();
    // Server a's value is the word server b answers with.
    await h.rpc("toolGateway.addServer", { server: { id: "a", label: "A", kind: "stdio", command: process.execPath, args: [STRUCTURED], env: { TOKEN: "Xy9-unique-value-42" } } });
    await h.rpc("toolGateway.addServer", { server: stdioServer("b", { env: { FAKE_TOKEN: "Xy9-unique-value-42" } }) });
    expect(text(await h.agent("tool_gateway_call", { id: await idOf(h, "b", "leak"), args: {} }))).toBe("the token is •••");
  });
});

describe("2. an edit never writes the mask back", () => {
  it("loads the stored values for the form (app window only) and refuses a field that still holds •••", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one", { args: [FIXTURE, `--key=${FAKE_SECRET}`] }) });
    const view = (await h.rpc("toolGateway.snapshot", null)).servers[0];
    expect(view.args[1]).toBe("--key=•••");
    await expect(h.rpc("toolGateway.serverConfig", { id: "one" }, CLIENT)).rejects.toMatchObject({ code: "forbidden" });
    const stored = await h.rpc("toolGateway.serverConfig", { id: "one" });
    expect(stored.args).toEqual([FIXTURE, `--key=${FAKE_SECRET}`]);
    await expect(h.rpc("toolGateway.editServer", { server: stdioServer("one", { args: view.args, env: { FAKE_TOKEN: null }, callTimeoutMs: 30_000 }) })).rejects.toThrow(/still holds •••/);
    await h.rpc("toolGateway.editServer", { server: stdioServer("one", { args: stored.args, env: { FAKE_TOKEN: null }, callTimeoutMs: 30_000 }) });
    expect((await h.rpc("toolGateway.serverConfig", { id: "one" })).args).toEqual([FIXTURE, `--key=${FAKE_SECRET}`]);
  });
});

describe("5. ACP agents are on by default (Patrick, 20 Nov)", () => {
  it("offers the tools to an ACP agent with no setting, and its switch turns them off", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    expect(h.gateway.agentConfiguration({ providerId: "acp-hermes", projectId: "prj_a" }).tools).toHaveLength(3);
    await h.rpc("toolGateway.setProvider", { providerId: "acp-hermes", access: false, servers: "all" });
    expect(h.gateway.agentConfiguration({ providerId: "acp-hermes", projectId: "prj_a" }).tools).toEqual([]);
  });
});

describe("6 and 11. the host worker", () => {
  const context = () => ({ signal: new AbortController().signal, experimental_retainWorker: () => ({ dispose: async () => {} }), experimental_emitSignal: async () => {} }) as never;
  afterEach(async () => { await closeAllForTests(); });

  it("starts what it is given, replacing an old process under the same key", async () => {
    const base = { key: "srv", command: process.execPath, args: [FIXTURE], cwd: process.cwd() };
    await hostHandlers.start({ ...base, env: { PATH: process.env.PATH ?? "", OLD_VALUE: "1" } }, context());
    const names = async () => JSON.parse(((await hostHandlers.callTool({ key: "srv", name: "env", args: {}, timeoutMs: 10_000, maxBytes: 1024 * 1024 }, context())) as { content: { text: string }[] }).content[0]!.text).names as string[];
    expect(await names()).toContain("OLD_VALUE");
    await hostHandlers.start({ ...base, env: { PATH: process.env.PATH ?? "", NEW_VALUE: "1" } }, context());
    const after = await names();
    expect(after).toContain("NEW_VALUE");
    expect(after).not.toContain("OLD_VALUE");
  });

  it("cuts a large result before it leaves the worker", async () => {
    await hostHandlers.start({ key: "big", command: process.execPath, args: [FIXTURE], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } }, context());
    const result = await hostHandlers.callTool({ key: "big", name: "big", args: { bytes: 3_000_000 }, timeoutMs: 20_000, maxBytes: 64 * 1024 }, context()) as { content: { text: string }[]; truncated?: boolean };
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(70 * 1024);
  }, 30_000);
});

describe("7. a new URL drops the old sign-in", () => {
  it("clears the server's OAuth tokens when its URL changes, and keeps them otherwise", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: { id: "mail", label: "Mail", kind: "streamable-http", url: "https://one.example.test/mcp" } });
    writeFileSync(join(secretsDir(h), "oauth.json"), JSON.stringify({ mail: { tokens: { access_token: "old-access-token-1234", token_type: "Bearer" } } }));
    await h.restart();
    await h.rpc("toolGateway.editServer", { server: { id: "mail", label: "Mail 2", kind: "streamable-http", url: "https://one.example.test/mcp" } });
    expect(JSON.parse(readFileSync(join(secretsDir(h), "oauth.json"), "utf8"))).toHaveProperty("mail");
    await h.rpc("toolGateway.editServer", { server: { id: "mail", label: "Mail", kind: "streamable-http", url: "https://two.example.test/mcp" } });
    expect(JSON.parse(readFileSync(join(secretsDir(h), "oauth.json"), "utf8"))).not.toHaveProperty("mail");
  });
});

describe("8. the approval hash is keyed", () => {
  it("keeps the key in the secrets folder (0600) and refuses a hash made without it", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const keyFile = join(secretsDir(h), "approval.key");
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    const row = h.db.prepare("SELECT record FROM tool_gateway_servers WHERE id = 'one'").get() as { record: string };
    const record = JSON.parse(row.record);
    const values = JSON.parse(readFileSync(join(secretsDir(h), "servers.json"), "utf8")).one;
    expect(record.approvedHash).toBe(configHash(record.config, values, readFileSync(keyFile, "utf8")));
    // A database edit with a hash anyone could compute doesn't count as an approval.
    record.config.args = [...record.config.args, "--changed"];
    record.approvedHash = configHash(record.config, values, "guessed-key");
    h.db.prepare("UPDATE tool_gateway_servers SET record = ? WHERE id = 'one'").run(JSON.stringify(record));
    expect((await h.rpc("toolGateway.snapshot", null)).servers[0]).toMatchObject({ approved: false, status: "needs-approval" });
    expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_a" }).tools).toEqual([]);
  });
});

describe("9. the CLI without a thread", () => {
  it("reaches only servers every provider may use", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    await h.rpc("toolGateway.addServer", { server: stdioServer("two") });
    const servers = async () => new Set(JSON.parse((await h!.gateway.cli(["tools", "--json", "--limit", "100"], {})).stdout!).tools.map((tool: { serverId: string }) => tool.serverId));
    expect([...(await servers())].sort()).toEqual(["one", "two"]);
    await h.rpc("toolGateway.setProvider", { providerId: "codex", access: true, servers: ["one"] });
    expect([...(await servers())]).toEqual(["one"]);
    await h.rpc("toolGateway.setProvider", { providerId: "acp-hermes", access: false, servers: "all" });
    expect([...(await servers())]).toEqual([]);
    const call = await h.gateway.cli(["call", (await import("../server/engine")).opaqueToolId("one", "count"), "--args", "{}"], {});
    expect(call.exitCode).toBe(1);
    expect(call.stderr).toMatch(/not found/i);
    // A thread still gets what its provider may use.
    expect(JSON.parse((await h.gateway.cli(["tools", "--json"], { threadId: "thr_claude" })).stdout!).tools.length).toBeGreaterThan(0);
  });
});

describe("10. reads without the app window", () => {
  it("show names, kinds and status only: no command, args, folder, URL or log", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one", { cwd: h.dataDir }) });
    await h.rpc("toolGateway.addServer", { server: { id: "web", label: "Web", kind: "streamable-http", url: "https://web.example.test/mcp" } });
    await h.agent("tool_gateway_call", { id: await idOf(h, "one", "count"), args: {} });
    await h.rpc("toolGateway.request", { name: "asked", command: "asked-mcp", args: ["--x"], why: "Test" }, CLIENT);
    const brief = await h.rpc("toolGateway.snapshot", null, CLIENT);
    for (const server of brief.servers) expect(server).toMatchObject({ command: null, args: [], cwd: null, url: null });
    expect(brief.servers.map((server: { id: string; kind: string; status: string }) => [server.id, server.kind])).toEqual([["one", "stdio"], ["web", "streamable-http"]]);
    expect(brief.requests[0]).toMatchObject({ name: "asked", command: null, args: [], url: null });
    const detail = await h.rpc("toolGateway.server", { id: "one" }, CLIENT);
    expect(detail.log).toEqual([]);
    expect(detail.server).toMatchObject({ command: null, args: [], cwd: null });
    expect(detail.tools.every((tool: { description: string; inputSchema: object }) => tool.description === "" && Object.keys(tool.inputSchema).length === 0)).toBe(true);
    const full = await h.rpc("toolGateway.server", { id: "one" });
    expect(full.server.cwd).toBe(h.dataDir);
    expect(full.log.length).toBeGreaterThan(0);
    const list = (await h.gateway.cli(["list", "--json"], {})).stdout!;
    expect(list).not.toContain(FIXTURE);
    expect(list).not.toContain("web.example.test");
  });
});

describe("12. a cancelled waiter", () => {
  it("leaves the queue, so the next live call still runs", async () => {
    h = await harness({ limits: { maxConcurrent: 1 } });
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    await h.gateway.engine.ensureServer("one");
    const running = h.gateway.engine.call("one", "slow", { ms: 600 });
    const cancelled = [new AbortController(), new AbortController(), new AbortController()];
    const waiting = cancelled.map((controller) => h!.gateway.engine.call("one", "slow", { ms: 10 }, { signal: controller.signal }).catch((error: unknown) => error));
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const controller of cancelled) controller.abort(new Error("cancelled"));
    const live = h.gateway.engine.call("one", "count", {});
    await running;
    await Promise.all(waiting);
    const result = await Promise.race([live, new Promise((_, reject) => setTimeout(() => reject(new Error("the live call hung")), 5_000))]);
    expect(text(result)).toContain("calls");
  }, 15_000);
});

describe("13. smaller items", () => {
  it("lists every method as gated or read-only, never both", () => {
    const methods = Object.keys({ ...toolGatewayContract, ...toolGatewayPublicContract }).sort();
    const gated = new Set<string>(GATED_METHODS);
    const reads = new Set<string>(READ_METHODS);
    for (const method of methods) expect(gated.has(method) !== reads.has(method), method).toBe(true);
    expect([...gated, ...reads].sort()).toEqual(methods);
  });

  it("caps pending requests", async () => {
    h = await harness();
    for (let i = 0; i < MAX_PENDING_REQUESTS; i++) await h.rpc("toolGateway.request", { name: `asked-${i}`, command: "x", why: "Test" }, CLIENT);
    await expect(h.rpc("toolGateway.request", { name: "one-more", command: "x", why: "Test" }, CLIENT)).rejects.toThrow(/already 20 requests/);
    expect(h.todos.created).toHaveLength(MAX_PENDING_REQUESTS);
  });

  it("tightens a secrets folder and a server folder that already exist", async () => {
    h = await harness();
    mkdirSync(secretsDir(h), { recursive: true, mode: 0o755 });
    chmodSync(secretsDir(h), 0o755);
    const serverDir = join(h.dataDir, "plugins", "studio", "tool-gateway", "servers", "one");
    mkdirSync(serverDir, { recursive: true, mode: 0o755 });
    chmodSync(serverDir, 0o755);
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    await h.agent("tool_gateway_call", { id: await idOf(h, "one", "count"), args: {} });
    expect(statSync(secretsDir(h)).mode & 0o777).toBe(0o700);
    expect(statSync(serverDir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(secretsDir(h), "servers.json"))).toBe(true);
    expect(MAX_CALL_TIMEOUT_MS).toBe(600_000);
  });
});

describe("R1. a secrets file that can't be read", () => {
  for (const file of ["servers.json", "oauth.json"]) {
    it(`(${file}) hides the gateway's tools but never throws, and nothing overwrites it`, async () => {
      h = await harness();
      await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
      writeFileSync(join(secretsDir(h), file), "{not json");
      await h.restart();
      expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_a" })).toEqual(file === "servers.json" ? { tools: [], instructions: "" } : expect.objectContaining({ tools: expect.any(Array) }));
      const snapshot = await h.rpc("toolGateway.snapshot", null);
      expect(snapshot.problems).toEqual([`${file}: can't be read`]);
      // A fixed message: nothing of the broken file is quoted to any reader.
      expect(JSON.stringify(snapshot)).not.toContain("not json");
      expect(JSON.stringify(await h.rpc("toolGateway.snapshot", null, CLIENT))).not.toContain("not json");
      if (file === "servers.json") {
        expect(snapshot.servers[0]).toMatchObject({ id: "one", approved: false, status: "needs-approval" });
        expect(json(await h.agent("tool_gateway_search", {})).tools).toEqual([]);
        await expect(h.rpc("toolGateway.addServer", { server: stdioServer("two") })).rejects.toThrow(/servers\.json can't be read/);
        expect(readFileSync(join(secretsDir(h), file), "utf8")).toBe("{not json");
      }
    });
  }

  it("(the key) leaves the unreadable key alone, approves nothing and keeps answering", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const keyFile = join(secretsDir(h), "approval.key");
    const key = readFileSync(keyFile, "utf8");
    chmodSync(keyFile, 0o000);
    try {
      await h.restart();
      expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_a" })).toEqual({ tools: [], instructions: "" });
      const snapshot = await h.rpc("toolGateway.snapshot", null);
      expect(snapshot.servers[0]).toMatchObject({ approved: false });
      expect(snapshot.problems).toEqual(["approval.key: can't be read"]);
      await expect(h.rpc("toolGateway.approve", { id: "one" })).rejects.toThrow(/approval key can't be read/);
    } finally {
      chmodSync(keyFile, 0o600);
    }
    expect(readFileSync(keyFile, "utf8")).toBe(key);
  });

  it("guards configure(): a failure inside Tool Gateway hides only its tools, and is logged once", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    h.db.exec("DROP TABLE tool_gateway_servers");
    expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_a" })).toEqual({ tools: [], instructions: "" });
    expect(h.gateway.agentConfiguration({ providerId: "codex", projectId: "prj_a" })).toEqual({ tools: [], instructions: "" });
    expect(h.warnings.filter((line) => line.includes("tools are hidden from agents"))).toHaveLength(1);
    h.db.exec("CREATE TABLE tool_gateway_servers (id TEXT PRIMARY KEY, record TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  });
});

describe("masking secret-named values and headers", () => {
  it("always masks values of secret-named env variables and every header, short or plain; other values only when they look secret", async () => {
    const { secretValuesOf } = await import("../server/config");
    const values = secretValuesOf({
      env: { API_KEY: "abc", db_password: "hunter", Session_Cookie: "plainword", AUTH_ENABLED: "true", LOG_LEVEL: "info", OTHER: "Zq8-looks-secret-1" },
      headers: { "X-Api": "short", Authorization: "Bearer tok" },
    });
    expect(values.sort()).toEqual(["Bearer tok", "Zq8-looks-secret-1", "abc", "hunter", "plainword", "short", "tok"].sort());
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one", { env: { FAKE_TOKEN: "pw42" } }) });
    expect(text(await h.agent("tool_gateway_call", { id: await idOf(h, "one", "leak"), args: {} }))).toBe("the token is •••");
  });
});
