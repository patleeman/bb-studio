import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { OfficeProjects } from "./projects";
import { legacyStudioId } from "./studio-projects";
import { officeProjectsContract } from "./projects-contract";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
const request = { projectId: "ignored", providerId: "codex", model: "model", reasoningLevel: "high" as const, permissionMode: "accept-edits" as const, executionInputSources: {}, environment: { type: "project-default" as const }, input: [{ type: "text" as const, text: "Build the garden", mentions: [] }] };
function fixture() {
  const core = ["personal", "work", "second"].map(id => ({ id, name: id, kind: id === "personal" ? "personal" as const : "standard" as const, sources: [], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 }));
  const threads = new Map([makeThreadResponse({ id: "oneoff", projectId: "personal", title: "One off", updatedAt: 20 }), makeThreadResponse({ id: "native", projectId: "work", title: "Native", updatedAt: 10 })].map(t => [t.id, t]));
  const item = { id: "pg_external", pluginId: "pages", title: "Standalone note", kind: "page", href: "/plugins/pages/pages/pg_external", icon: "📄", projectId: null };
  const getItems = vi.fn(async (_pluginId: string, ids: string[]) => ids.includes(item.id) ? [item] : []);
  const createdPages: any[] = [], timers: any[] = [];
  const spawn = vi.fn(async (args: any) => { const t = makeThreadResponse({ id: `spawn${threads.size}`, projectId: args.projectId, title: args.title ?? "Worker", providerId: args.providerId }); threads.set(t.id, t); return t; });
  const callRpc = vi.fn(async ({ method, input }: any) => {
    if (method === "create") { createdPages.push(input); return { page: { id: `pg_${createdPages.length}` } }; }
    if (method === "get") return { page: { id: input.id } };
    if (method === "automations_list") return timers;
    if (method === "automations_create") { const a = { ...input, id: `auto${timers.length}` }; timers.push(a); return a; }
    if (method === "automations_update") { Object.assign(timers.find(t => t.id === input.automationId), input); return {}; }
    if (method === "automations_resume") return {};
    if (method === "automations_delete") { timers.splice(timers.findIndex(t => t.id === input.automationId), 1); return {}; }
    throw new Error(method);
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    projects: { list: async () => core, get: async ({ projectId }) => { const p = core.find(p => p.id === projectId); if (!p) throw new Error("Missing BB project"); return p; } },
    threads: { spawn, list: async ({ offset = 0, limit = 200 } = {}) => [...threads.values()].slice(offset, offset + limit), get: async ({ threadId }) => { const t = threads.get(threadId); if (!t) throw Object.assign(new Error("missing"), { status: 404 }); return t; }, unpin: async () => ({ ok: true }), defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "high" }) as never },
    plugins: { callRpc: callRpc as never },
  } });
  cleanup.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  const changed = vi.fn(); const service = new OfficeProjects(db, bb.sdk, changed, { get: getItems } as never);
  return { db, bb, service, changed, threads, item, getItems, createdPages, spawn, timers, core };
}

it("migrates BB projects and Chief of Staff once, carrying lead/page/run and bot mappings", async () => {
  const x = fixture();
  x.db.prepare("INSERT INTO office_projects VALUES (?,?,?,?,?)").run("work", "native", "pg_old", 1, 2);
  x.db.prepare("INSERT INTO office_projects VALUES (?,?,?,?,?)").run("personal", "oneoff", "pg_chief", 1, 2);
  x.db.prepare("INSERT INTO office_project_runs VALUES (?,?,?,?,?,?)").run("work", 1, "daily", "09:00", "oldauto", "work");
  x.db.prepare("INSERT INTO office_bot_projects VALUES (?,?,?)").run("bot", "work", "pg_old");
  const projects = (await x.service.list()).projects;
  expect(projects).toHaveLength(3);
  expect(projects[0]).toMatchObject({ role: "chief-of-staff", bbProjectId: null, leadThreadId: "oneoff", pageId: "pg_chief" });
  const work = projects.find(p => p.bbProjectId === "work")!;
  expect(work).toMatchObject({ id: legacyStudioId("work"), projectId: legacyStudioId("work"), leadThreadId: "native", pageId: "pg_old", run: { enabled: true, cadence: "daily" } });
  expect(x.db.prepare("SELECT project_id FROM office_bot_projects").get()).toEqual({ project_id: work.id });
  await x.service.update({ projectId: work.id, name: "Renamed" });
  const restarted = new OfficeProjects(x.db, x.bb.sdk, x.changed);
  expect((await restarted.list()).projects).toHaveLength(3);
  expect((await restarted.get("work")).name).toBe("Renamed");
  expect((await restarted.get("personal")).id).toBe(projects[0]!.id);
});

it("creates without a BB folder and validates names/connections without changing core", async () => {
  const x = fixture();
  const p = await x.service.create({ name: "  My writing  " });
  expect(p.id).toMatch(/^sp_/);
  expect(p).toMatchObject({ name: "My writing", bbProjectId: null, pageId: null, leadThreadId: null });
  expect(x.spawn).not.toHaveBeenCalled();
  expect(x.createdPages).toHaveLength(0);
  expect(x.core.map(p => p.name)).toEqual(["personal", "work", "second"]);
  await expect(x.service.create({ name: "\n" })).rejects.toThrow();
  await expect(x.service.create({ name: "Duplicate", bbProjectId: "work" })).rejects.toThrow("already connected");
  await expect(x.service.update({ projectId: p.id, bbProjectId: "personal" })).rejects.toThrow("Personal");
  expect(officeProjectsContract.project_create.input.safeParse({ name: "Bad\u0000name" }).success).toBe(false);
});

