import { expect, test } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { setup } from "./bots-fixture";
import { ThreadProfiles } from "../thread-profiles";
import { Command, finalEntries, mergeEntries } from "../command";
import { commandSendInput, type CommandSpace } from "../command-contract";
import { recipients } from "../command-layout";

const SPACES = { spaces: [{ id: "sp_default", name: "Personal", isDefault: true }, { id: "sp_launch", name: "Launch", isDefault: false }] };
function fixture(spaceOf: Record<string, string> = {}, lead: string | null = null) {
  const x = setup();
  x.harness.inspection.sdk.stub("plugins.callRpc", async (args: { method: string; outputSchema: { parse(value: unknown): unknown } }) => args.outputSchema.parse(
    args.method === "spaces" ? SPACES : args.method === "space_of_threads" ? { threads: spaceOf } : { leadThreadId: lead },
  ) as never);
  x.harness.inspection.sdk.stub("threads.get", async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, title: threadId, status: "idle", updatedAt: threadId.length, archivedAt: threadId.startsWith("old") ? 5 : null }));
  x.harness.inspection.sdk.stub("threads.interactions.list", async ({ threadId }) => threadId === "ask" ? [{}] as never : []);
  x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: [], timelinePage: { olderCursor: null, hasOlderRows: false } }));
  x.harness.inspection.sdk.stub("threads.events.list", async () => []);
  const profiles = new ThreadProfiles(x.bb, x.store, x.runtime);
  return { ...x, command: new Command(x.bb, x.store, profiles) };
}

test("a Space's threads come from Studio, lead first, without archived ones", async () => {
  const x = fixture({ lead: "sp_launch", ask: "sp_launch", oldie: "sp_launch", elsewhere: "sp_default" }, "lead");
  try {
    const space = await x.command.space("sp_launch");
    expect(space.space).toEqual({ id: "sp_launch", name: "Launch" });
    expect(space.leadThreadId).toBe("lead");
    expect(space.threads.map(t => [t.id, t.hasPendingInteraction])).toEqual([["lead", false], ["ask", true]]);
    await expect(x.command.space("sp_gone")).rejects.toThrow("no longer exists");
  } finally { await x.close(); }
});

test("the default Space holds threads in no Space, or in a deleted one", async () => {
  const x = fixture({ mine: "sp_launch", lost: "sp_gone" });
  try {
    x.harness.inspection.sdk.stub("threads.list", async () => ["mine", "lost", "free"].map(id => makeThreadResponse({ id, status: "idle" })) as never);
    expect((await x.command.space("sp_default")).threads.map(t => t.id).sort()).toEqual(["free", "lost"]);
    expect(x.harness.inspection.sdk.callsTo("threads.list")[0]![0]).toMatchObject({ archived: false });
  } finally { await x.close(); }
});

test("sends reach only the Space's threads, with the roster as agent-only context", async () => {
  const x = fixture({ a: "sp_launch", b: "sp_launch" }, "a");
  try {
    const result = await x.command.send(commandSendInput.parse({ spaceId: "sp_launch", threadIds: ["a", "b"], text: "Ship it", permissionMode: "accept-edits" }));
    expect(result.deliveries.map(d => [d.threadId, d.status])).toEqual([["a", "sent"], ["b", "sent"]]);
    const sends = x.harness.inspection.sdk.callsTo("threads.send").map(call => call[0]) as { threadId: string; input: { text?: string; visibility?: string }[]; permissionMode?: string }[];
    expect(sends.map(s => s.threadId)).toEqual(["a", "b"]);
    expect(sends[0]!.input[0]!.text).toBe("Ship it");
    expect(sends[0]!.input[1]).toMatchObject({ visibility: "agent-only" });
    expect(sends[0]!.input[1]!.text).toContain('"threadId":"b"');
    expect(sends[0]!.permissionMode).toBe("accept-edits");
    await expect(x.command.send(commandSendInput.parse({ spaceId: "sp_launch", threadIds: ["stranger"], text: "Hi" }))).rejects.toThrow("one of this Space's threads");
    expect(() => commandSendInput.parse({ spaceId: "sp_launch", threadIds: ["a"], text: " " })).toThrow("Write a message or attach a file.");
  } finally { await x.close(); }
});

test("messages go to mentions, then the picked thread, then the lead", () => {
  const space: CommandSpace = { space: { id: "s", name: "S" }, leadThreadId: "lead", threads: [["lead", null], ["other", null], ["fork", "other"]].map(([id, parentThreadId]) => ({ id: id!, title: id!, botId: null, parentThreadId, status: "idle", updatedAt: 1, error: null })) };
  expect(recipients(["other", "other"], false, "lead", space)).toEqual(["other"]);
  expect(recipients([], true, null, space)).toEqual(["lead", "other"]);
  expect(recipients([], false, "fork", space)).toEqual(["fork"]);
  expect(recipients([], false, null, space)).toEqual(["lead"]);
  expect(() => recipients([], false, null, { ...space, leadThreadId: null })).toThrow("no lead");
});

