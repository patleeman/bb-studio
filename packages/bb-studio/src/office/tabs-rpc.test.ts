import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { MIGRATIONS } from "../migrations";
import { StudioHub, type HubItem, type LocalProvider } from "../hub";
import { initializeOffice } from "./server";
import { ModuleServices } from "../modules/services";
import { officeTabsContract } from "./tabs-contract";
import type { OfficeInput, OfficeOutput } from "./contract";

const cleanups: (() => Promise<void>)[]=[];
afterEach(async()=>{ for (const close of cleanups.splice(0)) await close(); });
async function setup() {
  const projects=["proj_personal","work"].map(id=>({id,name:id,kind:"personal" as const,sources:[],gitRemoteUrl:null,createdAt:1,updatedAt:1}));
  const {bb,harness}=createFakePluginHost({pluginId:"studio",sdk:{
    projects:{list:async()=>projects},
    threads:{list:async()=>[],search:async()=>({active:{results:[]},archived:{results:[]}}) as never,get:async({threadId})=>{ if(threadId==="deleted") throw Object.assign(new Error("not found"),{status:404}); return makeThreadResponse({id:threadId,projectId:threadId==="other"?"work":"proj_personal"}); }},
    plugins:{list:async()=>({plugins:[]}),experimental_discoverRpc:async()=>[]},
  }});
  cleanups.push(()=>harness.lifecycle.dispose());
  const db=bb.storage.database();bb.storage.migrate(db,MIGRATIONS);
  let items:HubItem[]=[{pluginId:"studio",id:"a",kind:"artifact",title:"Launch report",icon:"📄",projectId:"proj_personal",parentId:null,createdAt:1,updatedAt:1,updatedBy:null,preview:null,facts:[],badge:null,thumbnailUrl:null,href:"/plugins/studio/artifacts/a",archived:false}];
  const kind={id:"artifact",label:"Artifact",plural:"Artifacts",icon:"File",columns:[],actions:[],create:null,canArchive:true,blurb:"",agentInstructions:""};
  const local: LocalProvider = { kinds: [kind], items: () => items,
    call: async (_method, input) => ({ content: `Only in body: launch needle ${(input as { id?: string }).id ?? ""}` }) as never,
  };
  const hub=new StudioHub(bb.sdk,local);
  const modules=new ModuleServices();
  const rpc={input:z.unknown(),output:z.unknown()};
  let bots=["Zoe","Ada","Bea","Cal"].map(name=>({id:name.toLowerCase(),name:`Launch ${name}`,avatar:"🤖",description:"",projectId:"proj_personal",model:"model",providerId:"hermes",working:false}));
  modules.register("bot-teams",{list:rpc,office_talk:rpc,office_attention:rpc,office_create_requests:rpc},{
    list:()=>({bots,botCreateRequests:[]}),
    office_talk:()=>({conversations:[{id:"channel",title:"Launch channel",projectId:"proj_personal",memberBotIds:["ada","bea"],isDirect:false,needsYou:true,unread:true,href:"/plugins/studio/channels/channel"}]}),
    office_attention:()=>({attention:[]}),office_create_requests:()=>({requests:[]}),
  });
  const office=await initializeOffice(bb,db,hub,{moduleServices:modules});
  const spaceId=office.spaces.office.defaultSpace().id;
  const other=office.spaces.office.create({name:"Other"});office.spaces.office.setCatchAll(other.id,"work");
  const call=async <M extends keyof typeof officeTabsContract>(method:M,input:OfficeInput<M>)=>await harness.behavior.callRpc(method,input) as OfficeOutput<M>;
  return {bb,harness,db,office,spaceId,otherSpaceId:other.id,call,hub,removeItems:()=>{items=[];},removeBots:()=>{bots=[];},addOtherItems:()=>{items.push(...Array.from({length:110},(_,i)=>({...items[0]!,id:`other-${i}`,projectId:"work",title:"Launch report",updatedAt:999,href:`/plugins/studio/artifacts/other-${i}`})));}};
}

