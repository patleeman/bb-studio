// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Loop } from "../contract";
import { taskFromLoop } from "../../tasks/views";
import { task as taskSchema, type Task } from "../../tasks/contract";
import { boardRows } from "../../tasks/rows";
import type { AreaView } from "../../areas/contract";

const NOW = new Date("2026-11-02T15:00:00").getTime();
const DAY = 86_400_000;
const loop = (id: string, title: string, extra: Partial<Loop> = {}): Loop => ({ id, title, why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "surfaced", due: null, area: null, createdAt: NOW - DAY, updatedAt: NOW - 600_000, closedAt: null, closedBy: null, ...extra });
const empty = { needsYouNow: [] as Loop[], comingUp: [] as Loop[], agentsOnIt: [] as Loop[], waitingOnOthers: [] as Loop[], done: [] as Loop[] };
const state = vi.hoisted(() => ({
  groups: null as unknown,
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  toThread: vi.fn(),
  getError: null as string | null,
  openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })),
  interactions: [] as unknown[],
  attention: null as unknown,
  chatOpen: false,
  composer: { insert: vi.fn(), focus: vi.fn() },
  scheduled: [] as unknown[],
  extraTasks: [] as unknown[],
  zone: null as string | null,
  listError: null as string | null,
  scheduledError: null as string | null,
  areas: [] as unknown[],
  boardLoading: false,
  areasError: null as string | null,
}));
vi.mock("../../kit/composer", () => ({ threadComposer: (threadId: string) => state.chatOpen && threadId === "thr_bot" ? state.composer : null }));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: state.toThread }), useSdk: () => sdk }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ changed: [], timeZone: state.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, isLoading: false, error: null, set: async () => {}, values: { loopsEnabled: true } }), readStudioSettingsNow: () => ({}) }));
const sdk = { projects: { list: async () => [{ id: "proj_k", name: "Larkspur" }] }, threads: { interactions: { list: async () => state.interactions } } };
vi.mock("../../ui/live", () => ({
  useCall: () => state.call,
  useLive: (method: string, input?: { id?: string }) => {
    const found = method === "loops.get" ? Object.values(state.groups as Record<string, Loop[]>).flat().find((each) => each.id === input?.id) : undefined;
    if (method === "loops.get" && state.getError) return { data: null, loading: false, error: state.getError, refresh: () => {} };
    if (method === "loops.get") return { data: found ? { loop: found, history: [] } : null, loading: false, error: found ? null : "Todo not found", refresh: () => {} };
    if (method === "tasks.get") return { data: null, loading: false, error: "Task not found", refresh: () => {} };
    const all = [...Object.values(state.groups as Record<string, Loop[]>).flat().map(taskFromLoop), ...state.extraTasks] as Task[];
    const threads = [{ owner: "thread:thr_lead", name: "Larkspur lead", threadId: "thr_lead" }];
    const board = () => ({ ...boardRows(all, { since: NOW - 15 * 3_600_000, dir: { isWorker: (id: string) => id.startsWith("thr_w"), conversationOf: (id: string) => id, main: () => "thr_bot" } as never }), threads, workers: [{ threadId: "thr_w1", name: "Screenshot worker", status: "active", archived: false }] });
    if (method === "areas.list") return state.areasError ? { data: null, loading: false, error: state.areasError, refresh: () => {} } : { data: { areas: state.areas }, loading: false, error: null, refresh: () => {} };
    if (method === "tasks.board" && state.boardLoading) return { data: null, loading: true, error: null, refresh: () => {} };
    if (method === "tasks.board" && state.listError) return { data: null, loading: false, error: state.listError, refresh: () => {} };
    const data = method === "tasks.list" ? { tasks: all, threads, held: [] }
      : method === "tasks.board" ? board()
      : method === "loops.scheduled" ? { items: state.scheduled }
      : method === "bot_get" ? { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot" } }
      : method === "bot_list" ? { bots: [{ id: "bot_1", name: "Chief of Staff", threadId: "thr_bot", primary: true, state: "active" }] }
        : method === "project_leads" ? { leads: [{ projectId: "proj_k", leadThreadId: "thr_lead", run: null }] }
          : method === "loops.places" ? { names: ["Home", "Office", "Mom’s"] }
            : method === "bot_attention" ? { attention: state.attention } : null;
    if (method === "tasks.list" && state.listError) return { data: null, loading: false, error: state.listError, refresh: () => {} };
    if (method === "loops.scheduled" && state.scheduledError) return { data: null, loading: false, error: state.scheduledError, refresh: () => {} };
    return { data, loading: false, error: null, refresh: () => {} };
  },
}));
vi.mock("../../kit/ui/index", async () => (await import("./test-kit")).kitUi);
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", async () => ({ ...(await import("./test-kit")).kitUi, GHOST_BUTTON: "", PRIMARY_BUTTON: "", DANGER_BUTTON: "", openAppPath: vi.fn(), StudioBar: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));

const { TodosPage } = await import("./TodosPage");
const { TodoTab } = await import("./TodoTab");
const view = { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot", primary: true } } as never;
let root: Root, container: HTMLDivElement, tabRoot: Root, tabHost: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.chatOpen = false; state.composer.insert.mockClear(); state.composer.focus.mockClear(); state.toThread.mockImplementation(() => { state.chatOpen = true; });
  state.call.mockClear(); state.toThread.mockClear(); state.openLink.mockClear(); state.interactions = []; state.attention = null; state.zone = null; state.extraTasks = []; state.areas = []; state.areasError = null; state.boardLoading = false;
  state.groups = {
    ...empty,
    needsYouNow: [
      loop("loop_n", "Reply to Sam about the Q3 planning doc", { why: "He asked for your input", area: "Job", due: NOW + 4 * DAY }),
      loop("loop_d", "Choose the deck contractor", { kind: "decide", options: ["Bayside", "Hudson"], area: "Home" }),
    ],
    comingUp: [
      loop("loop_c", "Call the plumber about the slow drain", { status: "queued", trigger: { type: "place", place: "home", direction: "arrive" }, area: "Home" }),
      loop("loop_t", "Send the October expense report", { status: "snoozed", trigger: { type: "time", at: NOW + 2 * DAY } }),
      loop("loop_o", "Pay the Con Edison bill", { status: "queued", due: NOW - 2 * DAY, area: "Home" }),
      loop("loop_p", "Review the onboarding flow", { status: "queued", why: "1–1.5 h. Walk through the new sign-up screens.", area: "Job", trigger: { type: "time", at: NOW + 9 * DAY }, due: NOW + 10 * DAY, source: { kind: "url", ref: "q3-planning-notes", url: "https://research.example.com/plan" } }),
    ],
    agentsOnIt: [loop("loop_a", "Draft the Larkspur Q4 lead summary", { owner: "thread:thr_lead", status: "in_progress", area: "Larkspur" })],
    waitingOnOthers: [loop("loop_w", "Signed lease addendum", { kind: "waiting", status: "queued" })],
    done: [1, 2].map((n) => loop(`loop_x${n}`, `Closed ${n}`, { status: "done", closedAt: NOW - n * 60_000, closedBy: "patrick" })),
  };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  tabHost = document.createElement("div"); document.body.append(tabHost); tabRoot = createRoot(tabHost);
});
afterEach(() => { act(() => { root.unmount(); tabRoot.unmount(); }); container.remove(); tabHost.remove(); vi.useRealTimers(); });

