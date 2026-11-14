// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Loop } from "../contract";

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
  zone: null as string | null,
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
    const data = method === "loops.list" ? state.groups
      : method === "loops.scheduled" ? { items: state.scheduled }
      : method === "bot_get" ? { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot" } }
      : method === "bot_list" ? { bots: [{ id: "bot_1", name: "Chief of Staff", threadId: "thr_bot", primary: true, state: "active" }] }
        : method === "project_leads" ? { leads: [{ projectId: "proj_k", leadThreadId: "thr_lead", run: null }] }
          : method === "loops.places" ? { names: ["Home", "Office", "Mom’s"] }
            : method === "bot_attention" ? { attention: state.attention } : null;
    return { data, loading: false, error: null, refresh: () => {} };
  },
}));
vi.mock("../../kit/ui/index", async () => (await import("./test-kit")).kitUi);
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", () => ({ GHOST_BUTTON: "", PRIMARY_BUTTON: "", DANGER_BUTTON: "", openAppPath: vi.fn(), StudioBar: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));

const { TodosPage } = await import("./TodosPage");
const { TodoTab } = await import("./TodoTab");
const view = { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot", primary: true } } as never;
let root: Root, container: HTMLDivElement, tabRoot: Root, tabHost: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.chatOpen = false; state.composer.insert.mockClear(); state.composer.focus.mockClear(); state.toThread.mockImplementation(() => { state.chatOpen = true; });
  state.call.mockClear(); state.toThread.mockClear(); state.openLink.mockClear(); state.interactions = []; state.attention = null; state.zone = null;
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
const group = (name: string) => container.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
const titles = (scope: Element | null) => [...(scope?.querySelectorAll("[data-testid=bot-page-row-title]") ?? [])].map((each) => each.textContent);
const row = (title: string) => [...container.querySelectorAll<HTMLElement>("[data-testid=todo-row], [data-testid=todo-done]")].find((each) => each.querySelector("[data-testid=bot-page-row-title]")?.textContent === title)!;
const openTab = async (id: string) => { await act(async () => tabRoot.render(<TodoTab params={{ id }} />)); };
const openRow = async (title: string) => {
  const id = row(title).dataset.loop!;
  await act(async () => row(title).querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith(`bb://todo/${id}`, { source: "botPage", title, modifiers: { meta: false, ctrl: false, shift: false } });
  await openTab(id);
};
const detail = () => tabHost.querySelector<HTMLElement>("[data-testid=todo-detail]");
const buttonIn = (scope: Element, text: string) => {
  const found = [...scope.querySelectorAll("button")].find((each) => each.textContent?.trim() === text);
  if (!found) throw new Error(`No "${text}" in: ${[...scope.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

it("names itself in the header, and lists one line per todo in Today, This week, Later and Waiting on others", async () => {
  await render();
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toBe("Todos·Chief of Staff");
  expect([...container.querySelectorAll("section")].map((each) => each.getAttribute("aria-label"))).toEqual(["Today", "This week", "Later", "Waiting on others", "Scheduled", "Done"]);
  // Out now, and overdue, are Today; a snooze two days out is this week; no date or ten days out is later.
  expect(titles(group("Today"))).toEqual(["Pay the Con Edison bill", "Reply to Sam about the Q3 planning doc", "Choose the deck contractor"]);
  expect(titles(group("This week"))).toEqual(["Send the October expense report"]);
  expect(titles(group("Later"))).toEqual(["Review the onboarding flow", "Call the plumber about the slow drain"]);
  expect(titles(group("Waiting on others"))).toEqual(["Draft the Larkspur Q4 lead summary", "Signed lease addendum"]);
  // One small when on the right; nothing else on the line: no area chip, description, source or trigger pill.
  const meta = (title: string) => row(title).querySelector("[data-testid=bot-page-row-meta]");
  expect(meta("Pay the Con Edison bill")?.textContent).toBe("Overdue");
  expect(meta("Pay the Con Edison bill")?.className).toContain("text-warning");
  expect(meta("Reply to Sam about the Q3 planning doc")?.textContent).toBe("Due Fri, 3:00 PM");
  expect(meta("Send the October expense report")?.textContent).toBe("Wed");
  expect(meta("Call the plumber about the slow drain")?.textContent).toBe("When you get home");
  expect(meta("Draft the Larkspur Q4 lead summary")?.textContent).toBe("Larkspur lead");
  expect(meta("Signed lease addendum")?.textContent).toBe("Since Sun");
  expect(meta("Choose the deck contractor")).toBeNull();
  const prep = row("Review the onboarding flow");
  expect(prep.textContent).toBe("Review the onboarding flowDue Nov 12, 3:00 PM");
  expect(container.textContent).not.toContain("q3-planning-notes");
  expect(container.textContent).not.toContain("Tomorrow morning card");
  // Done is folded.
  expect(group("Done")?.querySelectorAll("[data-testid=todo-done]")).toHaveLength(0);
});

it("draws an open todo with an empty circle and a done one with a check", async () => {
  await render();
  expect(row("Pay the Con Edison bill").querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("Circle");
  expect(container.querySelector("[data-testid=todo-row] [data-icon=CircleCheck]")).toBeNull();
  await act(async () => group("Done")!.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  expect(row("Closed 1").querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("CircleCheck");
});

it("filters by area pills and search; area lives only in the filter bar", async () => {
  await render();
  const pills = () => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=bot-page-pill]")];
  expect(pills().map((each) => each.textContent)).toEqual(["All", "Home", "Job", "Larkspur"]);
  expect([...container.querySelectorAll("[data-testid=todo-row]")].some((each) => each.textContent?.includes("Home"))).toBe(false);
  await act(async () => pills().find((each) => each.textContent === "Home")!.click());
  expect(titles(container)).toEqual(["Pay the Con Edison bill", "Choose the deck contractor", "Call the plumber about the slow drain"]);
  await act(async () => pills().find((each) => each.textContent === "All")!.click());
  await type(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!, "onboarding sign");
  expect(titles(container)).toEqual(["Review the onboarding flow"]);
  await type(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!, "nothing like it");
  expect(container.querySelector("[data-testid=todos-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("No todos match “nothing like it”");
  expect(container.querySelector("[data-testid=scheduled-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("No scheduled items match “nothing like it”");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-testid=todos-empty] [data-testid=bot-page-empty-action]")!.click());
  expect(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!.value).toBe("");
  expect(titles(container).length).toBeGreaterThan(1);
});

it("a row opens the todo through the link router, and the todo tab shows its description, due date, when, area, owner and source with the plan's link", async () => {
  await render();
  expect(detail()).toBeNull();
  await openRow("Review the onboarding flow");
  expect(row("Review the onboarding flow").dataset.selected).toBe("true");
  expect(row("Review the onboarding flow").getAttribute("data-row-link")).toBe("bb://todo/loop_p");
  expect(container.querySelector("[data-testid=bot-page-detail], [data-fork-card=secondary-panel], [data-testid=todo-why]")).toBeNull();
  expect(detail()!.querySelector("[data-testid=bot-item-title]")?.textContent).toBe("Review the onboarding flow");
  expect(detail()!.querySelector("[data-testid=todo-why]")?.textContent).toBe("1–1.5 h. Walk through the new sign-up screens.");
  const facts = Object.fromEntries([...detail()!.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
  expect(facts).toEqual({ Due: "Thu, Nov 12, 3:00 PM", When: "Wed, Nov 11, 3:00 PM", Area: "Job", Owner: "You", Source: "q3-planning-notes" });
  expect(detail()!.querySelector("a")?.getAttribute("href")).toBe("https://research.example.com/plan");
  await act(async () => { row("Signed lease addendum").querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://todo/loop_w", { source: "botPage", title: "Signed lease addendum", modifiers: { meta: true, ctrl: false, shift: false } });
  await act(async () => { row("Signed lease addendum").querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://todo/loop_w", { source: "botPage", title: "Signed lease addendum", modifiers: { meta: false, ctrl: false, shift: true } });
});

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
  expect(tabHost.querySelector("[data-testid=link-not-found]")?.textContent).toContain("Todo");
  state.getError = "The server didn't answer";
  await openTab("loop_n");
  expect(tabHost.querySelector("[data-testid=link-not-found]")).toBeNull();
  expect(tabHost.querySelector("[data-testid=bot-item-error]")?.textContent).toBe("The server didn't answer");
  state.getError = null;
});

it("acts from the detail: Done, choose, Remind me now, Take it back, Open thread, Nudge them and Undo", async () => {
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
  await act(async () => buttonIn(detail()!, "Take it back").click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_a", changes: { owner: "patrick", status: "surfaced" } });
  await act(async () => buttonIn(detail()!, "Open thread").click());
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
  await openRow("Signed lease addendum");
  await act(async () => buttonIn(detail()!, "Nudge them").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_w", action: "nudge" });
  expect(detail()!.textContent).toContain("drafting a nudge in the chat");
  await act(async () => group("Done")!.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  await openRow("Closed 1");
  await act(async () => detail()!.querySelector<HTMLButtonElement>("[aria-label='Undo: Closed 1']")!.click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_x1", changes: { status: "surfaced" } });
});

it("names a todo's actions in plain words: Remind me now, Give to, Change when, Dismiss", async () => {
  await render();
  await openRow("Call the plumber about the slow drain");
  const labels = [...detail()!.querySelectorAll("button")].map((each) => each.textContent?.trim());
  expect(labels).toEqual(expect.arrayContaining(["Done", "Remind me now", "Snooze", "Give to", "Discuss", "Change when", "Dismiss"]));
  for (const old of ["Surface now", "Hand off", "Change trigger", "Drop"]) expect(labels).not.toContain(old);
  await act(async () => buttonIn(detail()!, "Dismiss").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_c", action: "drop" });
  await act(async () => buttonIn(detail()!, "Chief of Staff").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_c", action: "hand_off", owner: "cos" });
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

it("New hands a typed line to the Bot", async () => {
  await render();
  await act(async () => buttonIn(container, "New").click());
  const input = container.querySelector<HTMLInputElement>("input[aria-label='New todo']")!;
  await type(input, "call the plumber when I'm home");
  await act(async () => buttonIn(container.querySelector("[data-testid=todo-add]")!, "Add").click());
  expect(state.call).toHaveBeenCalledWith("loops.add", { text: "call the plumber when I'm home" });
  expect(container.querySelector("[data-testid=todo-add]")).toBeNull();
});

it("leads Today with the Bot chat's pending questions (a tracked one once), which open the chat; an unread reply is no todo", async () => {
  state.interactions = [{ id: "int_1", status: "pending", createdAt: NOW, payload: { kind: "approval" } }, { id: "int_2", status: "pending", createdAt: NOW, payload: { kind: "user_question", questions: [{ question: "Which day works for the call?" }] } }, { id: "int_3", status: "resolved" }];
  (state.groups as typeof empty).needsYouNow.push(loop("loop_q", "Approve the invoice", { source: { kind: "interaction", ref: "int_1" } }));
  state.attention = { reason: "1", count: 1, since: NOW, unread: 1 };
  await render();
  await act(async () => { await Promise.resolve(); });
  const today = group("Today")!;
  expect(titles(today).slice(0, 2)).toEqual(["Which day works for the call?", "Pay the Con Edison bill"]);
  expect(today.querySelector("[data-testid=bot-page-group-count]")?.textContent).toBe("5");
  expect(container.textContent).not.toContain("A reply from");
  expect(container.textContent).not.toContain("Unread");
  await act(async () => today.querySelector<HTMLButtonElement>("[data-testid=todo-chat] [data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_bot", { source: "botPage", title: "Chief of Staff", modifiers: { meta: false, ctrl: false, shift: false } });
});

it("says No todos yet when nothing is open, with New todo, and Done still there", async () => {
  state.groups = { ...empty, done: [loop("loop_v", "Cancel the hosting Pro trial", { status: "done", closedAt: NOW, closedBy: "patrick" })] };
  await render();
  expect(container.querySelector("[data-testid=todos-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("No todos yet");
  expect(container.querySelector("[data-testid=todos-empty] [data-testid=bot-page-empty-action]")?.textContent).toBe("New todo");
  expect(group("Done")?.textContent).toContain("Done1");
});

it("lists the Bot's check-ins, reminders, watchers and runners under Scheduled, each opening its automation", async () => {
  state.groups = { ...empty };
  const item = (key: string, over: Record<string, unknown>) => ({ key, source: "automation", id: key, botId: "bot_1", botName: "Chief of Staff", kind: "checkin", title: key, nextAt: null, state: "active", scheduleText: "Daily 8:00", threadId: "thr_bot", link: `bb://automation/bot_1%3A${key}`, ...over });
  state.scheduled = [
    item("Morning brief", { nextAt: NOW + 3_600_000 }),
    item("Inbox watch", { kind: "watcher", state: "paused" }),
    item("Other Bot's", { botId: "bot_2" }),
    item("A timed todo", { source: "todo", link: "bb://todo/loop_t" }),
  ];
  await render();
  const rows = [...container.querySelectorAll("[data-testid=todos-scheduled] [data-testid=scheduled-row]")];
  expect(rows.map((each) => each.textContent)).toEqual(["Morning brief4:00 PM", "Inbox watchPaused"]);
  expect(rows[0]!.getAttribute("data-row-link")).toBe("bb://automation/bot_1%3AMorning%20brief");
  state.scheduled = [];
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

it("shows 8 rows of a long group, then \"N more in Later\", so Scheduled stays near the top", async () => {
  state.groups = { ...empty, comingUp: Array.from({ length: 20 }, (_, n) => loop(`loop_l${n}`, `Later ${String(n).padStart(2, "0")}`, { status: "queued" })) };
  state.scheduled = [{ key: "Morning brief", source: "automation", id: "Morning brief", botId: "bot_1", botName: "Chief of Staff", kind: "checkin", title: "Morning brief", nextAt: null, state: "active", scheduleText: "Daily 8:00", threadId: "thr_bot", link: "bb://automation/bot_1%3AMorning%20brief" }];
  await render();
  const later = group("Later")!;
  expect(later.querySelector("[data-testid=bot-page-group-count]")?.textContent).toBe("20");
  expect(titles(later)).toHaveLength(8);
  expect(later.querySelector("[data-testid=todos-more]")?.textContent).toBe("12 more in Later");
  expect(container.querySelectorAll("[data-testid=bot-page-row-title]")).toHaveLength(9);
  await act(async () => later.querySelector<HTMLButtonElement>("[data-testid=todos-more]")!.click());
  expect(titles(group("Later"))).toHaveLength(20);
  expect(group("Later")!.querySelector("[data-testid=todos-more]")).toBeNull();
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

it("shows due times in Todos' time zone, not the computer's: 9:00 AM Pacific reads 9:00 AM with Pacific set", async () => {
  const { zonedTime } = await import("../clock");
  const due = zonedTime(2026, 11, 2, 9, 0, "America/Los_Angeles") + 4 * DAY;
  state.groups = { ...empty, comingUp: [loop("loop_call", "Call the dentist", { status: "queued", due })] };
  state.zone = "America/Los_Angeles";
  await act(async () => { root.render(<TodosPage view={view} />); });
  expect(container.textContent).toContain("Due Fri, 9:00 AM");
  state.zone = "America/New_York";
  await act(async () => { root.render(<TodosPage view={view} />); });
  expect(container.textContent).toContain("Due Fri, 12:00 PM");
});
