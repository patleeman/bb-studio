import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { MIGRATIONS } from "../migrations";
import { OfficeProjects } from "./projects";
import { BotProjects } from "./bot-projects";
import { ModuleServices } from "../modules/services";
import { botSchema } from "../modules/teams/contract";
import { Inbox, type SourceEvent } from "./inbox";
import { inboxHref } from "./inbox-links";
import { officeProjectsContract } from "./projects-contract";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanups.splice(0)) await dispose(); });
const request = { projectId: "p", providerId: "claude-code", model: "model", reasoningLevel: "high" as const, permissionMode: "accept-edits" as const, executionInputSources: {}, environment: { type: "project-default" as const }, input: [{ type: "text" as const, text: "Do my work", mentions: [] }] };
function fixture() {
  const project = (id: string) => ({ id, name: id, kind: id === "personal" ? "personal" as const : "standard" as const, sources: [], createdAt: 1, updatedAt: 1, gitRemoteUrl: null });
  const threads = new Map<string, ReturnType<typeof makeThreadResponse>>();
  const pages = new Map<string, string>();
  const automations: any[] = [];
  const spawn = vi.fn(async (args: any) => { const thread = makeThreadResponse({ id: `t${threads.size + 1}`, projectId: args.projectId, providerId: args.providerId, title: args.title }); threads.set(thread.id, thread); return thread; });
  const archive = vi.fn(async () => ({ ok: true }));
  const callRpc = vi.fn(async ({ method, input }: any) => {
    if (method === "get") return { page: pages.has(input.id) ? { id: input.id } : null };
    if (method === "create") { const id = `pg_${pages.size+1}`; pages.set(id, input.markdown); return { page: { id } }; }
    if (method === "markdown") return { markdown: pages.get(input.id) };
    if (method === "editDocument") { expect(pages.get(input.id)).toBe(input.expected); pages.set(input.id, input.markdown); return { markdown: input.markdown }; }
    if (method === "automations_list") return automations.filter(a => a.projectId === input.projectId);
    if (method === "automations_create") { const a = { ...input, id: `a${automations.length+1}` }; automations.push(a); return a; }
    const a = automations.find(a => a.id === input.automationId);
    if (method === "automations_update") Object.assign(a, input);
    else if (method === "automations_resume") a.enabled = true;
    else if (method === "automations_pause") a.enabled = false;
    else if (method === "automations_delete") automations.splice(automations.indexOf(a), 1);
    else throw new Error(method);
    return { ok: true };
  });
  const createProject = vi.fn(async () => project("new"));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    projects: { get: async ({ projectId }) => project(projectId), list: async () => [project("p"), project("personal"), project("new")], create: createProject },
    threads: { spawn, archive, get: async ({ threadId }) => { const t = threads.get(threadId); if (!t) throw Object.assign(new Error("missing"), { status: 404 }); return t; }, unpin: async () => ({ ok: true }), output: async () => ({ output: "Latest progress: tests pass" }) as never, defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "high", permissionMode: "accept-edits" }) as never, updatePluginMetadata: async () => ({}) },
    plugins: { callRpc: callRpc as never },
  } });
  cleanups.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  const changed = vi.fn(); const projects = new OfficeProjects(db, bb.sdk, changed);
  return { bb, db, projects, changed, threads, pages, automations, spawn, archive, callRpc, createProject };
}

it("creates Chief of Staff with hidden instructions and the personal template", async () => {
  const x = fixture(); const result = await x.projects.setup({ projectId: "personal", request });
  expect(result).toMatchObject({ name: "Chief of Staff", role: "chief-of-staff" });
  const args = x.spawn.mock.calls[0]![0];
  expect(args.input[0]).toMatchObject({ visibility: "agent-only", text: expect.stringContaining("create and staff projects") });
  expect(args.input.slice(1)).toEqual(request.input);
  expect(x.pages.get(result.pageId!)).toContain("## What I watch");
  expect(x.pages.get(result.pageId!)).toContain("## Handed off");
  expect(args.pluginMetadata.role).toBe("chief-of-staff");
});

it("enables, updates, disables Run mode without duplicate automations", async () => {
  const x = fixture(); await x.projects.setup({ projectId: "p", request });
  for (const cadence of ["hourly", "daily", "weekdays"] as const) {
    const result = await x.projects.setRun({ projectId: "p", enabled: true, cadence, time: "13:45" });
    expect(result.run).toEqual({ enabled: true, cadence, time: "13:45" });
    expect(x.automations).toHaveLength(1);
    expect(x.automations[0].trigger.cron).toBe(cadence === "hourly" ? "45 * * * *" : cadence === "daily" ? "45 13 * * *" : "45 13 * * 1-5");
    expect(x.automations[0].execution.prompt).toContain("Heartbeat: check the project");
  }
  await x.projects.setRun({ projectId: "p", enabled: false, cadence: "daily" });
  expect(x.automations).toEqual([]);
  expect((await x.projects.get("p")).run?.enabled).toBe(false);
  await expect(x.projects.setRun({ projectId: "new", enabled: true, cadence: "daily" })).rejects.toThrow("Start the project lead");
  expect(officeProjectsContract.project_set_run.input.safeParse({ projectId: "p", enabled: true, cadence: "daily", time: "24:99" }).success).toBe(false);
});

