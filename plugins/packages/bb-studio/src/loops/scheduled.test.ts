import { expect, it } from "vitest";
import type { BotAutomationView } from "../contract";
import type { Loop } from "./contract";
import { reminderLoopId, scheduledItems, type ScheduledBot } from "./scheduled";

const todo = (over: Partial<Loop>): Loop => ({
  id: "loop_1", title: "Pay the bill", why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "time", at: 5_000 },
  priority: "normal", push: false, status: "queued", due: null, area: null, createdAt: 1, updatedAt: 1, closedAt: null, closedBy: null, ...over,
});

const automation = (over: Partial<BotAutomationView>): BotAutomationView => ({
  id: "aut_1", kind: "checkin", name: "Morning brief", original: false, instruction: "Brief me", schedule: { type: "daily", time: "08:00" } as never,
  scheduleText: "Daily 8:00", state: "active", nextRunAt: 3_000, lastRunAt: null, lastOutcome: null, model: null, script: null,
  target: "main", targetName: "Dot", threadId: null, ...over,
});

const dot = (automations: BotAutomationView[]): ScheduledBot => ({ id: "bot_main", name: "Dot", threadId: "thr_main", primary: true, automations });

it("lists timed todos and every Bot automation with its next run, soonest first", () => {
  const items = scheduledItems({
    loops: [todo({}), todo({ id: "loop_2", trigger: { type: "none" } }), todo({ id: "loop_3", status: "done", closedAt: 2 }), todo({ id: "loop_4", owner: "cos", trigger: { type: "time", at: 1_000 } })],
    bots: [dot([automation({}), automation({ id: "aut_2", kind: "watcher", name: "Inbox", state: "paused", nextRunAt: 9 }), automation({ id: "aut_3", state: "done" })])],
  });
  expect(items.map((item) => [item.key, item.nextAt, item.threadId])).toEqual([
    ["todo:loop_4", 1_000, "thr_main"],
    ["automation:bot_main:aut_1", 3_000, "thr_main"],
    ["todo:loop_1", 5_000, null],
    ["automation:bot_main:aut_2", null, "thr_main"],
  ]);
  expect(items[1]).toMatchObject({ kind: "checkin", title: "Morning brief", scheduleText: "Daily 8:00", link: "bb://automation/bot_main%3Aaut_1" });
  expect(items[2]).toMatchObject({ kind: "todo", link: "bb://todo/loop_1" });
});

it("lists a reminder copied into the todos once, as its todo", () => {
  const items = scheduledItems({
    loops: [todo({ id: reminderLoopId("aut_r"), owner: "cos" })],
    bots: [dot([automation({ id: "aut_r", kind: "reminder", name: "Check the deploy" })])],
  });
  expect(items.map((item) => item.key)).toEqual([`todo:${reminderLoopId("aut_r")}`]);
});

it("filters to one thread: a thread's todos, and automations that wake it", () => {
  const items = scheduledItems({
    loops: [todo({ owner: "thread:thr_x" }), todo({ id: "loop_2", owner: "cos" })],
    bots: [dot([automation({ target: "own", threadId: "thr_x" }), automation({ id: "aut_2" })])],
    threadId: "thr_x",
  });
  expect(items.map((item) => item.key)).toEqual(["automation:bot_main:aut_1", "todo:loop_1"]);
});
