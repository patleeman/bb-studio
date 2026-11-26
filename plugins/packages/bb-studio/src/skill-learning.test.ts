import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { rpcContract } from "./contract";
import {
  ARCHIVE_AFTER_MS, cheapestModel, curatorPlan, lineDiff, lintSkill, patchText, REVIEW_TOOLS, RETRY_PROMPT, reviewPrompt, gaveUpOnTools,
  SAVE_RULES, SkillLearning, STALE_AFTER_MS, sweepDue, type LearningSkill, type SkillState,
} from "./skill-learning";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const fn of dispose.splice(0)) await fn(); });

const DAY = 86_400_000;
const turn = (seq: number, items: string[], opts: { user?: boolean; tool?: string } = {}) => [
  ...(opts.user ? [{ seq: seq, type: "client/turn/requested", data: { initiator: "user" } }] : []),
  ...items.map((type, i) => ({ seq: seq + 1 + i, type: "item/completed", data: { item: { type, ...(type === "toolCall" && opts.tool ? { tool: opts.tool } : {}) } } })),
  { seq: seq + 1 + items.length, type: "turn/completed", data: { status: "completed" } },
];

it("picks the cheapest model by price, else by name", () => {
  expect(cheapestModel([
    { model: "opus", description: "Opus · $4/$20 per Mtok" }, { model: "sonnet", description: "Sonnet · $2/$10 per Mtok" }, { model: "haiku", description: "Haiku · $0.10/$0.50 per Mtok" },
  ])).toBe("haiku");
  expect(cheapestModel([{ model: "gpt-6-sol", description: "Workhorse" }, { model: "gpt-6-luna", description: "Fast and affordable" }])).toBe("gpt-6-luna");
  expect(cheapestModel([{ model: "big" }])).toBeNull();
});

it("lints incident logs, oversize skills and near-duplicate names without blocking", () => {
  expect(lintSkill({ name: "deploy", body: "On 2026-10-01 we tried PR #482 and it broke." }, [])).toEqual([expect.stringMatching(/log of one session/)]);
  expect(lintSkill({ name: "deploy", body: "x".repeat(9000) }, [])).toEqual([expect.stringMatching(/9000 characters/)]);
  expect(lintSkill({ name: "deploy-check", body: "Run the smoke test." }, ["deploy-checks", "inbox"])).toEqual([expect.stringMatching(/close to deploy-checks/)]);
  expect(lintSkill({ name: "weekly-review", body: "1. Read the week's threads.\n2. Sum up." }, ["inbox-sweep"])).toEqual([]);
});