it("serves every tab RPC through schema validation, resolves routes and metadata, and publishes mutations",async()=>{
  const {call,spaceId,harness,db}=await setup();
  const signalCount=()=>harness.realtimeSignals.length;
  expect((await call("tabs_get",{spaceId})).seeded).toBe(false);
  await call("tabs_seed",{spaceId,pinnedThreadIds:["favorite","favorite","other","deleted"]});
  let tabs=await call("tabs_get",{spaceId});
  expect(tabs.seeded).toBe(true);
  expect(tabs.essentials.map(t=>t.ref)).toEqual(["office:inbox","bot:ada","bot:bea","bot:cal"]);
  expect(tabs.pinned).toMatchObject([{ref:"thread:favorite",title:null,href:null}]);
  expect(tabs.today).toEqual([]);
  const count=signalCount();await call("tabs_seed",{spaceId,pinnedThreadIds:["again"]});expect(signalCount()).toBe(count);
  for (const [href,ref] of [["/plugins/studio/office","office:home"],["/plugins/studio/office-inbox","office:inbox"],["/plugins/studio/office-team/ada/tasks","bot:ada"],["/plugins/studio/studio","library"],["/plugins/studio/studio/artifact","library:artifact"],["/plugins/studio/artifacts/a/details?x=1","item:studio:a"],["/plugins/studio/channels/channel","conversation:channel"]]) {
    const before=signalCount(); const opened=await call("tabs_open",{spaceId,href:href!});
    expect(opened.tab?.ref).toBe(ref); expect(signalCount()).toBeGreaterThan(before);
  }
  expect((await call("tabs_open",{spaceId,ref:"bot:ada"})).tab).toMatchObject({title:"Launch Ada",providerId:"hermes",botState:"idle",href:"/plugins/studio/office-team/ada"});
  expect((await call("tabs_open",{spaceId,ref:"office:inbox"})).tab).toMatchObject({badge:0,href:"/plugins/studio/office-inbox"});
  expect((await call("tabs_open",{spaceId,ref:"conversation:channel"})).tab).toMatchObject({needsYou:true,unread:true});
  for (const href of ["/unmatched","https://example.com/plugins/studio/office","//example.com","/plugins/studio/office-team/%E0%A4%A"]) expect(await call("tabs_open",{spaceId,href})).toEqual({tab:null,spaceId});
  await expect(call("tabs_open",{spaceId,ref:"folder:work"})).rejects.toThrow();
  await expect(harness.behavior.callRpc("tabs_open",{spaceId,ref:"library",href:"/plugins/studio/office"})).rejects.toThrow();
  const beforeFolder=signalCount();const {folder}=await call("tab_folder_create",{spaceId,name:"Reading"});
  await call("tabs_move",{spaceId,ref:"item:studio:a",zone:"pinned",folderId:folder.id,index:0});
  expect((await call("tab_folder_update",{folderId:folder.id,name:"Read later",open:false,position:0})).folder.open).toBe(false);
  await call("tab_folder_delete",{folderId:folder.id});expect(signalCount()).toBe(beforeFolder+4);
  tabs=await call("tabs_get",{spaceId});expect(tabs.pinned[0]).toMatchObject({ref:"item:studio:a",folderId:null});
  await call("tabs_move",{spaceId,ref:"item:studio:a",zone:"archived"});
  expect((await call("tabs_archived",{spaceId,query:"report",limit:1})).tabs[0]?.ref).toBe("item:studio:a");
  expect((await call("tabs_open",{spaceId,ref:"item:studio:a"})).tab?.zone).toBe("today");
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(harness.realtimeSignals.every(s=>s.channel==="studio-changed")).toBe(true);
});

