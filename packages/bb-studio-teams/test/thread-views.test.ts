import { expect, test } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { setup } from "./bots-fixture";
import { ThreadProfiles } from "../thread-profiles";
import { finalEntries, ThreadViews } from "../thread-views";
import { viewSendInput } from "../view-contract";
import { registerViewMentions } from "../view-mentions";

function fixture() {
  const x = setup();
  x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) => makeThreadResponse({ id: threadId, status: "idle" }));
  x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: [], timelinePage: { olderCursor: null, hasOlderRows: false } }));
  x.harness.inspection.sdk.stub("threads.events.list", async () => []);
  const profiles = new ThreadProfiles(x.bb, x.store, x.runtime, () => true);
  return { ...x, views: new ThreadViews(x.bb, x.store, profiles) };
}

test("explicit ordinary members stay independent when one is the other's child", async () => {
  const x = fixture();
  try {
    x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) => ({ ...makeThreadResponse({ id: threadId, parentThreadId: threadId === "child" ? "parent" : null, status: "idle" }), hasPendingInteraction: threadId === "child" }));
    x.harness.inspection.sdk.stub("threads.list", async ({ parentThreadId }) => parentThreadId === "parent" ? [makeThreadResponse({ id: "child", parentThreadId: "parent" })] : []);
    const view = await x.views.create("Related threads", [{ kind: "thread", id: "parent" }, { kind: "thread", id: "child" }]);
    expect((await x.views.threads(view)).map(thread => [thread.id, thread.parentThreadId, thread.hasPendingInteraction])).toEqual([["parent", null, false], ["child", null, true]]);
  } finally { await x.close(); }
});

test("BB's mention menu offers both channel broadcasts and resolves picked items", async () => {
  const x = fixture();
  try {
    registerViewMentions(x.bb, x.store, x.views);
    const provider = x.harness.inspection.registrations.mentionProviders.find(p => p.id === "broadcasts")!;
    const context = { trigger: "@" as const, query: "", projectId: null, threadId: null };
    expect(await provider.search(context)).toEqual([
      { id: "all", title: "@all", subtitle: "Everyone in this channel", icon: "Users" },
      { id: "channel", title: "@channel", subtitle: "Everyone in this channel", icon: "Users" },
    ]);
    expect((await provider.search({ ...context, query: "chan" })).map(p => p.id)).toEqual(["channel"]);
    expect(await provider.resolve("channel")).toEqual({ context: "@channel addresses every member when sent from a Studio Teams channel." });
    expect(() => provider.resolve("unrecognized")).toThrow("Unknown channel mention");
  } finally { await x.close(); }
});

test.each(["all", "channel", "everyone", "CHANNEL", "all."])("@%s delivers once to every channel member", async handle => {
  const x = fixture();
  try {
    const members = [{ kind: "bot" as const, id: x.a.id }, { kind: "bot" as const, id: x.b.id }, { kind: "thread" as const, id: "thr_member" }];
    const view = await x.views.create("Everyone", members);
    const input = viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: `(@${handle}), review this with @atlas`, targets: [members[0]], replyThreadId: "thr_member" });
    expect((await x.views.send(input)).deliveries.map(d => [d.threadId, d.status])).toEqual([
      ["thr_bot_1", "sent"], ["thr_bot_2", "sent"], ["thr_member", "sent"],
    ]);
    expect(x.harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(0);
    expect((await x.views.page(view.id)).entries[0]?.text).toBe(input.text);
  } finally { await x.close(); }
});

