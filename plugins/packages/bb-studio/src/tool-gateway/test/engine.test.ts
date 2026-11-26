// The engine through Tool Gateway's own surfaces, with the fixture stdio server:
// the approval hash, what a server is given, schema checks, limits, ids,
// which agents see the tools, and that no secret value leaves the server.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, ENV_ALLOW_LIST, resolveCommand, serverEnvironment } from "../server/config";
import { capResult, opaqueToolId } from "../server/engine";
import { CLIENT, FAKE_SECRET, harness, json, stdioServer, text, type Harness } from "./harness";

let h: Harness | null = null;
afterEach(async () => { await h?.close(); h = null; });

async function search(h: Harness, threadId = "thr_claude", query?: string) {
  return json(await h.agent("tool_gateway_search", { query, limit: 50 }, threadId));
}

async function idOf(h: Harness, name: string, threadId = "thr_claude"): Promise<string> {
  const found = (await search(h, threadId)).tools.find((tool: { name: string }) => tool.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found.id;
}

describe("approval is bound to the exact config", () => {
  it("stops a server whose row was edited outside Studio, and one whose secret changed", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const id = await idOf(h, "count");
    expect(json(await h.agent("tool_gateway_call", { id, args: {} }))).toMatchObject({ calls: 1 });

    // An edit to the row by any other path (here: SQL) turns it back to "needs approval".
    const row = h.db.prepare("SELECT record FROM tool_gateway_servers WHERE id = 'one'").get() as { record: string };
    const record = JSON.parse(row.record);
    record.config.args = [...record.config.args, "--extra"];
    h.db.prepare("UPDATE tool_gateway_servers SET record = ? WHERE id = 'one'").run(JSON.stringify(record));
    const refused = await h.agent("tool_gateway_call", { id, args: {} });
    expect(refused).toMatchObject({ isError: true });
    expect(text(refused)).toMatch(/needs approval|not found/i);
    expect((await h.rpc("toolGateway.snapshot", null)).servers[0]).toMatchObject({ status: "needs-approval", approved: false });
    expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_a" }).tools).toEqual([]);

    // Approving again (the app window) takes the new config.
    await h.rpc("toolGateway.approve", { id: "one" });
    expect((await h.rpc("toolGateway.snapshot", null)).servers[0]).toMatchObject({ approved: true });

    // A secret value changed in the secrets file is a different config too.
    const file = join(h.dataDir, "plugins", "studio", "secrets", "tool-gateway", "servers.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.dataDir, "plugins", "studio", "secrets", "tool-gateway")).mode & 0o777).toBe(0o700);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(stored.one.env.FAKE_TOKEN).toBe(FAKE_SECRET);
    stored.one.env.FAKE_TOKEN = "sk-other-value-999";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, JSON.stringify(stored));
    await h.restart();
    expect((await h.rpc("toolGateway.snapshot", null)).servers[0]).toMatchObject({ status: "needs-approval" });
  });
});

describe("what a stdio server is given", () => {
  it("passes only the allow-list and its own variables, and runs in its own private folder", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const result = json(await h.agent("tool_gateway_call", { id: await idOf(h, "env"), args: {} }));
    const allowed = new Set<string>([...ENV_ALLOW_LIST, "FAKE_TOKEN", "LOGNAME", "TERM", "__CF_USER_TEXT_ENCODING"]);
    for (const name of result.names) expect(allowed.has(name), name).toBe(true);
    expect(result.names).not.toContain("BB_SECRET_TEST");
    expect(result.names).not.toContain("ANTHROPIC_API_KEY");
    expect(result.names).toContain("FAKE_TOKEN");
    const dir = join(h.dataDir, "plugins", "studio", "tool-gateway", "servers", "one");
    expect(result.cwd.endsWith(join("tool-gateway", "servers", "one"))).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(serverEnvironment({ PATH: "/bin", BB_TOKEN: "x", OPENAI_API_KEY: "y" }, { env: { A: "1", B: "2" }, headers: {} }, ["A"])).toEqual({ PATH: "/bin", A: "1" });
  });

  it("takes an absolute command or a name on PATH, never a relative path", () => {
    expect(resolveCommand(process.execPath, "")).toBe(process.execPath);
    expect(resolveCommand("sh", "/usr/bin:/bin")).toMatch(/^\/(usr\/)?bin\/sh$/);
    expect(() => resolveCommand("./cmd", "/bin")).toThrow(ConfigError);
    expect(() => resolveCommand("bin/cmd", "/bin")).toThrow(ConfigError);
    expect(() => resolveCommand("no-such-command-tg", "/bin")).toThrow(/isn't on PATH/);
    expect(() => resolveCommand("/no/such/program", "/bin")).toThrow(ConfigError);
  });

  it("refuses a relative working folder and stores the resolved command", async () => {
    h = await harness();
    await expect(h.rpc("toolGateway.addServer", { server: stdioServer("one", { cwd: "relative/dir" }) })).rejects.toThrow(/absolute/);
    await expect(h.rpc("toolGateway.addServer", { server: stdioServer("two", { command: "./fixture" }) })).rejects.toThrow(/relative/);
    const added = await h.rpc("toolGateway.addServer", { server: stdioServer("three", { command: "node" }) }).catch(() => null);
    if (added) expect(added.command.startsWith("/")).toBe(true);
  });
});

