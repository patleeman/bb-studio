import { expect, it } from "vitest";
import { task as taskSchema, type Task } from "../contract";
import { boardRows, flightRows, workerRows } from "../rows";
import { zonedTime } from "../../loops/clock";
import { areaOrder, itemAge, runBars } from "../../areas/ui/model";
import type { AreaView } from "../../areas/contract";
import { areaAsks, doneSummary, isWaitingOnly, splitWaiting, startedAt, flightLook, moreLine, pageCounts, pageFlight, stepProgress, todoBox, todoHeader, todoShown, treeOf, waitLabel, weekStart, workerGroups, type FlightNode, type WorkerInfo } from "./board-model";

const NOW = Date.UTC(2026, 10, 15, 22, 0);
const H = 3_600_000;
const t = (id: string, patch: Record<string, unknown> = {}): Task => taskSchema.parse({ id, title: id, owner: "patrick", state: "todo", origin: "task", createdAt: NOW - 5 * H, updatedAt: NOW - H, ...patch });
const WORKERS = new Set(["thr_w1", "thr_w2", "thr_w3", "thr_w4"]);
const dir = { isWorker: (id: string) => WORKERS.has(id), conversationOf: (id: string) => id, main: () => "thr_main" } as never;
const ctx = { since: Date.UTC(2026, 10, 15, 5, 0), dir };

const DATA: Task[] = [
  t("ask", { state: "waiting", kind: "decide", options: ["Leave out", "Bundle"], needs: "Leave raw transcripts out?", conversation: "thr_main", area: "Systems" }),
  t("ask_sub", { state: "waiting", needs: "Try build 0115", parentId: "polish" }),
  t("mine_today", { attention: { queue: "surfaced", push: false } }),
  t("mine_later", { timing: { due: NOW + 9 * 24 * H, trigger: { type: "none" }, snoozed: false } }),
  t("outside", { kind: "waiting-outside", state: "waiting", waitingOn: { kind: "outside", ref: null, text: "the landlord" }, conversation: "thr_main" }),
  t("polish", { owner: "thread:thr_lead", state: "in_progress", progress: { step: "3/5 Shots", line: "Taking screenshots" }, conversation: "thr_studio" }),
  t("polish_shots", { owner: "thread:thr_w1", state: "in_progress", parentId: "polish", workers: ["thr_w1"] }),
  t("polish_review", { owner: "thread:thr_w2", state: "waiting", parentId: "polish", workers: ["thr_w2"], waitingOn: { kind: "ci", ref: "run 7", text: null } }),
  t("testflight", { owner: "thread:thr_lead", state: "waiting", waitingOn: { kind: "task", ref: "polish", text: null }, conversation: "thr_studio" }),
  t("duo", { owner: "thread:thr_lead", state: "waiting", waitingOn: { kind: "user", ref: null, text: null }, conversation: "thr_studio", workers: ["thr_w3"] }),
  t("cos_job", { owner: "cos", state: "in_progress", workers: ["thr_w4"] }),
  t("schedule", { owner: "cos", state: "in_progress", automation: { id: "aut_1", kind: "runner", role: "schedule" }, schedule: { text: "Daily" } }),
  t("dropped", { owner: "thread:thr_lead", state: "dropped", conversation: "thr_studio", closedAt: NOW - H }),
  t("done_today", { owner: "thread:thr_lead", state: "done", conversation: "thr_studio", closedAt: NOW - 2 * H, workers: ["thr_w1"] }),
  t("done_yesterday", { owner: "thread:thr_lead", state: "done", conversation: "thr_studio", closedAt: NOW - 20 * H }),
];

