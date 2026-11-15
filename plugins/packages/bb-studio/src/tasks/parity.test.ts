import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerLoops } from "../loops/register";
import { registerWorkCards, type TimelineReader } from "../work/register";
import { runWorkCli } from "../work/cli";

let uuid = 0;
vi.mock("node:crypto", async (original) => ({ ...(await original<typeof import("node:crypto")>()), randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` }));

const FIXTURE = join(__dirname, "fixtures", "parity.json");
const START = new Date("2026-11-02T15:00:00Z").getTime();
let db: Database.Database;

beforeEach(() => {
  uuid = 0;
  vi.useFakeTimers();
  vi.setSystemTime(START);
  db = new Database(":memory:");
  for (const sql of MIGRATIONS.filter((sql) => /CREATE TABLE (bot_loops|work_cards|tasks)\b/.test(sql))) db.exec(sql);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

type Tool = { name: string; execute(input: unknown, ctx: unknown): Promise<string> | string };
type Handler = (input: any) => unknown;

function fakeBb() {
  const handlers: Record<string, Handler> = {};
  const tools: Record<string, Tool> = {};
  const events: Record<string, (payload: any) => void> = {};
  const mentions: any[] = [];
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn(), info: vi.fn() }, onDispose: vi.fn(),
    agents: { registerTool: (tool: Tool) => { tools[tool.name] = tool; } },
    ui: { registerMentionProvider: (provider: unknown) => { mentions.push(provider); } },
    rpc: { register: (_contract: unknown, map: Record<string, Handler>) => Object.assign(handlers, map) },
    events: { on: (name: string, listener: (payload: any) => void) => { events[name] = listener; } },
    sdk: { threads: {
      get: async ({ threadId }: { threadId: string }) => { if (threadId === "thr_a") return { title: "Plumbing lead" }; if (threadId === "thr_w") return { status: "active", archivedAt: null }; throw new Error("Not found"); },
      update: vi.fn(async () => ({})),
      timeline: vi.fn(),
    } },
  };
  return { bb, handlers, tools, events, mentions };
}

const parse = (text: string) => JSON.parse(text);

async function scenario() {
  const out: { step: string; value: unknown }[] = [];
  const log = (step: string, value: unknown) => { out.push({ step, value: JSON.parse(JSON.stringify(value ?? null)) }); };
  const { bb, handlers, tools, events, mentions } = fakeBb();
  const posts: string[] = [];
  const notified: string[] = [];
  const loops = registerLoops(bb as never, db, async (text) => { posts.push(text); }, async (loop) => { notified.push(loop.id); },
    { get: async () => ({ loopsEnabled: true, loopDailyBudget: 3 }), onChange: () => {} }, () => "America/New_York", () => {});
  await vi.advanceTimersByTimeAsync(0);
  let message: { id: string; text: string; messageSeq: number } | null = null;
  const read: TimelineReader = async () => ({ rows: message ? [{ ...message, kind: "conversation" }] : [], timelinePage: { olderCursor: null } });
  const work = registerWorkCards(bb as never, db, { read, thread: async (id) => (id === "thr_gone" ? null : { status: "active", archivedAt: null }) });
  await work.swept;
  const ctx = { threadId: "thr_main" };
  const tool = async (name: string, input: unknown) => parse(await tools[name]!.execute(input, ctx));
  const T = Date.now();

  const plumber = await tool("todos_add", { title: "Call the plumber", why: "Leak under the sink", owner: "user", trigger: { type: "time", at: T + 3600000 }, push: true, due: T + 7200000, area: "Home" });
  const venue = await tool("loops_add", { title: "Pick a venue", kind: "decide", options: ["Hall", "Park"], owner: "patrick" });
  const report = await tool("todos_add", { title: "Read the report", kind: "read", priority: "low", area: "Work" });
  const sam = await tool("todos_add", { title: "Wait on Sam", kind: "waiting", trigger: { type: "event", event: "reply:sam", label: "when Sam replies" } });
  const botJob = await tool("todos_add", { title: "Renew the domain", owner: "cos", trigger: { type: "time", at: T + 1800000 } });
  const threadJob = await tool("todos_add", { title: "Fix the faucet", owner: "thread:thr_a", status: "in_progress" });
  const urgent = await tool("todos_add", { title: "Server down", priority: "urgent", push: true, source: { kind: "email", ref: "msg-1", url: "https://example.com/m/1" } });
  const home = await tool("todos_add", { title: "Water the plants", trigger: { type: "place", place: "Home", direction: "arrive" } });
  const extra = await tool("todos_add", { title: "Book the dentist", due: T - 1000 });
  const extra2 = await tool("todos_add", { title: "Pay the bill" });
  log("added", [plumber, venue, report, sam, botJob, threadJob, urgent, home, extra, extra2]);
  const spoken = await loops.add("Buy milk");
  log("voice add", spoken);
  log("posts after voice add", posts.splice(0));

  await loops.scheduler.tick();
  log("posts after tick", posts.splice(0));
  log("notified after tick", notified.splice(0));
  log("list", await handlers["loops.list"]!({}));
  log("list owner user", await handlers["loops.list"]!({ owner: "user" }));
  log("list area Home", await handlers["loops.list"]!({ area: "Home" }));

  vi.advanceTimersByTime(3600000);
  await loops.scheduler.tick();
  log("posts after an hour", posts.splice(0));
  log("notified after an hour", notified.splice(0));

  log("act choose", await handlers["loops.act"]!({ id: venue.id, action: "choose", option: "Hall" }));
  log("act snooze", await handlers["loops.act"]!({ id: report.id, action: "snooze", snooze: "tonight" }));
  log("act hand_off", await handlers["loops.act"]!({ id: sam.id, action: "hand_off", owner: "thread:thr_a" }));
  log("act nudge", await handlers["loops.act"]!({ id: threadJob.id, action: "nudge" }));
  log("act keep", await handlers["loops.act"]!({ id: extra.id, action: "keep" }));
  log("act got_it", await handlers["loops.act"]!({ id: extra2.id, action: "got_it" }));
  log("act drop", await handlers["loops.act"]!({ id: spoken.id, action: "drop" }));
  log("act done", parse(await tools["todos_act"]!.execute({ id: urgent.id, action: "done" }, ctx)));
  log("act on closed", await handlers["loops.act"]!({ id: urgent.id, action: "snooze", snooze: "tonight" }));
  log("posts after acts", posts.splice(0));

  vi.advanceTimersByTime(60000);
  log("update", await handlers["loops.update"]!({ id: plumber.id, changes: { why: "Leak under the kitchen sink", area: "House" } }));
  log("update reopen", await handlers["loops.update"]!({ id: urgent.id, changes: { status: "surfaced" } }));
  log("surface now", await handlers["loops.update"]!({ id: home.id, surfaceNow: true }));
  log("tool update surfaceNow", parse(await tools["todos_update"]!.execute({ id: extra.id, surfaceNow: true }, ctx)));
  log("posts after updates", posts.splice(0));
  log("fire", await handlers["loops.fire"]!({ event: "reply:sam" }));
  log("place", await handlers["loops.place"]!({ place: "Home", direction: "arrive" }));
  log("set places", await handlers["loops.setPlaces"]!({ names: [" Home ", "Office", "home"] }));
  log("places", await handlers["loops.places"]!({}));
  log("morning", await handlers["loops.morning"]!({}));
  log("tool morning", parse(await tools["todos_morning"]!.execute({}, ctx)));
  log("tool list", parse(await tools["loops_list"]!.execute({ owner: "user" }, ctx)));
  log("tool fire", parse(await tools["todos_fire"]!.execute({ event: "nothing" }, ctx)));
  for (const id of [plumber.id, venue.id, report.id, sam.id, botJob.id, threadJob.id, urgent.id, home.id, extra.id, extra2.id, spoken.id]) log(`get ${id}`, await handlers["loops.get"]!({ id }));
  log("tool get", parse(await tools["todos_get"]!.execute({ id: threadJob.id }, ctx)));
  log("get missing", await Promise.resolve().then(() => handlers["loops.get"]!({ id: "loop_missing" })).catch((error: Error) => error.message));
  const mention = mentions[0];
  log("mention search", await mention.search({ query: "" }));
  log("mention resolve", await mention.resolve(plumber.id));
  log("mention resolve missing", await mention.resolve("loop_missing"));
  vi.advanceTimersByTime(3 * 3600000);
  await loops.scheduler.tick();
  log("posts later", posts.splice(0));
  log("notified later", notified.splice(0));
  log("held", loops.scheduler.held());
  log("all loops", loops.store.all().sort((a, b) => a.id.localeCompare(b.id)));

  const release = await tool("work_card_create", { title: "Release 1.0.2", kind: "release", step: "1/3 Build" });
  const worker = await tool("work_card_create", { title: "Fix the flaky test", kind: "worker", workerThreadId: "thr_w", line: "Reading the logs" });
  log("work tool create", [release, worker]);
  log("work rpc create", await handlers["work.create"]!({ title: "Lead check", kind: "lead", threadId: "thr_main", state: "waiting", needs: "ignored" }));
  vi.advanceTimersByTime(1000);
  log("work update needs-you", parse(await tools["work_card_update"]!.execute({ id: release.id, state: "needs-you", needs: "Approve the push", step: "2/3 Tests" }, ctx)));
  log("work update running", await handlers["work.update"]!({ id: release.id, state: "running" }));
  log("work update clear line", await handlers["work.update"]!({ id: worker.id, line: "" }));
  log("work get tool", parse(await tools["work_card_get"]!.execute({ id: worker.id }, ctx)));
  message = { id: "m_7", text: `Started.\n::work{id="${release.id}"}`, messageSeq: 7 };
  log("work anchor", await handlers["work.anchor"]!({ id: release.id, threadId: "thr_main", messageId: "m_7" }));
  log("work list", await handlers["work.list"]!({ threadId: "thr_main" }));
  vi.advanceTimersByTime(1000);
  events["thread.idle"]!({ thread: { id: "thr_w" } });
  log("work after worker idle", await handlers["work.get"]!({ id: worker.id }));
  events["thread.active"]!({ thread: { id: "thr_w" } });
  log("work after worker back", await handlers["work.get"]!({ id: worker.id }));
  vi.advanceTimersByTime(1000);
  log("work done", await handlers["work.update"]!({ id: release.id, state: "done", line: "Shipped" }));
  log("work failed", await handlers["work.update"]!({ id: worker.id, state: "failed" }));
  log("work dismiss", await handlers["work.dismiss"]!({ id: worker.id }));
  log("work list after", await handlers["work.list"]!({ threadId: "thr_main" }));
  log("work clear", await handlers["work.clear"]!({ threadId: "thr_main" }));
  log("work list cleared", await handlers["work.list"]!({ threadId: "thr_main" }));
  log("work reopen", await handlers["work.update"]!({ id: release.id, state: "running" }));
  log("work move", work.store.move(release.id, "thr_other"));
  log("work openWithWorker", work.store.openWithWorker());
  log("work forWorker", work.store.forWorker("thr_w"));
  const cli = (argv: string[]) => runWorkCli(argv, work, ctx);
  log("cli create", await cli(["create", "--title", "CLI card", "--kind", "todo", "--step", "1/2"]));
  log("cli create json", await cli(["create", "--title", "CLI json", "--json"]));
  log("cli update", await cli(["update", "wc_00000000-0000-4000-8000-000000000015", "--state", "needs-you", "--needs", "Look"]));
  log("cli update blank", await cli(["update", "wc_00000000-0000-4000-8000-000000000015", "--line", "", "--step", ""]));
  log("cli show", await cli(["show", "wc_00000000-0000-4000-8000-000000000015", "--json"]));
  log("cli list", await cli(["list"]));
  log("cli dismiss", await cli(["dismiss", "wc_00000000-0000-4000-8000-000000000014"]));
  log("cli clear", await cli(["clear"]));
  log("cli missing", await cli(["show", "wc_missing"]));
  events["thread.archived"]!({ thread: { id: "thr_w" } });
  log("work reopen worker", await handlers["work.update"]!({ id: worker.id, state: "running" }));
  events["thread.deleted"]!({ thread: { id: "thr_w" } });
  log("work after worker deleted", await handlers["work.get"]!({ id: worker.id }));
  log("work missing", await Promise.resolve().then(() => handlers["work.get"]!({ id: "wc_missing" })).catch((error: Error) => error.message));
  log("loops after work", loops.store.all().map((loop) => loop.id).sort());
  return out;
}

it("keeps every loops_*, todos_* and work_card_* surface's output as recorded before tasks", async () => {
  const out = await scenario();
  expect(db.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({ n: 16 });
  expect(db.prepare("SELECT (SELECT count(*) FROM bot_loops) + (SELECT count(*) FROM work_cards) AS n").get()).toEqual({ n: 0 });
  if (process.env.RECORD_TASK_PARITY === "1") writeFileSync(FIXTURE, `${JSON.stringify(out, null, 1)}\n`);
  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof out;
  expect(out.map((entry) => entry.step)).toEqual(recorded.map((entry) => entry.step));
  for (let i = 0; i < out.length; i++) expect({ step: out[i]!.step, value: out[i]!.value }).toEqual(recorded[i]);
});
