// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Loop } from "../contract";

const NOW = new Date("2026-11-02T15:00:00").getTime();
const loop = (id: string, title: string, extra: Partial<Loop> = {}): Loop => ({ id, title, why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "surfaced", due: null, area: null, createdAt: NOW - 86_400_000, updatedAt: NOW - 600_000, closedAt: null, closedBy: null, ...extra });
const empty = { needsYouNow: [] as Loop[], comingUp: [] as Loop[], agentsOnIt: [] as Loop[], waitingOnOthers: [] as Loop[], done: [] as Loop[] };
const state = vi.hoisted(() => ({
  tabWindow: null as null | { title: string; toolbar: null },
  enabled: true,
  groups: null as unknown,
  inputs: [] as unknown[],
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  toThread: vi.fn(),
  openPanel: vi.fn((_options: unknown) => true),
  open: vi.fn(),
  interactions: [] as unknown[],
  attention: null as unknown,
  composer: null as null | { insert: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> },
  composerAsked: [] as string[],
}));
vi.mock("../../kit/composer", () => ({ threadComposer: (threadId: string) => { state.composerAsked.push(threadId); return state.composer; } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toThread: state.toThread }),
  experimental_useAppPanel: () => ({ openTab: ({ tab, ...rest }: { tab: { id: string } }) => (state.openPanel)({ actionId: tab.id, ...rest }) }),
  useSdk: () => sdk,
  experimental_useTabWindow: () => state.tabWindow,
}));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ changed: [], timeZone: "America/New_York", isLoading: false, error: null, set: async () => {}, ...(({ values: { loopsEnabled: state.enabled } })) }), readStudioSettingsNow: () => ({}) }));
const sdk = { projects: { list: async () => [{ id: "proj_k", name: "Larkspur" }] }, threads: { interactions: { list: async () => state.interactions } } };
vi.mock("../../ui/live", () => ({
  useCall: () => state.call,
  useLive: (method: string, input: unknown, options: { enabled?: boolean } = {}) => {
    if (options.enabled === false) return { data: null, loading: false, error: null, refresh: () => {} };
    if (method === "loops.list") state.inputs.push(input);
    const data = method === "loops.list" ? state.groups
      : method === "bot_get" ? { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot" } }
        : method === "project_leads" ? { leads: [{ projectId: "proj_k", leadThreadId: "thr_lead", run: null }] }
          : method === "loops.places" ? { names: ["Home", "Office"] }
            : method === "bot_attention" ? { attention: state.attention } : null;
    return { data, loading: false, error: null, refresh: () => {} };
  },
}));
vi.mock("../../kit/ui/index", async () => (await import("./test-kit")).kitUi);
vi.mock("../../kit/app/index", () => ({ openAppPath: state.open, ICON_BUTTON: "icon-button" }));

const { LoopsPane, withClosed, closesFromCircle } = await import("./LoopsPane");
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { enabled: true, inputs: [], interactions: [], attention: null, composer: { insert: vi.fn(), focus: vi.fn() }, composerAsked: [] });
  state.call.mockClear(); state.toThread.mockClear(); state.open.mockClear(); state.openPanel.mockClear();
  state.groups = {
    ...empty,
    needsYouNow: [loop("loop_n", "Reply to Sam about the Q3 planning doc", { why: "He asked for your input", area: "Job", due: NOW + 4 * 86_400_000 }), loop("loop_d", "Choose the deck contractor", { kind: "decide", options: ["Bayside — $18k", "Hudson — $21k"], area: "Home" })],
    comingUp: [loop("loop_c", "Call the plumber about the slow drain", { status: "queued", trigger: { type: "place", place: "home", direction: "arrive" }, push: true }), loop("loop_b", "Book the car service", { owner: "cos", status: "queued", trigger: { type: "time", at: NOW + 2 * 86_400_000 } })],
    agentsOnIt: [loop("loop_a", "Draft the Larkspur Q4 lead summary", { owner: "thread:thr_lead", status: "in_progress", area: "Larkspur" })],
    waitingOnOthers: [loop("loop_w", "Signed lease addendum", { kind: "waiting", status: "queued" })],
    done: [1, 2, 3, 4].map((n) => loop(`loop_x${n}`, `Closed ${n}`, { status: "done", closedAt: NOW - n * 60_000, closedBy: "patrick" })),
    areas: ["Home", "Job", "Larkspur"],
  };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = async (threadId = "thr_bot") => {
  await act(async () => root.render(<LoopsPane threadId={threadId} environment={null} params={null} />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};
const section = (name: string) => container.querySelector(`section[aria-label="${name}"]`) as HTMLElement;
const row = (title: string) => [...container.querySelectorAll("[data-testid^=loop-]")].find((each) => each.textContent?.includes(title)) as HTMLElement;
const buttonIn = (scope: Element, text: string) => {
  const found = [...scope.querySelectorAll("button")].find((each) => each.textContent?.trim() === text);
  if (!found) throw new Error(`No "${text}" in: ${[...scope.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};
const click = (scope: Element, text: string) => act(async () => buttonIn(scope, text).click());

it("shows the tab's five sections, compact, with the count that needs you in its header", async () => {
  await render();
  expect([...container.querySelectorAll("section")].map((each) => each.getAttribute("aria-label"))).toEqual(["Needs you now", "Coming up", "Agents on it", "Waiting on others", "Done · last 7 days"]);
  expect(container.querySelector("header")!.textContent).toBe("Todos2");
  expect(row("Reply to Sam").textContent).toContain("Fri");
  expect(row("Choose the deck").textContent).toContain("2 options");
  expect(row("Call the plumber").textContent).toContain("When you get home");
  expect(row("Book the car service").textContent).toContain("Chief of Staff will do it");
  expect(row("Draft the Larkspur").textContent).toContain("Larkspur lead");
  expect(section("Done · last 7 days").querySelectorAll("[data-testid=loop-done]")).toHaveLength(3);
  await click(section("Done · last 7 days"), "Show all");
  expect(section("Done · last 7 days").querySelectorAll("[data-testid=loop-done]")).toHaveLength(4);
});

it("puts each row's actions in its ⋯ menu", async () => {
  await render();
  const actions = (title: string) => [...row(title).querySelectorAll("[role=menuitem]")].map((each) => each.textContent);
  expect(row("Reply to Sam").querySelector("[aria-label='Actions: Reply to Sam about the Q3 planning doc']")).not.toBeNull();
  expect(actions("Reply to Sam")).toEqual(["Discuss", "Done", "Later today", "Tonight", "Tomorrow", "This weekend", "When I’m home", "Pick a time…", "Chief of Staff", "Larkspur lead", "Change trigger…", "Drop"].map((label) => expect.stringContaining(label)));
  await click(row("Reply to Sam"), "Done");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_n", action: "done" });
  await click(row("Reply to Sam"), "Larkspur lead");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_n", action: "hand_off", owner: "thread:thr_lead" });
  await act(async () => ([...row("Reply to Sam").querySelectorAll("[role=menuitem]")].find((each) => each.textContent?.startsWith("Tomorrow")) as HTMLButtonElement).click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_n", action: "snooze", snooze: "tomorrow_morning" });
  await click(row("Choose the deck"), "Hudson — $21k");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_d", action: "choose", option: "Hudson — $21k" });
  await click(row("Call the plumber"), "Surface now");
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_c", surfaceNow: true });
  // Not Patrick's: no Surface now.
  expect(actions("Book the car service")).toEqual(["Discuss", "Change trigger…"]);
  await click(row("Draft the Larkspur"), "Take it back");
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_a", changes: { owner: "patrick", status: "surfaced" } });
  await click(row("Draft the Larkspur"), "Open thread");
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
  await click(row("Signed lease"), "Nudge them");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_w", action: "nudge" });
  expect(container.textContent).toContain("drafting a nudge in the chat");
  await act(async () => (container.querySelector("[aria-label='Undo: Closed 1']") as HTMLButtonElement).click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_x1", changes: { status: "surfaced" } });
});

it("changes a trigger in place under its row, with Send to iPhone", async () => {
  await render();
  await click(row("Reply to Sam"), "Change trigger…");
  const form = row("Reply to Sam").querySelector("form[aria-label='Change trigger']")!;
  await click(form, "Place");
  await click(form, "Leave");
  await act(async () => (form.querySelector("input[type=checkbox]") as HTMLInputElement).click());
  await click(form, "Save");
  // Released, it goes back to waiting on its new trigger.
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_n", changes: { trigger: { type: "place", place: "Home", direction: "leave" }, push: true, status: "queued" } });
  expect(row("Reply to Sam").querySelector("form")).toBeNull();
});

const areaGroup = () => container.querySelector("[role=group][aria-label=Area]")!;

it("builds the area chips from the loops' areas and filters by one", async () => {
  state.groups = { ...empty, needsYouNow: [loop("loop_1", "One", { area: "Alpha" }), loop("loop_2", "Two", { area: "Beta" })], areas: ["Alpha", "Beta"] };
  await render();
  expect([...areaGroup().querySelectorAll("button")].map((each) => each.textContent)).toEqual(["All", "Alpha", "Beta"]);
  await click(areaGroup(), "Alpha");
  expect(state.inputs.at(-1)).toEqual({ area: "Alpha" });
});

it("filters by area and owner, and adds a todo", async () => {
  await render();
  await click(container.querySelector("[role=group][aria-label=Area]")!, "Home");
  expect(state.inputs.at(-1)).toEqual({ area: "Home" });
  await click(container, "Me");
  expect(state.inputs.at(-1)).toEqual({ area: "Home", owner: "patrick" });
  const input = container.querySelector("input[aria-label='Add a todo']") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "renew the passport");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => (container.querySelector("button[aria-label=Add]") as HTMLButtonElement).click());
  expect(state.call).toHaveBeenCalledWith("loops.add", { text: "renew the passport" });
});

it("beside the Bot's chat, its questions say so; beside another thread they open the chat", async () => {
  state.interactions = [{ id: "int_1", status: "pending", createdAt: NOW, payload: { kind: "user_question" } }];
  await render();
  expect(container.querySelector("[data-testid=loop-pending]")!.textContent).toContain("In this chat");
  expect(container.querySelector("[data-testid=loop-pending] button")).toBeNull();
  await render("thr_other");
  expect(container.querySelector("[data-testid=loop-pending]")!.textContent).toContain("In your chat with Chief of Staff");
  await act(async () => (container.querySelector("[aria-label='Open your chat with Chief of Staff']") as HTMLButtonElement).click());
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
});

it("in a window of its own, leaves the title to the window's bar: the count and the full page button stay", async () => {
  state.tabWindow = { title: "Todos", toolbar: null };
  await render();
  expect(container.querySelector("header h2")).toBeNull();
  expect(container.querySelector("header")!.textContent).toBe("2");
  expect(container.querySelector("header [aria-label='Open the full Todos page']")).not.toBeNull();
  state.tabWindow = null;
});

it("opens the full page from its header, and says when Todos are off", async () => {
  await render();
  await act(async () => (container.querySelector("[aria-label='Open the full Todos page']") as HTMLButtonElement).click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_1/loops");
  state.enabled = false;
  await render();
  expect(container.textContent).toContain("Todos are off");
  expect(container.querySelector("section")).toBeNull();
});

it("opens the pane when the sidebar asks the Bot chat, now or once the chat opens, once, and reports whether it opened", async () => {
  const { requestLoopsPane } = await import("./hooks");
  const { useThreadTabRequests, resetThreadTabRequests } = await import("../../kit/app/thread-panel");
  function Chat({ threadId }: { threadId: string }) { useThreadTabRequests(threadId); return null; }
  // Asked before the chat is open: its view opens the pane when it mounts.
  const early = requestLoopsPane("thr_bot");
  await act(async () => root.render(<Chat threadId="thr_bot" />));
  await expect(early).resolves.toBe(true);
  expect(state.openPanel).toHaveBeenCalledTimes(1);
  expect(state.openPanel).toHaveBeenCalledWith({ actionId: "loops", title: "Todos" });
  // Asked while the chat is open; another thread's request isn't its.
  void requestLoopsPane("thr_other");
  expect(state.openPanel).toHaveBeenCalledTimes(1);
  let opened: boolean | undefined;
  await act(async () => { opened = await requestLoopsPane("thr_bot"); });
  expect(opened).toBe(true);
  expect(state.openPanel).toHaveBeenCalledTimes(2);
  // Declined: false, after one try.
  state.openPanel.mockReturnValueOnce(false);
  await act(async () => { opened = await requestLoopsPane("thr_bot"); });
  expect(opened).toBe(false);
  expect(state.openPanel).toHaveBeenCalledTimes(3);
  resetThreadTabRequests();
});

it("closes a do or read todo in one click on its circle, done in place with Undo", async () => {
  (state.groups as typeof empty).needsYouNow.push(loop("loop_r", "Your vendor demo moved to Thu", { kind: "read" }));
  await render();
  const circle = (title: string) => row(title).querySelector("[role=checkbox]") as HTMLButtonElement | null;
  // Do and read rows (and Patrick's own coming-up do), not decisions, waits, agents or the Bot's.
  expect(circle("Reply to Sam")!.getAttribute("aria-label")).toBe("Mark done: Reply to Sam about the Q3 planning doc");
  expect(circle("Reply to Sam")!.title).toBe("Mark done");
  expect(circle("Call the plumber")).not.toBeNull();
  for (const title of ["Choose the deck", "Signed lease", "Draft the Larkspur", "Book the car service"]) expect(circle(title)).toBeNull();
  // The circle shows a check on hover.
  expect(circle("Reply to Sam")!.querySelector("[data-icon=Check]")).not.toBeNull();
  await act(async () => circle("Reply to Sam")!.click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_n", action: "done" });
  const done = container.querySelector("[data-testid=loop-just-done]") as HTMLElement;
  expect(done.textContent).toContain("Reply to Sam about the Q3 planning doc");
  expect(done.textContent).toContain("Done · just now");
  // Still first in Needs you now, where it was.
  expect(section("Needs you now").querySelector("[data-testid^=loop-]")).toBe(done);
  await act(async () => circle("Your vendor demo")!.click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_r", action: "got_it" });
  await act(async () => buttonIn(done, "Undo").click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_n", changes: { status: "surfaced" } });
  expect(circle("Reply to Sam")).not.toBeNull();
});

it("keeps a just-closed todo at its place after the refetch moves it to Done", () => {
  const a = loop("a", "A"), b = loop("b", "B"), c = loop("c", "C");
  const closed = new Map([["b", { loop: b, place: "needs" as const, index: 1, action: "done" as const }]]);
  expect(withClosed([a, c], "needs", closed).map((each) => each.id)).toEqual(["a", "b", "c"]);
  expect(withClosed([a, b, c], "needs", closed).map((each) => each.id)).toEqual(["a", "b", "c"]);
  expect(withClosed([a, c], "coming", closed).map((each) => each.id)).toEqual(["a", "c"]);
  expect(closesFromCircle(loop("x", "X", { kind: "decide" }))).toBe(false);
  expect(closesFromCircle(loop("x", "X", { kind: "read" }))).toBe(true);
  expect(closesFromCircle(loop("x", "X", { owner: "cos" }))).toBe(false);
});

it("Discuss puts the todo in the Bot chat's draft as an @loop chip, not sent, and focuses it", async () => {
  await render();
  await click(row("Reply to Sam"), "Discuss");
  expect(state.composerAsked).toEqual(["thr_bot"]);
  expect(state.composer!.insert).toHaveBeenCalledWith([{ provider: "loop", id: "loop_n", label: "Reply to Sam about the Q3 planning doc" }, " "], { at: "end" });
  // The menu focuses it as it closes (onCloseAutoFocus), past its focus trap.
  expect(state.composer!.focus).not.toHaveBeenCalled();
  expect(state.toThread).not.toHaveBeenCalled();
  expect(state.call).not.toHaveBeenCalled();
});

it("drags a row as its ::loop line and title, as plain text", async () => {
  await render();
  const dragged = row("Reply to Sam");
  expect(dragged.getAttribute("draggable")).toBe("true");
  const data = new Map<string, string>();
  const event = new Event("dragstart", { bubbles: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: { setData: (type: string, value: string) => data.set(type, value), effectAllowed: "" } });
  await act(async () => { dragged.dispatchEvent(event); });
  expect(Object.fromEntries(data)).toEqual({ "text/plain": '::loop{id="loop_n"}\nAbout: Reply to Sam about the Q3 planning doc\n' });
  expect(event.dataTransfer!.effectAllowed).toBe("copy");
  expect(dragged.hasAttribute("data-dragging")).toBe(true);
  await act(async () => { dragged.dispatchEvent(new Event("dragend", { bubbles: true })); });
  expect(dragged.hasAttribute("data-dragging")).toBe(false);
});
