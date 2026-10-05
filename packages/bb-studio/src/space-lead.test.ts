import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { spaceRunSchema, type SpaceRun } from "./contract";
import { SpaceLeads } from "./space-lead";
import { SpaceStore, THREAD_REF } from "./spaces";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const request = {
  projectId: "elsewhere", providerId: "codex", model: "model", reasoningLevel: "high" as const, permissionMode: "accept-edits" as const,
  executionInputSources: {}, environment: { type: "project-default" }, input: [{ type: "text", text: "Grow tomatoes", mentions: [] }],
} as never;

async function setup(migrations = MIGRATIONS) {
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
  bb.storage.migrate(db, migrations);
  const spaces = new SpaceStore(db);
  const garden = spaces.create({ name: "Garden", defaultProjectId: "p" });
  const kitchen = spaces.create({ name: "Kitchen", defaultProjectId: "q" });
  const changed = vi.fn();
  const leads = new SpaceLeads({ db, sdk: bb.sdk, spaces, changed });
  return { bb, db, spaces, leads, threads, spawn, get, archive, callRpc, automations, changed, garden, kitchen };
}

/** Starts a thread in the Garden's project and makes it the space's lead. */
async function lead(x: Awaited<ReturnType<typeof setup>>, spaceId = x.garden.id) {
  const thread = await x.spawn({ projectId: "p", title: "Garden · lead" });
  return x.leads.setLead(spaceId, thread.id);
}

it.each<[SpaceRun["cadence"], string]>([
  ["every5minutes", "*/5 * * * *"], ["every15minutes", "*/15 * * * *"], ["every30minutes", "*/30 * * * *"],
  ["every2hours", "30 */2 * * *"], ["every6hours", "30 */6 * * *"], ["weekly", "30 8 * * 1"],
  ["hourly", "30 * * * *"], ["daily", "30 8 * * *"], ["weekdays", "30 8 * * 1-5"],
  ["custom", "5,35 8-18/2 * JAN,MAR MON-FRI"],
])("schedules %s and reuses its automation when settings change", async (cadence, cron) => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily", time: "08:30" });
  const run = { enabled: true, cadence, ...(cadence === "custom" ? { cron: `  ${cron}  ` } : {}) };
  expect(await x.leads.setRun(x.garden.id, run)).toMatchObject({ run: { enabled: true, cadence, time: "08:30", ...(cadence === "custom" ? { cron } : {}) } });
  const update = x.callRpc.mock.calls.filter(([arg]) => arg.method === "automations_update").at(-1)![0];
  expect(update.input).toMatchObject({ trigger: { cron }, automationId: "a1" });
  expect(x.automations).toHaveLength(1);
  expect(x.callRpc.mock.calls.filter(([arg]) => arg.method === "automations_create")).toHaveLength(1);
});

it("retains custom cron when switched off and uses it when enabled again", async () => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "custom", cron: "*/15 9-17 * * 1-5" });
  expect(await x.leads.setRun(x.garden.id, { enabled: false, cadence: "custom" })).toMatchObject({ run: { enabled: false, cadence: "custom", cron: "*/15 9-17 * * 1-5" } });
  expect(x.automations).toHaveLength(0);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "custom" });
  const update = x.callRpc.mock.calls.filter(([arg]) => arg.method === "automations_update").at(-1)![0];
  expect(update.input).toMatchObject({ trigger: { cron: "*/15 9-17 * * 1-5" } });
});

it("migrates legacy settings and automation identity without changing them", async () => {
  const x = await setup(MIGRATIONS.slice(0, -1));
  x.db.prepare("INSERT INTO space_runs (space_id, enabled, cadence, time, automation_id, automation_project_id) VALUES (?, 1, 'weekdays', '08:30', 'legacy', 'p')").run(x.garden.id);
  x.bb.storage.migrate(x.db, MIGRATIONS);
  expect(x.leads.runs.get(x.garden.id)).toEqual({ enabled: true, cadence: "weekdays", time: "08:30" });
  expect(x.db.prepare("SELECT automation_id, automation_project_id, cron FROM space_runs WHERE space_id = ?").get(x.garden.id)).toEqual({ automation_id: "legacy", automation_project_id: "p", cron: null });
  await lead(x);
  x.callRpc.mockClear();
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "every6hours" });
  expect(x.callRpc.mock.calls.some(([arg]) => arg.method === "automations_create")).toBe(false);
  expect(x.callRpc.mock.calls.find(([arg]) => arg.method === "automations_update")![0].input).toMatchObject({ automationId: "legacy", trigger: { cron: "30 */6 * * *" } });
});

it.each([undefined, "", "not a cron expression", "* * * *", "0 * * * * *", "60 * * * *", "0 24 * * *", "0 9 0 * *", "0 9 * 13 *", "0 9 * * 8", "*/0 * * * *", "5-1 * * * *", "1,,2 * * * *", "0 9 * * FUNDAY", "0 9 * * 1/garbage"])("rejects invalid custom cron %s before changing storage or automations", async (cron) => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" });
  const before = x.leads.runs.get(x.garden.id);
  x.callRpc.mockClear();
  for (const enabled of [true, false]) {
    await expect(x.leads.setRun(x.garden.id, { enabled, cadence: "custom", cron })).rejects.toThrow(/cron/i);
    expect(x.leads.runs.get(x.garden.id)).toEqual(before);
    expect(x.callRpc).not.toHaveBeenCalled();
    expect(x.automations).toHaveLength(1);
  }
});