it("patches exact text once, refuses missing or ambiguous text", () => {
  expect(patchText("a\nstep two\nb", "step two", "step 2")).toBe("a\nstep 2\nb");
  expect(() => patchText("a", "zzz", "y")).toThrow(/isn't in the skill/);
  expect(() => patchText("x x", "x", "y")).toThrow(/2 times/);
  expect(patchText("x x", "x", "y", true)).toBe("y y");
  expect(patchText("cost $1", "cost", "$& price")).toBe("$& price $1");
});

it("diffs lines", () => {
  expect(lineDiff("a\nb\nc", "a\nB\nc")).toBe("  a\n- b\n+ B\n  c");
  expect(lineDiff("", "new")).toBe("+ new");
});

it("moves unused skills active → stale → archived; pinned and used ones stay", () => {
  const now = 1000 * DAY;
  const skill = (name: string, state: SkillState, idleDays: number, pinned = false) => ({ name, state, pinned, usedAt: now - idleDays * DAY, updatedAt: 0 });
  expect(curatorPlan([skill("fresh", "active", 5), skill("old", "active", 31), skill("older", "stale", 91), skill("ancient", "active", 200), skill("pinned", "active", 400, true), skill("gone", "archived", 400)], now)).toEqual([
    { name: "old", from: "active", to: "stale" }, { name: "older", from: "stale", to: "archived" }, { name: "ancient", from: "active", to: "archived" },
  ]);
  expect(STALE_AFTER_MS).toBe(30 * DAY);
  expect(ARCHIVE_AFTER_MS).toBe(90 * DAY);
});

it("gives a review fork only the skill tools and pages_read, and the where-it-goes and never-save rules", () => {
  expect([...REVIEW_TOOLS]).toEqual(["bot_skill_list", "bot_skill_view", "bot_skill_edit", "bot_skill_lint", "pages_read"]);
  const prompt = reviewPrompt({ name: "Dot", reason: "daily", since: Date.UTC(2026, 10, 20) });
  expect(prompt).toContain(SAVE_RULES);
  expect(prompt).toMatch(/daily review of this conversation\. Focus on what happened since the last review \(2026-11-20\)/);
  expect(prompt).toMatch(/remember this/);
  expect(prompt).toMatch(/"## Preferences" \(at most 25 lines\)/);
  expect(prompt).toMatch(/Never save: build, deploy or release logs/);
  expect(prompt).toMatch(/Default to saving nothing/);
  expect(prompt).toMatch(/reply exactly \[PASS\]/);
  expect(prompt).not.toMatch(/memory \(op|memory_add|pages_edit/);
  expect(reviewPrompt({ name: "Dot", reason: "archive" })).toMatch(/just archived this conversation: look back over all of it/);
});

it("tells a review its bridge tools work even when Claude Code calls them disconnected", () => {
  const prompt = reviewPrompt({ name: "Dot", reason: "daily" });
  expect(prompt).toMatch(/ToolSearch \("select:mcp__bb-bridge__bot_skill,mcp__bb-bridge__pages_read"\)/);
  expect(gaveUpOnTools("I couldn't save anything: the skill and Memory page tools are disconnected in this session, so nothing was written.")).toBe(true);
  expect(gaveUpOnTools("Couldn't save anything: the bot skill and Pages tools are disconnected in this session.")).toBe(true);
  expect(gaveUpOnTools("[PASS]")).toBe(false);
  expect(gaveUpOnTools("Nothing new worth keeping.")).toBe(false);
  expect(gaveUpOnTools(null)).toBe(false);
});

it("nudges a review that gave up on its tools once, then records what it wrote", async () => {
  const x = await setup();
  const log = vi.fn();
  (x.learning as unknown as { deps: { log: unknown } }).deps.log = log;
  expect(await x.learning.start("bot_main", "review")).toBe(true);
  await x.learning.active("fork1");
  await x.learning.idle(x.threads.get("fork1")!, "Nothing saved: the skill tools are disconnected in this session.");
  // Still running: it got the follow-up instead of being closed.
  expect(x.send).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "fork1", input: [expect.objectContaining({ text: RETRY_PROMPT })] }));
  expect((await x.learning.view("bot_main")).reviewing).toBe(true);
  expect(x.archive).not.toHaveBeenCalled();
  // Its retry saves a skill.
  await x.learning.active("fork1");
  x.learning.noteWrite("fork1", "saved");
  await x.learning.idle(x.threads.get("fork1")!, "Saved deploy-check.");
  expect(await x.learning.view("bot_main")).toMatchObject({ reviewing: false, lastReview: { result: "Saved 1 skill" } });
  expect(log).not.toHaveBeenCalled();
});

it("nudges only once: a second give-up closes the review and logs the reply", async () => {
  const x = await setup();
  const log = vi.fn();
  (x.learning as unknown as { deps: { log: unknown } }).deps.log = log;
  await x.learning.start("bot_main", "review");
  const sends = x.send.mock.calls.length;
  for (let i = 0; i < 2; i++) {
    await x.learning.active("fork1");
    await x.learning.idle(x.threads.get("fork1")!, "The tools are disconnected.");
  }
  expect(x.send.mock.calls.length).toBe(sends + 1);
  expect(await x.learning.view("bot_main")).toMatchObject({ reviewing: false, lastReview: { result: "Nothing to save" } });
  expect(log).toHaveBeenCalledWith(expect.stringMatching(/wrote nothing but replied: The tools are disconnected/));
});

