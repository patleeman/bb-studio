import { expect, test } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { setup } from "./bots-fixture";
import { ThreadProfiles } from "../thread-profiles";
import { finalEntries, ThreadViews } from "../thread-views";
import { viewSendInput } from "../view-contract";

function fixture() {
  const x = setup();
  x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) => makeThreadResponse({ id: threadId, status: "idle" }));
  x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: [], timelinePage: { olderCursor: null, hasOlderRows: false } }));
  const profiles = new ThreadProfiles(x.bb, x.store, x.runtime, () => true);
  return { ...x, views: new ThreadViews(x.bb, x.store, profiles) };
}
test("fanout creates all normal threads before sending the shared roster; retries don't redeliver successes", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Campout", [{ kind: "bot", id: x.a.id }, { kind: "bot", id: x.b.id }]);
    let failed = true;
    x.harness.inspection.sdk.stub("threads.send", async ({ threadId, input }) => {
      const content = input as { type: string; text?: string }[];
      const text = content[0]?.type === "text" ? content[0].text ?? "" : "";
      expect(x.store.threadBots()).toHaveLength(2);
      expect(text).toContain('"threadId":"thr_bot_1"');
      expect(text).toContain('"threadId":"thr_bot_2"');
      if (threadId === "thr_bot_2" && failed) { failed = false; throw new Error("Offline"); }
      return { ok: true, delivery: "sent" };
    });
    const input = viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: "@atlas collaborate with @scribe" });
    expect((await x.views.send(input)).deliveries.map(d => d.status)).toEqual(["sent", "error"]);
    expect((await x.views.send(input)).deliveries.map(d => d.status)).toEqual(["sent", "sent"]);
    expect(x.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(3);
    const page = await x.views.page(view.id);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.text).toBe(input.text);
    expect(page.threads.map(t => t.id)).toEqual(["thr_bot_1", "thr_bot_2"]);
    await expect(x.views.send({ ...input, text: "Different request" })).rejects.toThrow("already used");
  } finally { await x.close(); }
});
test("views share references, include descendants, and deleting a view leaves threads intact", async () => {
  const x = fixture();
  try {
    x.harness.inspection.sdk.stub("threads.list", async ({ parentThreadId }) => parentThreadId === "thr_parent" ? [makeThreadResponse({ id: "thr_child", parentThreadId: "thr_parent" })] : []);
    const one = await x.views.create("One", [{ kind: "thread", id: "thr_parent" }]);
    const two = await x.views.create("Two", [{ kind: "thread", id: "thr_parent" }]);
    expect((await x.views.threads(one)).map(t => [t.id, t.parentThreadId])).toEqual([["thr_parent", null], ["thr_child", "thr_parent"]]);
    expect((await x.views.threads(two))).toHaveLength(2);
    await x.views.handlers().viewDelete({ id: one.id });
    expect(x.harness.inspection.sdk.callsTo("threads.delete")).toHaveLength(0);
    expect(x.views.get(two.id).name).toBe("Two");
  } finally { await x.close(); }
});
test("uncertain addressing and out-of-view targets don't dispatch anything", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Work", [{ kind: "bot", id: x.a.id }, { kind: "bot", id: x.b.id }]);
    const input = viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: "Help" });
    await expect(x.views.send(input)).rejects.toThrow("Choose recipients");
    await expect(x.views.send({ ...input, targets: [{ kind: "thread", id: "thr_other" }] })).rejects.toThrow("belong to this view");
    expect(x.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  } finally { await x.close(); }
});
test("timeline excludes tools, inter-agent messages, interim replies, and PASS", () => {
  const base = { threadId: "thr_work", startedAt: 1, createdAt: 1, sourceSeqStart: 1, sourceSeqEnd: 1, turnId: "turn1", attachments: null };
  const message = (id: string, text: string, sourceSeqEnd: number) => ({ ...base, id, kind: "conversation", role: "assistant", text, sourceSeqEnd, turnRequest: null });
  const rows = [
    { ...base, id: "owner", kind: "conversation", role: "user", text: "Help", initiator: "user", senderThreadId: null, turnRequest: { status: "accepted" } },
    { ...base, id: "agent", kind: "conversation", role: "user", text: "Coordinate", initiator: "agent", senderThreadId: "thr_other", turnRequest: { status: "accepted" } },
    { ...base, id: "turn", kind: "turn", status: "completed", children: [message("interim", "Working", 2), message("final", "Done", 3)] },
    { ...base, id: "turn2", kind: "turn", status: "pending", children: [{ ...message("streaming", "Still working", 4), turnId: "turn2" }] },
    { ...message("pass", "[PASS]", 5), turnId: "turn3" },
  ];
  expect(finalEntries(rows as never).map(e => e.text)).toEqual(["Help", "Done"]);
});

