import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { rpcContract } from "./contract";
import {
  ARCHIVE_AFTER_MS, cheapestModel, curatorPlan, lineDiff, lintSkill, patchText, REVIEW_TOOLS, RETRY_PROMPT, reviewPrompt, gaveUpOnTools,
  SkillLearning, STALE_AFTER_MS, tallyTurns, type LearningSkill, type SkillState,
} from "./skill-learning";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const DAY = 86_400_000;
const turn = (seq: number, items: string[], opts: { user?: boolean; tool?: string } = {}) => [
  ...(opts.user ? [{ seq: seq, type: "client/turn/requested", data: { initiator: "user" } }] : []),
  ...items.map((type, i) => ({ seq: seq + 1 + i, type: "item/completed", data: { item: { type, ...(type === "toolCall" && opts.tool ? { tool: opts.tool } : {}) } } })),
  { seq: seq + 1 + items.length, type: "turn/completed", data: { status: "completed" } },
];

it("counts tool turns and user turns, and a skill write resets the tool count", () => {
  const events = [...turn(1, ["reasoning", "commandExecution", "agentMessage"], { user: true }), ...turn(10, ["agentMessage"], { user: true }), ...turn(20, ["fileRead", "mcpToolCall"])];
  expect(tallyTurns(events)).toEqual({ toolTurns: 2, userTurns: 2, skillWrite: false, lastSeq: 23, inTurn: 0 });
  const reset = [...turn(1, ["commandExecution"]), ...turn(10, ["toolCall"], { tool: "mcp__bb-bridge__bot_skill_patch" }), ...turn(20, ["commandExecution"])];
  expect(tallyTurns(reset)).toMatchObject({ toolTurns: 1, skillWrite: true });
  // An automation's turn isn't the user's.
  expect(tallyTurns([{ seq: 1, type: "client/turn/requested", data: { initiator: "automation" } }]).userTurns).toBe(0);
});

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

it("gives a review fork only the skill tools and Memory page tools, and a lessons-not-logs prompt", () => {
  expect([...REVIEW_TOOLS]).toEqual(["bot_skill_list", "bot_skill_view", "bot_skill_write", "bot_skill_patch", "bot_skill_delete", "bot_skill_lint", "pages_read", "pages_edit"]);
  const prompt = reviewPrompt({ name: "Dot", memoryPageId: "pg1", reason: "tools" });
  expect(prompt).toMatch(/Lessons, not logs/);
  expect(prompt).toMatch(/remember this/);
  expect(prompt).toMatch(/merge it into one rule/);
  expect(prompt).toMatch(/reply exactly \[PASS\]/);
  expect(prompt).toMatch(/pg1/);
});

it("tells a review its bridge tools work even when Claude Code calls them disconnected", () => {
  const prompt = reviewPrompt({ name: "Dot", memoryPageId: "pg1", reason: "tools" });
  expect(prompt).toMatch(/ToolSearch \("select:mcp__bb-bridge__bot_skill_list,.*mcp__bb-bridge__pages_edit"\)/);
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
      { model: "claude-haiku", description: "$0.10/$0.50 per Mtok", supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
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
  const learning = new SkillLearning({
    db, sdk: bb.sdk, changed: () => {}, bots: () => [bot], bot: (id) => id === bot.id ? bot : null, memoryPage: () => "pg_mem",
    skills: () => skills(),
    setState: (_botId, name, state) => { db.prepare("UPDATE bot_skills SET state = ? WHERE name = ?").run(state, name); },
  });
  const work = (n: number, user = false) => { for (let i = 0; i < n; i++) events.push(...turn((events.at(-1)?.seq ?? 0) + 1, ["commandExecution"], { user })); };
  return { db, bot, threads, learning, fork, update, send, stop, archive, work, skills, writeSkill, setEvents: (next: typeof events) => { events = next; } };
}

it("takes a baseline first, then forks a review on a cheap model after 10 tool turns", async () => {
  const x = await setup();
  x.work(30);
  // First look: old history doesn't count.
  await x.learning.idle(x.threads.get("bot1")!, "done");
  expect((await x.learning.view("bot_main")).toolTurns).toBe(0);
  x.work(9);
  await x.learning.idle(x.threads.get("bot1")!, "done");
  expect(x.fork).not.toHaveBeenCalled();
  expect((await x.learning.view("bot_main")).toolTurns).toBe(9);
  x.work(1);
  await x.learning.idle(x.threads.get("bot1")!, "done");
  expect(x.fork).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "bot1", visibility: "hidden", pluginMetadata: { botReview: "bot_main" } }));
  expect(x.update).toHaveBeenCalledWith({ threadId: "fork1", model: "claude-haiku", reasoningLevel: "low" });
  expect(x.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: "fork1", input: [expect.objectContaining({ text: expect.stringMatching(/Background skill review for "Dot"/) })] }));
  const view = await x.learning.view("bot_main");
  expect(view).toMatchObject({ reviewing: true, toolTurns: 0, defaultModel: "claude-haiku" });
  expect(x.learning.reviewThreads()).toEqual(new Set(["fork1"]));

  // Single flight: no second review while one runs.
  expect(await x.learning.start("bot_main", "review")).toBe(false);

  // A fork is idle before its prompt lands: that idle isn't the end.
  await x.learning.idle(x.threads.get("fork1")!, null);
  expect((await x.learning.view("bot_main")).reviewing).toBe(true);
  // The fork runs, saves a skill and finishes: recorded; Maintenance owns archiving.
  await x.learning.active("fork1");
  x.learning.noteWrite("fork1", "saved");
  await x.learning.idle(x.threads.get("fork1")!, "Saved deploy-check.");
  expect(x.archive).not.toHaveBeenCalled();
  expect(await x.learning.view("bot_main")).toMatchObject({ reviewing: false, lastReview: { result: "Saved 1 skill" } });
});

