// Lifecycle regression tests for ToolGatewayEngine and tool-gateway-host:
// waking queued waiters on crash/drop, reaping timed-out host starts,
// ignoring host callbacks after close, and suppressing stale transport.onerror.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolGatewayEngine, type EngineDeps, type StdioHost } from "../server/engine";
import type { ServerRecord } from "../server/store";
import { closeAllForTests, hostHandlers } from "../../../tool-gateway-host";
import { FIXTURE } from "./harness";

function makeRecord(id = "s1"): ServerRecord {
  return {
    id,
    label: `Server ${id}`,
    enabled: true,
    projects: null,
    disabledTools: [],
    config: {
      kind: "stdio",
      command: process.execPath,
      args: [FIXTURE],
      cwd: null,
      url: null,
      envNames: [],
      headerNames: [],
      callTimeoutMs: 5_000,
    },
    approvedHash: "hash-1",
    approvedAt: 1,
    source: "added",
    approvedTools: null,
    status: "stopped",
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeDeps(host: StdioHost, limits?: EngineDeps["limits"]) {
  const record = makeRecord("s1");
  const statusCalls: Array<{ id: string; status: string; error: string | null }> = [];
  const changed = vi.fn();
  const deps: EngineDeps = {
    server: (id) => (id === record.id ? record : null),
    secrets: () => ({ env: {}, headers: {} }),
    blocked: () => null,
    serverDir: () => "/tmp/bb-studio-tg-test",
    baseEnv: { PATH: process.env.PATH },
    redact: (text) => text,
    log: () => {},
    setStatus: (id, status, error) => { statusCalls.push({ id, status, error }); },
    changed,
    stdioHost: host,
    limits,
  };
  return { deps, statusCalls, changed };
}

describe("ToolGatewayEngine host lifecycle", () => {
  const engines: ToolGatewayEngine[] = [];
  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.close();
  });

  it("wakes queued waiters immediately when the host worker exits", async () => {
    let onExit: (() => void) | undefined;
    const host: StdioHost = {
      start: async () => ({ tools: [{ name: "slow", inputSchema: { type: "object" } }] }),
      refresh: async () => ({ tools: [] }),
      close: async () => {},
      callTool: () => new Promise(() => {}),
      onWorkerExit: (handler) => { onExit = handler; return () => { onExit = undefined; }; },
    };
    const { deps } = makeDeps(host, { maxConcurrent: 1 });
    const engine = new ToolGatewayEngine(deps);
    engines.push(engine);

    await engine.ensureServer("s1");
    void engine.call("s1", "slow", {}).catch(() => {});
    const queued = engine.call("s1", "slow", {});
    await new Promise((r) => setTimeout(r, 10));

    onExit?.();

    const settled = await Promise.race([
      queued.then(() => "resolved", (err: Error) => err.message),
      new Promise<string>((r) => setTimeout(() => r("HUNG"), 250)),
    ]);
    expect(settled).not.toBe("HUNG");
    expect(settled).toMatch(/stopped/i);
  });

  it("wakes queued waiters on hostConnectionChanged and ignores callbacks after close", async () => {
    let onConn: ((key: string, status: "closed" | "error", error: string | null) => void) | undefined;
    const host: StdioHost = {
      start: async () => ({ tools: [{ name: "slow", inputSchema: { type: "object" } }] }),
      refresh: async () => ({ tools: [] }),
      close: async () => {},
      callTool: () => new Promise(() => {}),
      onConnectionChanged: (handler) => { onConn = handler; return () => {}; },
    };
    const { deps } = makeDeps(host, { maxConcurrent: 1 });
    const engine = new ToolGatewayEngine(deps);
    engines.push(engine);

    await engine.ensureServer("s1");
    void engine.call("s1", "slow", {}).catch(() => {});
    const queued = engine.call("s1", "slow", {});
    await new Promise((r) => setTimeout(r, 10));

    onConn?.("s1", "error", "pipe broke");

    const settled = await Promise.race([
      queued.then(() => "resolved", (err: Error) => err.message),
      new Promise<string>((r) => setTimeout(() => r("HUNG"), 250)),
    ]);
    expect(settled).not.toBe("HUNG");
    expect(settled).toMatch(/stopped/i);

    // Also verify a connectionChanged callback arriving during engine.close() is ignored.
    const host2: StdioHost = {
      start: async () => ({ tools: [{ name: "ok", inputSchema: { type: "object" } }] }),
      refresh: async () => ({ tools: [] }),
      close: async () => {},
      callTool: async () => ({}),
      onConnectionChanged: (handler) => { onConn = handler; return () => {}; },
    };
    const d2 = makeDeps(host2);
    const engine2 = new ToolGatewayEngine(d2.deps);
    engines.push(engine2);
    await engine2.ensureServer("s1");
    // Hold close() before closeServer removes s2, or fire right after closed = true.
    let releaseClose!: () => void;
    host2.close = () => new Promise<void>((r) => { releaseClose = r; });
    const closing = engine2.close();
    const beforeStatus = d2.statusCalls.length;
    const beforeChanged = d2.changed.mock.calls.length;
    onConn?.("s1", "error", "late error");
    releaseClose();
    await closing;
    expect(d2.statusCalls.length).toBe(beforeStatus);
    expect(d2.changed.mock.calls.length).toBe(beforeChanged);
  });

  it("calls stdioHost.close(id) to reap an orphan child when stdioHost.start() times out", async () => {
    const closed: string[] = [];
    const host: StdioHost = {
      start: () => new Promise(() => {}),
      refresh: async () => ({ tools: [] }),
      close: async (key) => { closed.push(key); },
      callTool: async () => ({}),
    };
    const { deps } = makeDeps(host, { connectMs: 40 });
    const engine = new ToolGatewayEngine(deps);
    engines.push(engine);

    await expect(engine.ensureServer("s1")).rejects.toThrow();
    expect(closed).toEqual(["s1"]);
  });
});

describe("tool-gateway-host replacement lifecycle", () => {
  afterEach(async () => { await closeAllForTests(); });

  it("does not delete a replacement connection when an earlier aborted start() fails in catch", async () => {
    const signals: Array<{ name: string; payload: unknown }> = [];
    const makeCtx = (signal = new AbortController().signal) => ({
      signal,
      experimental_retainWorker: () => ({ dispose: async () => {} }),
      experimental_emitSignal: async (name: string, payload: unknown) => { signals.push({ name, payload }); },
    }) as never;

    // First start: hangs forever during initialize (never writes to stdout).
    const firstAbort = new AbortController();
    const first = hostHandlers.start(
      { key: "srv", command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } },
      makeCtx(firstAbort.signal),
    ).catch((err: unknown) => err);

    await new Promise((r) => setTimeout(r, 30));

    // Second start under the same key replaces the first and succeeds.
    await hostHandlers.start(
      { key: "srv", command: process.execPath, args: [FIXTURE], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } },
      makeCtx(),
    );

    // Now the first start's abort/catch settles — it must not delete the live replacement.
    firstAbort.abort(new Error("superseded"));
    await first;

    const result = await hostHandlers.callTool(
      { key: "srv", name: "count", args: {}, timeoutMs: 5_000, maxBytes: 1024 * 1024 },
      makeCtx(),
    ) as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain("calls");
    expect(signals.filter((s) => s.name === "connectionChanged")).toEqual([]);
  });
});
