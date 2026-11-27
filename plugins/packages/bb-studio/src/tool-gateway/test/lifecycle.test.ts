// Lifecycle regression tests for ToolGatewayEngine and tool-gateway-host:
// waking queued waiters on crash/drop, reaping timed-out host starts,
// ignoring host callbacks after close, and suppressing stale transport.onerror.
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
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

  it("stale timed-out start() aborts only its own controller and does not close a newer attempt (ownAttempt === false)", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const closed: string[] = [];
      let attempt = 0;
      const host: StdioHost = {
        start: (_config, signal) => {
          attempt += 1;
          if (signal) signals.push(signal);
          if (attempt === 1) return new Promise(() => {}); // hangs forever, ignores abort
          return new Promise(() => {}); // attempt 2 stays in flight while attempt 1's timeout fires
        },
        refresh: async () => ({ tools: [] }),
        close: async (key) => { closed.push(key); },
        callTool: async () => ({}),
      };
      const record = makeRecord("s1");
      record.config.cwd = process.cwd();
      const { deps } = makeDeps(host, { connectMs: 2_500 });
      deps.server = (id) => (id === record.id ? record : null);
      const engine = new ToolGatewayEngine(deps);
      engines.push(engine);

      // Start attempt #1 (connectMs = 2500 ms).
      const first = engine.ensureServer("s1").catch((err: unknown) => err);
      await Promise.resolve();
      expect(signals).toHaveLength(1);

      // closeServer() waits up to CLOSE_TIMEOUT_MS (2000 ms) for attempt #1, then clears pending.
      const closing = engine.closeServer("s1");
      await vi.advanceTimersByTimeAsync(2_050);
      await closing;

      // Start attempt #2 before attempt #1's 2500 ms connect timeout fires.
      const second = engine.ensureServer("s1").catch((err: unknown) => err);
      await Promise.resolve();
      expect(signals).toHaveLength(2);
      expect(signals[1]!.aborted).toBe(false);

      // Advance past attempt #1's 2500 ms timeout (still well before attempt #2's 4550 ms timeout).
      await vi.advanceTimersByTimeAsync(600);
      await first;

      // Attempt #1 must NOT have aborted attempt #2's controller and must NOT have called stdioHost.close("s1").
      expect(signals[1]!.aborted).toBe(false);
      expect(closed).toEqual([]);

      // Clean up attempt #2.
      const stop = engine.close();
      await vi.advanceTimersByTimeAsync(2_500);
      await stop;
      await second;
    } finally {
      vi.useRealTimers();
    }
  });

  it("wakes queued waiters immediately when a local stdio transport closes unexpectedly", async () => {
    const record = makeRecord("s1");
    record.config.cwd = process.cwd();
    const deps: EngineDeps = {
      server: (id) => (id === record.id ? record : null),
      secrets: () => ({ env: {}, headers: {} }),
      blocked: () => null,
      serverDir: () => process.cwd(),
      baseEnv: { PATH: process.env.PATH },
      redact: (text) => text,
      log: () => {},
      setStatus: () => {},
      changed: () => {},
      limits: { maxConcurrent: 1 },
    };
    const engine = new ToolGatewayEngine(deps);
    engines.push(engine);

    const conn = await engine.ensureServer("s1");
    void engine.call("s1", "slow", { ms: 5_000 }).catch(() => {});
    const queued = engine.call("s1", "count", {});
    await new Promise((r) => setTimeout(r, 30));

    // Kill the real child process so StdioClientTransport fires transport.onclose.
    const pid = (conn.transport as StdioClientTransport).pid;
    expect(pid).toBeTruthy();
    process.kill(pid!, "SIGKILL");

    const settled = await Promise.race([
      queued.then(() => "resolved", (err: Error) => err.message),
      new Promise<string>((r) => setTimeout(() => r("HUNG"), 1_000)),
    ]);
    expect(settled).not.toBe("HUNG");
    expect(settled).toMatch(/stopped/i);
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

  it("suppresses transport.onerror signals after expected close or key replacement", async () => {
    const signals: Array<{ name: string; payload: unknown }> = [];
    const makeCtx = () => ({
      signal: new AbortController().signal,
      experimental_retainWorker: () => ({ dispose: async () => {} }),
      experimental_emitSignal: async (name: string, payload: unknown) => { signals.push({ name, payload }); },
    }) as never;

    const captured: StdioClientTransport[] = [];
    const origStart = StdioClientTransport.prototype.start;
    const spy = vi.spyOn(StdioClientTransport.prototype, "start").mockImplementation(function (this: StdioClientTransport) {
      captured.push(this);
      return origStart.call(this);
    });
    try {
      await hostHandlers.start(
        { key: "srv", command: process.execPath, args: [FIXTURE], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } },
        makeCtx(),
      );
      const firstTransport = captured[0]!;
      expect(firstTransport).toBeDefined();

      // Replace "srv" with a second connection; a late error on the replaced transport must be ignored.
      await hostHandlers.start(
        { key: "srv", command: process.execPath, args: [FIXTURE], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } },
        makeCtx(),
      );
      firstTransport.onerror?.(new Error("late replaced transport error"));

      // Close the active connection; a late error on it must also be ignored.
      const secondTransport = captured[1]!;
      await hostHandlers.close({ key: "srv" });
      secondTransport.onerror?.(new Error("late closed transport error"));

      await new Promise((r) => setTimeout(r, 20));
      expect(signals.filter((s) => s.name === "connectionChanged")).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
