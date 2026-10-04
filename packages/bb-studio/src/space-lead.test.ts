import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import type { HubItem } from "./hub";
import { SpaceLeads } from "./space-lead";
import { SpaceStore, THREAD_REF } from "./spaces";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const request = {
  projectId: "elsewhere", providerId: "codex", model: "model", reasoningLevel: "high" as const, permissionMode: "accept-edits" as const,
  executionInputSources: {}, environment: { type: "project-default" }, input: [{ type: "text", text: "Grow tomatoes", mentions: [] }],
} as never;

async function setup() {
  const project = (id: string, kind: "personal" | "standard" = "standard") => ({ id, name: id, kind, sources: [], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 });
  const threads = new Map<string, ReturnType<typeof makeThreadResponse>>();
  let count = 0;
  const spawn = vi.fn(async (args: { projectId: string; title?: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const thread = makeThreadResponse({ id: `t${++count}`, projectId: args.projectId, title: args.title ?? null, updatedAt: 1000 + count, providerId: "codex" });
    threads.set(thread.id, thread);
    return thread;
  });
  const get = vi.fn(async ({ threadId }: { threadId: string }) => {
    const thread = threads.get(threadId);
    if (!thread) throw Object.assign(new Error("Not found"), { status: 404 });
    return thread;
  });
  const list = vi.fn(async ({ projectId, archived, limit = 100, offset = 0 }: { projectId?: string; archived?: boolean; limit?: number; offset?: number } = {}) =>
    [...threads.values()].filter((t) => (!projectId || t.projectId === projectId) && (archived === undefined || !!t.archivedAt === archived)).slice(offset, offset + limit));
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 5 }); return { ok: true }; });
  const automations: { id: string; name: string }[] = [];
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: { name?: string; automationId?: string } }) => {
    if (method === "automations_list") return automations;
    if (method === "automations_create") { const made = { id: `a${automations.length + 1}`, name: input.name! }; automations.push(made); return made; }
    if (method === "automations_delete") { automations.splice(automations.findIndex((a) => a.id === input.automationId), 1); return {}; }
    return {};
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    projects: { list: async () => [project("proj_personal", "personal"), project("p"), project("q")], get: async ({ projectId }) => project(projectId) },
    threads: {
      spawn: spawn as never, get: get as never, list: list as never, archive: archive as never,
      unpin: async () => ({}) as never, output: async () => ({ output: "Planted the seeds." }),
      defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never,
    },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const spaces = new SpaceStore(db);
  const garden = spaces.create({ name: "Garden", defaultProjectId: "p" });
  const kitchen = spaces.create({ name: "Kitchen", defaultProjectId: "q" });
  let pageCount = 0;
  const pages = new Map<string, string>();
  const ensurePage = vi.fn(async (spaceId: string) => {
    if (!pages.has(spaceId)) { pages.set(spaceId, `pg_${++pageCount}`); spaces.setPage(spaceId, pages.get(spaceId)!); }
    return pages.get(spaceId)!;
  });
  const items: HubItem[] = [];
  const changed = vi.fn();
  const leads = new SpaceLeads({ db, sdk: bb.sdk, spaces, ensurePage, hub: { overview: async () => ({ items, providers: [] }) }, changed });
  return { db, spaces, leads, threads, spawn, get, archive, callRpc, automations, ensurePage, items, changed, garden, kitchen };
}