it("puts every open top-level task in exactly one of Your to-do and In flight, and the counts agree with In flight in each conversation and with Workers", () => {
  const board = boardRows(DATA, ctx);
  const counts = pageCounts(board, NOW, "America/New_York");
  expect(counts.todo + counts.flight).toBe(board.counts.open);
  expect(counts.open).toBe(board.counts.open);
  const flight = pageFlight(board);
  expect(new Set(flight.map((n) => n.task.id))).toEqual(new Set(["polish", "outside", "cos_job", "testflight", "duo"]));
  const box = todoBox(board.tasks, NOW, "America/New_York");
  expect(box.asks.map((x) => x.id)).toEqual(["ask", "ask_sub"]);
  expect(box.today.map((x) => x.id)).toEqual(["mine_today"]);
  expect(box.later.map((x) => x.id)).toEqual(["mine_later"]);

  const homes = [...new Set(board.rows.filter((r) => r.under === null).map((r) => r.home))];
  const perConversation = homes.filter((h): h is string => !!h).map((h) => pageFlight(flightRows(DATA, h, ctx)).length).reduce((a, b) => a + b, 0);
  const homeless = flight.filter((n) => !n.row.home).length;
  expect(perConversation + homeless).toBe(counts.flight);

  const workers = workerRows(DATA, ctx);
  const groups = workerGroups({ ...workers, groups: workers.groups.map((g) => ({ ...g, name: g.conversation ?? "None" })) });
  const sidebarIds = groups.flatMap((g) => g.nodes.map((n) => n.task.id)).sort();
  expect(sidebarIds).toEqual(flight.filter((n) => n.row.hasWorkers).map((n) => n.task.id).sort());
  expect(sidebarIds.length).toBe(counts.withWorkers);
  expect(workers.counts.workers).toBe(board.counts.workers);
  expect(groups.map((g) => g.conversation)).toEqual(["thr_studio", "thr_main"]);
});

it("never shows a subtask as its own row: workers fold under their task, each once", () => {
  const nodes = pageFlight(boardRows(DATA, ctx));
  const polish = nodes.find((n) => n.task.id === "polish")!;
  expect(polish.children.map((c) => c.task.id)).toEqual(["ask_sub", "polish_review", "polish_shots"]);
  expect(polish.children.flatMap((c) => c.workers.map((w) => w.threadId))).toEqual(["thr_w2", "thr_w1"]);
  expect(nodes.map((n) => n.task.id)).not.toContain("polish_shots");
  expect(polish.row.needsYou).toBe(true);
  expect(flightLook(polish.task, polish.row.needsYou)).toBe("running");
});

it("reads a step as N of M and leaves odd steps alone", () => {
  expect(stepProgress("3/5 Tests")).toEqual({ at: 3, of: 5, label: "3 of 5", rest: "Tests" });
  expect(stepProgress("Step 1 of 6: migrate")).toEqual({ at: 1, of: 6, label: "1 of 6", rest: "migrate" });
  expect(stepProgress("Rebased on 5a")).toBeNull();
  expect(stepProgress("7/5")).toBeNull();
  expect(stepProgress(null)).toBeNull();
});

it("says what a waiting task waits on", () => {
  const titleOf = (id: string) => (id === "polish" ? "Phone polish" : null);
  expect(waitLabel(DATA.find((x) => x.id === "duo")!, titleOf)).toEqual({ short: "waiting on you", long: "Waiting on you" });
  expect(waitLabel(DATA.find((x) => x.id === "polish_review")!, titleOf)).toEqual({ short: "waiting on CI", long: "Waiting on CI: run 7" });
  expect(waitLabel(DATA.find((x) => x.id === "testflight")!, titleOf)).toEqual({ short: "waiting on a task", long: "Waiting on Phone polish" });
  expect(waitLabel(DATA.find((x) => x.id === "outside")!, titleOf)).toEqual({ short: "waiting on the landlord", long: "Waiting on the landlord" });
  expect(waitLabel(t("plain", { owner: "cos", state: "waiting" }))).toEqual({ short: "waiting", long: "Waiting" });
});