it("office_search mixes item, bot, channel and library hits, scopes before limiting, and reports existing zones",async()=>{
  const {call,spaceId,addOtherItems}=await setup();addOtherItems();
  await call("tabs_open",{spaceId,ref:"bot:ada"});await call("tabs_move",{spaceId,ref:"bot:ada",zone:"pinned"});
  const hits=(await call("office_search",{spaceId,query:"Launch"})).results;
  expect(hits.map(t=>t.kind)).toEqual(expect.arrayContaining(["item","bot","conversation"]));
  expect(hits.find(t=>t.ref==="bot:ada")?.zone).toBe("pinned");
  expect(hits.find(t=>t.ref==="item:studio:a")?.zone).toBe("archived");
  expect(hits.some(t=>t.ref.includes("other-"))).toBe(false);
  expect((await call("office_search",{spaceId,query:"Artifacts"})).results).toEqual(expect.arrayContaining([expect.objectContaining({ref:"library:artifact",href:"/plugins/studio/studio/artifact"})]));
  expect((await call("office_search",{spaceId,query:"needle"})).results).toEqual([expect.objectContaining({ref:"item:studio:a"})]);
  expect((await call("office_search",{spaceId,query:"",limit:1})).results).toHaveLength(1);
});

it("prunes deleted items and bots and lazily archives on tabs_get with realtime",async()=>{
  const {call,spaceId,db,harness,removeItems,removeBots}=await setup();
  await call("tabs_open",{spaceId,ref:"item:studio:a"});await call("tabs_open",{spaceId,ref:"bot:ada"});
  removeItems();removeBots();const before=harness.realtimeSignals.length;
  expect((await call("tabs_get",{spaceId})).today).toEqual([]);
  expect(db.prepare("SELECT * FROM office_tabs").all()).toEqual([]);expect(harness.realtimeSignals.length).toBeGreaterThan(before);
  await call("tabs_open",{spaceId,ref:"thread:old"});
  db.prepare("UPDATE office_tabs SET opened_at=1").run();
  expect((await call("tabs_get",{spaceId})).today).toEqual([]);
  expect((await call("tabs_archived",{spaceId})).tabs[0]).toMatchObject({ref:"thread:old",title:null,href:null});
});

it("preserves saved item tabs on provider failure and retries concurrent seeding only once", async () => {
  const { call, spaceId, hub, db, harness } = await setup();
  await call("tabs_open", { spaceId, ref: "item:studio:a" });
  const read = vi.spyOn(hub, "itemsResult").mockResolvedValue({ status: "unavailable", error: "Temporarily offline" });
  await expect(call("tabs_get", { spaceId })).rejects.toThrow("Temporarily offline");
  expect(db.prepare("SELECT ref FROM office_tabs").all()).toEqual([{ ref: "item:studio:a" }]);
  read.mockRestore();
  const before = harness.realtimeSignals.length;
  await Promise.all([call("tabs_seed", { spaceId, pinnedThreadIds: ["one"] }), call("tabs_seed", { spaceId, pinnedThreadIds: ["two"] })]);
  const tabs = await call("tabs_get", { spaceId });
  expect(tabs.pinned).toHaveLength(1);
  expect(tabs.essentials).toHaveLength(4);
  expect(tabs.today.map(t => t.ref)).toEqual(["item:studio:a"]);
  expect(harness.realtimeSignals.length).toBe(before + 1);
  await harness.behavior.callRpc("space_settings_set", { spaceId, settings: { todayArchiveAfter: "never" } });
  await harness.behavior.callRpc("space_settings_set", { spaceId, settings: { defaultTrust: "act" } });
  expect(await harness.behavior.callRpc("space_settings_get", { spaceId })).toMatchObject({ settings: { todayArchiveAfter: "never", defaultTrust: "act" } });
});

