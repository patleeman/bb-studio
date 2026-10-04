import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { StudioHub } from "../hub";
import { initializeOffice } from "./server";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });
const request = { projectId: "elsewhere", providerId: "codex", model: "model", reasoningLevel: "high", permissionMode: "accept-edits", executionInputSources: {}, environment: { kind: "project" }, input: [{ type: "text", text: "Build a garden", mentions: [] }, { type: "localImage", path: "/tmp/garden.png" }], serviceTier: "fast", sendAt: 2000000000 };
async function setup() {
  const project = { id: "p", name: "Garden", kind: "standard" as const, sources: [], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 };
  const pages = new Set<string>();
  const threads = new Map<string, ReturnType<typeof makeThreadResponse>>();
  let pageCount = 0, threadCount = 0;
  const spawn = vi.fn(async (_args: unknown) => {
    const thread = makeThreadResponse({ id: `t${++threadCount}`, projectId: "p", title: "Garden · lead" });
    threads.set(thread.id, thread); return thread;
  });
  const unpin = vi.fn(async () => ({ ok: true }));
  const getThread = vi.fn(async ({ threadId }: { threadId: string }) => {
    const thread = threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Not found"), { status: 404 });
    return thread;
  });
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: any }) => {
    if (method === "create") { const id = `pg_${++pageCount}`; pages.add(id); return { page: { id } }; }
    if (method === "get") return { page: pages.has(input.id) ? { id: input.id } : null };
    throw new Error(`Unexpected RPC ${method}`);
  });
  const list = vi.fn(async ({ offset = 0, limit = 100 }: { offset?: number; limit?: number } = {}) => [...threads.values()].slice(offset, offset + limit));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    projects: { list: async () => [project], get: async ({ projectId }) => ({ ...project, id: projectId, kind: projectId === "personal" ? "personal" : "standard" }) },
    threads: { spawn, get: getThread, list, unpin },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  await initializeOffice(bb, db, new StudioHub(bb.sdk));
  const call = (name: string, input: unknown = { projectId: "p" }) => harness.behavior.callRpc(name, input);
  const create = () => call("project_setup", { projectId: "p", request });
  return { db, call, create, pages, threads, spawn, unpin, getThread, callRpc, list };
}

it("creates on demand and serializes idempotent setup with the composer's inputs", async () => {
  const x = await setup();
  expect(await x.call("project_get")).toEqual({ projectId: "p", name: "Garden", leadThreadId: null, pageId: null, pageHref: null, role: "project", run: null });
  expect(x.db.prepare("SELECT * FROM office_projects").all()).toEqual([]);
  const [a, b] = await Promise.all([x.create(), x.create()]);
  expect(a).toEqual(b);
  expect(a).toEqual({ projectId: "p", name: "Garden", leadThreadId: "t1", pageId: "pg_1", pageHref: "/plugins/pages/pages/pg_1", role: "project", run: null });
  expect(x.spawn).toHaveBeenCalledTimes(1);
  expect(x.callRpc.mock.calls.filter(([arg]) => arg.method === "create")).toHaveLength(1);
  expect(x.callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "pages", method: "create", input: expect.objectContaining({ projectId: "p", parentId: null, title: "Garden", icon: "📁", markdown: expect.stringContaining("## Brief\n\nBuild a garden") }) }));
  const args = x.spawn.mock.calls[0]![0] as { input: { text: string }[] };
  expect(args).toMatchObject({ ...request, projectId: "p", title: "Garden · lead", input: expect.any(Array), pluginMetadata: { role: "project-lead", projectId: "p", pageId: "pg_1" } });
  expect(args.input.slice(1)).toEqual(request.input);
  for (const text of ["Memory section, before acting", "bb thread spawn", "Studio Inbox"]) expect(args.input[0]!.text).toContain(text);
  expect(x.unpin).toHaveBeenCalledWith({ threadId: "t1" });
});

it("clears deleted references and recreates only what is missing", async () => {
  const x = await setup(); await x.create();
  x.pages.clear();
  expect(await x.call("project_get")).toMatchObject({ pageId: null, pageHref: null, leadThreadId: "t1" });
  expect(x.db.prepare("SELECT page_id FROM office_projects").get()).toEqual({ page_id: null });
  expect(await x.create()).toMatchObject({ pageId: "pg_2", leadThreadId: "t1" });
  expect(x.spawn).toHaveBeenCalledTimes(1);
  x.threads.clear();
  expect(await x.call("project_get")).toMatchObject({ pageId: "pg_2", leadThreadId: null });
  expect(await x.create()).toMatchObject({ pageId: "pg_2", leadThreadId: "t2" });
  expect(x.callRpc.mock.calls.filter(([arg]) => arg.method === "create")).toHaveLength(2);
});

it("keeps references on transient errors and saves the page before spawning", async () => {
  const x = await setup();
  x.spawn.mockRejectedValueOnce(new Error("Provider offline"));
  await expect(x.create()).rejects.toThrow("Provider offline");
  expect(x.db.prepare("SELECT page_id,lead_thread_id FROM office_projects").get()).toEqual({ page_id: "pg_1", lead_thread_id: null });
  await x.create();
  x.callRpc.mockRejectedValueOnce(new Error("Pages unavailable"));
  await expect(x.call("project_get")).rejects.toThrow("Pages unavailable");
  x.getThread.mockRejectedValueOnce(new Error("Host unavailable"));
  await expect(x.create()).rejects.toThrow("Host unavailable");
  expect(x.db.prepare("SELECT page_id,lead_thread_id FROM office_projects").get()).toEqual({ page_id: "pg_1", lead_thread_id: "t1" });
  expect(x.callRpc.mock.calls.filter(([arg]) => arg.method === "create")).toHaveLength(1);
});

it("lists top-level project threads newest first, paginates and flags the lead", async () => {
  const x = await setup(); await x.create();
  for (let i = 0; i < 103; i++) x.threads.set(`w${i}`, makeThreadResponse({ id: `w${i}`, projectId: "p", updatedAt: 1000 + i }));
  x.threads.set("child", makeThreadResponse({ id: "child", projectId: "p", parentThreadId: "t1" }));
  x.threads.set("other", makeThreadResponse({ id: "other", projectId: "other" }));
  const { threads } = await x.call("project_threads") as { threads: { id: string; isLead: boolean; updatedAt: number }[] };
  expect(threads).toHaveLength(104);
  expect(threads.filter(t => t.isLead).map(t => t.id)).toEqual(["t1"]);
  expect(threads.map(t => t.updatedAt)).toEqual(threads.map(t => t.updatedAt).sort((a, b) => b - a));
  expect(x.list).toHaveBeenCalledWith({ projectId: "p", hasParent: false, limit: 100, offset: 100 });
});

it("supports the personal workspace and rejects invalid setup requests", async () => {
  const x = await setup();
  expect(await x.call("project_get", { projectId: "personal" })).toMatchObject({ name: "Chief of Staff", role: "chief-of-staff", run: null });
  await expect(x.call("project_setup", { projectId: "p", providerId: "codex", model: "x" })).rejects.toThrow();
  expect(x.spawn).not.toHaveBeenCalled();
});