it("hands off a lead with context, settings and note, retargets Run and retries archive safely", async () => {
  const x = fixture(); const old = await x.projects.setup({ projectId: "p", request });
  await x.projects.setRun({ projectId: "p", enabled: true, cadence: "hourly" });
  x.archive.mockRejectedValueOnce(new Error("Offline"));
  const input = { threadId: old.leadThreadId!, request: { ...request, providerId: "codex", prompt: "Please review the plan" } };
  await expect(x.projects.handoff(input)).rejects.toThrow("Offline");
  const result = await x.projects.handoff(input);
  expect(x.spawn).toHaveBeenCalledTimes(2);
  expect((await x.projects.get("p")).leadThreadId).toBe(result.threadId);
  expect(x.automations[0].execution.targetThreadId).toBe(result.threadId);
  const args = x.spawn.mock.calls[1]![0];
  expect(args).toMatchObject({ providerId: "codex", model: "model", projectId: "p" });
  expect(args.input[0].text).toContain("Latest progress: tests pass");
  expect(args.input[0].text).toContain("/threads/t1");
  expect(args.input.at(-1).text).toBe("Please review the plan");
  expect(x.archive).toHaveBeenLastCalledWith({ threadId: old.leadThreadId });
});

it("hands off a non-lead without changing the project mapping", async () => {
  const x = fixture(); const lead = await x.projects.setup({ projectId: "p", request });
  x.threads.set("other", makeThreadResponse({ id: "other", projectId: "p" }));
  await x.projects.handoff({ threadId: "other", request });
  expect((await x.projects.get("p")).leadThreadId).toBe(lead.leadThreadId);
});

it("repairs stored Inbox hrefs with thread, item, project, null fallback", async () => {
  const x = fixture();
  const base = { href: "/plugins/studio/office-team/b", threadId: null, item: null, projectId: null };
  expect(inboxHref({ ...base, threadId: "t" })).toBe("/threads/t");
  expect(inboxHref({ ...base, item: { href: "/plugins/pages/pages/p" } })).toBe("/plugins/pages/pages/p");
  expect(inboxHref({ ...base, projectId: "p" })).toBe("/plugins/studio/projects/p");
  expect(inboxHref(base)).toBeNull();
  expect(inboxHref({ ...base, href: "/plugins/studio/office-inbox" })).toBe("/plugins/studio/office-inbox");
  for (const href of ["/plugins/studio/office", "/office/talk/x", "/plugins/studio/office/talk/x", "/plugins/studio/channels/x"]) {
    const event: SourceEvent = { ...base, href, key: "legacy", source: "legacy", type: "report", title: "Old", body: "", botId: null, threadId: "t", actions: null, createdAt: 1 };
    const inbox = new Inbox(x.db, [{ id: "legacy", list: async () => [event], act: async () => {} }], () => "s");
    expect((await inbox.events())[0]!.href).toBe("/threads/t");
  }
});

function bots(x: ReturnType<typeof fixture>, chief = false, withThread = true) {
  let bot = botSchema.parse({ id: "bot_0123456789abcdef", name: chief ? "Chief of Staff" : "Gardener", handle: chief ? "chief-of-staff" : "gardener", home: "/tmp/bot", projectId: "p", hostId: "host", createdAt: 1, updatedAt: 1, lastWakeAt: 0, error: null, intervalMinutes: 60, model: "model" });
  if (withThread) x.threads.set("dm", makeThreadResponse({ id: "dm", projectId: "p", providerId: "codex" }));
  const modules = new ModuleServices(); const schema = { input: z.any(), output: z.any() };
  const call = vi.fn(async (method: string, input: any) => {
    if (method === "get") return { bot };
    if (method === "list") return { bots: [bot] };
    if (method === "document") return { text: input.file === "MISSION.md" ? "Grow food" : "No pesticides" };
    if (method === "profileThreads") return withThread ? [{ threadId: "dm" }] : [];
    if (method === "office_direct") return { threadId: withThread ? "dm" : null };
    if (method === "update") { bot = { ...bot, ...input }; return bot; }
    if (method === "retire") { bot = { ...bot, retired: true }; return bot; }
    if (method === "setThreadProfile") return {};
    throw new Error(method);
  });
  const names = ["get", "list", "document", "profileThreads", "office_direct", "update", "retire", "setThreadProfile"];
  modules.register("bot-teams", Object.fromEntries(names.map(n => [n, schema])), Object.fromEntries(names.map(n => [n, (input: any) => call(n, input)])));
  return { service: new BotProjects(x.db, x.bb.sdk, x.projects, modules, x.changed), call, id: bot.id };
}