test("merged replies show one owner message sent to several threads once", () => {
  const entry = (id: string, threadId: string, role: "user" | "assistant", text: string, createdAt: number) => ({ id, threadId, role, text, createdAt });
  expect(mergeEntries([entry("2", "b", "user", "Go", 1_010), entry("1", "a", "user", "Go", 1_000), entry("3", "a", "assistant", "Done", 2_000), entry("4", "b", "user", "Go", 200_000)]).map(e => e.id)).toEqual(["1", "3", "4"]);
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
  ];
  expect(finalEntries(rows as never).map(e => e.text)).toEqual(["Help", "Done"]);
  const withFile = { ...rows[0], id: "owner2", attachments: { imageUrls: [], localFilePaths: ["/tmp/a/brief.pdf"], localFiles: 1, localImagePaths: [], localImages: 0, webImages: 1 } };
  expect(finalEntries([withFile] as never).map(e => e.text)).toEqual(["Help\n\n📎 brief.pdf\n\n📎 Image"]);
});

test("flat streaming output is hidden until its turn completes", () => {
  const reply = { id: "reply", kind: "conversation", role: "assistant", threadId: "thr_work", text: "Streaming", turnId: "turn_work", sourceSeqEnd: 2, createdAt: 100 };
  expect(finalEntries([reply] as never)).toEqual([]);
  expect(finalEntries([{ kind: "turn", id: "turn_work", turnId: "turn_work", status: "pending", children: [] }, reply] as never)).toEqual([]);
  expect(finalEntries([{ kind: "turn", id: "turn_work", turnId: "turn_work", status: "completed", children: [] }, reply] as never).map(e => e.text)).toEqual(["Streaming"]);
});

test("scheduled automation prompts and their replies stay out of the feed", () => {
  const base = { threadId: "thr_work", turnId: "turn_auto", createdAt: 100, sourceSeqEnd: 1 };
  const rows = [
    { ...base, id: "scheduled", kind: "conversation", role: "user", initiator: "user", senderThreadId: null, turnRequest: { status: "accepted" }, text: "[bb automation due:auto_1]\n\nCheck the release" },
    { ...base, id: "turn_auto", kind: "turn", status: "completed", children: [{ ...base, id: "reply", kind: "conversation", role: "assistant", text: "Posted the report to Feed" }] },
  ];
  expect(finalEntries(rows as never)).toEqual([]);
  expect(finalEntries([{ ...rows[0], turnId: null }, rows[1]] as never)).toEqual([]);
});

test("text-only replies use BB completion events, and empty final output hides progress", async () => {
  const x = fixture({ thr_text: "sp_launch" });
  try {
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: [
      { id: "done", kind: "conversation", role: "assistant", threadId: "thr_text", text: "Done", turnId: "turn_done", sourceSeqStart: 2, sourceSeqEnd: 3, createdAt: 100 },
      { id: "partial", kind: "conversation", role: "assistant", threadId: "thr_text", text: "Working", turnId: "turn_active", sourceSeqStart: 5, sourceSeqEnd: 6, createdAt: 200 },
      { id: "progress", kind: "conversation", role: "assistant", threadId: "thr_text", text: "Checking", turnId: "turn_quiet", sourceSeqStart: 7, sourceSeqEnd: 8, createdAt: 300 },
    ], timelinePage: { olderCursor: null, hasOlderRows: false } }) as never);
    x.harness.inspection.sdk.stub("threads.events.list", async () => [
      { type: "turn/completed", seq: 4, scope: { kind: "turn", turnId: "turn_done" }, data: { status: "completed" } },
      { type: "item/completed", seq: 9, scope: { kind: "turn", turnId: "turn_quiet" }, data: { item: { type: "agentMessage", text: " \n", phase: "final_answer" } } },
      { type: "turn/completed", seq: 10, scope: { kind: "turn", turnId: "turn_quiet" }, data: { status: "completed" } },
    ] as never);
    expect((await x.command.feed("sp_launch")).entries.map(entry => entry.text)).toEqual(["Done"]);
  } finally { await x.close(); }
});

test("the focused Command Space answers @ for a while, then stops", async () => {
  const x = fixture({ lead: "sp_launch", ask: "sp_launch" }, "lead");
  try {
    expect(await x.command.mentionable()).toBeNull();
    x.command.focus("sp_launch", 1_000);
    expect((await x.command.mentionable(2_000))?.threads.map(t => t.id)).toEqual(["lead", "ask"]);
    expect(await x.command.mentionable(1_000 + 11 * 60_000)).toBeNull();
  } finally { await x.close(); }
});