test("broadcasts don't match email addresses or longer handles", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Broadcast boundaries", [{ kind: "bot", id: x.a.id }, { kind: "bot", id: x.b.id }]);
    for (const text of ["mail@channel.com", "mail@all.com"]) {
      const input = viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text, targets: [{ kind: "bot", id: x.a.id }] });
      expect((await x.views.recipients(view, input)).targets).toEqual(input.targets);
    }
    for (const handle of ["all-guide", "channel_guide", "all2"]) {
      const input = viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: `@${handle} review` });
      await expect(x.views.send(input)).rejects.toThrow(`Choose a member for @${handle}`);
    }
    expect(x.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  } finally { await x.close(); }
});
test("fanout creates all normal threads before sending the shared roster; retries don't redeliver successes", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Campout", [{ kind: "bot", id: x.a.id }, { kind: "bot", id: x.b.id }]);
    let failed = true;
    x.harness.inspection.sdk.stub("threads.send", async ({ threadId, input }) => {
      const content = input as { type: string; text?: string; visibility?: string }[];
      expect(content[0]).toEqual({ type: "text", text: "@atlas collaborate with @scribe", mentions: [] });
      expect(content[1]?.visibility).toBe("agent-only");
      const text = content[1]?.type === "text" ? content[1].text ?? "" : "";
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
    const sends = x.harness.inspection.sdk.callsTo("threads.send") as [{ input: unknown[] }][];
    expect(sends[1]![0].input).toEqual(sends[2]![0].input);
    const page = await x.views.page(view.id);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.text).toBe(input.text);
    expect(page.threads.map(t => t.id)).toEqual(["thr_bot_1", "thr_bot_2"]);
    await expect(x.views.send({ ...input, text: "Different request" })).rejects.toThrow("already used");
  } finally { await x.close(); }
});
test("attachments from the composer reach every recipient and show by name in the view", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Files", [{ kind: "bot", id: x.a.id }, { kind: "bot", id: x.b.id }]);
    x.harness.inspection.sdk.stub("threads.send", async () => ({ ok: true, delivery: "sent" }));
    const file = { type: "localFile" as const, path: "/tmp/uploads/brief.pdf", name: "brief.pdf" };
    const image = { type: "localImage" as const, path: "/tmp/uploads/screen.png" };
    const input = viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: "", attachments: [file, image], targets: [{ kind: "bot", id: x.a.id }, { kind: "bot", id: x.b.id }] });
    expect((await x.views.send(input)).deliveries.map(d => d.status)).toEqual(["sent", "sent"]);
    for (const call of x.harness.inspection.sdk.callsTo("threads.send")) expect((call as [{ input: unknown[] }])[0].input.slice(2)).toEqual([file, image]);
    expect((await x.views.page(view.id)).entries[0]?.text).toBe("📎 brief.pdf\n\n📎 screen.png");
    expect(() => viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: " " })).toThrow("Write a message or attach a file.");
  } finally { await x.close(); }
});
test("approval modes pass through per recipient, members ahead of everyone", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Modes", [{ kind: "bot", id: x.a.id }, { kind: "bot", id: x.b.id }]);
    x.harness.inspection.sdk.stub("threads.send", async () => ({ ok: true, delivery: "sent" }));
    const input = viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: "@atlas @scribe go", permissionMode: "accept-edits", memberPermissionModes: [{ member: { kind: "bot", id: x.b.id }, mode: "full" }] });
    await x.views.send(input);
    const sent = x.harness.inspection.sdk.callsTo("threads.send").map(call => (call as [{ threadId: string; permissionMode?: string; executionInputSources?: unknown }])[0]);
    expect(sent.map(s => [s.threadId, s.permissionMode])).toEqual([["thr_bot_1", "accept-edits"], ["thr_bot_2", "full"]]);
    expect(sent[0]?.executionInputSources).toEqual({ permissionMode: "explicit" });
    await x.views.send(viewSendInput.parse({ id: view.id, requestId: crypto.randomUUID(), text: "@atlas again" }));
    const last = (x.harness.inspection.sdk.callsTo("threads.send").at(-1) as [{ permissionMode?: string }])[0];
    expect(last.permissionMode).toBeUndefined();
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
    await expect(x.views.send({ ...input, targets: [{ kind: "thread", id: "thr_other" }] })).rejects.toThrow("belong to this channel");
    expect(x.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  } finally { await x.close(); }
});
test("timeline excludes tools, inter-agent messages, interim replies, and empty replies", () => {
  const base = { threadId: "thr_work", startedAt: 1, createdAt: 1, sourceSeqStart: 1, sourceSeqEnd: 1, turnId: "turn1", attachments: null };
  const message = (id: string, text: string, sourceSeqEnd: number) => ({ ...base, id, kind: "conversation", role: "assistant", text, sourceSeqEnd, turnRequest: null });
  const rows = [
    { ...base, id: "owner", kind: "conversation", role: "user", text: "Help", initiator: "user", senderThreadId: null, turnRequest: { status: "accepted" } },
    { ...base, id: "agent", kind: "conversation", role: "user", text: "Coordinate", initiator: "agent", senderThreadId: "thr_other", turnRequest: { status: "accepted" } },
    { ...base, id: "turn", kind: "turn", status: "completed", children: [message("interim", "Working", 2), message("final", "Done", 3)] },
    { ...base, id: "turn2", kind: "turn", status: "pending", children: [{ ...message("streaming", "Still working", 4), turnId: "turn2" }] },
    { ...message("quiet", " \n", 5), turnId: "turn3" },
    { ...message("pass", "[PASS]", 6), turnId: "turn4" },
  ];
  expect(finalEntries(rows as never).map(e => e.text)).toEqual(["Help", "Done"]);
  const withFile = { ...rows[0], id: "owner2", attachments: { imageUrls: [], localFilePaths: ["/tmp/a/brief.pdf"], localFiles: 1, localImagePaths: [], localImages: 0, webImages: 1 } };
  expect(finalEntries([withFile] as never).map(e => e.text)).toEqual(["Help\n\n📎 brief.pdf\n\n📎 Image"]);
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
  expect(finalEntries([{ ...rows[0], turnId: null }, rows[1]] as never)).toEqual([]);
});

