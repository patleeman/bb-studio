import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { z } from "zod";
import { MIGRATIONS } from "../migrations";
import { ModuleServices } from "../modules/services";
import { Inbox, type SourceEvent } from "./inbox";
import { migrateOfficeSpaces } from "./migration";
import { OfficeSpaceStore } from "./space-store";
import { officeTeam } from "./team";

it("scopes bots by project and connects thread approvals to their task assignee", async () => {
  const db = new Database(":memory:");
  try {
    for (const sql of MIGRATIONS) db.exec(sql);
    migrateOfficeSpaces(db, { projectIds: ["work"], projectForMember: () => undefined, logConflict: () => {} });
    const spaces = new OfficeSpaceStore(db), work = spaces.create({ name: "Work" });
    spaces.moveProject("work", work.id);
    const event: SourceEvent = { key: "approval", projectId: "work", source: "test", type: "request", title: "Approval", body: "", botId: null, threadId: "task-thread", item: null, href: null, actions: null, createdAt: 1 };
    const inbox = new Inbox(db, [{ id: "test", list: async () => [event], act: async () => {} }], p => spaces.forProject(p).id);
    const modules = new ModuleServices();
    expect(await officeTeam(work.id, spaces, inbox, modules)).toEqual({ bots: [] });
    const rpc = { input: z.unknown(), output: z.unknown() };
    const bot = { name: "Helper", avatar: null, description: "Research", model: "", working: true };
    modules.register("bot-teams", { list: rpc }, { list: () => ({ bots: [
      { ...bot, id: "global", projectId: null }, { ...bot, id: "worker", projectId: "work", trust: "act" },
      { ...bot, id: "retired", projectId: "work", retired: true },
    ] }) });
    const task = { title: "Task", description: "", status: "doing", statusLabel: "Doing", projectId: "work", assignee: "bot:worker", archived: false, updatedAt: 1, recurrence: null, handoff: { threadId: "task-thread", state: "idle", note: null } };
    modules.register("studio-tasks", { board: rpc }, { board: () => ({ tasks: [
      { ...task, id: "active" }, { ...task, id: "done", status: "done" }, { ...task, id: "archived", archived: true },
    ] }) });
    expect((await officeTeam(work.id, spaces, inbox, modules)).bots).toMatchObject([{ id: "worker", state: "needs_you", activeTaskCount: 1, trust: "act", spaceId: work.id }]);
    inbox.mark([event.key], "done");
    expect((await officeTeam(work.id, spaces, inbox, modules)).bots[0]?.state).toBe("working");
    expect((await officeTeam(spaces.defaultSpace().id, spaces, inbox, modules)).bots).toMatchObject([{ id: "global", trust: "ask", activeTaskCount: 0 }]);
    expect((await officeTeam("all", spaces, inbox, modules)).bots).toHaveLength(2);
    await expect(officeTeam("missing", spaces, inbox, modules)).rejects.toThrow();
  } finally { db.close(); }
});