it("creates ordered splits, deduplicates, archives/reopens, and restores panes in order", async () => {
  const { call, spaceId, db, harness } = await setup();
  const refs = ["thread:one", "item:studio:a", "bot:ada"];
  for (const ref of refs) await call("tabs_open", { spaceId, ref });
  const before = harness.realtimeSignals.length;
  const { tab } = await call("tabs_split_create", { spaceId, refs });
  expect(harness.realtimeSignals.length).toBe(before + 1);
  expect(tab).toMatchObject({ kind: "split", title: "Thread | Launch report | Launch Ada", zone: "today", href: null });
  expect(tab.members?.map(m => m.ref)).toEqual(refs);
  expect((await call("tabs_get", { spaceId })).today.map(t => t.ref)).toEqual([tab.ref]);
  expect((await call("tabs_split_create", { spaceId, refs })).tab.ref).toBe(tab.ref);
  expect(db.prepare("SELECT * FROM office_tab_splits").all()).toHaveLength(1);
  expect((await call("tabs_open", { spaceId, ref: "thread:one" })).tab?.ref).toBe(tab.ref);
  await call("tabs_close_many", { spaceId, refs: [tab.ref] });
  expect((await call("tabs_archived", { spaceId })).tabs[0]?.members).toHaveLength(3);
  expect((await call("tabs_reopen", { spaceId })).tab?.ref).toBe(tab.ref);
  const unsplitBefore = harness.realtimeSignals.length;
  await call("tabs_split_remove", { spaceId, ref: tab.ref });
  expect(harness.realtimeSignals.length).toBe(unsplitBefore + 1);
  expect((await call("tabs_get", { spaceId })).today.map(t => t.ref)).toEqual(refs);
  expect(db.prepare("SELECT * FROM office_tab_splits").all()).toEqual([]);
});

it("validates split members, pane order, folder scope and Essentials cap without partial writes", async () => {
  const { call, spaceId, otherSpaceId, db, harness } = await setup();
  for (let i = 0; i < 8; i++) {
    await call("tabs_open", { spaceId, ref: `thread:${i}` });
    await call("tabs_move", { spaceId, ref: `thread:${i}`, zone: "essential" });
  }
  const before = harness.realtimeSignals.length;
  await expect(call("tabs_split_create", { spaceId, refs: ["library", "office:home"], zone: "essential" })).rejects.toThrow("8 tabs");
  expect(db.prepare("SELECT * FROM office_tab_splits").all()).toEqual([]);
  expect(harness.realtimeSignals.length).toBe(before);
  for (const refs of [["library"], ["library", "library"], ["split:fake", "library"], ["library", "office:home", "bot:ada", "bot:bea", "bot:cal"], ["thread:deleted", "library"]]) {
    await expect(call("tabs_split_create", { spaceId, refs })).rejects.toThrow();
  }
  const { folder } = await call("tab_folder_create", { spaceId: otherSpaceId, name: "Elsewhere" });
  await expect(call("tabs_split_create", { spaceId, refs: ["library", "office:home"], zone: "pinned", folderId: folder.id })).rejects.toThrow("not in this Space");
  expect(db.prepare("SELECT * FROM office_tab_splits").all()).toEqual([]);
  const a = (await call("tabs_split_create", { spaceId, refs: ["library", "office:home"], zone: "pinned" })).tab;
  const b = (await call("tabs_split_create", { spaceId, refs: ["office:home", "library"] })).tab;
  expect(a.ref).not.toBe(b.ref);
  expect(a.zone).toBe("pinned");
});

it("cleans missing split members, collapses one survivor in place, and drops empty splits", async () => {
  const { call, spaceId, removeItems, removeBots, db } = await setup();
  const { folder } = await call("tab_folder_create", { spaceId, name: "Group" });
  const { tab } = await call("tabs_split_create", { spaceId, refs: ["thread:one", "item:studio:a", "bot:ada"], zone: "pinned", folderId: folder.id });
  removeItems();
  expect((await call("tabs_get", { spaceId })).pinned[0]?.members?.map(t => t.ref)).toEqual(["thread:one", "bot:ada"]);
  removeBots();
  expect((await call("tabs_get", { spaceId })).pinned).toMatchObject([{ ref: "thread:one", folderId: folder.id, zone: "pinned", openedAt: tab.openedAt }]);
  expect(db.prepare("SELECT * FROM office_tab_splits").all()).toEqual([]);
  expect(db.prepare("SELECT ref FROM office_tabs WHERE ref=?").get(tab.ref)).toBeUndefined();

  const second = await setup();
  const split = (await second.call("tabs_split_create", { spaceId: second.spaceId, refs: ["item:studio:a", "bot:ada"] })).tab;
  await second.call("tabs_close_many", { spaceId: second.spaceId, refs: [split.ref] });
  second.removeItems(); second.removeBots();
  expect(await second.call("tabs_reopen", { spaceId: second.spaceId })).toEqual({ tab: null });
  expect(second.db.prepare("SELECT * FROM office_tab_splits").all()).toEqual([]);
  expect(second.db.prepare("SELECT * FROM office_tabs").all()).toEqual([]);
});

