// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Task } from "../contract";
import type { TaskView } from "../rpc-contract";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const base: Task = {
  id: "task_1", title: "Pick a backup provider", why: "The old plan ends Friday.", owner: "patrick", state: "todo", kind: "do", options: [], needs: null, priority: "normal",
  conversation: "thr_main", project: null, area: "Home", timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: "surfaced", push: false },
  progress: { step: null, line: null }, workers: [], outputs: [], source: null, parentId: null, schedule: null, card: null, stale: false, origin: "task",
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

it("a do task of the user's: title, why, owner You, To do, and Done, Snooze, Hand off", async () => {
  put();
  await render("loop", { id: "task_1" });
  expect(card().dataset.state).toBe("todo");
  expect(card().querySelector('[data-testid="task-why"]')!.textContent).toBe("The old plan ends Friday.");
  expect(card().querySelector('[data-testid="task-owner"]')!.textContent).toBe("You");
  expect(card().querySelector('[data-testid="task-state"]')!.textContent).toBe("To do");
  const text = card().querySelector('[data-testid="task-actions"]')!.textContent!;
  for (const label of ["Done", "Snooze", "Hand off"]) expect(text).toContain(label);
  await click("Done");
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_1", action: "done" });
});

it("a decision shows its options as buttons and chooses one; choosing is the Done, so there is no Done button", async () => {
  put({ kind: "decide", options: ["Backblaze", "Wasabi"] });
  await render("loop", { id: "task_1" });
  expect(card().querySelector('[data-testid="task-done"]')).toBeNull();
  const text = card().querySelector('[data-testid="task-actions"]')!.textContent!;
  for (const label of ["Snooze", "Hand off"]) expect(text).toContain(label);
  await click("Wasabi");
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_1", action: "choose", option: "Wasabi" });
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

it("running with an agent: its name, the line, Open thread, Take over (never the user's) and Hand off", async () => {
  put({ owner: "thread:thr_w", state: "in_progress", workers: ["thr_w"], progress: { step: "2/5 Tests", line: "Running the suite" } });
  await render("work", { id: "task_1" });
  expect(card().dataset.state).toBe("running");
  expect(card().querySelector('[data-testid="task-owner"]')!.textContent).toBe("Fix the flaky test");
  expect(card().querySelector('[data-testid="task-line"]')!.textContent).toBe("Running the suite");
  await click("Take over");
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_1", action: "take_back" });
  put({ owner: "cos", state: "in_progress" }, { history: [{ type: "handed_off", at: NOW, data: JSON.stringify({ owner: "cos", from: "patrick", by: "patrick" }) }] });
  await render("work", { id: "task_1" });
  expect(container.textContent).toContain("Take back");
  put({ owner: "thread:thr_w", state: "in_progress", workers: ["thr_w"], progress: { step: "2/5 Tests", line: "Running the suite" } });
  await render("work", { id: "task_1" });
  await click("Open thread");
  expect(state.toThread).toHaveBeenCalledWith("thr_w");
});

it("hands off to the Bot, a project lead or the task's worker", async () => {
  put({ workers: ["thr_w"] });
  await render("loop", { id: "task_1" });
  const items = [...container.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
  expect(items).toEqual(expect.arrayContaining(["Chief of Staff", "Fix the flaky test"]));
  await act(async () => ([...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === "Fix the flaky test")!).click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_1", action: "hand_off", to: "thread:thr_w" });
});

it("the Bot's task shows its face and name", async () => {
  put({ owner: "cos", state: "in_progress" });
  await render("loop", { id: "task_1" });
  expect(card().querySelector('[data-testid="task-owner"]')!.textContent).toContain("Chief of Staff");
  expect(card().querySelector<HTMLElement>('[data-testid="task-owner"]')!.dataset.owner).toBe("cos");
});

it("done: the Done state and Undo; stale: Ended without a final update", async () => {
  put({ state: "done", closedAt: NOW - 1_000, closedBy: "patrick" });
  await render("loop", { id: "task_1" });
  expect(card().dataset.state).toBe("done");
  await click("Undo");
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_1", action: "reopen" });
  put({ id: "wc_2", state: "done", stale: true, closedAt: NOW - 1_000, owner: "thread:thr_w", origin: "work", card: { kind: "worker", messageId: null, messageSeq: null, dismissedAt: null } });
  await render("work", { id: "wc_2" });
  expect(card().dataset.state).toBe("ended");
  expect(card().querySelector('[data-testid="task-state"]')!.textContent).toBe("Ended without a final update");
  expect(card().textContent).not.toContain("Running");
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

it("offers Keep or Dismiss on one of the user's to-dos with no update in three days", async () => {
  put({ origin: "loop", updatedAt: NOW - 4 * 86_400_000 });
  await render("loop", { id: "task_1" });
  expect(container.querySelector('[data-testid="task-review"]')!.textContent).toContain("Still on it?");
  await click("Keep");
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_1", action: "keep" });
});

it("a card the agent closed offers Reopen for that agent, not Undo", async () => {
  put({ owner: "thread:thr_w", state: "failed", closedAt: NOW - 1_000, closedBy: "thread:thr_w", workers: ["thr_w"] });
  await render("work", { id: "task_1" });
  expect(container.querySelector('[data-testid="task-undo"]')).toBeNull();
  const reopen = container.querySelector<HTMLButtonElement>('[data-testid="task-reopen"]')!;
  expect(reopen.textContent).toBe("Reopen for Fix the flaky test");
  expect(reopen.title).toBe("Reopens it and asks Fix the flaky test to carry on");
  await act(async () => reopen.click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_1", action: "reopen" });
});