it("folds the to-do list to seven rows with N more today and N later, asks first", () => {
  const many = Array.from({ length: 9 }, (_, i) => t(`today_${i}`, { attention: { queue: "surfaced", push: false }, createdAt: NOW - 10 * H + i }));
  const box = todoBox([...DATA, ...many], NOW, "UTC");
  const shown = todoShown(box, 1, false);
  expect(shown).toEqual({ asks: 2, areaAsks: 0, today: 4, later: 0, moreAsks: 0, moreToday: 6, moreLater: 1 });
  expect(moreLine(shown.moreToday, shown.moreLater)).toBe("6 more today · 1 later");
  expect(todoHeader(box, 1)).toBe("3 asks · 10 today");
  expect(todoShown(box, 1, true)).toEqual({ asks: 2, areaAsks: 0, today: 10, later: 1, moreAsks: 0, moreToday: 0, moreLater: 0 });
  const tight = todoShown(box, 1, false, 4, 3);
  expect(tight).toEqual({ asks: 2, areaAsks: 1, today: 0, later: 0, moreAsks: 2, moreToday: 10, moreLater: 1 });
  expect(moreLine(tight.moreToday, tight.moreLater, tight.moreAsks)).toBe("2 more asks · 10 more today · 1 later");
  expect(todoHeader(box, 1, 3)).toBe("6 asks · 10 today");
});

it("counts done today and this week from the user's midnight and Monday, not the computer's, across midnight", () => {
  const zone = "America/Los_Angeles";
  const sunday = zonedTime(2026, 11, 15, 23, 30, zone);
  const done = (id: string, at: number, patch: Record<string, unknown> = {}) => t(id, { owner: "thread:thr_lead", state: "done", closedAt: at, ...patch });
  const tasks = [
    done("late_sunday", zonedTime(2026, 11, 15, 23, 10, zone), { outputs: [{ kind: "pr", ref: "https://example.com/pull/14" }] }),
    done("early_sunday", zonedTime(2026, 11, 15, 0, 5, zone)),
    done("saturday_late", zonedTime(2026, 11, 14, 23, 55, zone)),
    done("monday", zonedTime(2026, 11, 9, 0, 1, zone)),
    done("last_sunday", zonedTime(2026, 11, 8, 23, 59, zone)),
    done("sub", zonedTime(2026, 11, 15, 22, 0, zone), { parentId: "late_sunday", owner: "thread:thr_w1" }),
    t("failed", { state: "failed", closedAt: sunday - H }),
    t("mine", { state: "done", closedAt: zonedTime(2026, 11, 12, 9, 0, zone) }),
  ];
  const sum = doneSummary(tasks, sunday, zone);
  expect([sum.today, sum.week]).toEqual([2, 5]);
  expect(sum.latest.map((x) => x.id)).toEqual(["late_sunday", "early_sunday", "saturday_late", "mine"]);
  expect(sum.groups.map((g) => [g.owner, g.tasks.map((x) => x.task.id)])).toEqual([["patrick", ["mine"]], ["thread:thr_lead", ["late_sunday", "early_sunday", "saturday_late", "monday"]]]);
  expect(sum.groups[1]!.tasks[0]!.folded.map((x) => x.id)).toEqual(["sub"]);
  const mondayMorning = zonedTime(2026, 11, 16, 0, 30, zone);
  const next = doneSummary(tasks, mondayMorning, zone);
  expect([next.today, next.week]).toEqual([0, 0]);
  expect(weekStart(mondayMorning, zone)).toBe(zonedTime(2026, 11, 16, 0, 0, zone));
  const utc = doneSummary(tasks, sunday, "UTC");
  expect(utc.today).toBe(1);
});