it("accepts valid cron lists, ranges, names and steps at the contract boundary", () => {
  for (const cron of ["*/5 * * * *", "0,30 9-17/2 1,15 1-12 0-7", "0 9 * jan,dec mon-fri"]) {
    expect(spaceRunSchema.parse({ enabled: false, cadence: "custom", time: "09:00", cron }).cron).toBe(cron);
  }
});

it("keeps saved settings when Automations rejects a custom schedule", async () => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily", time: "08:30" });
  const before = x.leads.runs.get(x.garden.id);
  x.callRpc.mockRejectedValueOnce(new Error("Automation schedule validation failed"));
  await expect(x.leads.setRun(x.garden.id, { enabled: true, cadence: "custom", cron: "0 9 31 2 *" })).rejects.toThrow("schedule validation");
  expect(x.leads.runs.get(x.garden.id)).toEqual(before);
  expect(x.automations).toHaveLength(1);
});

it("makes an existing thread the lead, adds it to the space, and clears a deleted lead", async () => {
  const x = await setup();
  expect(await x.leads.get(x.garden.id)).toMatchObject({ spaceId: x.garden.id, name: "Garden", leadThreadId: null, run: null, defaultProjectId: "p" });
  const visitor = await x.spawn({ projectId: "q" });
  await expect(x.leads.setLead(x.garden.id, "missing")).rejects.toThrow("no longer exists");
  expect(await x.leads.setLead(x.garden.id, visitor.id)).toMatchObject({ leadThreadId: visitor.id });
  // A thread from another space's project joins this one.
  expect(x.spaces.threads.explicit(visitor.id)).toBe(x.garden.id);
  // A thread already in the space through its project isn't added.
  const local = await x.spawn({ projectId: "p" });
  await x.leads.setLead(x.garden.id, local.id);
  expect(x.spaces.threads.explicit(local.id)).toBeNull();
  expect(x.spawn).toHaveBeenCalledTimes(2);

  x.threads.delete(local.id);
  expect(await x.leads.get(x.garden.id)).toMatchObject({ leadThreadId: null });
});

it("clearing the lead turns the heartbeat off; a new lead takes it over", async () => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" });
  const next = await x.spawn({ projectId: "p" });
  await x.leads.setLead(x.garden.id, next.id);
  const update = x.callRpc.mock.calls.filter(([arg]) => arg.method === "automations_update").at(-1)![0] as unknown as { input: { execution: { targetThreadId: string } } };
  expect(update.input.execution.targetThreadId).toBe(next.id);
  expect(await x.leads.setLead(x.garden.id, null)).toMatchObject({ leadThreadId: null, run: { enabled: false } });
  expect(x.automations).toHaveLength(0);
});

it("keeps the old lead when the heartbeat can't move to the new one", async () => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" });
  const next = await x.spawn({ projectId: "q" });
  x.threads.set(next.id, { ...next, providerId: null } as never);
  await expect(x.leads.setLead(x.garden.id, next.id)).rejects.toThrow("provider");
  expect(await x.leads.get(x.garden.id)).toMatchObject({ leadThreadId: "t1", run: { enabled: true } });
  expect(x.spaces.threads.explicit(next.id)).toBeNull();
});

it("keeps each thread in one space and maps threads to their space", async () => {
  const x = await setup();
  const { id: threadId } = await x.spawn({ projectId: "p" });
  x.spaces.add(x.garden.id, [{ pluginId: THREAD_REF, id: threadId }]);
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

  const put = (id: string, projectId: string, extra: Partial<ReturnType<typeof makeThreadResponse>> = {}) => x.threads.set(id, makeThreadResponse({ id, projectId, title: id, updatedAt: 500, ...extra }));
  put("implicit", "p");
  put("archived", "p", { archivedAt: 3 });
  put("moved", "p");
  put("visitor", "q");
  x.spaces.add(x.kitchen.id, [{ pluginId: THREAD_REF, id: "moved" }]);
  x.spaces.add(x.garden.id, [{ pluginId: THREAD_REF, id: "visitor" }]);
  const map = await x.leads.spaceOfThreads();
  expect(map).toMatchObject({ implicit: x.garden.id, moved: x.kitchen.id, visitor: x.garden.id });
  expect(map.archived).toBeUndefined();
  // Cached until membership changes.
  expect(await x.leads.spaceOfThreads()).toBe(map);
  x.spaces.add(x.kitchen.id, [{ pluginId: THREAD_REF, id: "implicit" }]);
  expect((await x.leads.spaceOfThreads()).implicit).toBe(x.kitchen.id);
});

