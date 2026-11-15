import { expect, it } from "vitest";
import type { Task } from "../contract";
import { ALL, everMine, ownerShort, filterChoices, handOffTargets, historyLines, inFlightDetail, matches, ownerLabel, rowNumber, sectionTasks, taskKind, taskSection, taskStatus } from "./model";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const t = (patch: Partial<Task> = {}): Task => ({
  id: "task_1", title: "A task", why: "", owner: "patrick", state: "todo", kind: "do", options: [], needs: null, priority: "normal", conversation: null, project: null, area: null,
  timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: "queued", push: false }, progress: { step: null, line: null }, workers: [], outputs: [],
  source: null, parentId: null, schedule: null, card: null, automation: null, stale: false, origin: "task", createdAt: NOW, updatedAt: NOW, closedAt: null, closedBy: null, ...patch,
});
const names = { bot: "Chief of Staff", leads: new Map([["thr_lead", "Larkspur lead"]]), threads: [{ owner: "thread:thr_w", name: "Fix the flaky test", threadId: "thr_w" }] };

it("says each state the way the card and rows do", () => {
  expect(taskStatus(t()).label).toBe("To do");
  expect(taskStatus(t({ state: "waiting" })).id).toBe("needs-you");
  expect(taskStatus(t({ state: "waiting", kind: "waiting-outside" })).label).toBe("Waiting on others");
  expect(taskStatus(t({ timing: { due: null, trigger: { type: "time", at: NOW + 1 }, snoozed: true } })).label).toBe("Snoozed");
  expect(taskStatus(t({ owner: "cos", state: "in_progress" })).label).toBe("Running");
  expect(taskStatus(t({ owner: "cos", state: "waiting" })).label).toBe("Waiting");
  expect(taskStatus(t({ owner: "cos", state: "todo" })).label).toBe("Scheduled");
  expect(taskStatus(t({ state: "done" })).label).toBe("Done");
  expect(taskStatus(t({ state: "dropped" })).label).toBe("Dismissed");
  expect(taskStatus(t({ state: "failed" })).label).toBe("Failed");
  expect(taskStatus(t({ state: "done", stale: true })).label).toBe("Ended");
});

it("files tasks in the page's sections", () => {
  expect(taskSection(t({ attention: { queue: "surfaced", push: false } }), NOW, "UTC")).toBe("today");
  expect(taskSection(t({ timing: { due: NOW + 3_600_000, trigger: { type: "none" }, snoozed: false } }), NOW, "UTC")).toBe("today");
  expect(taskSection(t({ timing: { due: NOW + 3 * 86_400_000, trigger: { type: "none" }, snoozed: false } }), NOW, "UTC")).toBe("later");
  expect(taskSection(t({ state: "waiting" }), NOW, "UTC")).toBe("today");
  expect(taskSection(t({ owner: "thread:thr_w", state: "in_progress" }), NOW, "UTC")).toBe("agents");
  expect(taskSection(t({ owner: "cos", state: "todo", timing: { due: null, trigger: { type: "time", at: NOW + 1 }, snoozed: false } }), NOW, "UTC")).toBe("scheduled");
  expect(taskSection(t({ schedule: { text: "Daily 9:00", cron: null, timeZone: null, automationId: null, paused: false } }), NOW, "UTC")).toBe("scheduled");
  expect(taskSection(t({ kind: "waiting-outside", state: "waiting" }), NOW, "UTC")).toBe("waiting");
  expect(taskSection(t({ state: "done" }), NOW, "UTC")).toBe("done");
  const s = sectionTasks([t({ id: "a", attention: { queue: "surfaced", push: false } }), t({ id: "b", state: "waiting" })], { area: ALL, project: ALL, owner: ALL, query: "" }, NOW, "UTC");
  expect(s.today.map((x) => x.id)).toEqual(["b", "a"]);
});