it("sets up one lead per space, serialized and idempotent, and recreates a deleted lead", async () => {
  const x = await setup();
  expect(await x.leads.get(x.garden.id)).toMatchObject({ spaceId: x.garden.id, name: "Garden", leadThreadId: null, pageId: null, run: null, defaultProjectId: "p" });
  const [a, b] = await Promise.all([x.leads.setup(x.garden.id, request), x.leads.setup(x.garden.id, request)]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ leadThreadId: "t1", pageId: "pg_1", pageHref: "/plugins/pages/pages/pg_1" });
  expect(x.spawn).toHaveBeenCalledTimes(1);
  const args = x.spawn.mock.calls[0]![0] as unknown as { projectId: string; title: string; pluginMetadata: unknown; input: { text: string; visibility?: string }[] };
  expect(args).toMatchObject({ projectId: "p", providerId: "codex", title: "Garden · lead", pluginMetadata: { role: "space-lead", spaceId: x.garden.id, pageId: "pg_1" } });
  expect(args.input[0]).toMatchObject({ visibility: "agent-only" });
  for (const text of ["/plugins/pages/pages/pg_1", "studio_space_items", "feed_post"]) expect(args.input[0]!.text).toContain(text);
  expect(args.input[1]).toMatchObject({ text: "Grow tomatoes" });
  expect(x.spaces.ownerOfThread({ id: "t1", projectId: "p" })).toBe(x.garden.id);
  expect(x.spaces.get(x.garden.id)!.threadIds).toEqual(["t1"]);

  x.threads.delete("t1");
  expect(await x.leads.get(x.garden.id)).toMatchObject({ leadThreadId: null, pageId: "pg_1" });
  expect(await x.leads.setup(x.garden.id, request)).toMatchObject({ leadThreadId: "t2", pageId: "pg_1" });
  expect(x.spawn).toHaveBeenCalledTimes(2);
});

it("spawns a space without a default project's lead in Personal and keeps a failed spawn retryable", async () => {
  const x = await setup();
  const loose = x.spaces.create({ name: "Loose" });
  x.spawn.mockRejectedValueOnce(new Error("Provider offline"));
  await expect(x.leads.setup(loose.id, request)).rejects.toThrow("Provider offline");
  expect(x.ensurePage).toHaveBeenCalledTimes(1);
  const done = await x.leads.setup(loose.id, request);
  expect(done.leadThreadId).toBe("t1");
  expect(x.spawn.mock.calls[1]![0]).toMatchObject({ projectId: "proj_personal" });
});

it("starts threads in the space and keeps each thread in one space", async () => {
  const x = await setup();
  const { threadId } = await x.leads.startThread(x.garden.id, request);
  expect(x.spawn.mock.calls[0]![0]).toMatchObject({ projectId: "p" });
  expect(x.spaces.threads.explicit(threadId)).toBe(x.garden.id);
  // Adding it elsewhere moves it; the explicit space beats the project's.
  x.spaces.add(x.kitchen.id, [{ pluginId: THREAD_REF, id: threadId }]);
  expect(x.spaces.get(x.garden.id)!.threadIds).toEqual([]);
  expect(x.spaces.get(x.kitchen.id)!.threadIds).toEqual([threadId]);
  expect(x.spaces.ownerOfThread({ id: threadId, projectId: "p" })).toBe(x.kitchen.id);
  // Taking it out falls back to its project's space.
  x.spaces.removeMembers(x.kitchen.id, [{ pluginId: THREAD_REF, id: threadId }]);
  expect(x.spaces.ownerOfThread({ id: threadId, projectId: "p" })).toBe(x.garden.id);
  expect(() => x.spaces.add(x.kitchen.id, [{ pluginId: "pages", id: "pg" }])).toThrow("follow their project");
});

it("overviews implicit and explicit threads and the space's items", async () => {
  const x = await setup();
  await x.leads.setup(x.garden.id, request);
  const put = (id: string, projectId: string, extra: Partial<ReturnType<typeof makeThreadResponse>> = {}) => x.threads.set(id, makeThreadResponse({ id, projectId, title: id, updatedAt: 500, ...extra }));
  put("implicit", "p");
  put("child", "p", { parentThreadId: "implicit" });
  put("archived", "p", { archivedAt: 3 });
  put("moved", "p");
  put("visitor", "q", { updatedAt: 2000 });
  x.spaces.add(x.kitchen.id, [{ pluginId: THREAD_REF, id: "moved" }]);
  x.spaces.add(x.garden.id, [{ pluginId: THREAD_REF, id: "visitor" }]);
  const item = (id: string, projectId: string | null, extra: Partial<HubItem> = {}) => ({ pluginId: "pages", id, kind: "page", title: id, href: `/p/${id}`, icon: null, projectId, updatedAt: 10, archived: false, ...extra }) as HubItem;
  x.items.push(item("note", "p"), item("pg_1", "p"), item("old", "p", { archived: true }), item("other", "q"));
  const { threads, items } = await x.leads.overview(x.garden.id);
  expect(threads.map((t) => t.id)).toEqual(["visitor", "t1", "child", "implicit"]);
  expect(threads.find((t) => t.id === "t1")).toMatchObject({ isLead: true, title: "Garden · lead" });
  expect(threads.find((t) => t.id === "child")).toMatchObject({ parentThreadId: "implicit", isLead: false });
  expect(items).toEqual([{ ref: "pages:note", title: "note", kind: "page", href: "/p/note", icon: null, updatedAt: 10 }]);
  const map = await x.leads.spaceOfThreads();
  expect(map).toMatchObject({ t1: x.garden.id, implicit: x.garden.id, moved: x.kitchen.id, visitor: x.garden.id });
  expect(map.archived).toBeUndefined();
  // Cached until membership changes.
  expect(await x.leads.spaceOfThreads()).toBe(map);
  x.spaces.add(x.kitchen.id, [{ pluginId: THREAD_REF, id: "implicit" }]);
  expect((await x.leads.spaceOfThreads()).implicit).toBe(x.kitchen.id);
});