it("overviews and imports bots idempotently, adopts DM, converts schedules and retires without deletion", async () => {
  const x = fixture(); const b = bots(x);
  expect((await b.service.overview()).bots[0]).toMatchObject({ name: "Gardener", hasMemory: true, schedules: 1, suggestion: "project" });
  const first = await b.service.migrate({ botId: b.id });
  expect(first).toMatchObject({ projectId: "new", leadThreadId: "dm", run: { enabled: true, cadence: "hourly" } });
  expect(x.pages.get(first.pageId!)).toContain("No pesticides");
  expect(x.pages.get(first.pageId!)).toContain("Grow food");
  expect(await b.service.migrate({ botId: b.id })).toEqual(first);
  expect(x.createProject).toHaveBeenCalledTimes(1);
  expect(x.pages.size).toBe(1);
  expect(x.automations).toHaveLength(1);
  expect(b.call).toHaveBeenCalledWith("setThreadProfile", { threadId: "dm", botId: null });
  expect(await b.service.retire(b.id)).toEqual({ ok: true });
  expect(x.threads.has("dm")).toBe(true);
  expect((await b.service.overview()).bots[0]!.suggestion).toBe("retire");
});

it("merges Chief of Staff into Personal and preserves its existing page and lead", async () => {
  const x = fixture(); const existing = await x.projects.setup({ projectId: "personal", request });
  const b = bots(x, true);
  const migrated = await b.service.migrate({ botId: b.id, projectId: "new" });
  expect(migrated).toMatchObject({ projectId: "personal", role: "chief-of-staff", leadThreadId: existing.leadThreadId, pageId: existing.pageId });
  expect(x.pages.get(existing.pageId!)).toContain("Do my work");
  expect(x.pages.get(existing.pageId!)).toContain("No pesticides");
  expect(x.createProject).not.toHaveBeenCalled();
});

it("defers a migrated heartbeat until a lead is started", async () => {
  const x = fixture(); const b = bots(x, false, false);
  const migrated = await b.service.migrate({ botId: b.id, projectId: "p" });
  expect(migrated.leadThreadId).toBeNull(); expect(migrated.run?.enabled).toBe(true);
  expect(x.automations).toHaveLength(0);
  await x.projects.setup({ projectId: "p", request });
  expect(x.automations).toHaveLength(1);
});

it("recovers a lost disabled heartbeat create response without duplicate schedules", async () => {
  const x = fixture(); await x.projects.setup({ projectId: "p", request });
  const original = x.callRpc.getMockImplementation()!;
  let lost = false;
  x.callRpc.mockImplementation(async args => {
    const result = await original(args);
    if (args.method === "automations_create" && !lost) { lost = true; throw new Error("Lost response"); }
    return result;
  });
  await expect(x.projects.setRun({ projectId: "p", enabled: true, cadence: "daily" })).rejects.toThrow("Lost response");
  expect(x.automations[0].enabled).toBe(false);
  expect((await x.projects.get("p")).run?.enabled).toBe(false);
  await x.projects.setRun({ projectId: "p", enabled: true, cadence: "daily" });
  expect(x.automations).toHaveLength(1);
  expect(x.automations[0].enabled).toBe(true);
});

it("does not archive the original thread when handoff spawn fails", async () => {
  const x = fixture(); const project = await x.projects.setup({ projectId: "p", request });
  x.spawn.mockRejectedValueOnce(new Error("Provider unavailable"));
  await expect(x.projects.handoff({ threadId: project.leadThreadId!, request })).rejects.toThrow("Provider unavailable");
  expect(x.archive).not.toHaveBeenCalled();
  expect((await x.projects.get("p")).leadThreadId).toBe(project.leadThreadId);
});

it("pauses original bot schedules after its project heartbeat is enabled", async () => {
  const x = fixture(); const b = bots(x);
  x.automations.push({ id: "old", name: "Old bot schedule", projectId: "p", enabled: true, trigger: { cron: "30 8 * * 1-5" }, execution: { targetThreadId: "dm" } });
  expect((await b.service.overview()).bots[0]!.schedules).toBe(2);
  const result = await b.service.migrate({ botId: b.id, projectId: "new" });
  expect(result.run).toEqual({ enabled: true, cadence: "weekdays", time: "08:30" });
  expect(x.automations.find(a => a.id === "old").enabled).toBe(false);
  expect(x.automations.filter(a => a.enabled)).toHaveLength(1);
});