it("filters by area, project, owner group or thread, and words", () => {
  const f = { area: ALL, project: ALL, owner: ALL, query: "" };
  expect(matches(t({ area: "Home" }), { ...f, area: "Home" })).toBe(true);
  expect(matches(t({ area: "Job" }), { ...f, area: "Home" })).toBe(false);
  expect(matches(t({ project: "proj_k" }), { ...f, project: "proj_k" })).toBe(true);
  expect(matches(t({ owner: "thread:thr_w" }), { ...f, owner: "agents" })).toBe(true);
  expect(matches(t({ owner: "thread:thr_w" }), { ...f, owner: "thread:thr_w" })).toBe(true);
  expect(matches(t({ owner: "cos" }), { ...f, owner: "agents" })).toBe(false);
  expect(matches(t({ title: "Renew the passport" }), { ...f, query: "passport renew" })).toBe(true);
  expect(filterChoices([t({ area: "Job" }), t({ area: "Home" }), t({ area: "Home" })], (x) => x.area).map((c) => c.label)).toEqual(["All", "Home", "Job"]);
});

it("names owners and lists hand-off targets without the current owner", () => {
  expect(ownerLabel("patrick", names)).toBe("You");
  expect(ownerLabel("cos", names)).toBe("Chief of Staff");
  expect(ownerLabel("thread:thr_lead", names)).toBe("Larkspur lead");
  expect(ownerLabel("thread:thr_w", names)).toBe("Fix the flaky test");
  const base = [{ owner: "cos", name: "Chief of Staff" }, { owner: "thread:thr_lead", name: "Larkspur lead" }];
  expect(handOffTargets(t({ owner: "cos", workers: ["thr_w"] }), base, names.threads, "thr_bot")).toEqual([{ owner: "thread:thr_lead", name: "Larkspur lead" }, { owner: "thread:thr_w", name: "Fix the flaky test" }]);
});

it("reads the history as lines, newest first", () => {
  const lines = historyLines([
    { type: "added_by_you", at: 1, data: "{}" },
    { type: "handed_off", at: 2, data: JSON.stringify({ owner: "cos", from: "patrick", by: "patrick" }) },
    { type: "handed_off", at: 3, data: JSON.stringify({ owner: "patrick", from: "cos", by: "cos", needs: "Pick one" }) },
    { type: "acted", at: 4, data: JSON.stringify({ action: "choose", option: "B" }) },
    { type: "closed", at: 4, data: JSON.stringify({ action: "choose", option: "B" }) },
    { type: "notified", at: 5, data: "{}" },
  ], names);
  expect(lines.map((l) => l.text)).toEqual(["You chose B", "Chief of Staff handed it to you: Pick one", "You handed it to Chief of Staff", "You added it"]);
});

it("reads row=\"N\" for every positive N", () => {
  expect([undefined, "1", "2", "3", "12", "true", "0", "-1", "x", "2x"].map(rowNumber)).toEqual([null, 1, 2, 3, 12, 1, null, null, null, null]);
});

it("an In flight row says what is needed, else the step and line", () => {
  expect(inFlightDetail(t({ state: "waiting", needs: "Approve" }))).toBe("Approve");
  expect(inFlightDetail(t({ owner: "cos", state: "in_progress", progress: { step: "2/5", line: "Tests" } }))).toBe("2/5 · Tests");
  expect(inFlightDetail(t({ state: "done", progress: { step: "5/5", line: "Shipped" } }))).toBe("Shipped");
});

it("says who took a task back and names the Bot's chat as the Bot", () => {
  const withBot = { ...names, botThreadId: "thr_bot" };
  const lines = historyLines([
    { type: "handed_off", at: 1, data: JSON.stringify({ owner: "patrick", from: "thread:thr_bot", by: "thread:thr_bot" }) },
    { type: "handed_off", at: 2, data: JSON.stringify({ owner: "thread:thr_w", from: "patrick", by: "patrick" }) },
    { type: "handed_off", at: 3, data: JSON.stringify({ owner: "patrick", from: "thread:thr_w", by: "patrick" }) },
    { type: "closed", at: 4, data: JSON.stringify({ action: "done", by: "thread:thr_w" }) },
  ], withBot);
  expect(lines.map((l) => l.text)).toEqual(["Done by Fix the flaky test", "You took it back from Fix the flaky test", "You handed it to Fix the flaky test", "Chief of Staff handed it to you"]);
});