it("orders areas problems first, draws the last seven runs oldest to newest, so the newest sits beside Last, and ages open items in the user's zone", () => {
  const area = (name: string, status: AreaView["status"]) => ({ name, status }) as AreaView;
  expect(areaOrder([area("Comms", "ok"), area("Kensico", "flagged"), area("House", "broken"), area("Jobs", "unknown"), area("Systems", "flagged")]).map((a) => a.name))
    .toEqual(["House", "Kensico", "Systems", "Comms", "Jobs"]);
  const runs = Array.from({ length: 9 }, (_, i) => ({ at: NOW - i * H, outcome: i < 3 ? "broken" as const : "ok" as const, line: "", taskId: null }));
  expect(runBars(runs).map((r) => r.outcome)).toEqual(["ok", "ok", "ok", "ok", "broken", "broken", "broken"]);
  expect(runBars(runs).map((r) => r.at)).toEqual([...runs.slice(0, 7)].reverse().map((r) => r.at));
  expect(runBars(runs.slice(0, 2)).map((r) => r.at)).toEqual([runs[1]!.at, runs[0]!.at]);
  expect(itemAge({ since: null, sinceAt: NOW - H }, NOW, "UTC")).toBe("today");
  expect(itemAge({ since: null, sinceAt: NOW - 6 * 24 * H }, NOW, "UTC")).toBe("6 days");
  expect(itemAge({ since: null, sinceAt: Date.UTC(2026, 9, 5, 12) }, NOW, "UTC")).toBe("Oct 5");
  expect(itemAge({ since: "~Nov", sinceAt: null }, NOW, "UTC")).toBe("~Nov");
  expect(itemAge({ since: null, sinceAt: Date.UTC(2026, 10, 15, 3) }, Date.UTC(2026, 10, 15, 6), "America/New_York")).toBe("1 day");
});

it("builds the tree from flat rows, keeping a subtask after its parent", () => {
  const board = boardRows(DATA, ctx);
  const tree = treeOf(board);
  const ids = tree.map((n) => n.task.id);
  expect(ids).not.toContain("polish_shots");
  expect(tree.find((n) => n.task.id === "done_today")!.row.open).toBe(false);
  expect(ids).not.toContain("dropped");
  expect(ids).not.toContain("schedule");
  expect(ids).not.toContain("done_yesterday");
});

it("counts a to-do checked a moment ago under Done at once, and times running work from when it began", () => {
  const now = Date.UTC(2026, 10, 15, 22, 0);
  const justNow = t("just_now", { state: "done", closedAt: now + 30_000 });
  expect(doneSummary([justNow], now, "UTC").today).toBe(1);
  const node = { task: t("running", { state: "in_progress", createdAt: now - 6 * 86_400_000 }), row: { id: "running", home: null, under: null, depth: 0, open: true, workers: [], hasWorkers: false, needsYou: false, startedAt: now - 5 * 60_000 } };
  expect(startedAt(node)).toBe(now - 5 * 60_000);
  expect(startedAt({ ...node, row: { ...node.row, startedAt: undefined } })).toBe(now - 6 * 86_400_000);
});

it("turns every area open item that needs the user into an ask, problems first, except one already among the user's own tasks", () => {
  const item = (title: string, needsUser: boolean, taskId: string | null = null) => ({ title, since: null, sinceAt: null, needsUser, taskId });
  const areas = [
    { id: "area_comms", name: "Comms", status: "ok" as const, open: [item("PR #14 review", true), item("Releases untagged", false)] },
    { id: "area_house", name: "House", status: "broken" as const, open: [item("Clean the dryer vent", true, "mine_today"), item("Defrost the freezer", true)] },
    { id: "area_studio", name: "BB Studio", status: "ok" as const, open: [item("Next build: your OK", true, "testflight")] },
  ];
  expect(areaAsks(areas, DATA).map((a) => [a.area, a.title])).toEqual([["House", "Defrost the freezer"], ["BB Studio", "Next build: your OK"], ["Comms", "PR #14 review"]]);
});

