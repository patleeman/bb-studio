import { expect, it } from "vitest";
import type { ConversationRow, WorkerRow } from "../../bot-threads-contract";
import { conversationLines, staleFailure, landingThread, olderBotFromPath, olderLabel, olderPath, secondLine, shortAge, spaceDots, summarySections, swipeStep, switchTarget, SWIPE_IDLE_MS, SWIPE_START, SWIPE_THRESHOLD, workerLines, splitWorkers, doneLabel, hiddenThreadTarget } from "./model";

const bots = [
  { id: "cos", name: "Chief of Staff", needsYou: false },
  { id: "home", name: "Home", needsYou: true },
  { id: "work", name: "Work", needsYou: false },
];

it("draws one dot per Bot: the shown one active, amber for a Bot that needs Patrick, a number for the first nine", () => {
  const dots = spaceDots(bots, "cos");
  expect(dots.map((dot) => [dot.id, dot.active, dot.amber, dot.shortcut])).toEqual([["cos", true, false, 1], ["home", false, true, 2], ["work", false, false, 3]]);
  expect(dots[1]!.label).toBe("Home, needs you");
  // The active Bot keeps its amber too; an unknown current one falls back to the first.
  expect(spaceDots([{ ...bots[0]!, needsYou: true }], "gone")[0]).toMatchObject({ active: true, amber: true });
  expect(spaceDots(Array.from({ length: 10 }, (_, n) => ({ id: `b${n}`, name: `B${n}`, needsYou: false })), "b0")[9]!.shortcut).toBeNull();
});

it("switches by number or by a step, without wrapping", () => {
  expect(switchTarget(bots, "cos", { index: 2 })).toBe("home");
  expect(switchTarget(bots, "cos", { index: 9 })).toBeNull();
  expect(switchTarget(bots, "cos", { step: 1 })).toBe("home");
  expect(switchTarget(bots, "cos", { step: -1 })).toBeNull();
  expect(switchTarget(bots, "work", { step: 1 })).toBeNull();
  expect(switchTarget([], null, { step: 1 })).toBeNull();
});

it("turns a two-finger sideways swipe into one switch per gesture, and ignores scrolling", () => {
  let state = SWIPE_START;
  const wheel = (deltaX: number, deltaY: number, at: number) => { const result = swipeStep(state, { deltaX, deltaY, at }); state = result.state; return result.step; };
  // Scrolling down the list is not a swipe.
  expect(wheel(5, 60, 1000)).toBeNull();
  expect(wheel(SWIPE_THRESHOLD / 2, 0, 1010)).toBeNull();
  expect(wheel(SWIPE_THRESHOLD / 2 + 1, 0, 1020)).toBe(1);
  // The rest of the same gesture does nothing more.
  expect(wheel(400, 0, 1030)).toBeNull();
  // A pause ends the gesture; the next one goes the other way.
  expect(wheel(-SWIPE_THRESHOLD - 1, 0, 1030 + SWIPE_IDLE_MS + 1)).toBe(-1);
});

it("lands on the Bot's last-open conversation while it is listed, else its Main", () => {
  expect(landingThread({ mainThreadId: "main" }, "conv", new Set(["conv"]))).toBe("conv");
  expect(landingThread({ mainThreadId: "main" }, "conv", new Set(["other"]))).toBe("main");
  expect(landingThread({ mainThreadId: "main" }, null, null)).toBe("main");
  // Not yet known whether it is listed: trust the last one.
  expect(landingThread({ mainThreadId: "main" }, "conv", null)).toBe("conv");
  expect(landingThread(null, null, null)).toBeNull();
});

const conversation = (over: Partial<ConversationRow> & { threadId: string }): ConversationRow => ({ title: over.threadId, isMain: false, forkedFrom: null, projectId: null, updatedAt: 0, latest: null, running: false, needsYou: null, mirrored: false, ...over });

it("puts BB's live state on the server's rows: running at once, a pending question as the needs-you reason, the row on screen selected", () => {
  const rows = [conversation({ threadId: "main", isMain: true, latest: "Morning brief is out" }), conversation({ threadId: "fork", needsYou: { reason: "Pick a date", at: 5 } }), conversation({ threadId: "asks" })];
  const live = new Map([["main", { id: "main", status: "active" }], ["asks", { id: "asks", status: "idle", hasPendingInteraction: true, updatedAt: 9 }]]);
  const lines = conversationLines(rows, live, "fork");
  expect(lines.map((line) => [line.threadId, line.running, line.needsYou?.reason ?? null, line.selected])).toEqual([
    ["main", true, null, false], ["fork", false, "Pick a date", true], ["asks", false, "Asked you a question", false],
  ]);
  expect(secondLine(lines[0]!)).toEqual({ tone: "running", text: "Morning brief is out" });
  expect(secondLine(lines[1]!)).toEqual({ tone: "needs-you", text: "Needs you: Pick a date" });
  expect(secondLine({ needsYou: null, latest: null, running: true })).toEqual({ tone: "running", text: "Working…" });
  expect(secondLine({ needsYou: null, latest: null, running: false })).toEqual({ tone: "quiet", text: "" });
  expect(secondLine({ needsYou: null, latest: null, running: false })).toEqual({ tone: "quiet", text: "" });
  expect(secondLine({ needsYou: null, latest: "Morning brief is out", running: false })).toEqual({ tone: "quiet", text: "Morning brief is out" });
});