it("resolves implicit + explicit membership, moves refs, and unlinks implicit threads to one-offs", async () => {
  const x = fixture(); const a = await x.service.create({ name: "A" }), b = await x.service.create({ name: "B" });
  expect((await x.service.links.all()).threads).toEqual({ native: legacyStudioId("work") });
  await x.service.membershipMutation(a.id, ["thread:oneoff", "item:pages:pg_external", "thread:native"]);
  expect((await x.service.links.all()).threads).toEqual({ oneoff: a.id, native: a.id });
  expect((await x.service.links.all()).items).toEqual([{ ref: "item:pages:pg_external", projectId: a.id, title: "Standalone note", kind: "page", href: x.item.href, icon: "📄" }]);
  expect(x.item.projectId).toBeNull();
  await x.service.membershipMutation(b.id, ["thread:oneoff", "item:pages:pg_external"]);
  expect((await x.service.links.all()).threads.oneoff).toBe(b.id);
  expect((await x.service.links.all()).items[0]!.projectId).toBe(b.id);
  await x.service.membershipMutation(null, ["thread:native", "thread:oneoff", "item:pages:pg_external"]);
  expect(await x.service.links.all()).toEqual({ threads: {}, items: [] });
  await x.service.membershipMutation(a.id, ["thread:native"]);
  expect((await x.service.threads(a.id)).threads).toMatchObject([{ id: "native", linked: true }]);
  expect((await x.service.threads("work")).threads).toEqual([]);
  const chief = (await x.service.list()).projects.find(p => p.role === "chief-of-staff")!;
  await x.service.membershipMutation(chief.id, ["thread:oneoff"]);
  expect((await x.service.links.all()).threads.oneoff).toBe(chief.id);
});

it("validates a whole link batch before saving and emits one membership change", async () => {
  const x = fixture(); const p = await x.service.create({ name: "A" });
  x.changed.mockClear();
  await expect(x.service.links.link(p.id, ["thread:oneoff", "item:pages:missing"])).rejects.toThrow("Item no longer exists");
  expect(x.service.links.rows()).toEqual([]);
  expect(x.changed).not.toHaveBeenCalled();
  await x.service.links.link(p.id, ["thread:oneoff", "item:pages:pg_external"]);
  expect(x.changed).toHaveBeenCalledTimes(1);
  const reads = x.getItems.mock.calls.length;
  await x.service.links.all(); await x.service.links.all();
  expect(x.getItems).toHaveBeenCalledTimes(reads);
});

it("spawns leads/workers in Personal or connected BB project and auto-links their refs", async () => {
  const x = fixture(); const detached = await x.service.create({ name: "Writing" });
  await x.service.membershipMutation(detached.id, ["thread:oneoff", "item:pages:pg_external"]);
  const lead = await x.service.setup({ projectId: detached.id, request });
  expect(x.spawn.mock.calls[0]![0].projectId).toBe("personal");
  expect(x.spawn.mock.calls[0]![0].input[0].text).toContain("Standalone note");
  expect(x.spawn.mock.calls[0]![0].input[0].text).toContain("thread:oneoff");
  expect(x.createdPages[0].projectId).toBeNull();
  const worker = await x.service.start({ projectId: detached.id, request });
  expect((await x.service.links.all()).threads[worker.threadId]).toBe(detached.id);
  expect((await x.service.links.all()).threads[lead.leadThreadId!]).toBe(detached.id);
  expect((await x.service.links.all()).items.find(i => i.ref === `item:pages:${lead.pageId}`)?.projectId).toBe(detached.id);
  await x.service.start({ projectId: "work", request });
  expect(x.spawn.mock.calls.at(-1)![0].projectId).toBe("work");
  await x.service.setRun({ projectId: detached.id, enabled: true, cadence: "daily" });
  expect(x.timers[0].execution.prompt).toContain("item:pages:pg_external");
  await x.service.membershipMutation(null, ["item:pages:pg_external"]);
  expect(x.timers[0].execution.prompt).not.toContain("item:pages:pg_external");
});

it("renames, reorders, archives and restores Studio projects without deleting members or BB projects", async () => {
  const x = fixture(); const a = await x.service.create({ name: "A" }), b = await x.service.create({ name: "B" });
  const renamed = await x.service.update({ projectId: a.id, name: "New name", icon: "✍️" });
  expect(renamed).toMatchObject({ name: "New name", icon: "✍️" });
  const first = (await x.service.list()).projects[0]!;
  await x.service.store.reorder({ projectId: b.id, previousProjectId: null, nextProjectId: first.id });
  expect((await x.service.list()).projects[0]!.id).toBe(b.id);
  const lead = await x.service.setup({ projectId: a.id, request });
  await x.service.setRun({ projectId: a.id, enabled: true, cadence: "daily" });
  const archived = await x.service.archive(a.id, true);
  expect(archived.archivedAt).not.toBeNull();
  expect(archived.run?.enabled).toBe(false);
  expect(x.timers).toHaveLength(0);
  expect((await x.service.links.all()).threads[lead.leadThreadId!]).toBeUndefined();
  expect((await x.service.links.all()).items.some(item => item.projectId === a.id)).toBe(false);
  expect(x.service.links.rows(a.id)).not.toHaveLength(0);
  expect(x.threads.has(lead.leadThreadId!)).toBe(true);
  expect(x.core).toHaveLength(3);
  await expect(x.service.start({ projectId: a.id, request })).rejects.toThrow("Restore");
  expect((await x.service.archive(a.id, false)).archivedAt).toBeNull();
  expect((await x.service.links.all()).threads[lead.leadThreadId!]).toBe(a.id);
  const chief = (await x.service.list()).projects.find(p => p.role === "chief-of-staff")!;
  await expect(x.service.archive(chief.id, true)).rejects.toThrow("Chief of Staff");
});