it("moves plain tabs and splits to another Space without moving underlying work", async () => {
  const { call, spaceId, otherSpaceId, office, db, hub } = await setup();
  const beforeItem = await hub.get("studio", ["a"]);
  await call("tabs_open", { spaceId, ref: "item:studio:a" });
  await call("tabs_open", { spaceId: otherSpaceId, ref: "item:studio:a" });
  await call("tabs_move", { spaceId: otherSpaceId, ref: "item:studio:a", zone: "essential" });
  const moved = (await call("tabs_move_space", { spaceId, ref: "item:studio:a", toSpaceId: otherSpaceId })).tab;
  expect(moved).toMatchObject({ ref: "item:studio:a", zone: "today", folderId: null });
  expect((await call("tabs_get", { spaceId })).today).toEqual([]);
  expect((await call("tabs_get", { spaceId: otherSpaceId })).today.map(t => t.ref)).toEqual(["item:studio:a"]);
  expect(await hub.get("studio", ["a"])).toEqual(beforeItem);
  expect(office.spaces.office.forProject("proj_personal").id).toBe(spaceId);
  const split = (await call("tabs_split_create", { spaceId, refs: ["item:studio:a", "thread:one"] })).tab;
  const targetDuplicate = (await call("tabs_split_create", { spaceId: otherSpaceId, refs: ["item:studio:a", "thread:one"] })).tab;
  const result = await call("tabs_move_space", { spaceId, ref: split.ref, toSpaceId: otherSpaceId });
  expect(result.tab.ref).toBe(split.ref);
  expect((await call("tabs_get", { spaceId: otherSpaceId })).today.map(t => t.ref)).toEqual([split.ref]);
  expect(db.prepare("SELECT id,space_id FROM office_tab_splits").all()).toEqual([{ id: split.ref.slice(6), space_id: otherSpaceId }]);
  expect(db.prepare("SELECT * FROM office_tabs WHERE ref=?").get(targetDuplicate.ref)).toBeUndefined();
  await expect(call("tabs_move_space", { spaceId: otherSpaceId, ref: split.ref, toSpaceId: "missing" })).rejects.toThrow();
  expect((await call("tabs_get", { spaceId: otherSpaceId })).today[0]?.ref).toBe(split.ref);
});

it("bulk closes atomically with one event and reopens in close order, skipping missing targets", async () => {
  const { call, spaceId, harness, removeItems } = await setup();
  for (const ref of ["thread:a", "thread:b", "item:studio:a"]) await call("tabs_open", { spaceId, ref });
  const before = harness.realtimeSignals.length;
  await call("tabs_close_many", { spaceId, refs: ["thread:a", "thread:b", "item:studio:a", "thread:b", "thread:unknown"] });
  expect(harness.realtimeSignals.length).toBe(before + 1);
  removeItems();
  expect((await call("tabs_reopen", { spaceId })).tab?.ref).toBe("thread:b");
  expect((await call("tabs_reopen", { spaceId })).tab?.ref).toBe("thread:a");
  expect(await call("tabs_reopen", { spaceId })).toEqual({ tab: null });
  expect((await call("tabs_get", { spaceId })).today.map(t => t.ref)).toEqual(["thread:a", "thread:b"]);
});