async function setup() {
  const threads = new Map([["bot1", makeThreadResponse({ id: "bot1", projectId: "proj_personal", providerId: "claude-code", status: "idle", updatedAt: 0 })]]);
  let events: { seq: number; type: string; data: Record<string, unknown> }[] = [];
  let forks = 0;
  const fork = vi.fn(async ({ sourceThreadId }: { sourceThreadId: string }) => {
    const thread = makeThreadResponse({ id: `fork${++forks}`, projectId: "proj_personal", providerId: "claude-code", status: "idle", sourceThreadId });
    threads.set(thread.id, thread);
    return thread;
  });
  const update = vi.fn(async () => ({}));
  const send = vi.fn(async (_args: unknown) => ({ ok: true }));
  const stop = vi.fn(async (_args: unknown) => ({}));
  const archive = vi.fn(async ({ threadId }: { threadId: string }) => { threads.set(threadId, { ...threads.get(threadId)!, archivedAt: 5 }); return { ok: true }; });
  const list = vi.fn(async ({ threadId, afterSeq, order, limit }: { threadId: string; afterSeq?: string; order?: string; limit?: string }) => {
    // BB refuses pages over 100.
    if (Number(limit) > 100) throw Object.assign(new Error("Thread event limit cannot exceed 100"), { status: 400 });
    // A fork's workspace is ready at once.
    if (threadId !== "bot1") return [{ seq: 1, type: "system/thread-provisioning", data: { status: "completed" } }];
    const after = events.filter((event) => event.seq > Number(afterSeq ?? 0));
    return (order === "desc" ? [...after].reverse() : after).slice(0, Number(limit ?? 100));
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => threads.get(threadId)!) as never, fork: fork as never, update: update as never, send: send as never, stop: stop as never, archive: archive as never,
      events: { list: list as never, wait: (async () => null) as never },
    },
    providers: { models: (async () => ({ models: [
      { model: "claude-opus", description: "$4/$20 per Mtok", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }] },
      { model: "claude-haiku", displayName: "Haiku Fast", description: "$0.10/$0.50 per Mtok", supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
    ] })) as never },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bot = { id: "bot_main", name: "Dot", threadId: "bot1" as string | null, state: "active", kind: "studio" };
  db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES ('bot_main', 'Dot', 'x', 'active', 'bot1', 0, 0, 0)").run();
  const skills = (): LearningSkill[] => (db.prepare("SELECT * FROM bot_skills WHERE bot_id = 'bot_main' ORDER BY name").all() as { name: string; description: string; body: string; state: SkillState; pinned: number; used_at: number | null; updated_at: number }[])
    .map((row) => ({ name: row.name, description: row.description, body: row.body, state: row.state, pinned: !!row.pinned, usedAt: row.used_at, updatedAt: row.updated_at }));
  const writeSkill = (_botId: string, input: { name: string; description: string; body: string }) => {
    db.prepare("INSERT INTO bot_skills (bot_id, name, description, body, created_at, updated_at) VALUES ('bot_main', ?, ?, ?, 0, 0) ON CONFLICT (bot_id, name) DO UPDATE SET body = excluded.body").run(input.name, input.description, input.body);
  };
  const conversations: string[] = [];
  const learning = new SkillLearning({
    db, sdk: bb.sdk, changed: () => {}, bots: () => [bot], bot: (id) => id === bot.id ? bot : null, conversations: () => conversations,
    skills: () => skills(),
    setState: (_botId, name, state) => { db.prepare("UPDATE bot_skills SET state = ? WHERE name = ?").run(state, name); },
  });
  const work = (n: number, user = false) => { for (let i = 0; i < n; i++) events.push(...turn((events.at(-1)?.seq ?? 0) + 1, ["commandExecution"], { user })); };
  return { db, bot, threads, learning, conversations, fork, update, send, stop, archive, work, skills, writeSkill, setEvents: (next: typeof events) => { events = next; } };
}