describe("no secret value leaves the server", () => {
  it("hides a planted secret in the log, the snapshot, search results, errors and call results", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const found = await search(h);
    expect(JSON.stringify(found)).not.toContain(FAKE_SECRET);
    const leakId = found.tools.find((tool: { name: string }) => tool.name === "leak").id;
    const called = await h.agent("tool_gateway_call", { id: leakId, args: {} });
    expect(text(called)).toContain("•••");
    expect(text(called)).not.toContain(FAKE_SECRET);
    const described = await h.agent("tool_gateway_describe", { ids: [leakId] });
    expect(text(described)).not.toContain(FAKE_SECRET);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const detail = await h.rpc("toolGateway.server", { id: "one" });
    expect(detail.log.some((line: { kind: string; text: string }) => line.kind === "stderr" && line.text.includes("•••"))).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(await h.rpc("toolGateway.snapshot", null, CLIENT))).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(await h.rpc("toolGateway.overview", null, CLIENT))).not.toContain(FAKE_SECRET);
    const logged = h.db.prepare("SELECT text FROM tool_gateway_log").all() as { text: string }[];
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line.text).not.toContain(FAKE_SECRET);
    // An error that carries the value: a server whose command fails with it in the args.
    await h.rpc("toolGateway.addServer", { server: { id: "broken", label: "Broken", kind: "stdio", command: process.execPath, args: ["-e", `console.error(process.env.FAKE_TOKEN); throw new Error(process.env.FAKE_TOKEN)`], env: { FAKE_TOKEN: FAKE_SECRET } } });
    const searched = await search(h);
    expect(JSON.stringify(searched)).not.toContain(FAKE_SECRET);
    expect(searched.tools.some((tool: { status: string }) => tool.status === "error")).toBe(true);
    expect(JSON.stringify(await h.rpc("toolGateway.snapshot", null))).not.toContain(FAKE_SECRET);
  });
});

describe("schema checks", () => {
  it("refuses arguments that break the input schema before they are sent, with parameters named pattern, format, type and properties", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const echo = await idOf(h, "echo");
    const count = await idOf(h, "count");
    const ok = await h.agent("tool_gateway_call", { id: echo, args: { pattern: "abc", format: "a@b.example", type: "a", properties: { any: 1 } } });
    expect(json(ok)).toEqual({ pattern: "abc", format: "a@b.example", type: "a", properties: { any: 1 } });
    for (const args of [{ pattern: "ABC" }, { pattern: "abc", format: "not-an-email" }, { pattern: "abc", type: "c" }, { pattern: "abc", properties: "x" }, {}, { pattern: "abc", extra: 1 }]) {
      const refused = await h.agent("tool_gateway_call", { id: echo, args });
      expect(refused, JSON.stringify(args)).toMatchObject({ isError: true });
      expect(text(refused)).toMatch(/Invalid arguments for echo/);
    }
    // Only the one valid call reached the server, plus this count.
    expect(json(await h.agent("tool_gateway_call", { id: count, args: {} }))).toEqual({ calls: 2 });
  });

  it("falls back to 'must be an object' for a schema that can't be compiled, and logs it once", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const odd = await idOf(h, "odd");
    expect(text(await h.agent("tool_gateway_call", { id: odd, args: { x: 1 } }))).toBe("odd");
    expect(text(await h.agent("tool_gateway_call", { id: odd, args: { x: 2 } }))).toBe("odd");
    const lines = h.gateway.store.logLines("one").filter((line) => line.text.includes("can't be compiled"));
    expect(lines).toHaveLength(1);
  });
});