test("history follows BB cursors past tool-only pages and keeps equal timestamps", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("History", [{kind:"thread",id:"thr_history"}]);
    const reply = (id: string) => ({kind:"turn",id,turnId:id,status:"completed",sourceSeqStart:1,children:[{kind:"conversation",id,role:"assistant",threadId:"thr_history",text:id,turnId:id,sourceSeqStart:1,sourceSeqEnd:1,createdAt:100}]});
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

test.each([false, true])("empty final output hides earlier progress in saved views (wrapped=%s)", async (wrapped) => {
  const x = fixture();
  try {
    const view = await x.views.create("Quiet replies", [{ kind: "thread", id: "thr_quiet" }]);
    const reply = { id: "progress", kind: "conversation", role: "assistant", threadId: "thr_quiet", text: "Checking", turnId: "turn_quiet", sourceSeqStart: 2, sourceSeqEnd: 3, createdAt: 100 };
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: wrapped ? [{ kind: "turn", id: "turn_quiet", turnId: "turn_quiet", status: "completed", sourceSeqStart: 1, children: [reply] }] : [reply], timelinePage: { olderCursor: null, hasOlderRows: false } }) as never);
    x.harness.inspection.sdk.stub("threads.events.list", async () => [
      { type: "item/completed", seq: 3, scope: { kind: "turn", turnId: "turn_quiet" }, data: { item: { type: "agentMessage", text: "Checking", phase: "commentary" } } },
      { type: "item/completed", seq: 4, scope: { kind: "turn", turnId: "turn_quiet" }, data: { item: { type: "agentMessage", text: " \n", phase: "final_answer" } } },
      { type: "turn/completed", seq: 5, scope: { kind: "turn", turnId: "turn_quiet" }, data: { status: "completed" } },
    ] as never);
    expect((await x.views.page(view.id)).entries).toEqual([]);
  } finally { await x.close(); }
});