it("turns the heartbeat on and off through Automations", async () => {
  const x = await setup();
  await expect(x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" })).rejects.toThrow("lead");
  await x.leads.setup(x.garden.id, request);
  expect(await x.leads.setRun(x.garden.id, { enabled: true, cadence: "weekdays", time: "08:30" })).toMatchObject({ run: { enabled: true, cadence: "weekdays", time: "08:30" } });
  const create = x.callRpc.mock.calls.find(([arg]) => arg.method === "automations_create")![0] as unknown as { input: { trigger: { cron: string }; execution: { targetThreadId: string; prompt: string } } };
  expect(create.input.trigger.cron).toBe("30 8 * * 1-5");
  expect(create.input.execution).toMatchObject({ targetThreadId: "t1", prompt: expect.stringContaining("Heartbeat") });
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "hourly" });
  expect(x.automations).toHaveLength(1);
  expect(await x.leads.setRun(x.garden.id, { enabled: false, cadence: "hourly" })).toMatchObject({ run: { enabled: false } });
  expect(x.automations).toHaveLength(0);
});

it("hands a lead off to a new thread that stays the lead, once", async () => {
  const x = await setup();
  await x.leads.setup(x.garden.id, request);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" });
  const { threadId } = await x.leads.handoff("t1", request);
  expect(threadId).toBe("t2");
  const args = x.spawn.mock.calls[1]![0] as unknown as { projectId: string; pluginMetadata: unknown; input: { text: string; visibility?: string }[] };
  expect(args).toMatchObject({ projectId: "p", pluginMetadata: { role: "space-lead", spaceId: x.garden.id, handoffFrom: "t1" } });
  expect(args.input[0]).toMatchObject({ visibility: "agent-only" });
  for (const text of ["/threads/t1", "Planted the seeds.", "/plugins/pages/pages/pg_1"]) expect(args.input[0]!.text).toContain(text);
  expect(x.archive).toHaveBeenCalledWith({ threadId: "t1" });
  expect(await x.leads.get(x.garden.id)).toMatchObject({ leadThreadId: "t2" });
  expect(x.spaces.threads.explicit("t2")).toBe(x.garden.id);
  const update = x.callRpc.mock.calls.filter(([arg]) => arg.method === "automations_update").at(-1)![0] as unknown as { input: { execution: { targetThreadId: string } } };
  expect(update.input.execution.targetThreadId).toBe("t2");
  expect(await x.leads.handoff("t1", request)).toEqual({ threadId: "t2" });
  expect(x.spawn).toHaveBeenCalledTimes(2);
  expect(x.archive).toHaveBeenCalledTimes(1);
});

it("hands off a worker in place: an added thread stays added", async () => {
  const x = await setup();
  const { threadId } = await x.leads.startThread(x.kitchen.id, request);
  const next = await x.leads.handoff(threadId, request);
  expect(x.spaces.threads.explicit(next.threadId)).toBe(x.kitchen.id);
  expect((x.spawn.mock.calls[1]![0] as unknown as { pluginMetadata: unknown }).pluginMetadata).toEqual({ handoffFrom: threadId });
  expect(await x.leads.get(x.kitchen.id)).toMatchObject({ leadThreadId: null });
});