describe("limits", () => {
  it("times out a slow call, caps a large result, and runs at most 4 calls at once", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one", { callTimeoutMs: 1000 }) });
    const slow = await idOf(h, "slow");
    const timedOut = await h.agent("tool_gateway_call", { id: slow, args: { ms: 3000 } });
    expect(timedOut).toMatchObject({ isError: true });
    expect(text(timedOut)).toMatch(/timed out|timeout/i);

    const big = await h.agent("tool_gateway_call", { id: await idOf(h, "big"), args: { bytes: 2_500_000 } });
    const bigText = text(big);
    expect(Buffer.byteLength(bigText, "utf8")).toBeLessThan(1024 * 1024 + 1024);
    expect(bigText).toContain("over the 1024 KB limit");

    await h.rpc("toolGateway.editServer", { server: stdioServer("one", { env: { FAKE_TOKEN: null }, callTimeoutMs: 10_000 }) });
    const slowAgain = await idOf(h, "slow");
    const results = await Promise.all(Array.from({ length: 7 }, () => h!.agent("tool_gateway_call", { id: slowAgain, args: { ms: 300 } })));
    const most = Math.max(...results.map((result) => json(result).maxActive));
    expect(most).toBeLessThanOrEqual(4);
    expect(most).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("caps results to the first part with a note", () => {
    const capped = capResult({ content: [{ type: "text", text: "a".repeat(5000) }] }, 2000);
    expect(capped.truncated).toBe(true);
    expect(JSON.stringify(capped).length).toBeLessThan(2600);
  });

  it("waits longer after each failure, from 5 s doubling to 5 min", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: { id: "broken", label: "Broken", kind: "stdio", command: process.execPath, args: ["-e", "process.exit(1)"] } });
    await h.agent("tool_gateway_search", {});
    expect(h.gateway.engine.backoffMs("broken")).toBe(5_000);
    await h.gateway.engine.ensureServer("broken", { retryNow: true }).catch(() => {});
    expect(h.gateway.engine.backoffMs("broken")).toBe(10_000);
    for (let i = 0; i < 10; i++) await h.gateway.engine.ensureServer("broken", { retryNow: true }).catch(() => {});
    expect(h.gateway.engine.backoffMs("broken")).toBe(5 * 60_000);
  }, 30_000);

  it("stops an idle server and starts it again on the next call", async () => {
    h = await harness({ limits: { idleMs: 300 } });
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const count = await idOf(h, "count");
    expect(json(await h.agent("tool_gateway_call", { id: count, args: {} }))).toEqual({ calls: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(h.gateway.engine.liveStatus("one").status).toBe("stopped");
    expect(json(await h.agent("tool_gateway_call", { id: count, args: {} }))).toEqual({ calls: 1 });
  }, 10_000);
});

