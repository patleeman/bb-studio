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