it("marks a running task stalled when every thread on it has been quiet for six hours or is gone, and leaves schedules and fresh work alone", async () => {
  const { stalledTasks } = await import("../stalled");
  const fact = (id: string, status: string, idleH: number, extra: Record<string, unknown> = {}) => ({ id, parentThreadId: "thr_lead", title: id, status, archivedAt: null, createdAt: NOW - 48 * H, updatedAt: NOW - idleH * H, ...extra });
  const tasks = [
    t("quiet", { owner: "thread:thr_q", state: "in_progress", workers: ["thr_q"] }),
    t("busy", { owner: "thread:thr_b", state: "in_progress", workers: ["thr_b"] }),
    t("recent", { owner: "thread:thr_r", state: "in_progress", workers: ["thr_r"] }),
    t("gone", { owner: "thread:thr_gone", state: "in_progress" }),
    t("parent", { owner: "thread:thr_q", state: "in_progress" }),
    t("child", { owner: "thread:thr_b", state: "in_progress", parentId: "parent" }),
    t("sched", { owner: "thread:thr_q", state: "in_progress", automation: { id: "aut_1", kind: "runner", role: "schedule" }, schedule: { text: "Daily" } }),
    t("nothread", { owner: "cos", state: "in_progress" }),
  ];
  const facts = [fact("thr_q", "idle", 7), fact("thr_b", "active", 9), fact("thr_r", "idle", 2)];
  expect([...stalledTasks(tasks, facts, NOW)].sort()).toEqual(["gone", "quiet"]);
  expect(stalledTasks(tasks, [], NOW).size).toBe(0);
});

it("tasks.check lists a stalled running task as a problem and changes nothing", async () => {
  const { checkTasks } = await import("../check");
  const tasks = [t("quiet", { owner: "thread:thr_w1", state: "in_progress", workers: ["thr_w1"], conversation: "thr_studio" })];
  const before = JSON.stringify(tasks);
  const facts = [{ id: "thr_w1", parentThreadId: "thr_lead", title: "Worker", status: "idle", archivedAt: null, createdAt: NOW - 48 * H, updatedAt: NOW - 7 * H }];
  const problems = checkTasks(tasks, facts, ctx, [], NOW);
  expect(problems.filter((p) => p.kind === "stalled").map((p) => p.taskIds)).toEqual([["quiet"]]);
  expect(JSON.stringify(tasks)).toBe(before);
});

// In flight is work under way; what only waits leaves it for Waiting.
const node = (task: Task, extra: { workers?: WorkerInfo[]; children?: FlightNode[]; needsYou?: boolean; stalled?: boolean } = {}): FlightNode => ({
  row: { id: task.id, home: null, under: null, depth: 0, open: !["done", "dropped", "failed"].includes(task.state), workers: (extra.workers ?? []).map((w) => w.threadId), hasWorkers: !!extra.workers?.length, needsYou: extra.needsYou ?? false, stalled: extra.stalled ?? false },
  task, children: extra.children ?? [], workers: extra.workers ?? [],
});
const agent = (id: string, patch: Record<string, unknown> = {}) => t(id, { owner: "thread:thr_lead", ...patch });
const worker = (status: string | null, archived = false): WorkerInfo => ({ threadId: `thr_${status ?? "none"}`, name: "A worker", status, archived });
const at = (type: string, extra: Record<string, unknown> = {}) => ({ due: null, trigger: { type, ...extra }, snoozed: false });

