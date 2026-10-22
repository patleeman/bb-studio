import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CodeServers } from "./runtime";
import type { Workspace } from "../shared";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const workspace = (id: string): Workspace => ({ id, title: id, projectId: null, threadId: id, folders: ["/project"], trusted: true, share: true, archived: false, createdAt: 1, updatedAt: 1 });
const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve("pending"), ms));
const log = { info() {}, warn() {} };

it("releases a stopped install waiter and lets a replacement start immediately", async () => {
  let release!: (bin: string) => void;
  const gate = new Promise<string>((resolve) => { release = resolve; });
  const install = vi.fn(() => gate);
  const spawn = vi.fn(() => { throw new Error("must not spawn"); });
  const runtime = new CodeServers({ root: "/fixture/code", log, onChange() {}, quiesce: async () => {}, install, spawn });
  const first = runtime.open(workspace("a"));
  let second: ReturnType<typeof runtime.open> | undefined;
  try {
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    runtime.stop("a");
    expect(await Promise.race([first, delay(30)])).toMatchObject({ state: "stopped" });
    second = runtime.open(workspace("a"));
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2));
  } finally {
    runtime.dispose(); release("/fixture/bin/code-server");
    await Promise.all([first, second]);
  }
  expect(spawn).not.toHaveBeenCalled();
});

async function downloading() {
  const root = await mkdtemp(join(tmpdir(), "code-cancel-"));
  const runtime = new CodeServers({ root, log, onChange() {}, quiesce: async () => {} });
  cleanup.push(async () => {
    runtime.dispose();
    await vi.waitFor(async () => { expect((await readdir(join(root, "code-server"))).filter((name) => name.startsWith(".download-"))).toEqual([]); });
    await rm(root, { recursive: true, force: true });
  });
  return runtime;
}

it("keeps a shared download alive for another workspace, then aborts it on disposal", async () => {
  let signal: AbortSignal | undefined, reject!: (error: Error) => void;
  vi.stubGlobal("fetch", vi.fn((_url, options) => {
    signal = options?.signal;
    return new Promise((_resolve, no) => { reject = no; signal?.addEventListener("abort", () => no(signal!.reason), { once: true }); });
  }));
  const runtime = await downloading();
  const first = runtime.open(workspace("a"));
  let second: ReturnType<typeof runtime.open> | undefined;
  try {
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(signal).toBeDefined();
    second = runtime.open(workspace("b"));
    await vi.waitFor(() => expect(runtime.status("b").state).toBe("installing"));
    runtime.stop("a");
    expect(await Promise.race([first, delay(30)])).toMatchObject({ state: "stopped" });
    expect(signal!.aborted).toBe(false);
    runtime.dispose();
    expect(signal!.aborted).toBe(true);
    expect(await second).toMatchObject({ state: "stopped" });
  } finally {
    runtime.dispose(); reject(new Error("fixture ended")); await Promise.all([first, second]);
  }
});

it("aborts a stalled download body and cleans its staging directory", async () => {
  const cancel = vi.fn();
  const timeouts = vi.spyOn(AbortSignal, "timeout");
  let close!: () => void;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { close = () => { try { controller.close(); } catch { /* Already cancelled. */ } }; }, cancel }))));
  const runtime = await downloading();
  const opening = runtime.open(workspace("a"));
  try {
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    runtime.dispose();
    expect(await Promise.race([opening, delay(100)])).toMatchObject({ state: "stopped" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(timeouts).toHaveBeenCalledWith(300_000);
  } finally { runtime.dispose(); close(); await opening; }
});

it("bounds and cancels a stalled health check without publishing running", async () => {
  class Child extends EventEmitter {
    exitCode: number | null = null;
    signalCode = null;
    stdout = new EventEmitter(); stderr = new EventEmitter();
    kill() { this.exitCode = 0; this.emit("exit", 0, null); return true; }
  }
  let signal: AbortSignal | undefined, reject!: (error: Error) => void;
  const timeouts = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn((_url, options) => {
    signal = options?.signal;
    return new Promise((_resolve, no) => { reject = no; signal?.addEventListener("abort", () => no(signal!.reason), { once: true }); });
  }));
  const root = await mkdtemp(join(tmpdir(), "code-health-"));
  const runtime = new CodeServers({ root, log, onChange() {}, quiesce: async () => {}, install: async () => "/fixture/bin/code-server", spawn: () => {
    const child = new Child();
    queueMicrotask(() => child.stdout.emit("data", Buffer.from("HTTP server listening on http://127.0.0.1:4321/")));
    return child as unknown as import("node:child_process").ChildProcess;
  } });
  const opening = runtime.open(workspace("a"));
  try {
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(signal).toBeDefined();
    expect(timeouts.mock.calls[0]![0]).toBeLessThanOrEqual(2000);
    runtime.stop("a");
    expect(signal!.aborted).toBe(true);
    expect(await Promise.race([opening, delay(100)])).toMatchObject({ state: "stopped" });
  } finally {
    runtime.dispose(); reject(new Error("fixture ended")); await opening;
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["sweep", "beforeOpen"])("releases a disposed start while %s is still blocked", async (phase) => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const block = async () => { entered(); await gate; };
  const install = vi.fn(async () => { throw new Error("must not install"); });
  const runtime = new CodeServers({ root: "/fixture/code", log, onChange() {}, quiesce: phase === "sweep" ? block : async () => {}, beforeOpen: phase === "beforeOpen" ? block : undefined, install });
  const opening = runtime.open(workspace("a"));
  try {
    await ready; runtime.dispose();
    expect(await Promise.race([opening, delay(30)])).toMatchObject({ state: "stopped" });
  } finally { runtime.dispose(); release(); await opening; }
  expect(install).not.toHaveBeenCalled();
});

it("restarts after cancelling the last download waiter", async () => {
  const fetch = vi.fn((_url: unknown, options?: RequestInit) => {
    if (fetch.mock.calls.length === 1) return new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    });
    return Promise.resolve(new Response(null, { status: 503 }));
  });
  vi.stubGlobal("fetch", fetch);
  const runtime = await downloading();
  const first = runtime.open(workspace("a"));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  runtime.stop("a");
  const second = runtime.open(workspace("a"));
  expect(await first).toMatchObject({ state: "stopped" });
  expect(await second).toMatchObject({ state: "failed", error: expect.stringContaining("503") });
  expect(fetch).toHaveBeenCalledTimes(2);
});