it("knows whether a task was ever the user's", () => {
  expect(everMine([{ type: "created", at: 1, data: JSON.stringify({ by: "thread:thr_w", owner: "thread:thr_w" }) }])).toBe(false);
  expect(everMine([{ type: "added_by_you", at: 1, data: "{}" }])).toBe(true);
  expect(everMine([{ type: "handed_off", at: 1, data: JSON.stringify({ owner: "cos", from: "patrick" }) }])).toBe(true);
});

it("files the Bot's chat under the Bot in the owner filter", () => {
  const f = { area: ALL, project: ALL, owner: "cos", query: "", botThreadId: "thr_bot" };
  expect(matches(t({ owner: "thread:thr_bot" }), f)).toBe(true);
  expect(matches(t({ owner: "cos" }), f)).toBe(true);
  expect(matches(t({ owner: "thread:thr_bot" }), { ...f, owner: "agents" })).toBe(false);
});

it("doesn't repeat the title as the owner's name", () => {
  const n = { ...names, threads: [{ owner: "thread:thr_w", name: "Worker: draft release notes", threadId: "thr_w" }] };
  expect(ownerShort(t({ owner: "thread:thr_w", title: "Worker: draft release notes", card: { kind: "worker", messageId: null, messageSeq: null, dismissedAt: null } }), n)).toBe("Its worker");
  expect(ownerShort(t({ owner: "thread:thr_w", title: "Ship it" }), n)).toBe("Worker: draft release notes");
  expect(ownerShort(t({ owner: "cos", title: "Chief of Staff" }), n)).toBe("Chief of Staff");
});

it("writes one history line per choice, and marks updates that came after the task was closed", () => {
  const lines = historyLines([
    { type: "handed_off", at: 10, data: JSON.stringify({ owner: "thread:thr_w", from: "patrick", by: "patrick" }) },
    { type: "progress", at: 10, data: JSON.stringify({ step: null, line: "Chose: Short" }) },
    { type: "acted", at: 10, data: JSON.stringify({ action: "choose", option: "Short" }) },
    { type: "closed", at: 20, data: JSON.stringify({ action: "choose", option: "Taco Lab" }) },
    { type: "acted", at: 20, data: JSON.stringify({ action: "choose", option: "Taco Lab" }) },
    { type: "progress", at: 30, data: JSON.stringify({ step: "5/5", line: "Back on it", kept: true }) },
  ], names);
  expect(lines.map((l) => l.text)).toEqual(["5/5 · Back on it (after it was closed)", "You chose Taco Lab", "You chose Short", "You handed it to Fix the flaky test"]);
});

it("names a watcher's repeats and clearing in history, and a recurring task's kind", () => {
  const lines = historyLines([
    { type: "found_again", at: NOW, data: JSON.stringify({ count: 2, line: "Spend $5.61 today" }) },
    { type: "cleared", at: NOW, data: "{}" },
  ], names);
  expect(lines.map((l) => l.text)).toEqual(["Cleared: the watcher stopped finding it", "Found again (2 times in all): Spend $5.61 today"]);
  const link = { id: "run_1", kind: "runner" as const, role: "schedule" as const, thread: null, keys: [], count: 0, lastAt: null, mode: null, clearedAt: null, posted: true, sentAt: null, nudgedAt: null, nudged: null, severity: null, pushedAt: null };
  expect(taskKind(t({ automation: link }))).toEqual({ label: "Runner", icon: "Repeat" });
  expect(taskKind(t({ automation: { ...link, role: "run" } }))).toEqual({ label: "Run", icon: "Repeat" });
  expect(taskStatus(t({ owner: "cos", state: "waiting", automation: link, schedule: { text: "Daily", cron: null, timeZone: null, automationId: "run_1", paused: true } })).label).toBe("Paused");
});