const render = async () => { await act(async () => root.render(<TodosPage view={view} />)); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const group = (name: string) => [...container.querySelectorAll<HTMLElement>("section")].find((each) => each.getAttribute("aria-label") === name) ?? null;
const titles = (scope: Element | null) => [...(scope?.querySelectorAll("[data-testid=bot-page-row-title]") ?? [])].map((each) => each.textContent);
const openTab = async (id: string) => { await act(async () => tabRoot.render(<TodoTab params={{ id }} />)); };
const idOf = (title: string) => [...Object.values(state.groups as Record<string, Loop[]>).flat(), ...(state.extraTasks as Task[])].find((each) => each.title === title)!.id;
const openRow = async (title: string) => openTab(idOf(title));
const showScheduled = async () => { await act(async () => container.querySelector<HTMLButtonElement>("[data-testid=bot-page-pill][data-value=scheduled]")!.click()); };
const box = (testId: string) => container.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const texts = (scope: Element | null, selector: string) => [...(scope?.querySelectorAll<HTMLElement>(selector) ?? [])].map((each) => each.textContent ?? "");
const H = 3_600_000;
const mk = (id: string, patch: Record<string, unknown>): Task => taskSchema.parse({ id, title: id, owner: "patrick", state: "todo", origin: "task", createdAt: NOW - 5 * H, updatedAt: NOW - H, ...patch });
const ASKS = () => [
  mk("task_ask", { title: "Home server backup is stuck", state: "waiting", kind: "decide", options: ["Leave out", "Bundle"], needs: "Leave raw transcripts out of the Dropbox copy?", area: "Systems", conversation: "thr_bot" }),
  mk("task_try", { title: "Try build 0115 on the Duo", state: "waiting", needs: "Unblocks the Duo checks", project: "BB Studio", createdAt: NOW - 4 * H }),
];
const FLIGHT = () => [
  mk("task_polish", { title: "Phone polish for the next build", owner: "thread:thr_lead", state: "in_progress", progress: { step: "3/5 Shots", line: "Taking screenshots of the fixes" }, conversation: "thr_lead", createdAt: NOW - 50 * 60_000 }),
  mk("task_shots", { title: "Screenshots in three themes", owner: "thread:thr_w1", state: "in_progress", parentId: "task_polish", workers: ["thr_w1"] }),
  mk("task_tf", { title: "Next TestFlight build", owner: "thread:thr_lead", state: "waiting", waitingOn: { kind: "task", ref: "task_polish", text: null }, progress: { step: null, line: "Waiting on phone polish, then your OK" }, conversation: "thr_lead" }),
  mk("task_duo", { title: "Duo checks on real hardware", owner: "thread:thr_lead", state: "waiting", waitingOn: { kind: "user", ref: null, text: null }, conversation: "thr_lead" }),
];
const area = (id: string, patch: Partial<AreaView>): AreaView => ({ id, name: id, covers: "", owner: { kind: "runner", runnerId: id, thread: null }, ownerName: `${id} runner`, cadence: "4× daily", status: "ok", reason: null, now: null, open: [], runs: [], lastRun: null, nextRun: null, nextLabel: null, paused: false, links: [], statusFile: null, fileError: null, updatedAt: NOW, ...patch });
const detail = () => tabHost.querySelector<HTMLElement>("[data-testid=todo-detail]");
const buttonIn = (scope: Element, text: string) => {
  const found = [...scope.querySelectorAll("button")].find((each) => each.textContent?.trim() === text);
  if (!found) throw new Error(`No "${text}" in: ${[...scope.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

it("the todo tab shows one Due row when the todo comes back at its due time", async () => {
  (state.groups as typeof empty).comingUp.push(loop("loop_m", "Call Millers Flour", { status: "queued", push: true, due: NOW + DAY - 6 * 3_600_000, trigger: { type: "time", at: NOW + DAY - 6 * 3_600_000 } }));
  await render();
  await openRow("Call Millers Flour");
  const facts = [...detail()!.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
  expect(facts).toEqual([["Due", "Tomorrow 9:00 AM"], ["Owner", "You"]]);
  expect(detail()!.querySelector("dd [data-icon=Smartphone]")).not.toBeNull();
});

it("a deleted todo's tab says Not found, with its link", async () => {
  await openTab("loop_gone");
  expect(detail()).toBeNull();
  expect(tabHost.querySelector("[data-testid=link-not-found]")?.textContent).toContain("bb://todo/loop_gone");
  expect(tabHost.querySelector("[data-testid=link-not-found]")?.textContent).toContain("Task");
  state.getError = "The server didn't answer";
  await openTab("loop_n");
  expect(tabHost.querySelector("[data-testid=link-not-found]")).toBeNull();
  expect(tabHost.querySelector("[data-testid=bot-item-error]")?.textContent).toBe("The server didn't answer");
  state.getError = null;
});

it("acts from the detail: Done, choose, Remind me now, Take back, Open thread, Nudge them and Undo", async () => {
  await render();
  await openRow("Reply to Sam about the Q3 planning doc");
  await act(async () => buttonIn(detail()!, "Done").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_n", action: "done" });
  await openRow("Choose the deck contractor");
  await act(async () => buttonIn(detail()!, "Hudson").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_d", action: "choose", option: "Hudson" });
  await openRow("Call the plumber about the slow drain");
  await act(async () => buttonIn(detail()!, "Remind me now").click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_c", surfaceNow: true });
  await openRow("Draft the Larkspur Q4 lead summary");
  await act(async () => buttonIn(detail()!, "Take back").click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "loop_a", action: "take_back" });
  await act(async () => buttonIn(detail()!, "Open thread").click());
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
  await openRow("Signed lease addendum");
  await act(async () => buttonIn(detail()!, "Nudge them").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_w", action: "nudge" });
  expect(detail()!.textContent).toContain("drafting a nudge in the chat");
  await openRow("Closed 1");
  await act(async () => detail()!.querySelector<HTMLButtonElement>("[aria-label='Undo: Closed 1']")!.click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_x1", changes: { status: "surfaced" } });
});

it("shows why Remind me now failed in the detail", async () => {
  state.call.mockImplementationOnce(async () => { throw new Error("An active Bot chat is required"); });
  await render();
  await openRow("Call the plumber about the slow drain");
  await act(async () => buttonIn(detail()!, "Remind me now").click());
  expect(detail()!.querySelector("[role='alert']")?.textContent).toBe("An active Bot chat is required");
});

it("names a task's actions in plain words: Remind me now, Hand off, Change when, Dismiss", async () => {
  await render();
  await openRow("Call the plumber about the slow drain");
  const labels = [...detail()!.querySelectorAll("button")].map((each) => each.textContent?.trim());
  expect(labels).toEqual(expect.arrayContaining(["Done", "Remind me now", "Snooze", "Hand off", "Discuss", "Change when", "Dismiss"]));
  for (const old of ["Surface now", "Give to", "Change trigger", "Drop"]) expect(labels).not.toContain(old);
  await act(async () => buttonIn(detail()!, "Dismiss").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_c", action: "drop" });
  await act(async () => buttonIn(detail()!, "Chief of Staff").click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "loop_c", action: "hand_off", to: "cos" });
});

it("changes a trigger from the detail to a phone place with Send to iPhone", async () => {
  await render();
  await openRow("Call the plumber about the slow drain");
  await act(async () => buttonIn(detail()!, "Change when").click());
  const form = tabHost.querySelector("form[aria-label='Change when']")!;
  expect([...form.querySelectorAll("[role=radiogroup][aria-label=Place] label")].map((each) => each.textContent)).toEqual(["Home", "Office", "Mom’s"]);
  await act(async () => ([...form.querySelectorAll("input[type=radio]")][1] as HTMLInputElement).click());
  await act(async () => buttonIn(form, "Leave").click());
  await act(async () => (form.querySelector("input[type=checkbox]") as HTMLInputElement).click());
  await act(async () => buttonIn(form, "Save").click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_c", changes: { trigger: { type: "place", place: "Office", direction: "leave" }, push: true } });
});

it("Discuss in the detail opens the Bot chat, then puts the todo in its draft", async () => {
  await render();
  await openRow("Call the plumber about the slow drain");
  await act(async () => detail()!.querySelector<HTMLButtonElement>("[aria-label='Discuss: Call the plumber about the slow drain']")!.click());
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
  await vi.waitFor(() => expect(state.composer.insert).toHaveBeenCalledWith([{ provider: "loop", id: "loop_c", label: "Call the plumber about the slow drain" }, " "], { at: "end" }));
});

it("New adds a typed line as the user's task", async () => {
  await render();
  await act(async () => buttonIn(container, "New task").click());
  const input = container.querySelector<HTMLInputElement>("input[aria-label='New task']")!;
  await type(input, "call the plumber when I'm home");
  await act(async () => buttonIn(container.querySelector("[data-testid=todo-add]")!, "Add").click());
  expect(state.call).toHaveBeenCalledWith("loops.add", { text: "call the plumber when I'm home" });
  expect(container.querySelector("[data-testid=todo-add]")).toBeNull();
});

it("files an agent's task that waits for its time on the Scheduled tab", async () => {
  (state.groups as Record<string, Loop[]>).agentsOnIt.push(loop("loop_s", "Check the deploy tonight", { owner: "cos", status: "queued", trigger: { type: "time", at: NOW + 3_600_000 } }));
  await render();
  await showScheduled();
  expect(titles(group("Scheduled"))).toContain("Check the deploy tonight");
});

it("lists the Bot's check-ins, reminders, watchers and runners on the Scheduled tab, each opening its automation", async () => {
  state.groups = { ...empty };
  const item = (key: string, over: Record<string, unknown>) => ({ key, source: "automation", id: key, botId: "bot_1", botName: "Chief of Staff", kind: "checkin", title: key, nextAt: null, state: "active", scheduleText: "Daily 8:00", threadId: "thr_bot", link: `bb://automation/bot_1%3A${key}`, ...over });
  state.scheduled = [
    item("Morning brief", { nextAt: NOW + 3_600_000 }),
    item("Inbox watch", { kind: "watcher", state: "paused" }),
    item("Other Bot's", { botId: "bot_2" }),
    item("A timed todo", { source: "todo", link: "bb://todo/loop_t" }),
  ];
  await render();
  await showScheduled();
  const rows = [...container.querySelectorAll("[data-testid=tasks-scheduled] [data-testid=scheduled-row]")];
  expect(rows.map((each) => each.textContent)).toEqual(["Morning brief4:00 PM", "Inbox watchPaused"]);
  expect(rows[0]!.getAttribute("data-row-link")).toBe("bb://automation/bot_1%3AMorning%20brief");
  state.scheduled = [];
});

it("shows each recurring task's last result beside its next run, once, and Runs opens its task", async () => {
  state.groups = { ...empty };
  const item = (key: string, over: Record<string, unknown>) => ({ key, source: "automation", id: key, botId: "bot_1", botName: "Chief of Staff", kind: "checkin", title: key, nextAt: null, state: "active", scheduleText: "Daily 8:00", threadId: "thr_bot", link: `bb://automation/bot_1%3A${key}`, ...over });
  const parent = (automationId: string, title: string, line: string | null, paused = false, severity: string | null = null) => ({
    ...taskFromLoop(loop(`task_auto-${automationId}`, title, { owner: "cos", status: "in_progress" })), origin: "task", state: paused ? "waiting" : "in_progress",
    schedule: { text: "Daily 1:00 PM", cron: null, timeZone: null, automationId, paused }, progress: { step: null, line },
    automation: { id: automationId === "heartbeat" ? "heartbeat:bot_1" : automationId, kind: "checkin", role: "schedule", thread: "thr_bot", keys: [], count: 3, lastAt: NOW, mode: null, clearedAt: null, posted: true, sentAt: null, nudgedAt: null, nudged: null, severity, pushedAt: null },
  });
  state.scheduled = [item("aut_daily", { title: "Daily check-in", nextAt: NOW + 3_600_000 }), item("aut_silent", { title: "Silent heartbeat", kind: "watcher" }), item("aut_new", { title: "New one" }), item("heartbeat", { title: "Check-in" })];
  state.extraTasks = [parent("aut_daily", "Daily check-in", "Nothing new"), parent("aut_silent", "Silent heartbeat", "Needs you: Approve the budget raise"), parent("aut_new", "New one", "Found: Disk 99% full", false, "critical"), parent("aut_orphan", "Not listed", "Ran"), parent("heartbeat", "Check-in", "Nothing new")];
  await render();
  await showScheduled();
  const rows = [...container.querySelectorAll<HTMLElement>("[data-testid=tasks-scheduled] [data-testid=scheduled-row]")];
  expect(rows.map((each) => each.textContent)).toEqual(["Daily check-inNothing new4:00 PMRuns", "Silent heartbeatNeeds you: Approve the budget raiseDaily 8:00Runs", "New oneCritical · Found: Disk 99% fullDaily 8:00Runs", "Check-inNothing newDaily 8:00Runs"]);
  expect(rows[2]!.querySelector("[data-testid=scheduled-last]")!.parentElement!.className).toContain("text-destructive");
  expect(rows[1]!.querySelector("[data-testid=scheduled-last]")!.parentElement!.className).toContain("text-warning");
  expect(titles(group("Scheduled"))).toEqual(["Not listed", "Daily check-in", "Silent heartbeat", "New one", "Check-in"]);
  await act(async () => rows[0]!.querySelector<HTMLButtonElement>("[data-testid=scheduled-runs]")!.click());
  expect(state.openLink).toHaveBeenCalledWith("bb://todo/task_auto-aut_daily", expect.objectContaining({ title: "Daily check-in" }));
  state.scheduled = [];
  state.extraTasks = [];
});

it("opens at the top, also as studio/automations: nothing scrolls the page to Scheduled", async () => {
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  state.scheduled = [{ key: "Morning brief", source: "automation", id: "Morning brief", botId: "bot_1", botName: "Chief of Staff", kind: "checkin", title: "Morning brief", nextAt: null, state: "active", scheduleText: "Daily 8:00", threadId: "thr_bot", link: "bb://automation/bot_1%3AMorning%20brief" }];
  const { AutomationsPanel } = await import("../../ui/automations/AutomationsPanel");
  await act(async () => root.render(<AutomationsPanel />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(container.querySelector("[data-testid=scheduled-row]")).not.toBeNull();
  expect(scrolled).not.toHaveBeenCalled();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  state.scheduled = [];
});

it("under a Bot that isn't the primary, is that Bot's Scheduled alone, titled Scheduled: the todos are the primary's", async () => {
  const item = (key: string, botId: string) => ({ key, source: "automation", id: key, botId, botName: botId, kind: "reminder", title: key, nextAt: null, state: "active", scheduleText: "Once", threadId: null, link: `bb://automation/${botId}%3A${encodeURIComponent(key)}` });
  state.scheduled = [item("Water the plants", "bot_1"), item("Ship notes", "bot_2")];
  await act(async () => root.render(<TodosPage view={{ bot: { id: "bot_2", name: "New bot", threadId: "thr_two", primary: false, state: "active" } } as never} />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toBe("Scheduled·New bot");
  expect([...container.querySelectorAll("section")].map((each) => each.getAttribute("aria-label"))).toEqual(["Scheduled"]);
  expect(titles(container)).toEqual(["Ship notes"]);
  expect(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")?.placeholder).toBe("Search scheduled");
  expect(container.querySelector("[data-testid=todos-empty]")).toBeNull();
  expect(container.textContent).not.toContain("Pay the Con Edison bill");
  state.scheduled = [];
});

it("names itself Tasks, with Now and Scheduled tabs; Now shows Your to-do and In flight on top, Areas, then the Done bar", async () => {
  state.extraTasks = [...ASKS(), ...FLIGHT()];
  await render();
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toBe("Tasks·Chief of Staff");
  expect(texts(container, "[data-testid=bot-page-pill]")).toEqual(["Now", "Scheduled0"]);
  expect(container.querySelector("[data-testid=bot-page-pill][data-value=now]")?.getAttribute("data-state")).toBe("on");
  expect(texts(container, "h2")).toEqual(["Your to-do", "In flight", "Areas"]);
  expect(container.querySelector("[data-testid=tasks-top]")?.className).toContain("@4xl/bot-page:grid-cols-[1fr_1.15fr]");
  expect(box("tasks-done")).not.toBeNull();
  expect(box("tasks-scheduled")).toBeNull();
  expect(container.textContent).not.toContain("Scheduled & recurring");
});

it("Your to-do: agents' asks first with their answers in the row, then today's own to-dos, then N more today · N later", async () => {
  state.extraTasks = [...ASKS(), ...FLIGHT()];
  await render();
  const todo = box("tasks-todo")!;
  expect(todo.querySelector("[data-testid=box-detail]")?.textContent).toBe("2 asks · 3 today");
  expect(texts(todo, "[data-testid=todo-ask] span.truncate.font-medium")).toEqual(["Home server backup is stuck", "Try build 0115 on the Duo"]);
  expect(texts(todo, "[data-testid=todo-ask] span.text-xs")).toEqual(["Systems · Leave raw transcripts out of the Dropbox copy?", "BB Studio · Unblocks the Duo checks"]);
  expect(texts(todo, "[data-testid=todo-own] span.text-sm")).toEqual(["Pay the Con Edison bill", "Reply to Sam about the Q3 planning doc", "Choose the deck contractor"]);
  expect(texts(todo, "[data-testid=todo-own] span.text-xs")).toEqual(["Home · Overdue", "Job · Due Fri, 3:00 PM", "Home"]);
  const ask = todo.querySelector<HTMLElement>("[data-task-id=task_ask]")!;
  expect(texts(ask, "[data-testid=ask-option]")).toEqual(["Leave out", "Bundle"]);
  expect(ask.querySelector("[data-testid=ask-option]")!.getAttribute("aria-label")).toBe("Leave out: Home server backup is stuck");
  await act(async () => ask.querySelector<HTMLButtonElement>("[data-testid=ask-option]")!.click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_ask", action: "choose", option: "Leave out" });
  const tryIt = todo.querySelector<HTMLElement>("[data-task-id=task_try]")!;
  await act(async () => tryIt.querySelector<HTMLButtonElement>("[data-testid=ask-done]")!.click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_try", action: "done" });
  await act(async () => buttonIn(tryIt, "Larkspur lead").click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "task_try", action: "hand_off", to: "thread:thr_lead" });
  await act(async () => todo.querySelector<HTMLButtonElement>("[data-task-id=loop_o] [data-testid=todo-check]")!.click());
  expect(state.call).toHaveBeenCalledWith("tasks.act", { id: "loop_o", action: "done" });
  expect(todo.querySelector("[data-task-id=loop_o] [data-testid=todo-check]")!.getAttribute("aria-label")).toBe("Mark Pay the Con Edison bill done");
  const more = todo.querySelector<HTMLButtonElement>("[data-testid=todo-more]")!;
  expect(more.textContent).toBe("3 later");
  await act(async () => more.click());
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(texts(todo.querySelector("[data-testid=todo-later]"), "[data-testid=todo-own] span.text-sm")).toEqual(["Send the October expense report", "Review the onboarding flow", "Call the plumber about the slow drain"]);
  await act(async () => todo.querySelector<HTMLButtonElement>("[data-task-id=task_ask] button")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://todo/task_ask", { source: "botPage", title: "Home server backup is stuck", modifiers: { meta: false, ctrl: false, shift: false } });
});

it("leads Your to-do with the Bot chat's pending questions, which open the chat", async () => {
  state.interactions = [{ id: "int_2", status: "pending", createdAt: NOW, payload: { kind: "user_question", questions: [{ question: "Which day works for the call?" }] } }];
  await render();
  await act(async () => { await Promise.resolve(); });
  const todo = box("tasks-todo")!;
  expect(todo.querySelector("li")?.getAttribute("data-testid")).toBe("todo-chat");
  expect(todo.querySelector("[data-testid=todo-chat]")?.textContent).toContain("Which day works for the call?");
  expect(todo.querySelector("[data-testid=box-detail]")?.textContent).toBe("1 ask · 3 today");
  await act(async () => todo.querySelector<HTMLButtonElement>("[data-testid=todo-chat] button")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_bot", expect.objectContaining({ title: "Chief of Staff" }));
});

it("In flight: running rows first with a ring, the step and the owner's time, waiting rows saying on what, workers folded under their task", async () => {
  state.extraTasks = [...ASKS(), ...FLIGHT()];
  await render();
  const flight = box("tasks-flight")!;
  expect(flight.querySelector("[data-testid=box-detail]")?.textContent).toBe("2 running · 3 waiting");
  const rows = [...flight.querySelectorAll<HTMLElement>("[data-testid=page-flight-row]")];
  expect(rows.map((each) => each.dataset.taskId)).toEqual(["loop_a", "task_polish", "loop_w", "task_duo", "task_tf"]);
  const polish = rows[1]!;
  expect(polish.dataset.look).toBe("running");
  expect(polish.querySelector("[data-testid=flight-ring]")?.getAttribute("data-progress")).toBe("3/5");
  expect(polish.querySelector("[data-testid=flight-right]")?.textContent).toBe("3 of 5");
  expect(polish.querySelector("[data-testid=flight-owner]")?.textContent).toBe("Larkspur lead · 50m");
  expect(polish.querySelector("[data-testid=flight-line]")?.textContent).toBe("Shots · Taking screenshots of the fixes");
  expect(texts(flight, "[data-look=waiting] [data-testid=flight-right]")).toEqual(["waiting on someone", "waiting on you", "waiting on a task"]);
  expect(rows[4]!.querySelector("[data-testid=flight-line]")?.textContent).toBe("Waiting on phone polish, then your OK");
  expect(rows[3]!.querySelector("[data-testid=flight-line]")?.textContent).toBe("Waiting on you");
  expect(rows[2]!.querySelector("[data-testid=flight-glyph]")?.getAttribute("data-look")).toBe("waiting");
  expect(flight.querySelectorAll("[data-testid=page-flight-row][data-task-id=task_shots]")).toHaveLength(0);
  const fold = polish.querySelector<HTMLButtonElement>("[data-testid=flight-fold]")!;
  expect(fold.dataset.count).toBe("1 subtask · 1 worker");
  expect(fold.textContent).toBe("1");
  expect(fold.getAttribute("aria-label")).toBe("Show 1 subtask · 1 worker under Phone polish for the next build");
  await act(async () => fold.click());
  expect(texts(polish, "[data-testid=flight-subtask]")[0]).toContain("Screenshots in three themes");
  await act(async () => polish.querySelector<HTMLButtonElement>("[data-testid=flight-worker]")!.click());
  expect(state.toThread).toHaveBeenCalledWith("thr_w1");
  const todoRows = box("tasks-todo")!.querySelectorAll("[data-testid=todo-ask], [data-testid=todo-own]").length + 3;
  expect(todoRows + rows.length).toBe(13);
});

it("Areas: one card each, problems first, with who, covers, where it stands, open items and their age, the last runs and last and next", async () => {
  const runs = (outcomes: string) => [...outcomes].map((c, i) => ({ at: NOW - i * 6 * H, outcome: (c === "x" ? "broken" : c === "w" ? "flagged" : "ok") as "ok", line: `run ${i}`, taskId: null }));
  state.areas = [
    area("Comms", { covers: "GitHub activity, the agent inbox", now: "Inbox is clear.", runs: runs("gggggggg") }),
    area("House", { status: "broken", covers: "Maintenance, providers, house reminders", now: "Can't read the house Reminders list.", reason: "Last run: RUNNER PROBLEM no access", cadence: "Every day 7:10 AM",
      open: [{ title: "Pest control visit due", since: "~Nov", sinceAt: null, needsUser: false, taskId: null }, { title: "Defrost the freezer", since: "2026-09-26", sinceAt: Date.UTC(2026, 8, 26), needsUser: true, taskId: "loop_o" }, { title: "Porch latch", since: null, sinceAt: null, needsUser: false, taskId: null }, { title: "Fourth", since: null, sinceAt: null, needsUser: false, taskId: null }],
      runs: runs("xxxgggg"), lastRun: NOW - H, nextRun: NOW + 16 * H }),
    area("BB Studio", { owner: { kind: "lead", thread: "thr_lead" }, ownerName: "BB Studio lead", cadence: "Every day 4:30 AM", now: "Shipped 0115.", nextLabel: "Fork sync", nextRun: NOW + 13 * H, lastRun: NOW - 2 * H, runs: runs("ggw") }),
    area("Systems", { status: "flagged", now: "Backups are falling behind.", runs: runs("gwg") }),
    area("Kensico", { status: "unknown", owner: { kind: "lead", thread: "thr_k" }, ownerName: "Kensico lead", cadence: null }),
  ];
  state.extraTasks = FLIGHT();
  await render();
  const cards = [...container.querySelectorAll<HTMLElement>("[data-testid=area-card]")];
  expect(cards.map((each) => [each.dataset.area, each.dataset.status])).toEqual([["House", "broken"], ["Systems", "flagged"], ["BB Studio", "ok"], ["Comms", "ok"], ["Kensico", "unknown"]]);
  expect(box("tasks-areas")!.querySelector("h2 + span")?.textContent).toBe("2 need a look · problems first");
  const house = cards[0]!;
  expect(house.className).toContain("--destructive");
  expect(house.querySelector("[data-testid=area-dot]")?.getAttribute("aria-label")).toBe("Broken");
  expect(house.querySelector("[data-testid=area-who]")?.textContent).toBe("House runner · Every day 7:10 AM");
  expect(house.querySelector("[data-testid=area-covers]")?.textContent).toBe("Maintenance, providers, house reminders");
  expect(house.querySelector("[data-testid=area-reason]")?.textContent).toBe("Last run: RUNNER PROBLEM no access");
  expect(house.querySelector("[data-testid=area-now]")?.textContent).toBe("Can't read the house Reminders list.");
  expect(house.querySelector("h4")?.textContent).toBe("Open · 4");
  const items = [...house.querySelectorAll<HTMLElement>("[data-testid=area-item]")];
  expect(items.map((each) => [each.textContent, each.dataset.needsYou ?? null])).toEqual([["Defrost the freezer, needs you, Sep 26", "true"], ["Pest control visit due, ~Nov", null], ["Porch latch", null]]);
  expect(house.querySelector("[data-testid=area-more]")?.textContent).toBe("+1 more");
  await act(async () => items[0]!.querySelector("button")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://todo/loop_o", expect.objectContaining({ title: "Defrost the freezer" }));
  expect([...house.querySelectorAll<HTMLElement>("[data-testid=area-run]")].map((each) => each.dataset.outcome)).toEqual(["ok", "ok", "ok", "ok", "broken", "broken", "broken"]);
  expect(house.querySelector("[data-testid=area-runs]")?.getAttribute("aria-label")).toBe("Last 7 runs, oldest first, newest last: fine, fine, fine, fine, broken, broken, broken");
  expect(house.querySelector("[data-testid=area-runs] li:last-child")?.getAttribute("title")).toBe(`${new Date(NOW).toLocaleString()}: run 0`);
  expect(house.querySelector("[data-testid=area-runs]")?.nextElementSibling?.getAttribute("data-testid")).toBe("area-when");
  expect(house.querySelector("[data-testid=area-when]")?.textContent).toBe("Last 2:00 PM·Next Tue 7:00 AM");
  const studio = cards[2]!;
  expect(studio.querySelector("[data-testid=area-who]")?.textContent).toBe("BB Studio lead · 1 worker");
  expect(studio.querySelector("[data-testid=area-dot]")?.getAttribute("aria-label")).toBe("Fine, working now");
  expect(studio.querySelector("[data-testid=area-when]")?.textContent).toBe("Last 1:00 PM·Fork sync Tue 4:00 AM");
  await act(async () => studio.querySelector<HTMLButtonElement>("[data-testid=area-who]")!.click());
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
  expect(cards[4]!.querySelector("[data-testid=area-now]")?.textContent).toBe("No report yet.");
  expect(cards[4]!.textContent).toContain("Nothing open");
  expect(cards[4]!.textContent).toContain("No runs yet");
  expect(cards[3]!.querySelectorAll("[data-testid=area-run]")).toHaveLength(7);
});

it("says so when there are no areas yet, and shows the areas error", async () => {
  await render();
  expect(box("areas-empty")?.textContent).toContain("No areas yet");
  state.areasError = "Areas could not be loaded";
  await render();
  expect(box("areas-error")?.textContent).toBe("Areas could not be loaded");
});

it("the Done bar says how many today and this week (from Monday), the latest few, and opens to the week grouped by owner with outputs", async () => {
  state.extraTasks = [
    mk("task_rel", { title: "TestFlight 0115", owner: "thread:thr_lead", state: "done", closedAt: NOW - 3 * H, outputs: [{ kind: "pr", ref: "https://github.com/example/app/pull/14" }, { kind: "page", ref: "pg_notes", title: "Release notes" }] }),
    mk("task_rel_sub", { title: "Build the IPA", owner: "thread:thr_w1", state: "done", parentId: "task_rel", closedAt: NOW - 4 * H, outputs: [{ kind: "build", ref: "0115" }] }),
    mk("task_last_week", { title: "Last Sunday's fix", owner: "thread:thr_lead", state: "done", closedAt: NOW - 16 * H }),
    mk("task_failed", { title: "Broken attempt", owner: "thread:thr_lead", state: "failed", closedAt: NOW - H }),
  ];
  await render();
  const done = box("tasks-done")!;
  expect(done.querySelector("[data-testid=done-counts]")?.textContent).toBe("3 today · 3 this week");
  expect(done.querySelector("[data-testid=done-latest]")?.textContent).toBe("Latest: Closed 1 · Closed 2 · TestFlight 0115");
  const toggle = done.querySelector<HTMLButtonElement>("[data-testid=done-toggle]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(done.querySelector("[data-testid=done-week]")).toBeNull();
  await act(async () => toggle.click());
  expect([...done.querySelectorAll<HTMLElement>("[data-testid=done-group]")].map((each) => each.getAttribute("aria-label"))).toEqual(["Done by You", "Done by Larkspur lead"]);
  const rel = done.querySelector<HTMLElement>("[data-testid=done-item][data-task-id=task_rel]")!;
  expect(rel.textContent).toContain("with 1 subtask");
  expect(texts(rel, "[data-testid=task-output]")).toEqual(["PR #14", "Release notes", "0115"]);
  await act(async () => rel.querySelector<HTMLButtonElement>("[data-testid=task-output][data-kind=page]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_notes", expect.objectContaining({ source: "botPage", title: "Release notes" }));
  expect(done.textContent).not.toContain("Broken attempt");
  expect(done.textContent).not.toContain("Last Sunday's fix");
});

it("search narrows the to-do list, In flight and the areas, and says when nothing matches", async () => {
  state.extraTasks = [...ASKS(), ...FLIGHT()];
  state.areas = [area("House", { covers: "Maintenance" }), area("Comms", { covers: "Inbox" })];
  await render();
  await type(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!, "screenshots");
  expect([...container.querySelectorAll<HTMLElement>("[data-testid=page-flight-row]")].map((each) => each.dataset.taskId)).toEqual(["task_polish"]);
  expect(box("todo-empty")?.textContent).toBe("No to-dos match.");
  expect(container.querySelectorAll("[data-testid=area-card]")).toHaveLength(0);
  expect(box("areas-empty")?.textContent).toBe("No areas match.");
  expect(box("tasks-done")?.querySelector("[data-testid=done-counts]")?.textContent).toBe("Nothing done this week matches");
  await type(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!, "inbox");
  expect([...container.querySelectorAll<HTMLElement>("[data-testid=area-card]")].map((each) => each.dataset.area)).toEqual(["Comms"]);
  expect(box("flight-empty")?.textContent).toBe("Nothing in flight matches.");
});

it("with nothing open says so in each box, and the Done bar still shows", async () => {
  state.groups = { ...empty, done: [loop("loop_v", "Cancel the hosting Pro trial", { status: "done", closedAt: NOW, closedBy: "patrick" })] };
  await render();
  expect(box("todo-empty")?.textContent).toBe("Nothing for you right now.");
  expect(box("flight-empty")?.textContent).toContain("Nothing in flight.");
  expect(box("tasks-done")?.querySelector("[data-testid=done-counts]")?.textContent).toBe("1 today · 1 this week");
});

it("shows the tasks error, and Scheduled's own error on its tab", async () => {
  state.listError = "Tasks could not be loaded. Nothing was lost. Restart BB Studio to try again.";
  state.scheduledError = "Tasks could not be loaded. Nothing was lost. Restart BB Studio to try again.";
  await render();
  expect(container.querySelector("[data-testid=tasks-error]")?.textContent).toBe(state.listError);
  expect(container.textContent).not.toMatch(/SQLITE|disk/);
  expect(box("tasks-top")).toBeNull();
  expect(box("tasks-loading")).toBeNull();
  expect(container.textContent).not.toContain("Nothing for you right now");
  expect(container.textContent).not.toContain("Nothing in flight");
  await showScheduled();
  expect(container.querySelector("[data-testid=tasks-scheduled] [data-testid=scheduled-error]")?.textContent).toBe(state.scheduledError);
  expect(container.querySelector("[data-testid=scheduled-empty]")).toBeNull();
  state.listError = null; state.scheduledError = null;
});

it("shows due times in the to-do list in Tasks' time zone, not the computer's", async () => {
  const { zonedTime } = await import("../clock");
  const due = zonedTime(2026, 11, 2, 9, 0, "America/Los_Angeles") + 4 * DAY;
  state.groups = { ...empty, needsYouNow: [loop("loop_call", "Call the dentist", { due })] };
  state.zone = "America/Los_Angeles";
  await render();
  expect(box("tasks-todo")!.textContent).toContain("Due Fri, 9:00 AM");
  state.zone = "America/New_York";
  await render();
  expect(box("tasks-todo")!.textContent).toContain("Due Fri, 12:00 PM");
});

it("while the tasks load, shows a loading state, not empty boxes", async () => {
  state.boardLoading = true;
  await render();
  expect(box("tasks-loading")?.querySelectorAll("[aria-busy=true]")).toHaveLength(2);
  expect(box("tasks-top")).toBeNull();
  expect(container.textContent).not.toContain("Nothing for you right now");
  expect(container.textContent).not.toContain("Nothing in flight");
  state.boardLoading = false;
  await render();
  expect(box("tasks-loading")).toBeNull();
  expect(box("tasks-todo")).not.toBeNull();
});

it("checking an own to-do that fails says why in the row, and the check is a 24 px target", async () => {
  state.call.mockImplementationOnce(async () => { throw new Error("The task changed; reload to try again"); });
  await render();
  const check = box("tasks-todo")!.querySelector<HTMLButtonElement>("[data-task-id=loop_o] [data-testid=todo-check]")!;
  expect(check.className).toContain("size-6");
  await act(async () => check.click());
  expect(box("tasks-todo")!.querySelector("[data-task-id=loop_o] [data-testid=todo-error]")?.textContent).toBe("The task changed; reload to try again");
});
