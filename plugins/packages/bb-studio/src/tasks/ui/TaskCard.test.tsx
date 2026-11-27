// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Task } from "../contract";
import type { TaskView } from "../rpc-contract";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const base: Task = {
  id: "task_1", title: "Pick a backup provider", why: "The old plan ends Friday.", owner: "patrick", state: "todo", kind: "do", options: [], needs: null, priority: "normal",
  conversation: "thr_main", project: null, area: "Home", timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: "surfaced", push: false },
  progress: { step: null, line: null }, workers: [], outputs: [], source: null, parentId: null, schedule: null, card: null, automation: null, waitingOn: null, stale: false, origin: "task",
  createdAt: NOW - 3_600_000, updatedAt: NOW - 60_000, closedAt: null, closedBy: null,
};
const state = vi.hoisted(() => ({
  views: {} as Record<string, TaskView | null>,
  errors: {} as Record<string, string | null>,
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ task: {}, note: null })),
  toThread: vi.fn(),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: state.toThread }), useSdk: () => ({ projects: { list: async () => [] } }) }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: {}, timeZone: "UTC" }) }));
vi.mock("../../ui/live", () => ({
  useCall: () => state.call,
  useLive: (method: string, input: { id?: string }) => {
    const data = method === "tasks.get" ? state.views[input.id ?? ""] ?? null
      : method === "bot_get" ? { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot", avatar: "🤖", shape: "blob", color: "#5b8def" } }
        : method === "project_leads" ? { leads: [{ projectId: "proj_k", leadThreadId: "thr_lead" }] }
          : null;
    return { data, loading: false, error: method === "tasks.get" ? state.errors[input.id ?? ""] ?? null : null, refresh: () => {} };
  },
}));
vi.mock("./task-views", () => ({
  useNearScreen: () => [() => {}, true],
  useTaskView: (id: string) => {
    const error = state.errors[id] ?? null;
    const missing = !!error && /not found/i.test(error);
    return { data: missing ? null : state.views[id] ?? null, missing, error: missing ? null : error, loading: false, refresh: () => {} };
  },
}));
vi.mock("../../kit/ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);
vi.mock("../../kit/app/index", async () => ({ ...(await import("../../loops/ui/test-kit")).kitUi, remember: (_key: string, value: unknown) => value, openAppPath: vi.fn() }));
vi.mock("../../kit/app/directive-card", () => ({ remember: (_key: string, value: unknown) => value }));

const { TaskDirective } = await import("./TaskCard");
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.views = {}; state.errors = {};
  state.call.mockClear(); state.toThread.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const message = { id: "m1", threadId: "thr_main", turnId: null, projectId: null };
const put = (patch: Partial<Task> = {}, extra: Partial<TaskView> = {}) => {
  const task = { ...base, ...patch };
  state.views[task.id] = { task, history: [], todo: task.origin !== "work", threads: [{ owner: "thread:thr_w", name: "Fix the flaky test", threadId: "thr_w" }], ...extra };
  return task;
};
const render = async (_directive: "loop" | "work", attributes: Record<string, string>) => {
  await act(async () => root.render(<TaskDirective attributes={attributes} source="" message={message} openWorkspaceFile={null} />));
};
const card = () => container.querySelector<HTMLElement>('[data-testid="task-card"]')!;
const click = async (text: string) => {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`No button ${text}: ${[...container.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  await act(async () => found.click());
};

it("draws one card for ::loop and ::work alike, for loop_, task_ and wc_ ids", async () => {
  for (const id of ["loop_1", "loop_reminder_aut_1", "task_1", "wc_1"]) {
    put({ id, title: `Card ${id}`, origin: id.startsWith("wc_") ? "work" : "loop" });
    await render(id.startsWith("wc_") ? "work" : "loop", { id });
    expect(card().dataset.taskId).toBe(id);
    expect(card().textContent).toContain(`Card ${id}`);
  }
  await render("loop", { id: "nope" });
  expect(container.innerHTML).toBe("");
});

it("needs you: the warning state and what is needed", async () => {
  put({ state: "waiting", needs: "Touch the YubiKey to sign", card: { kind: "release", messageId: "m1", messageSeq: 3, dismissedAt: null }, origin: "work", progress: { step: "4/5 Sign", line: "Waiting on the key" } });
  await render("work", { id: "task_1" });
  expect(card().dataset.state).toBe("needs-you");
  expect(card().querySelector('[data-testid="task-needs"]')!.textContent).toBe("Touch the YubiKey to sign");
  expect(card().querySelector('[data-testid="task-step"]')!.textContent).toBe("4/5 Sign");
  expect(card().textContent).toContain("Release");
  expect(card().textContent).not.toContain("Snooze");
});

it("the Bot's task shows its face and name", async () => {
  put({ owner: "cos", state: "in_progress" });
  await render("loop", { id: "task_1" });
  expect(card().querySelector('[data-testid="task-owner"]')!.textContent).toContain("Chief of Staff");
  expect(card().querySelector<HTMLElement>('[data-testid="task-owner"]')!.dataset.owner).toBe("cos");
});

it("expands the history of hand-offs on the card", async () => {
  put({ owner: "patrick", state: "waiting", kind: "decide", options: ["A", "B"] }, {
    history: [
      { type: "created", at: NOW - 3_000_000, data: JSON.stringify({ by: "thread:thr_w", owner: "thread:thr_w" }) },
      { type: "progress", at: NOW - 2_000_000, data: JSON.stringify({ step: "1/2", line: "Compared prices" }) },
      { type: "handed_off", at: NOW - 1_000_000, data: JSON.stringify({ owner: "patrick", from: "thread:thr_w", by: "thread:thr_w", needs: "Pick one" }) },
    ],
  });
  await render("loop", { id: "task_1" });
  expect(container.querySelector('[data-testid="task-history"]')).toBeNull();
  await act(async () => container.querySelector<HTMLElement>('[data-testid="task-history-toggle"]')!.click());
  const lines = [...container.querySelectorAll('[data-testid="task-history"] li')].map((li) => li.textContent);
  expect(lines[0]).toContain("Fix the flaky test handed it to you: Pick one");
  expect(lines[1]).toContain("1/2 · Compared prices");
  expect(lines[2]).toContain("Fix the flaky test created it");
  expect(lines[2]).not.toContain(" for ");
});

it("draws every row=\"N\" as a compact row that opens the full card, not only row 1", async () => {
  put({ id: "task_1", title: "First" });
  put({ id: "task_2", title: "Second", state: "waiting", needs: "Approve" });
  put({ id: "task_3", title: "Third", kind: "decide", options: ["A", "B", "C"] });
  await act(async () => root.render(<>{["task_1", "task_2", "task_3"].map((id, i) => <TaskDirective key={id} attributes={{ id, row: String(i + 1) }} source="" message={message} openWorkspaceFile={null} />)}</>));
  const rows = [...container.querySelectorAll<HTMLElement>('[data-testid="task-row"]')];
  expect(rows.map((r) => r.dataset.taskId)).toEqual(["task_1", "task_2", "task_3"]);
  expect(container.querySelector('[data-testid="task-card"]')).toBeNull();
  expect(rows[1]!.textContent).toContain("Needs you");
  expect(rows[2]!.textContent).toContain("3 options");
  await act(async () => rows[2]!.querySelector("button")!.click());
  expect(container.querySelector('[data-testid="task-card"]')!.textContent).toContain("Third");
  await act(async () => root.render(<TaskDirective attributes={{ id: "task_1", row: "true" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.querySelector('[data-testid="task-row"]')).not.toBeNull();
  await act(async () => root.render(<TaskDirective attributes={{ id: "task_1", row: "0" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.querySelector('[data-testid="task-card"]')).not.toBeNull();
});

it("shows the error instead of a skeleton when tasks can't be loaded, and says when a task was removed", async () => {
  state.errors.task_1 = "Tasks could not be loaded. Nothing was lost. Restart BB Studio to try again.";
  await render("loop", { id: "task_1" });
  expect(container.querySelector('[role="alert"]')!.textContent).toBe("Tasks could not be loaded. Nothing was lost. Restart BB Studio to try again.");
  expect(container.querySelector(".animate-pulse")).toBeNull();
  await act(async () => root.render(<TaskDirective attributes={{ id: "task_1", row: "2" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  state.errors.task_1 = "Task task_1 not found";
  await render("loop", { id: "task_1" });
  expect(container.textContent).toBe("This task was removed.");
});

it("anchors a carded task to the message it is posted in, once", async () => {
  put({ card: { kind: "task", messageId: null, messageSeq: null, dismissedAt: null } });
  await render("work", { id: "task_1" });
  await render("work", { id: "task_1" });
  expect(state.call.mock.calls.filter(([method]) => method === "work.anchor")).toEqual([["work.anchor", { id: "task_1", threadId: "thr_main", messageId: "m1" }]]);
});

it("a recurring task shows its schedule, Active or Paused, its latest runs and findings, and no Done or Hand off", async () => {
  const link = (role: "schedule" | "run" | "finding", count = 1) => ({ id: "aut_silent", kind: "watcher" as const, role, thread: "thr_bot", keys: [], count, lastAt: NOW, mode: null, clearedAt: null, posted: true, sentAt: null, nudgedAt: null, nudged: null, severity: null, pushedAt: null });
  const run = { ...base, id: "task_run1", title: "Silent heartbeat · Nov 13, 2:00 PM", owner: "cos", state: "done" as const, origin: "task" as const, progress: { step: null, line: "Nothing new" }, automation: link("run"), parentId: "task_auto-aut-silent", createdAt: NOW - 3_600_000, closedAt: NOW - 3_500_000, closedBy: "cos" };
  const finding = { ...base, id: "task_find1", title: "Silent heartbeat: Kensico spend $5.80 today", owner: "cos", state: "in_progress" as const, origin: "task" as const, automation: link("finding", 3), parentId: "task_auto-aut-silent", createdAt: NOW - 7_200_000 };
  put({ id: "task_auto-aut-silent", title: "Silent heartbeat", owner: "cos", state: "in_progress", origin: "task", schedule: { text: "Every 2 hours", cron: null, timeZone: null, automationId: "aut_silent", paused: false }, automation: link("schedule"), progress: { step: null, line: "Found: Kensico spend $5.80 today" } }, { runs: [run, finding] });
  await render("loop", { id: "task_auto-aut-silent" });
  expect(card().dataset.state).toBe("active");
  expect(card().textContent).toContain("Watcher · Every 2 hours");
  expect([...card().querySelectorAll('[data-testid="task-run"]')].map((each) => each.textContent)).toEqual([expect.stringContaining("DoneNothing new"), expect.stringContaining("Finding · RunningSilent heartbeat: Kensico spend $5.80 today")]);
  const actions = card().querySelector('[data-testid="task-actions"]')!.textContent!;
  for (const label of ["Done", "Hand off", "Take over"]) expect(actions).not.toContain(label);
  put({ id: "task_auto-aut-silent", title: "Silent heartbeat", owner: "cos", state: "waiting", origin: "task", schedule: { text: "Every 2 hours", cron: null, timeZone: null, automationId: "aut_silent", paused: true }, automation: link("schedule") });
  await render("loop", { id: "task_auto-aut-silent" });
  expect(card().dataset.state).toBe("paused");
  put(finding);
  await render("loop", { id: "task_find1" });
  expect(card().querySelector('[data-testid="task-found"]')!.textContent).toBe("· Found 3 times");
  expect(card().querySelector('[data-testid="task-severity"]')).toBeNull();
  put({ ...finding, automation: { ...link("finding", 3), severity: "critical" } });
  await render("loop", { id: "task_find1" });
  expect(card().querySelector('[data-testid="task-severity"]')!.textContent).toBe("· Critical");
  expect(card().querySelector('[data-testid="task-severity"]')!.className).toContain("text-destructive");
  expect(card().textContent).toContain("Finding");
});

it("shows the task's outputs on the card: a PR, a page and a build, each opening where it lives", async () => {
  const opened = vi.fn(async () => ({ via: "workbench" }));
  const links = await import("../../links/open");
  vi.spyOn(links, "openLinkFromAnywhere").mockImplementation(opened as never);
  put({ owner: "thread:thr_w", state: "done", closedAt: NOW, outputs: [{ kind: "pr", ref: "https://github.com/example/app/pull/14" }, { kind: "page", ref: "pg_notes", title: "Release notes" }, { kind: "build", ref: "0115" }] });
  await render("work", { id: "task_1" });
  const chips = [...card().querySelectorAll<HTMLElement>('[data-testid="task-output"]')];
  expect(chips.map((each) => [each.dataset.kind, each.textContent, each.tagName])).toEqual([["pr", "PR #14", "BUTTON"], ["page", "Release notes", "BUTTON"], ["build", "0115", "SPAN"]]);
  expect(chips[0]!.getAttribute("aria-label")).toBe("Open pr PR #14");
  await act(async () => chips[1]!.click());
  expect(opened).toHaveBeenCalledWith("bb://page/pg_notes", expect.objectContaining({ source: "card", title: "Release notes" }));
  put({ outputs: [] });
  await render("work", { id: "task_1" });
  expect(card().querySelector('[data-testid="task-outputs"]')).toBeNull();
});

it("is read-only: an old card shows where it stands, with no Done, Snooze, Hand off, Undo, Reopen, Keep or Take over", async () => {
  const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean);
  put({ id: "task_mine", title: "Pick a backup provider" });
  await render("loop", { id: "task_mine" });
  expect(card().textContent).toContain("Pick a backup provider");
  expect(card().textContent).toContain("The old plan ends Friday.");
  for (const label of ["Done", "Snooze", "Hand off", "Got it", "Dismiss", "Drop"]) expect(buttons()).not.toContain(label);
  put({ id: "task_decide", kind: "decide", options: ["Backblaze", "Wasabi"], state: "waiting", needs: "Pick one" });
  await render("loop", { id: "task_decide" });
  expect(buttons()).not.toContain("Backblaze");
  expect(card().textContent).toContain("Pick one");
  put({ id: "task_agent", owner: "thread:thr_w", state: "in_progress", workers: ["thr_w"], progress: { step: "2/5 Tests", line: "Fixing the flaky one" } });
  await render("work", { id: "task_agent" });
  expect(card().textContent).toContain("Fixing the flaky one");
  expect(buttons()).not.toContain("Take over");
  await click("Open thread");
  expect(state.toThread).toHaveBeenCalledWith("thr_w");
  put({ id: "task_done", state: "done", closedAt: NOW - 60_000, closedBy: "patrick" });
  await render("loop", { id: "task_done" });
  expect(buttons()).not.toContain("Undo");
  put({ id: "task_stale", owner: "thread:thr_w", state: "in_progress", stale: true });
  await render("work", { id: "task_stale" });
  expect(card().textContent).toContain("Ended without a final update");
  expect(buttons()).not.toContain("Reopen");
  expect(state.call).not.toHaveBeenCalled();
});
