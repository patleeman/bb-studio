import { expect, it } from "vitest";
import type { Task } from "../contract";
import { ALL, filterChoices, handOffTargets, historyLines, inFlightDetail, matches, ownerLabel, rowNumber, sectionTasks, taskSection, taskStatus } from "./model";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const t = (patch: Partial<Task> = {}): Task => ({
  id: "task_1", title: "A task", why: "", owner: "patrick", state: "todo", kind: "do", options: [], needs: null, priority: "normal", conversation: null, project: null, area: null,
  timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: "queued", push: false }, progress: { step: null, line: null }, workers: [], outputs: [],
  source: null, parentId: null, schedule: null, card: null, stale: false, origin: "task", createdAt: NOW, updatedAt: NOW, closedAt: null, closedBy: null, ...patch,
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