it("sweeps once a day: forks a review of each thread with new events on a cheap model, one at a time", async () => {
  const x = await setup();
  x.threads.set("conv1", makeThreadResponse({ id: "conv1", projectId: "proj_personal", providerId: "claude-code", status: "idle", updatedAt: 0 }));
  x.conversations.push("bot1", "conv1");
  x.work(3);
  const morning = new Date(2026, 10, 26, 9).getTime();
  vi.useFakeTimers({ toFake: ["Date"] });
  const at = (time: number) => { vi.setSystemTime(time); return time; };
  at(morning);
  // Idle turns don't start reviews any more.
  await x.learning.idle(x.threads.get("bot1")!, "done");
  expect(x.fork).not.toHaveBeenCalled();
  await x.learning.tick(morning);
  expect(x.fork).toHaveBeenCalledTimes(1);
  expect(x.fork).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "bot1", visibility: "hidden", pluginMetadata: { botReview: "bot_main" } }));
  expect(x.update).toHaveBeenCalledWith({ threadId: "fork1", model: "claude-haiku", reasoningLevel: "low" });
  expect(x.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: "fork1", input: [expect.objectContaining({ text: expect.stringMatching(/Background skill review for "Dot"\. This is the daily review/) })] }));
  expect(await x.learning.view("bot_main")).toMatchObject({ reviewing: true, queued: 1, cadence: "daily-and-archive", lastSweepAt: morning, defaultModel: "claude-haiku", modelNames: { "claude-opus": "Opus", "claude-haiku": "Haiku Fast" } });
  expect(x.learning.reviewThreads()).toEqual(new Set(["fork1"]));
  // Single flight: no second review while one runs.
  expect(await x.learning.start("bot_main", "review")).toBe(false);
  await x.learning.tick(at(morning + 60_000));
  expect(x.fork).toHaveBeenCalledTimes(1);

  // A fork is idle before its prompt lands: that idle isn't the end.
  await x.learning.idle(x.threads.get("fork1")!, null);
  expect((await x.learning.view("bot_main")).reviewing).toBe(true);
  // The fork saves a skill and finishes; the next queued thread starts.
  await x.learning.active("fork1");
  x.learning.noteWrite("fork1", "saved");
  await x.learning.idle(x.threads.get("fork1")!, "Saved deploy-check.");
  expect(x.archive).not.toHaveBeenCalled();
  expect(x.fork).toHaveBeenLastCalledWith(expect.objectContaining({ sourceThreadId: "conv1" }));
  await x.learning.active("fork2");
  await x.learning.idle(x.threads.get("fork2")!, "[PASS]");
  expect(await x.learning.view("bot_main")).toMatchObject({ reviewing: false, queued: 0, lastReview: { result: "Nothing to save" } });

  // The same day: no second sweep. The next day: only threads with new events.
  await x.learning.tick(at(morning + 3_600_000));
  expect(x.fork).toHaveBeenCalledTimes(2);
  x.work(1);
  await x.learning.tick(at(morning + 86_400_000));
  expect(x.fork).toHaveBeenCalledTimes(3);
  expect(x.fork).toHaveBeenLastCalledWith(expect.objectContaining({ sourceThreadId: "bot1" }));
  expect(x.send).toHaveBeenLastCalledWith(expect.objectContaining({ input: [expect.objectContaining({ text: expect.stringMatching(/since the last review/) })] }));
});

it("runs the daily sweep after 3 AM local, once per day", () => {
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
  expect(sweepDue(null, at(26, 1))).toBe(true);
  expect(sweepDue(at(26, 9), at(26, 23))).toBe(false);
  expect(sweepDue(at(26, 9), at(27, 2))).toBe(false);
  expect(sweepDue(at(26, 9), at(27, 3))).toBe(true);
  expect(sweepDue(at(20, 9), at(26, 1))).toBe(true);
});

it("reviews an archived conversation once, first in the queue, and stays off when turned off, paused or external", async () => {
  const x = await setup();
  x.threads.set("conv2", { ...makeThreadResponse({ id: "conv2", projectId: "proj_personal", providerId: "claude-code", status: "idle", updatedAt: 0 }), archivedAt: 9 });
  await x.learning.sweep("bot_main", Date.now());
  expect(x.learning.archived("bot_main", "conv2")).toBe(true);
  await x.learning.next("bot_main");
  expect(x.fork).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "conv2" }));
  expect(x.send.mock.calls[0]![0]).toMatchObject({ input: [{ text: expect.stringMatching(/just archived this conversation/) }] });
  await x.learning.active("fork1");
  await x.learning.idle(x.threads.get("fork1")!, "[PASS]");
  // The archived thread isn't reviewed again by a sweep or Run now's day pass unless it moves.
  expect(x.fork).toHaveBeenCalledTimes(2);
  expect(x.fork).toHaveBeenLastCalledWith(expect.objectContaining({ sourceThreadId: "bot1" }));

  await x.learning.set("bot_main", { enabled: false });
  expect(x.learning.archived("bot_main", "conv2")).toBe(false);
  await x.learning.tick(Date.now() + 3 * 86_400_000);
  await x.learning.set("bot_main", { enabled: true });
  x.bot.state = "paused";
  expect(await x.learning.runNow("bot_main")).toBe(false);
  x.bot.kind = "external";
  x.bot.state = "active";
  expect(await x.learning.start("bot_main", "review")).toBe(false);
  expect(x.fork).toHaveBeenCalledTimes(2);
});