it("follows thread and item ownership by ref and href only when requested", async () => {
  const { call, spaceId, otherSpaceId, addOtherItems, harness } = await setup();
  addOtherItems();
  expect((await call("tabs_open", { spaceId, ref: "thread:other", follow: true })).spaceId).toBe(otherSpaceId);
  expect((await call("tabs_open", { spaceId, href: "/threads/other", follow: true })).spaceId).toBe(otherSpaceId);
  expect((await call("tabs_open", { spaceId, ref: "item:studio:other-0", follow: true })).spaceId).toBe(otherSpaceId);
  expect((await call("tabs_open", { spaceId, href: "/plugins/studio/artifacts/other-1", follow: true })).spaceId).toBe(otherSpaceId);
  expect((await call("tabs_open", { spaceId, ref: "thread:other", follow: false })).spaceId).toBe(spaceId);
  for (const ref of ["bot:ada", "conversation:channel", "office:inbox", "office:home", "library"]) {
    expect((await call("tabs_open", { spaceId: otherSpaceId, ref, follow: true })).spaceId).toBe(otherSpaceId);
  }
  expect(await call("tabs_open", { spaceId, href: "/missing", follow: true })).toEqual({ tab: null, spaceId });
  const count = harness.realtimeSignals.length;
  await harness.behavior.callRpc("space_reorder", { spaceIds: [otherSpaceId, "missing", otherSpaceId] });
  expect(harness.realtimeSignals.length).toBe(count + 1);
  const spaces = await harness.behavior.callRpc("spaces_list", {}) as { spaces: { id: string; position: number }[] };
  expect(spaces.spaces.map(s => [s.id, s.position])).toEqual([[otherSpaceId, 0], [spaceId, 1]]);
});

it("preserves an archived split through provider failure, then collapses a deleted thread member", async () => {
  const { call, spaceId, hub, harness, db } = await setup();
  const { tab } = await call("tabs_split_create", { spaceId, refs: ["thread:one", "item:studio:a"] });
  await call("tabs_close_many", { spaceId, refs: [tab.ref] });
  const old = db.prepare("SELECT * FROM office_tabs WHERE ref=?").get(tab.ref) as { archived_at: number };
  const read = vi.spyOn(hub, "itemsResult").mockResolvedValue({ status: "unavailable", error: "Offline" });
  await expect(call("tabs_get", { spaceId })).rejects.toThrow("Offline");
  expect(db.prepare("SELECT refs FROM office_tab_splits").get()).toEqual({ refs: JSON.stringify(["thread:one", "item:studio:a"]) });
  read.mockRestore();
  harness.sdk.stub("threads.get", async () => { throw Object.assign(new Error("Gone"), { status: 404 }); });
  const archived = await call("tabs_archived", { spaceId });
  expect(archived.tabs).toMatchObject([{ ref: "item:studio:a", zone: "archived", archivedAt: old.archived_at }]);
  expect(db.prepare("SELECT * FROM office_tab_splits").all()).toEqual([]);
  expect((await call("tabs_reopen", { spaceId })).tab?.ref).toBe("item:studio:a");
});

it("bulk close rolls back every row and emits nothing when the database rejects a write", async () => {
  const { call, spaceId, harness, db } = await setup();
  for (const ref of ["thread:a", "thread:b"]) await call("tabs_open", { spaceId, ref });
  db.exec("CREATE TRIGGER reject_close BEFORE UPDATE OF zone ON office_tabs WHEN NEW.ref='thread:b' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  const before = harness.realtimeSignals.length;
  await expect(call("tabs_close_many", { spaceId, refs: ["thread:a", "thread:b"] })).rejects.toThrow("fixture failure");
  expect(harness.realtimeSignals.length).toBe(before);
  expect((await call("tabs_get", { spaceId })).today).toHaveLength(2);
});

it("collapses overlapping pane arrangements to one plain tab and removes a split's live panes only", async () => {
  const { call, spaceId, removeItems, removeBots, harness } = await setup();
  await call("tabs_split_create", { spaceId, refs: ["thread:one", "item:studio:a"] });
  await call("tabs_split_create", { spaceId, refs: ["item:studio:a", "thread:one"] });
  removeItems();
  expect((await call("tabs_get", { spaceId })).today.map(t => t.ref)).toEqual(["thread:one"]);
  const split = (await call("tabs_split_create", { spaceId, refs: ["thread:one", "bot:ada", "library"] })).tab;
  removeBots();
  const before = harness.realtimeSignals.length;
  await call("tabs_split_remove", { spaceId, ref: split.ref });
  expect(harness.realtimeSignals.length).toBe(before + 1);
  expect((await call("tabs_get", { spaceId })).today.map(t => t.ref)).toEqual(["thread:one", "library"]);
});
