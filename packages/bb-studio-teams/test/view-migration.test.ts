import { expect, test } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { setup } from "./bots-fixture";
import { ThreadProfiles } from "../thread-profiles";
import { ThreadViews } from "../thread-views";
import { migrateViews } from "../view-migration";

test("legacy single-bot channels become fresh threads without replaying retained history", async () => {
  const x = setup();
  try {
    x.store.putRoom({...x.room,memberIds:[x.a.id]});
    x.store.putMessage({id:"old",roomId:x.room.id,runId:"old",botId:null,speaker:"You",text:"Private old history",createdAt:1,attachments:[],replyTo:null});
    x.harness.inspection.sdk.stub("threads.get",async ({threadId})=>makeThreadResponse({id:threadId}));
    const profiles = new ThreadProfiles(x.bb,x.store,x.runtime,()=>true), views = new ThreadViews(x.bb,x.store,profiles);
    await migrateViews(x.bb,x.store,x.runtime,profiles,views);
    await migrateViews(x.bb,x.store,x.runtime,profiles,views);
    expect(x.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(x.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
    expect(x.store.messages(x.room.id)[0]?.text).toBe("Private old history");
    expect((await views.threads(views.get(x.room.id)))[0]?.id).toBe("thr_bot_1");
  } finally { await x.close(); }
});

test("automation migration targets normal bot threads, preserves scheduling, and resumes after an offline host", async () => {
  const x = setup();
  try {
    x.store.put({...x.a,model:"demo-model"});
    x.store.db.prepare("INSERT OR REPLACE INTO channel_threads(room_id,thread_id,title,delivered_rowid) VALUES (?,?,'Old',0)").run(x.room.id,"thr_old_channel");
    x.harness.inspection.sdk.stub("threads.get",async({threadId})=>makeThreadResponse({id:threadId}));
    let offline = true;
    x.harness.inspection.sdk.stub("threads.archive",async()=>{if(offline)throw new Error("Offline");return{ok:true};});
    const updates: unknown[] = [];
    x.harness.inspection.sdk.stub("plugins.callRpc",async raw=> {
      const args = raw as {method:string;input:unknown;outputSchema:{parse(value:unknown):never}};
      if(args.method === "automations_list")return args.outputSchema.parse([{id:"automation",enabled:false,trigger:{triggerType:"schedule",cron:"0 9 * * 1-5",timezone:"America/New_York"},execution:{mode:"script",env:{BB_BOTS_CHANNEL_AUTOMATION:JSON.stringify({channelId:x.room.id,botId:x.a.id,prompt:"Review progress"})}}}]);
      updates.push(args.input);return args.outputSchema.parse({});
    });
    const profiles = new ThreadProfiles(x.bb,x.store,x.runtime,()=>true), views = new ThreadViews(x.bb,x.store,profiles);
    await expect(migrateViews(x.bb,x.store,x.runtime,profiles,views)).rejects.toThrow("Offline");
    expect(x.store.db.prepare("SELECT 1 FROM view_migrations WHERE room_id=?").get(x.room.id)).toBeUndefined();
    offline=false;
    await migrateViews(x.bb,x.store,x.runtime,profiles,views);
    expect(x.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    const update=updates[0] as {execution:{mode:string;targetThreadId:string;prompt:string};enabled?:boolean;trigger?:unknown};
    expect(update.execution.targetThreadId).toBe("thr_bot_1");expect(update.execution.mode).toBe("agent");
    expect(update.execution.prompt).toContain("feed_post");expect(update.enabled).toBeUndefined();expect(update.trigger).toBeUndefined();
  } finally { await x.close(); }
});