test("flat streaming output is hidden until its turn completes", () => {
  const reply = { id: "reply", kind: "conversation", role: "assistant", threadId: "thr_work", text: "Streaming", turnId: "turn_work", sourceSeqEnd: 2, createdAt: 100 };
  expect(finalEntries([reply] as never)).toEqual([]);
  expect(finalEntries([{kind:"turn", id:"turn_work", turnId:"turn_work", status:"pending",children:[]}, reply] as never)).toEqual([]);
  expect(finalEntries([{kind:"turn", id:"turn_work", turnId:"turn_work", status:"completed",children:[]}, reply] as never).map(e=>e.text)).toEqual(["Streaming"]);
});

test("scheduled automation prompts and their replies stay out of the view", () => {
  const base = { threadId: "thr_work", turnId: "turn_auto", createdAt: 100, sourceSeqEnd: 1 };
  const rows = [
    { ...base, id: "scheduled", kind: "conversation", role: "user", initiator: "user", senderThreadId: null,
      turnRequest: { status: "accepted" }, text: "[bb automation due:auto_1]\n\nCheck the release" },
    { ...base, id: "turn_auto", kind: "turn", status: "completed", children: [
      { ...base, id: "reply", kind: "conversation", role: "assistant", text: "Posted the report to Feed" },
    ] },
  ];
  expect(finalEntries(rows as never)).toEqual([]);
});

test("history follows BB cursors past tool-only pages and keeps equal timestamps", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("History", [{kind:"thread",id:"thr_history"}]);
    const reply = (id: string) => ({kind:"turn",id,turnId:id,status:"completed",children:[{kind:"conversation",id,role:"assistant",threadId:"thr_history",text:id,turnId:id,sourceSeqEnd:1,createdAt:100}]});
    x.harness.inspection.sdk.stub("threads.timeline", async ({beforeAnchorId}) => beforeAnchorId ? {rows:[reply("a"),reply("b"),reply("c")],timelinePage:{hasOlderRows:false,olderCursor:null}} : {rows:[],timelinePage:{hasOlderRows:true,olderCursor:{anchorId:"tools",anchorSeq:1}}});
    const first = await x.views.page(view.id, undefined, 2);
    expect(first.entries.map(e=>e.text)).toEqual(["b","c"]);
    expect(first.hasOlder).toBe(true);
    const older = await x.views.page(view.id, 100, 2, first.entries[0]!.id);
    expect(older.entries.map(e=>e.text)).toEqual(["a"]);
    expect(older.hasOlder).toBe(false);
    // Source deletion is reflected on the next read.
    x.harness.inspection.sdk.stub("threads.timeline", async()=>({rows:[],timelinePage:{hasOlderRows:false,olderCursor:null}}));
    expect((await x.views.page(view.id)).entries).toEqual([]);
  } finally { await x.close(); }
});

test("text-only replies use BB completion events when no turn wrapper exists", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Text replies", [{ kind: "thread", id: "thr_text" }]);
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: [
      { id: "done", kind: "conversation", role: "assistant", threadId: "thr_text", text: "Done", turnId: "turn_done", sourceSeqStart: 2, sourceSeqEnd: 3, createdAt: 100 },
      { id: "partial", kind: "conversation", role: "assistant", threadId: "thr_text", text: "Working", turnId: "turn_active", sourceSeqStart: 5, sourceSeqEnd: 6, createdAt: 200 },
    ], timelinePage: { olderCursor: null, hasOlderRows: false } }) as never);
    x.harness.inspection.sdk.stub("threads.events.list", async () => [
      { type: "turn/completed", seq: 4, scope: { kind: "turn", turnId: "turn_done" }, data: { status: "completed" } },
    ] as never);
    expect((await x.views.page(view.id)).entries.map(entry => entry.text)).toEqual(["Done"]);
  } finally { await x.close(); }
});

test("reply, explicit steer, and @bot+new select real threads", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Work", [{kind:"bot",id:x.a.id}]);
    const send = (text:string, extra={})=>x.views.send(viewSendInput.parse({id:view.id,requestId:crypto.randomUUID(),text,...extra}));
    await send("First"); await send("Again");
    expect(x.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    await send("@atlas+new Separate work");
    expect(x.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
    await send("@thread:thr_bot_1 Correction", {mode:"steer"});
    const last = x.harness.inspection.sdk.callsTo("threads.send").at(-1)![0] as {threadId:string;mode:string};
    expect(last.threadId).toBe("thr_bot_1"); expect(last.mode).toBe("steer-if-active");
  } finally { await x.close(); }
});