it("puts each kind of row in In flight or Waiting", () => {
  const active = {
    running: node(agent("running", { state: "in_progress" })),
    stalledRunning: node(agent("stalled", { state: "in_progress" }), { stalled: true }),
    queued: node(agent("queued", { state: "todo" })),
    waitingWithoutReason: node(agent("waiting", { state: "waiting" })),
    onCi: node(agent("ci", { state: "waiting", waitingOn: { kind: "ci", ref: "run 7", text: null } })),
    onTheUser: node(agent("user", { state: "waiting", waitingOn: { kind: "user", ref: null, text: null } })),
    subtaskNeedsYou: node(agent("sub_needs", { state: "waiting", waitingOn: { kind: "outside", ref: null, text: "Unraid" } }), { needsYou: true }),
    timeAlreadyDue: node(agent("due", { state: "todo", timing: at("time", { at: NOW - H }) })),
    outsideButWorkerRunning: node(agent("worked", { state: "waiting", waitingOn: { kind: "outside", ref: null, text: "Unraid" } }), { workers: [worker("active")] }),
    outsideButSubtaskRunning: node(agent("parent", { state: "waiting", waitingOn: { kind: "task", ref: "x", text: null } }), { children: [node(agent("child", { state: "in_progress", parentId: "parent" }))] }),
    ended: node(agent("ended", { state: "waiting", stale: true, waitingOn: { kind: "outside", ref: null, text: "Unraid" } })),
    closed: node(agent("closed", { state: "done", closedAt: NOW - H, kind: "waiting-outside" })),
  };
  const waiting = {
    onSomeoneOutside: node(agent("red4", { owner: "cos", state: "waiting", waitingOn: { kind: "outside", ref: null, text: "Unraid shipping a fix" } })),
    onAnotherTask: node(agent("tf", { state: "waiting", waitingOn: { kind: "task", ref: "polish", text: null } })),
    waitingOutsideKind: node(t("lease", { kind: "waiting-outside", state: "waiting" })),
    agentsWaitingOutsideKind: node(agent("agent_lease", { kind: "waiting-outside", state: "todo" })),
    onAnEvent: node(agent("event", { state: "todo", timing: at("event", { event: "reply:sam" }) })),
    onAPlace: node(agent("place", { state: "waiting", timing: at("place", { place: "home", direction: "arrive" }) })),
    untilALaterTime: node(agent("later", { state: "todo", timing: at("time", { at: NOW + 24 * H }) })),
    snoozed: node(agent("snoozed", { state: "waiting", timing: { due: null, trigger: { type: "none" }, snoozed: true } })),
    withAnIdleWorker: node(agent("idle", { state: "waiting", waitingOn: { kind: "outside", ref: null, text: "Unraid" } }), { workers: [worker("idle")] }),
    withAnArchivedWorker: node(agent("gone", { state: "waiting", waitingOn: { kind: "outside", ref: null, text: "Unraid" } }), { workers: [worker("active", true)] }),
  };
  for (const [kind, n] of Object.entries(active)) expect(isWaitingOnly(n, NOW), kind).toBe(false);
  for (const [kind, n] of Object.entries(waiting)) expect(isWaitingOnly(n, NOW), kind).toBe(true);
  const split = splitWaiting([active.running, waiting.onSomeoneOutside, active.onCi, waiting.onAnEvent], NOW);
  expect(split.active.map((n) => n.task.id)).toEqual(["running", "ci"]);
  expect(split.waiting.map((n) => n.task.id)).toEqual(["red4", "event"]);
});

it("splits the board's In flight: the sample's outside and task waits go to Waiting, the rest stay", () => {
  const split = splitWaiting(pageFlight({ ...boardRows(DATA, ctx), workers: [{ threadId: "thr_w1", name: "Shots", status: "active", archived: false }] }), NOW);
  expect(split.waiting.map((n) => n.task.id)).toEqual(["outside", "testflight"]);
  expect(split.active.map((n) => n.task.id)).not.toContain("outside");
  expect(split.active.map((n) => n.task.id)).toContain("duo");
});

it("leaves a worker's task that only waits out of the sidebar's Workers", () => {
  const tasks = [
    agent("live", { state: "in_progress", workers: ["thr_w1"], conversation: "thr_studio" }),
    agent("parked", { state: "waiting", waitingOn: { kind: "outside", ref: null, text: "Unraid" }, workers: ["thr_w2"], conversation: "thr_studio" }),
  ];
  const rows = workerRows(tasks, ctx);
  const data = { ...rows, workers: [{ threadId: "thr_w1", name: "Live", status: "active", archived: false }, { threadId: "thr_w2", name: "Parked", status: "idle", archived: false }], groups: rows.groups.map((g) => ({ ...g, name: "BB Studio" })) };
  expect(workerGroups(data, () => true, NOW).flatMap((g) => g.nodes.map((n) => n.task.id))).toEqual(["live"]);
});