test("source owner messages replace send receipts and reflect edits and deletion", async () => {
  const x = fixture();
  try {
    const view = await x.views.create("Owner messages", [{ kind: "thread", id: "thr_owner" }]);
    const requestId = crypto.randomUUID();
    await x.views.send(viewSendInput.parse({ id: view.id, requestId, text: "Original" }));
    const owner = { id: "owner", threadId: "thr_owner", kind: "conversation", role: "user", initiator: "user", senderThreadId: null,
      turnId: null, createdAt: 100, sourceSeqStart: 1, sourceSeqEnd: 1, turnRequest: { status: "accepted" }, text: `[Studio view message ${requestId}]\nOriginal\n[End owner message]` };
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: [owner], timelinePage: { olderCursor: null, hasOlderRows: false } }) as never);
    expect((await x.views.page(view.id)).entries.map(entry => entry.text)).toEqual(["Original"]);
    owner.text = "Edited in the thread";
    expect((await x.views.page(view.id)).entries.map(entry => entry.text)).toEqual(["Edited in the thread"]);
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: [], timelinePage: { olderCursor: null, hasOlderRows: false } }));
    expect((await x.views.page(view.id)).entries).toEqual([]);
  } finally { await x.close(); }
});

test.each([false, true])("hidden channel context retains merged fanout grouping and source edits (steer=%s)", async steer => {
  const x = fixture();
  try {
    const view = await x.views.create("Concise input", [{ kind: "thread", id: "one" }, { kind: "thread", id: "two" }]);
    const requestId = crypto.randomUUID();
    await x.views.send(viewSendInput.parse({ id: view.id, requestId, text: "Check the brief", targets: view.members }));
    const sent = (x.harness.inspection.sdk.callsTo("threads.send")[0] as [{ input: unknown[] }])[0].input;
    let text = "Check the brief", deleted = false;
    x.harness.inspection.sdk.stub("threads.timeline", async ({ threadId }) => ({ rows: deleted ? [] : [{
      id: "owner", threadId, kind: "conversation", role: "user", initiator: "user", senderThreadId: null,
      turnId: null, createdAt: 100, sourceSeqStart: steer ? 11 : 5, sourceSeqEnd: steer ? 11 : 5,
      turnRequest: { status: "accepted" }, text,
    }], timelinePage: { olderCursor: null, hasOlderRows: false } }) as never);
    x.harness.inspection.sdk.stub("threads.events.list", async ({ types, beforeSeq }: { types?: readonly string[]; beforeSeq?: string }) => {
      const request = { type: "client/turn/requested", seq: 5, data: { requestId: "source_request", input: sent } };
      if (types?.length === 1) return [request] as never;
      return (steer && Number(beforeSeq) > 11 ? [{ type: "turn/input/accepted", seq: 11, data: { clientRequestId: "source_request" } }] : [request]) as never;
    });
    expect((await x.views.page(view.id)).entries.map(entry => [entry.text, entry.groupId])).toEqual([["Check the brief", requestId]]);
    expect(x.store.db.prepare("SELECT id FROM view_entries WHERE id LIKE 'view:%'").all()).toEqual([]);
    text = "Edited in the source";
    expect((await x.views.page(view.id)).entries.map(entry => entry.text)).toEqual([text]);
    deleted = true;
    expect((await x.views.page(view.id)).entries).toEqual([]);
  } finally { await x.close(); }
});

test("grouped queued inputs with identical text retain separate channel identities", async () => {
  const x = fixture();
  try {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const input = ids.map(id => [{ type: "text", text: "Check", mentions: [] }, { type: "text", visibility: "agent-only", text: `[Studio view message ${id}]\nCheck\n[End owner message]`, mentions: [] }]);
    x.harness.inspection.sdk.stub("threads.events.list", async () => [{ type: "client/turn/requested", seq: 5, data: { requestId: "queued", input: [], inputGroups: input } }] as never);
    const rows = ["a", "b"].map(id => ({ id, threadId: "one", kind: "conversation", role: "user", initiator: "user", senderThreadId: null, sourceSeqStart: 5, sourceSeqEnd: 5, text: "Check" }));
    expect([...await x.views.ownerGroups("one", rows as never)]).toEqual([["a", ids[0]], ["b", ids[1]]]);
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
