import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { BotNudges, nudgeNote, type NudgeOwner } from "./bot-nudge";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

function setup(owner: NudgeOwner | null = { botId: "bot_main", botThreadId: "bot1", active: true, self: false }) {
  const pending = new Map<string, { status: string }[]>();
  const send = vi.fn(async () => ({ ok: true }));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { send: send as never, interactions: { list: (async ({ threadId }: { threadId: string }) => pending.get(threadId) ?? []) as never } as never },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const state = { owner };
  const nudges = new BotNudges({ db, sdk: bb.sdk, owner: async () => state.owner });
  return { nudges, send, pending, state };
}

const thread = { id: "t_key", title: "Rotate the ORBIT-42 deploy key", projectId: "proj_o" };
const question = { status: "pending", payload: { kind: "plugin", data: { title: "A few questions", questions: [{ question: "Which vault holds the ORBIT-42 deploy key?" }] } } };
const approval = { status: "pending", payload: { kind: "approval", title: "Run `git push --force`" } };

it("nudges the Bot once per waiting episode, with one agent-only note", async () => {
  const x = setup();
  expect(await x.nudges.pending(thread, question)).toBe(true);
  expect(x.send).toHaveBeenCalledTimes(1);
  const sent = (x.send.mock.calls[0] as unknown[])[0] as { threadId: string; senderThreadId: string; input: { text: string; visibility?: string }[] };
  expect(sent).toMatchObject({ threadId: "bot1", senderThreadId: "t_key" });
  expect(sent.input).toEqual([expect.objectContaining({ visibility: "agent-only", text: nudgeNote(thread, question) })]);
  expect(sent.input[0]!.text).toContain('Your thread "Rotate the ORBIT-42 deploy key" (/projects/proj_o/threads/t_key) is waiting on an answer: Which vault holds the ORBIT-42 deploy key?');
  expect(sent.input[0]!.text).toMatch(/reply exactly \[PASS\]\. If only the user can, ask them in a line or two/);
  // Another question in the same episode: no repeat.
  x.pending.set("t_key", [question, question]);
  expect(await x.nudges.pending(thread, question)).toBe(false);
  // A turn while it still waits: still the same episode.
  await x.nudges.settled("t_key");
  expect(await x.nudges.pending(thread, question)).toBe(false);
  // Answered, and later a new question: a new episode, a new nudge.
  x.pending.set("t_key", [{ status: "resolved" }]);
  await x.nudges.settled("t_key");
  expect(await x.nudges.pending(thread, approval)).toBe(true);
  expect(((x.send.mock.calls[1] as unknown[])[0] as { input: { text: string }[] }).input[0]!.text).toContain("is waiting on an approval: Run `git push --force`");
});

it("doesn't nudge about the Bot's own chat, a thread no Bot owns, or for a paused Bot; a failed send can try again", async () => {
  const x = setup({ botId: "bot_main", botThreadId: "bot1", active: true, self: true });
  expect(await x.nudges.pending({ id: "bot1" }, question)).toBe(false);
  x.state.owner = null;
  expect(await x.nudges.pending(thread, question)).toBe(false);
  x.state.owner = { botId: "bot_main", botThreadId: "bot1", active: false, self: false };
  expect(await x.nudges.pending(thread, question)).toBe(false);
  expect(x.send).not.toHaveBeenCalled();
  x.state.owner = { botId: "bot_main", botThreadId: "bot1", active: true, self: false };
  x.send.mockRejectedValueOnce(new Error("busy"));
  expect(await x.nudges.pending(thread, question)).toBe(false);
  expect(await x.nudges.pending(thread, question)).toBe(true);
});