const worker = (over: Partial<WorkerRow> & { threadId: string }): WorkerRow => ({ title: over.threadId, status: "done", ownerConversationId: null, ownerTitle: null, projectId: null, updatedAt: 0, tag: null, branch: null, mirrored: false, sameTitle: 1, ...over });

it("updates a worker's glyph from BB's live state, and keeps the server's for a hidden worker BB doesn't list", () => {
  const rows = [worker({ threadId: "w1", status: "running" }), worker({ threadId: "w2" }), worker({ threadId: "w3", status: "failed" }), worker({ threadId: "w4", status: "running" })];
  const live = new Map([["w1", { id: "w1", status: "idle" }], ["w2", { id: "w2", status: "active" }], ["w3", { id: "w3", status: "error" }]]);
  expect(workerLines(rows, live, "w2").map((line) => [line.threadId, line.status, line.selected])).toEqual([["w1", "done", false], ["w2", "running", true], ["w3", "failed", false], ["w4", "running", false]]);
});

it("keeps the server's state for a thread mirrored from bb: the live view only knows the idle copy here", () => {
  const live = new Map([["w", { id: "w", status: "idle" }], ["main", { id: "main", status: "idle" }]]);
  expect(workerLines([worker({ threadId: "w", status: "running", mirrored: true })], live, null)[0]!.status).toBe("running");
  expect(conversationLines([conversation({ threadId: "main", isMain: true, running: true, mirrored: true })], live, null)[0]!.running).toBe(true);
});

it("splits workers into the active ones, needing Patrick first, and the done ones; and says how old a row is", () => {
  const workers = [{ id: "a", status: "done" }, { id: "b", status: "running" }, { id: "c", status: "failed" }, { id: "d", status: "needs-you" }] as const;
  const split = splitWorkers(workers);
  expect(split.active.map((worker) => worker.id)).toEqual(["d", "b"]);
  expect(split.done.map((worker) => worker.id)).toEqual(["a", "c"]);
  expect(doneLabel(12)).toBe("12 done");
  const now = 10 * 24 * 60 * 60_000;
  expect([now - 10_000, now - 4 * 60_000, now - 2 * 60 * 60_000, now - 3 * 24 * 60 * 60_000, now - 9 * 24 * 60 * 60_000].map((at) => shortAge(at, now))).toEqual(["now", "4m", "2h", "3d", "1w"]);
});

it("splits a finished conversation's summary into its sections for the card", () => {
  expect(summarySections("**Decisions**\n- One mock a day\n- `Outline` at **15** minutes\n\n## Left open\n1. Paid mock?\n\nMade: the [outline](/x).\n\n**Last replies** (Studio saved these)\n\n> First line\n> second\n>\n")).toEqual([
    { heading: "Decisions", items: ["One mock a day", "Outline at 15 minutes"], list: true },
    { heading: "Left open", items: ["Paid mock?", "Made: the outline."], list: true },
    { heading: "Last replies", items: ["First line", "second"], list: false },
  ]);
  expect(summarySections("Just one line.")).toEqual([{ heading: "", items: ["Just one line."], list: false }]);
  expect(olderLabel(0, "worker")).toBeNull();
  expect(olderLabel(1, "conversation")).toBe("1 older conversation");
  expect(olderLabel(12, "worker")).toBe("12 older workers");
  const DAY = 24 * 60 * 60_000;
  expect(staleFailure({ status: "failed", updatedAt: 0 }, 70 * DAY)).toBe(true);
  expect(staleFailure({ status: "failed", updatedAt: 69 * DAY }, 70 * DAY)).toBe(false);
  expect(staleFailure({ status: "done", updatedAt: 0 }, 70 * DAY)).toBe(false);
  expect(olderPath("cos")).toBe("conversations/cos");
  expect(olderBotFromPath("conversations/c%20os")).toBe("c os");
  expect(olderBotFromPath("conversations")).toBeNull();
});

it("a thread bb's list hides still gets a menu target, unless its project is unknown", () => {
  expect(hiddenThreadTarget({ threadId: "t1", projectId: "p1" }, "running")).toMatchObject({ id: "t1", projectId: "p1", status: "active", archivedAt: null, parentThreadId: null });
  expect(hiddenThreadTarget({ threadId: "t1", projectId: "p1" }, "failed")?.status).toBe("error");
  expect(hiddenThreadTarget({ threadId: "t1", projectId: null }, "idle")).toBeNull();
});