describe("ids and who sees the tools", () => {
  it("keeps tool ids stable across restarts", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    const before = await idOf(h, "echo");
    expect(before).toBe(opaqueToolId("one", "echo"));
    expect(before).toMatch(/^tg_[0-9a-f]{16}$/);
    await h.restart();
    expect(await idOf(h, "echo")).toBe(before);
  });

  it("hides the tools with no server ready, shows them with one, and hides them again when it is switched off", async () => {
    h = await harness();
    const context = { providerId: "claude-code", projectId: "prj_a" };
    expect(h.gateway.agentConfiguration(context)).toEqual({ tools: [], instructions: "" });
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    expect(h.gateway.agentConfiguration(context).tools).toEqual(["tool_gateway_search", "tool_gateway_describe", "tool_gateway_call"]);
    expect(h.gateway.agentConfiguration(context).instructions).toContain("tool_gateway_search");
    await h.rpc("toolGateway.setEnabled", { id: "one", enabled: false });
    expect(h.gateway.agentConfiguration(context).tools).toEqual([]);
    const call = await h.agent("tool_gateway_call", { id: opaqueToolId("one", "echo"), args: { pattern: "a" } });
    expect(text(call)).toMatch(/not found/i);
  });

  it("gives one provider the tools and not another, and honours a provider's server list at call time", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    await h.rpc("toolGateway.addServer", { server: stdioServer("two") });
    await h.rpc("toolGateway.setProvider", { providerId: "codex", access: false, servers: "all" });
    expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_a" }).tools).toHaveLength(3);
    expect(h.gateway.agentConfiguration({ providerId: "codex", projectId: "prj_a" }).tools).toEqual([]);
    expect((await search(h, "thr_codex")).tools).toEqual([]);
    expect(text(await h.agent("tool_gateway_call", { id: opaqueToolId("one", "count"), args: {} }, "thr_codex"))).toMatch(/not found/i);

    // The ACP agent gets server two only.
    await h.rpc("toolGateway.setProvider", { providerId: "acp-hermes", access: true, servers: ["two"] });
    expect(h.gateway.agentConfiguration({ providerId: "acp-hermes", projectId: "prj_a" }).tools).toHaveLength(3);
    const servers = new Set((await search(h, "thr_acp")).tools.map((tool: { serverId: string }) => tool.serverId));
    expect([...servers]).toEqual(["two"]);
    expect(text(await h.agent("tool_gateway_call", { id: opaqueToolId("one", "count"), args: {} }, "thr_acp"))).toMatch(/not found/i);
    expect(json(await h.agent("tool_gateway_call", { id: opaqueToolId("two", "count"), args: {} }, "thr_acp"))).toEqual({ calls: 1 });
    const providers = (await h.rpc("toolGateway.providers", null, CLIENT)).providers;
    expect(providers.find((provider: { id: string }) => provider.id === "acp-hermes")).toMatchObject({ acp: true, access: true, servers: ["two"] });
    // A provider plugin of the ACP family (no acp- prefix) is an ACP agent too.
    expect(providers.find((provider: { id: string }) => provider.id === "antigravity")).toMatchObject({ acp: true });
    expect(providers.find((provider: { id: string }) => provider.id === "codex")).toMatchObject({ acp: false });
  });

  it("limits a server to its projects", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    await h.rpc("toolGateway.setScope", { id: "one", projects: ["prj_a"] });
    expect(h.gateway.agentConfiguration({ providerId: "claude-code", projectId: "prj_b" }).tools).toEqual([]);
    expect((await search(h, "thr_other_project")).tools).toEqual([]);
    expect(text(await h.agent("tool_gateway_call", { id: opaqueToolId("one", "count"), args: {} }, "thr_other_project"))).toMatch(/not found/i);
    expect((await search(h, "thr_claude")).tools.length).toBeGreaterThan(0);
  });

  it("hides a tool switched off on the server's page", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    await h.rpc("toolGateway.setToolEnabled", { id: "one", tool: "echo", enabled: false });
    const names = (await search(h)).tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain("echo");
    expect(text(await h.agent("tool_gateway_call", { id: opaqueToolId("one", "echo"), args: { pattern: "a" } }))).toMatch(/not found/i);
  });
});

describe("the CLI", () => {
  it("lists, searches and calls, and has no approve", async () => {
    h = await harness();
    await h.rpc("toolGateway.addServer", { server: stdioServer("one") });
    expect((await h.gateway.cli(["list"], {})).stdout).toContain("one\tFixture one\tstdio");
    const tools = (await h.gateway.cli(["tools", "count"], { threadId: "thr_claude" })).stdout!;
    const id = tools.split("\t")[0]!;
    const called = await h.gateway.cli(["call", id, "--args", "{}"], { threadId: "thr_claude" });
    expect(called.exitCode).toBe(0);
    expect(called.stdout).toContain("calls");
    expect((await h.gateway.cli(["approve", "one"], {})).exitCode).toBe(2);
  });
});
