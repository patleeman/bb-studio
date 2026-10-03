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
    threads:{list:async()=>[],get:async({threadId})=>{ if(threadId==="deleted") throw Object.assign(new Error("not found"),{status:404}); return makeThreadResponse({id:threadId,projectId:threadId==="other"?"work":"proj_personal"}); }},
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
  const other=office.spaces.office.create({name:"Other"});office.spaces.office.moveProject("work",other.id);
  const call=async <M extends keyof typeof officeTabsContract>(method:M,input:OfficeInput<M>)=>await harness.behavior.callRpc(method,input) as OfficeOutput<M>;
  return {bb,harness,db,office,spaceId,call,hub,removeItems:()=>{items=[];},removeBots:()=>{bots=[];},addOtherItems:()=>{items.push(...Array.from({length:110},(_,i)=>({...items[0]!,id:`other-${i}`,projectId:"work",title:"Launch report",updatedAt:999,href:`/plugins/studio/artifacts/other-${i}`})));}};
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
  for (const href of ["/unmatched","https://example.com/plugins/studio/office","//example.com","/plugins/studio/office-team/%E0%A4%A"]) expect(await call("tabs_open",{spaceId,href})).toEqual({tab:null});
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