it("stops the review when the user starts a turn, when the bot pauses, or after 20 minutes", async () => {
  const x = await setup();
  expect(await x.learning.start("bot_main", "review")).toBe(true);
  await x.learning.active("bot1");
  expect(x.stop).toHaveBeenCalledWith({ threadId: "fork1" });
  expect((await x.learning.view("bot_main")).lastReview?.result).toMatch(/you started a turn/);

  expect(await x.learning.start("bot_main", "review")).toBe(true);
  x.bot.state = "paused";
  await x.learning.tick();
  expect((await x.learning.view("bot_main")).lastReview?.result).toMatch(/Dot is paused/);

  x.bot.state = "active";
  expect(await x.learning.start("bot_main", "review")).toBe(true);
  await x.learning.tick(Date.now() + 21 * 60_000);
  expect((await x.learning.view("bot_main")).lastReview?.result).toMatch(/took too long/);
});

it("doesn't fork a busy bot thread", async () => {
  const x = await setup();
  x.threads.set("bot1", { ...x.threads.get("bot1")!, status: "active" });
  expect(await x.learning.start("bot_main", "review")).toBe(false);
});

it("removes retired approval and pending skill fields from the RPC contract", async () => {
  const x = await setup();
  expect(rpcContract.bot_learning_set.input.shape).not.toHaveProperty("approval");
  expect(rpcContract.bot_learning.output.shape).not.toHaveProperty("approval");
  expect(rpcContract.bot_learning.output.shape).not.toHaveProperty("pending");
  expect(rpcContract).not.toHaveProperty("bot_skill_pending_resolve");
  expect(await x.learning.view("bot_main")).not.toHaveProperty("approval");
  expect(await x.learning.view("bot_main")).not.toHaveProperty("pending");
  expect(reviewPrompt({ name: "Dot", reason: "manual" })).toContain("apply immediately");
});

it("runs the curator explicitly from maintenance, with a dry run, pins exempt, and optional consolidation", async () => {
  const x = await setup();
  const now = Date.now();
  x.writeSkill("bot_main", { name: "old", description: "d", body: "b" });
  x.writeSkill("bot_main", { name: "pinned", description: "d", body: "b" });
  x.writeSkill("bot_main", { name: "fresh", description: "d", body: "b" });
  x.db.prepare("UPDATE bot_skills SET used_at = ?, updated_at = 0 WHERE name IN ('old', 'pinned')").run(now - 100 * DAY);
  x.db.prepare("UPDATE bot_skills SET used_at = ? WHERE name = 'fresh'").run(now);
  x.db.prepare("UPDATE bot_skills SET pinned = 1 WHERE name = 'pinned'").run();

  const dry = await x.learning.curate("bot_main", { dryRun: true, now });
  expect(dry).toMatchObject({ changes: [{ name: "old", from: "active", to: "archived" }], result: "Dry run: 1 archived" });
  expect(x.skills().find((skill) => skill.name === "old")?.state).toBe("active");

  // The minute tick doesn't curate; built-in Maintenance owns the pass.
  await x.learning.set("bot_main", { enabled: false });
  await x.learning.tick(now + 100 * DAY);
  expect(x.skills().find((skill) => skill.name === "old")?.state).toBe("active");
  await x.learning.set("bot_main", { consolidate: true });
  await x.learning.curate("bot_main", { now });
  expect(Object.fromEntries(x.skills().map((skill) => [skill.name, skill.state]))).toEqual({ fresh: "active", old: "archived", pinned: "active" });
  expect((await x.learning.view("bot_main")).lastCurator).toMatchObject({ result: "1 archived" });
  // Two skills left unarchived: a consolidation fork.
  expect(x.send).toHaveBeenCalledWith(expect.objectContaining({ input: [expect.objectContaining({ text: expect.stringMatching(/Skill curator for "Dot"/) })] }));
});

it("bounds diff memory while retaining all lines for long skills", () => {
  const before = "old\n".repeat(1100), after = "new\n".repeat(1100);
  const diff = lineDiff(before, after);
  expect(diff.split("\n").filter((line) => line === "- old")).toHaveLength(1100);
  expect(diff.split("\n").filter((line) => line === "+ new")).toHaveLength(1100);
});

it("removes curator Pause from RPC settings and views while retaining legacy data", async () => {
  const x = await setup();
  await x.learning.view("bot_main");
  x.db.prepare("UPDATE bot_learning SET curator_paused = 1").run();
  expect(rpcContract.bot_learning_set.input.shape).not.toHaveProperty("curatorPaused");
  expect(await x.learning.view("bot_main")).not.toHaveProperty("curatorPaused");
  await x.learning.set("bot_main", { consolidate: true });
  expect(x.db.prepare("SELECT curator_paused FROM bot_learning").get()).toEqual({ curator_paused: 1 });
});
