import { describe, expect, it } from "vitest";
import { CODE_SERVER_VERSION, leftoverPids, releaseAsset, workspaceFile, workspaceFileName } from "./runtime";

describe("code-server runtime", () => {
  it("picks the release for this machine", () => {
    expect(releaseAsset("darwin", "arm64")).toBe(`code-server-${CODE_SERVER_VERSION}-macos-arm64`);
    expect(releaseAsset("linux", "x64")).toBe(`code-server-${CODE_SERVER_VERSION}-linux-amd64`);
    expect(releaseAsset("win32", "x64")).toBeNull();
  });

  it("writes a multi-root workspace file", () => {
    expect(JSON.parse(workspaceFile(["/a", "/b"]))).toEqual({ folders: [{ path: "/a" }, { path: "/b" }], settings: {} });
  });

  it("names the workspace file after its title", () => {
    expect(workspaceFileName("Billing / API")).toBe("Billing API.code-workspace");
    expect(workspaceFileName("  ")).toBe("Workspace.code-workspace");
  });
});

describe("leftover servers", () => {
  const root = "/data/plugins/studio-code";
  const ps = [
    `  101 ${root}/code-server/code-server-${CODE_SERVER_VERSION}-macos-arm64/lib/node ${root}/watchdog.cjs ${root}/code-server/x/bin/code-server`,
    `  102 ${root}/code-server/x/lib/node ${root}/code-server/x/out/node/entry.js --bind-addr 127.0.0.1:5000`,
    `  103 /usr/bin/node /bb/plugin-host.js ${root}/server.js`,
    `  104 /usr/bin/vim notes.txt`,
    `  105 ${root}/code-server/x/lib/node self`,
  ].join("\n");

  it("finds this plugin's code-servers and watchdogs, and nothing else", () => {
    expect(leftoverPids(ps, `${root}/`, 105)).toEqual([101, 102]);
  });
});

// No real process or server is launched: this tests the ownership fence itself.
describe("the migration start fence", () => {
  it("does not install or spawn when the old server cannot be quiesced", async () => {
    const { CodeServers } = await import("./runtime");
    let installed = false, spawned = false;
    const runtime = new CodeServers({
      root: "/fixture/studio/code", log: { info() {}, warn() {} }, onChange() {},
      quiesce: async () => { throw new Error("old process still alive"); },
      install: async () => { installed = true; return "/fixture/bin"; },
      spawn: () => { spawned = true; throw new Error("must not launch"); },
    });
    const result = await runtime.open({ id: "cws_1", title: "Repo", projectId: null, threadId: null, folders: ["/project"], trusted: true, share: true, archived: false, createdAt: 1, updatedAt: 2 });
    expect(result).toMatchObject({ state: "failed", error: "old process still alive" });
    expect(installed).toBe(false); expect(spawned).toBe(false);
    runtime.dispose();
  });
  it("does not install or spawn before the migration is acknowledged", async () => {
    const { CodeServers } = await import("./runtime");
    const order: string[] = [];
    const runtime = new CodeServers({
      root: "/fixture/studio/code", log: { info() {}, warn() {} }, onChange() {},
      quiesce: async () => { order.push("quiesce"); },
      beforeOpen: async () => { order.push("migration"); throw new Error("copy incomplete"); },
      install: async () => { order.push("install"); return "/fixture/bin"; },
      spawn: () => { order.push("spawn"); throw new Error("must not launch"); },
    });
    const result = await runtime.open({ id: "cws_1", title: "Repo", projectId: null, threadId: null, folders: ["/project"], trusted: true, share: true, archived: false, createdAt: 1, updatedAt: 2 });
    expect(result).toMatchObject({ state: "failed", error: "copy incomplete" });
    expect(order).toEqual(["quiesce", "migration"]);
    runtime.dispose();
  });
});

it("waits for the stopped watchdog to exit before spawning its replacement", async () => {
  const { EventEmitter } = await import("node:events");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { vi } = await import("vitest");
  const { CodeServers } = await import("./runtime");
  class Child extends EventEmitter {
    exitCode: number | null = null;
    signalCode = null;
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    kill() { return true; }
    exit() { this.exitCode = 0; this.emit("exit", 0, null); }
  }
  const children: Child[] = [];
  const directory = await mkdtemp(join(tmpdir(), "code-stop-open-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ ok: true }) as Response);
  const runtime = new CodeServers({
    root: directory, log: { info() {}, warn() {} }, onChange() {}, quiesce: async () => {},
    install: async () => "/fixture/bin/code-server",
    spawn: () => {
      const child = new Child(); children.push(child);
      queueMicrotask(() => child.stdout.emit("data", Buffer.from("HTTP server listening on http://127.0.0.1:4321/")));
      return child as unknown as import("node:child_process").ChildProcess;
    },
  });
  const workspace = { id: "cws_1", title: "Repo", projectId: null, threadId: null, folders: [directory], trusted: true, share: true, archived: false, createdAt: 1, updatedAt: 2 };
  try {
    expect((await runtime.open(workspace)).state).toBe("running");
    runtime.stop(workspace.id);
    const replacement = runtime.open(workspace);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(children).toHaveLength(1);
    children[0]!.exit();
    expect((await replacement).state).toBe("running");
    expect(children).toHaveLength(2);
  } finally {
    runtime.dispose(); for (const child of children) if (child.exitCode === null) child.exit();
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

it.each(["sweep", "beforeOpen"])("cancels disposal during %s and refuses later opens", async (phase) => {
  const { CodeServers } = await import("./runtime");
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  let installs = 0;
  const block = async () => { entered(); await gate; };
  const runtime = new CodeServers({
    root: "/fixture/code", log: { info() {}, warn() {} }, onChange() {},
    quiesce: phase === "sweep" ? block : async () => {},
    beforeOpen: phase === "beforeOpen" ? block : undefined,
    install: async () => { installs++; throw new Error("must not install"); },
  });
  const workspace = { id: "cws_1", title: "Repo", projectId: null, threadId: null, folders: ["/project"], trusted: true, share: true, archived: false, createdAt: 1, updatedAt: 2 };
  const opening = runtime.open(workspace);
  await ready;
  runtime.dispose();
  release();
  expect(await opening).toMatchObject({ state: "stopped" });
  expect(await runtime.open(workspace)).toMatchObject({ state: "stopped" });
  expect(installs).toBe(0);
});
