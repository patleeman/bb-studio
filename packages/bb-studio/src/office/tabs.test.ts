import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { migrateOfficeSpaces } from "./migration";
import { OfficeSpaceStore } from "./space-store";
import { OfficeTabs } from "./tabs";
import { officeTabHandlers } from "./tab-service";
import type { TabTarget } from "./tabs-contract";

const databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
function setup() {
  const db = new Database(":memory:"); databases.push(db); db.pragma("foreign_keys=ON");
  MIGRATIONS.forEach(sql => db.exec(sql));
  migrateOfficeSpaces(db, { projectIds: [], projectForMember: () => undefined, logConflict: () => {} });
  const spaces = new OfficeSpaceStore(db), spaceId = spaces.defaultSpace().id;
  let time = 1_800_000_000_000;
  const changed = vi.fn();
  const store = new OfficeTabs(db, spaces, changed, () => time);
  return { db, spaces, spaceId, store, changed, advance: (ms: number) => { time += ms; } };
}
const refs = (store: OfficeTabs, spaceId: string, zone: string, folderId: string | null = null) => store.rows(spaceId).filter(t => t.zone === zone && t.folder_id === folderId).map(t => t.ref);

describe("office tab storage", () => {
  it("opens at Today top, touches existing tabs without reordering, and revives archives", () => {
    const { store, spaceId, advance, changed } = setup();
    store.open(spaceId, "thread:a"); advance(10); store.open(spaceId, "thread:b");
    const opened = store.rows(spaceId).find(t => t.ref === "thread:a")!.opened_at;
    advance(10); store.open(spaceId, "thread:a");
    expect(refs(store, spaceId, "today")).toEqual(["thread:b", "thread:a"]);
    expect(store.rows(spaceId).find(t => t.ref === "thread:a")!.opened_at).toBeGreaterThan(opened);
    store.move(spaceId, "thread:a", "archived");
    expect(store.rows(spaceId).find(t => t.ref === "thread:a")!.archived_at).not.toBeNull();
    store.open(spaceId, "thread:a");
    expect(refs(store, spaceId, "today")).toEqual(["thread:a", "thread:b"]);
    expect(store.rows(spaceId)[0]!.archived_at).toBeNull();
    expect(changed).toHaveBeenCalledTimes(5);
  });
  it("adds to the end of Essentials and Pinned, and to the top of Today", () => {
    const { store, spaceId } = setup();
    for (const ref of ["thread:a", "thread:b", "thread:c", "thread:d"]) store.open(spaceId, ref);
    store.move(spaceId, "thread:a", "essential"); store.move(spaceId, "thread:b", "essential");
    store.move(spaceId, "thread:c", "pinned"); store.move(spaceId, "thread:d", "pinned");
    expect(refs(store, spaceId, "essential")).toEqual(["thread:a", "thread:b"]);
    expect(refs(store, spaceId, "pinned")).toEqual(["thread:c", "thread:d"]);
    store.open(spaceId, "thread:e"); store.move(spaceId, "thread:c", "today");
    expect(refs(store, spaceId, "today")).toEqual(["thread:c", "thread:e"]);
  });
  it("pins, reorders, unpins and enforces the Essentials cap atomically", () => {
    const { store, spaceId, advance } = setup();
    for (let i=0; i<9; i++) { store.open(spaceId, `thread:${i}`); if (i<8) store.move(spaceId, `thread:${i}`, "essential"); }
    expect(() => store.move(spaceId, "thread:8", "essential")).toThrow("8 tabs");
    expect(refs(store, spaceId, "essential")).toHaveLength(8);
    store.move(spaceId, "thread:0", "essential", null, 0);
    expect(refs(store, spaceId, "essential")[0]).toBe("thread:0");
    store.move(spaceId, "thread:0", "pinned");
    store.move(spaceId, "thread:8", "essential");
    advance(10); store.move(spaceId, "thread:0", "today");
    expect(refs(store, spaceId, "today")).toEqual(["thread:0"]);
    expect(store.rows(spaceId).find(t => t.ref === "thread:0")!.opened_at).toBe(1_800_000_000_010);
  });
  it("scopes folders, reorders them, and preserves tabs at Pinned top level on delete", () => {
    const { store, spaceId, spaces, db } = setup();
    const a=store.createFolder(spaceId,"A"), b=store.createFolder(spaceId,"B");
    expect(store.updateFolder(b.id,{name:"Renamed",open:false,position:0})).toEqual({ ...b, name:"Renamed",open:false,position:0 });
    for (const ref of ["thread:a","thread:b","thread:c"]) { store.open(spaceId,ref); store.move(spaceId,ref,"pinned",ref === "thread:c" ? null : a.id,99); }
    const other=spaces.create({name:"Other"}); const outside=store.createFolder(other.id,"Outside");
    expect(() => store.move(spaceId,"thread:c","pinned",outside.id)).toThrow("not in this Space");
    expect(() => store.move(spaceId,"thread:c","today",a.id)).toThrow("Only Pinned");
    store.deleteFolder(a.id);
    expect(refs(store,spaceId,"pinned")).toEqual(["thread:a","thread:b","thread:c"]);
    expect(store.folders(spaceId)).toEqual([{...b,name:"Renamed",open:false,position:0}]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it.each(["12h","1d","3d","7d","never"] as const)("auto-archives by %s, preserving pinned and essential tabs", setting => {
    const { store, spaces, spaceId, advance, changed }=setup();
    spaces.setSettings(spaceId,{todayArchiveAfter:setting});
    for (const ref of ["thread:old","thread:pin","thread:essential"]) store.open(spaceId,ref);
    store.move(spaceId,"thread:pin","pinned"); store.move(spaceId,"thread:essential","essential");
    const hours={"12h":12,"1d":24,"3d":72,"7d":168,never:1000}[setting];
    advance(hours*3600000); store.archiveOld(spaceId);
    expect(refs(store,spaceId,"today")).toEqual(["thread:old"]);
    advance(1); store.open(spaceId,"thread:new"); changed.mockClear(); store.archiveOld(spaceId);
    expect(refs(store,spaceId,"today")).toEqual(setting === "never" ? ["thread:new","thread:old"] : ["thread:new"]);
    expect(changed).toHaveBeenCalledTimes(setting === "never" ? 0 : 1);
    expect(refs(store,spaceId,"pinned")).toEqual(["thread:pin"]);
    expect(refs(store,spaceId,"essential")).toEqual(["thread:essential"]);
  });
  it("seeds once across restarts and pruning, keeps pre-seed opens, and never overwrites settings", () => {
    const { store,spaceId,spaces,db,changed }=setup();
    expect(spaces.settings(spaceId).todayArchiveAfter).toBe("3d");
    expect(store.seeded(spaceId)).toBe(false);
    store.open(spaceId,"thread:early");
    store.seed(spaceId,["office:inbox","bot:a"],["thread:fav","item:pages:p"]);
    expect(refs(store,spaceId,"essential")).toEqual(["office:inbox","bot:a"]);
    expect(refs(store,spaceId,"pinned")).toEqual(["thread:fav","item:pages:p"]);
    expect(refs(store,spaceId,"today")).toEqual(["thread:early"]);
    store.forget(spaceId,store.rows(spaceId).map(t=>t.ref)); changed.mockClear();
    new OfficeTabs(db,spaces,changed).seed(spaceId,["office:inbox"],[]);
    expect(store.rows(spaceId)).toEqual([]); expect(store.seeded(spaceId)).toBe(true); expect(changed).not.toHaveBeenCalled();
    spaces.setSettings(spaceId,{todayArchiveAfter:"never"});
    spaces.setSettings(spaceId,{defaultTrust:"act"}); expect(store.seeded(spaceId)).toBe(true);
    expect(spaces.settings(spaceId).todayArchiveAfter).toBe("never");
  });
});

it("drops unresolvable refs through reads, preserves data on resolver failure, and returns current zones in search", async () => {
  const {store,spaceId,changed,advance}=setup();
  const target=(ref:string):TabTarget=>({ref,kind:ref.startsWith("item:")?"item":"bot",title:"Find me",icon:null,href:"/target"});
  const live = new Map(["bot:live","item:pages:p"].map(ref=>[ref,target(ref)]));
  const handlers=officeTabHandlers(store,()=>({
    resolve: async ref=>{if(ref==="bot:offline") throw new Error("offline"); return live.get(ref) ?? null;},
    essentials:async()=>[],atPath:async()=>null,seedThreads:async()=>[],search:async()=>[...live.values()],
  }));
  store.open(spaceId,"bot:gone");store.open(spaceId,"bot:live"); store.move(spaceId,"bot:live","pinned"); changed.mockClear();
  expect((await handlers.tabs_get({spaceId})).pinned[0]?.ref).toBe("bot:live");
  expect(store.rows(spaceId).some(t=>t.ref==="bot:gone")).toBe(false); expect(changed).toHaveBeenCalledTimes(1);
  const search=await handlers.office_search({spaceId,query:"Find"});
  expect(search.results.map(t=>[t.ref,t.zone])).toEqual([["bot:live","pinned"],["item:pages:p","archived"]]);
  store.open(spaceId,"bot:offline"); await expect(handlers.tabs_get({spaceId})).rejects.toThrow("offline");
  expect(store.rows(spaceId).some(t=>t.ref==="bot:offline")).toBe(true);store.forget(spaceId,["bot:offline"]);
  await handlers.tabs_move({spaceId,ref:"bot:live",zone:"archived"}); advance(5);
  await handlers.tabs_open({spaceId,ref:"item:pages:p"});await handlers.tabs_move({spaceId,ref:"item:pages:p",zone:"archived"});
  expect((await handlers.tabs_archived({spaceId,query:"Find",limit:1})).tabs[0]?.ref).toBe("item:pages:p");
  expect((await handlers.tabs_open({spaceId,ref:"bot:live"})).tab?.zone).toBe("today");
});