it("turns the heartbeat on and off through Automations", async () => {
  const x = await setup();
  await expect(x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" })).rejects.toThrow("lead");
  await lead(x);
  expect(await x.leads.setRun(x.garden.id, { enabled: true, cadence: "weekdays", time: "08:30" })).toMatchObject({ run: { enabled: true, cadence: "weekdays", time: "08:30" } });
  const create = x.callRpc.mock.calls.find(([arg]) => arg.method === "automations_create")![0] as unknown as { input: { trigger: { cron: string }; execution: { targetThreadId: string; prompt: string } } };
  expect(create.input.trigger.cron).toBe("30 8 * * 1-5");
  expect(create.input.execution).toMatchObject({ targetThreadId: "t1", prompt: expect.stringContaining("Heartbeat") });
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "hourly" });
  expect(x.automations).toHaveLength(1);
  expect(await x.leads.setRun(x.garden.id, { enabled: false, cadence: "hourly" })).toMatchObject({ run: { enabled: false } });
  expect(x.automations).toHaveLength(0);
});

it("keeps a space's heartbeat row when Automations can't turn it off", async () => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" });
  x.callRpc.mockRejectedValueOnce(Object.assign(new Error("Automations is down"), { status: 503 }));
  await expect(x.leads.removeSpace(x.garden.id)).rejects.toThrow("Automations is down");
  expect(x.leads.runs.get(x.garden.id)).toMatchObject({ enabled: true });
  await x.leads.removeSpace(x.garden.id);
  expect(x.leads.runs.get(x.garden.id)).toBeNull();
  expect(x.automations).toHaveLength(0);
});

it("refuses to remove the default space without touching its lead or heartbeat", async () => {
  const x = await setup();
  const personal = x.spaces.defaultSpace().id;
  await lead(x, personal);
  await x.leads.setRun(personal, { enabled: true, cadence: "daily" });
  await expect(x.leads.removeSpace(personal)).rejects.toThrow("default space");
  expect(x.leads.runs.get(personal)).toMatchObject({ enabled: true });
  expect((await x.leads.get(personal)).leadThreadId).toBe("t1");
  expect(x.automations).toHaveLength(1);
});

it("hands a lead off to a new thread that stays the lead, once", async () => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" });
  const { threadId } = await x.leads.handoff("t1", request);
  expect(threadId).toBe("t2");
  const args = x.spawn.mock.calls[1]![0] as unknown as { projectId: string; pluginMetadata: unknown; input: { text: string; visibility?: string }[] };
  expect(args).toMatchObject({ projectId: "p", pluginMetadata: { role: "space-lead", spaceId: x.garden.id, handoffFrom: "t1" } });
  expect(args.input[0]).toMatchObject({ visibility: "agent-only" });
  for (const text of ["/threads/t1", "Planted the seeds.", "lead"]) expect(args.input[0]!.text).toContain(text);
  expect(x.archive).toHaveBeenCalledWith({ threadId: "t1" });
  expect(await x.leads.get(x.garden.id)).toMatchObject({ leadThreadId: "t2" });
  expect(x.spaces.threads.explicit("t2")).toBe(x.garden.id);
  const update = x.callRpc.mock.calls.filter(([arg]) => arg.method === "automations_update").at(-1)![0] as unknown as { input: { execution: { targetThreadId: string } } };
  expect(update.input.execution.targetThreadId).toBe("t2");
  expect(await x.leads.handoff("t1", request)).toEqual({ threadId: "t2" });
  expect(x.spawn).toHaveBeenCalledTimes(2);
  expect(x.archive).toHaveBeenCalledTimes(1);
});

it("a repeated handoff of an old lead doesn't take the lead back from a newer one", async () => {
  const x = await setup();
  await lead(x);
  await x.leads.setRun(x.garden.id, { enabled: true, cadence: "daily" });
  await x.leads.handoff("t1", request);
  const other = await x.spawn({ projectId: "p" });
  await x.leads.setLead(x.garden.id, other.id);
  expect(await x.leads.handoff("t1", request)).toEqual({ threadId: "t2" });
  expect(await x.leads.get(x.garden.id)).toMatchObject({ leadThreadId: other.id, run: { enabled: true } });
  const update = x.callRpc.mock.calls.filter(([arg]) => arg.method === "automations_update").at(-1)![0] as unknown as { input: { execution: { targetThreadId: string } } };
  expect(update.input.execution.targetThreadId).toBe(other.id);
});

it("hands off a worker in place: an added thread stays added", async () => {
  const x = await setup();
  const { id: threadId } = await x.spawn({ projectId: "p" });
  x.spaces.add(x.kitchen.id, [{ pluginId: THREAD_REF, id: threadId }]);
  const next = await x.leads.handoff(threadId, request);
  expect(x.spaces.threads.explicit(next.threadId)).toBe(x.kitchen.id);
  expect((x.spawn.mock.calls[1]![0] as unknown as { pluginMetadata: unknown }).pluginMetadata).toEqual({ handoffFrom: threadId });
  expect(await x.leads.get(x.kitchen.id)).toMatchObject({ leadThreadId: null });
});
