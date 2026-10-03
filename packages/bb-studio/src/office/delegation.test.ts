import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { z } from "zod";
import { MIGRATIONS } from "../migrations";
import { ModuleServices } from "../modules/services";
import { migrateOfficeSpaces } from "./migration";
import { OfficeSpaceStore } from "./space-store";
import { delegateOffice } from "./delegation";

it.each([undefined, "daily" as const])("links context before dispatch or schedule: %s", async schedule => {
  const db = new Database(":memory:");
  try {
    for (const sql of MIGRATIONS) db.exec(sql);
    migrateOfficeSpaces(db, { projectIds: ["folder"], projectForMember: () => undefined, logConflict: () => {} });
    const spaces = new OfficeSpaceStore(db), modules = new ModuleServices();
    const calls: { method: string; input: unknown }[] = [], rpc = { input: z.unknown(), output: z.unknown() };
    modules.register("bot-teams", { get: rpc }, { get: () => ({ bot: { id: "bot", projectId: "proj_personal" } }) });
    modules.register("studio-tasks", { create: rpc, link: rpc, update: rpc, get: rpc, scheduleBot: rpc }, {
      create: input => { calls.push({ method: "create", input }); return { task: { id: "task" } }; },
      link: input => { calls.push({ method: "link", input }); return { ok: true }; },
      update: input => { calls.push({ method: "update", input }); return { ok: true }; },
      scheduleBot: input => { calls.push({ method: "scheduleBot", input }); return { threadId: "thread" }; },
      get: () => ({ task: { id: "task", title: "Finish", description: "Finish", status: "in_progress", statusLabel: "Doing", projectId: "folder", assignee: "bot:bot", archived: false, updatedAt: 1, recurrence: null, handoff: { threadId: "thread", state: "working", note: null } } }),
    });
    const folders = { ensureCatchAll: async () => {}, list: async () => [{ id: "folder", spaceId: "spc_personal", name: "Folder", path: "/fixture", archived: false, isDefault: false }] };
    const hub = { overview: async () => ({ providers: [], items: [{ pluginId: "studio", id: "page", title: "Context", href: "/page", projectId: "folder", archived: false }] }) };
    const result = await delegateOffice({ botId: "bot", brief: "Finish", schedule, context: ["studio:page"] }, modules, spaces, folders, hub as never);
    expect(result).toMatchObject({ taskId: "task", task: { botId: "bot", status: "working" } });
    expect(calls.map(c => c.method)).toEqual(["create", "link", schedule ? "scheduleBot" : "update"]);
    expect(calls[0]!.input).toEqual({ title: "Finish", description: "Finish", projectId: "folder" });
    expect(calls[1]!.input).toMatchObject({ link: { itemId: "page" } });
    await expect(delegateOffice({ botId: "bot", brief: "Finish", context: ["studio:missing"] }, modules, spaces, folders, hub as never)).rejects.toThrow("Context item is unavailable");
    expect(calls).toHaveLength(3);
  } finally { db.close(); }
});