it("records [PASS] as nothing to save, trips on user turns, and stays off when turned off or paused", async () => {
  const x = await setup();
  await x.learning.idle(x.threads.get("bot1")!, null);
  await x.learning.set("bot_main", { interval: 3 });
  for (let i = 0; i < 3; i++) x.setEvents([]);
  x.setEvents([...turn(1, ["agentMessage"], { user: true }), ...turn(5, ["agentMessage"], { user: true }), ...turn(9, ["agentMessage"], { user: true })]);
  x.db.prepare("UPDATE bot_learning SET seen_seq = 0").run();
  await x.learning.idle(x.threads.get("bot1")!, null);
  expect(x.fork).toHaveBeenCalledTimes(1);
  expect(x.send.mock.calls[0]![0]).toMatchObject({ input: [{ text: expect.stringMatching(/run of turns with the user/) }] });
  await x.learning.active("fork1");
  await x.learning.idle(x.threads.get("fork1")!, "[PASS]");
  expect((await x.learning.view("bot_main")).lastReview?.result).toBe("Nothing to save");

  await x.learning.set("bot_main", { enabled: false });
  x.db.prepare("UPDATE bot_learning SET tool_turns = 50").run();
  expect(await x.learning.maybeReview("bot_main")).toBe(false);
  await x.learning.set("bot_main", { enabled: true });
  x.bot.state = "paused";
  expect(await x.learning.maybeReview("bot_main")).toBe(false);
  x.bot.kind = "external";
  x.bot.state = "active";
  expect(await x.learning.start("bot_main", "review")).toBe(false);
  expect(x.fork).toHaveBeenCalledTimes(1);
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
  expect(reviewPrompt({ name: "Dot", memoryPageId: null, reason: "manual" })).toContain("apply immediately");
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

  // The old minute tick no longer curates; built-in Maintenance owns the pass.
  await x.learning.tick(now + 100 * DAY);
  expect(x.skills().find((skill) => skill.name === "old")?.state).toBe("active");
  await x.learning.set("bot_main", { consolidate: true });
  await x.learning.curate("bot_main", { now });
  expect(Object.fromEntries(x.skills().map((skill) => [skill.name, skill.state]))).toEqual({ fresh: "active", old: "archived", pinned: "active" });
  expect((await x.learning.view("bot_main")).lastCurator).toMatchObject({ result: "1 archived" });
  // Two skills left unarchived: a consolidation fork.
  expect(x.send).toHaveBeenCalledWith(expect.objectContaining({ input: [expect.objectContaining({ text: expect.stringMatching(/Skill curator for "Dot"/) })] }));
});

it("pages through more than 100 new events", async () => {
  const x = await setup();
  await x.learning.idle(x.threads.get("bot1")!, null);
  await x.learning.set("bot_main", { enabled: false });
  x.work(45);
  await x.learning.idle(x.threads.get("bot1")!, null);
  expect((await x.learning.view("bot_main")).toolTurns).toBe(45);
});

it("bounds diff memory while retaining all lines for long skills", () => {
  const before = "old\n".repeat(1100), after = "new\n".repeat(1100);
  const diff = lineDiff(before, after);
  expect(diff.split("\n").filter((line) => line === "- old")).toHaveLength(1100);
  expect(diff.split("\n").filter((line) => line === "+ new")).toHaveLength(1100);
});

it("counts a tool turn split across event pages", async () => {
  const x = await setup();
  await x.learning.count(x.bot);
  const filler = Array.from({ length: 99 }, (_, i) => ({ seq: i + 1, type: "item/completed", data: { item: { type: "reasoning" } } }));
  x.setEvents([...filler, ...turn(99, ["commandExecution"])]);
  await x.learning.count(x.bot);
  expect((await x.learning.view("bot_main")).toolTurns).toBe(1);
});
it("keeps an unfinished tool turn across count calls and service restarts", async () => {
  const x = await setup();
  await x.learning.count(x.bot);
  x.setEvents([{ seq: 1, type: "item/completed", data: { item: { type: "commandExecution" } } }]);
  await x.learning.count(x.bot);
  expect((await x.learning.view("bot_main")).toolTurns).toBe(0);
  x.setEvents([{ seq: 2, type: "turn/completed", data: {} }]);
  const learning = new SkillLearning({ ...(x.learning as unknown as { deps: ConstructorParameters<typeof SkillLearning>[0] }).deps });
  await learning.count(x.bot);
  expect((await learning.view("bot_main")).toolTurns).toBe(1);
  await learning.count(x.bot);
  expect((await learning.view("bot_main")).toolTurns).toBe(1);
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
