import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { ModuleServices } from "../modules/services";
import { z } from "zod";
import { migrateOfficeSpaces } from "./migration";
import { OfficeSpaceStore } from "./space-store";
import { Inbox, type SourceEvent } from "./inbox";
import { officeHome } from "./home";

it("keeps global work in Personal and projects each Home from the same Inbox", async () => {
  const db = new Database(":memory:"); for (const sql of MIGRATIONS) db.exec(sql);
  migrateOfficeSpaces(db, { projectIds: ["work"], projectForMember: () => undefined, logConflict: () => {} });
  const spaces = new OfficeSpaceStore(db); const work = spaces.create({ name: "Work" }); spaces.moveProject("work",work.id);
  const source = { id: "test", list: async (): Promise<SourceEvent[]> => [{ key: "r1", projectId: null, source: "test", type: "request", title: "Global", body: "", botId: null, threadId: null, item: null, href: null, actions: null, createdAt: 1 }], act: async () => {} };
  const inbox = new Inbox(db,[source], p => spaces.forProject(p).id);
  const hub = { overview: async () => ({ providers: [], items: [
    { pluginId: "studio",id:"global",kind:"artifact",projectId:null,archived:false,title:"Global",href:"/global",updatedAt:1 },
    { pluginId: "studio",id:"work",kind:"artifact",projectId:"work",archived:false,title:"Work",href:"/work",updatedAt:2 },
  ] }) };
  const modules = new ModuleServices();
  modules.register("studio-tasks",{ board: {input:z.unknown(),output:z.unknown()} }, {board: () => ({tasks:[{id:"task",title:"Delegation",description:"",status:"in_progress",statusLabel:"Doing",projectId:"work",assignee:"bot:bot",archived:false,updatedAt:1,recurrence:null,handoff:{threadId:"thread",state:"blocked",note:"Need input"}}]})});
  const personal = await officeHome(spaces.defaultSpace().id,inbox,spaces,hub as never,modules);
  expect(personal.needsYou.map(e => e.key)).toEqual(["r1"]);
  expect(personal.recent.map(i => i.id)).toEqual(["global"]);
  expect(personal.working).toEqual([]);
  const office = await officeHome(work.id,inbox,spaces,hub as never,modules);
  expect(office.needsYou).toEqual([]); expect(office.recent.map(i => i.id)).toEqual(["work"]);
  expect(office.working).toMatchObject([{id:"task",status:"waiting",botId:"bot"}]);
  db.close();
});
