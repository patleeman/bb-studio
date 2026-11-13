// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Loop } from "../contract";

const NOW = new Date("2026-11-02T15:00:00").getTime();
const base: Loop = { id: "loop_1", title: "Reply to Sam about the Q3 planning doc", why: "He asked for your input; the doc locks Friday.", source: { kind: "email", ref: "Email from Sam B." }, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "surfaced", due: null, area: "Job", createdAt: NOW - 86_400_000, updatedAt: NOW, closedAt: null, closedBy: null };
const state = vi.hoisted(() => ({
  enabled: true,
  view: null as { loop: Loop; history: { type: string; at: number; data: string }[]; owner?: { owner: string; name: string; threadId: string | null } } | null,
  error: null as string | null,
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  toThread: vi.fn(),
  open: vi.fn(),
  openPanel: vi.fn((_options: unknown) => false),
  live: [] as string[],
  groups: null as unknown,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toThread: state.toThread }),
  experimental_useAppPanel: () => ({ openTab: ({ tab, ...rest }: { tab: { id: string } }) => (state.openPanel)({ actionId: tab.id, ...rest }) }),
  useSdk: () => ({ projects: { list: async () => [{ id: "proj_k", name: "Larkspur" }] } }),
}));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ changed: [], timeZone: "America/New_York", isLoading: false, error: null, set: async () => {}, ...(({ values: { loopsEnabled: state.enabled } })) }), readStudioSettingsNow: () => ({}) }));
vi.mock("../../ui/live", () => ({
  useCall: () => state.call,
  useLive: (method: string, _input: unknown, options: { enabled?: boolean } = {}) => {
    if (options.enabled === false) return { data: null, loading: false, error: null, refresh: () => {} };
    state.live.push(method);
    const data = method === "loops.get" ? state.view
      : method === "bot_get" ? { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot" } }
        : method === "project_leads" ? { leads: [{ projectId: "proj_k", leadThreadId: "thr_lead", run: null }] }
          : method === "loops.list" ? state.groups
            : null;
    return { data, loading: false, error: method === "loops.get" ? state.error : null, refresh: () => {} };
  },
}));
vi.mock("../../kit/ui/index", async () => (await import("./test-kit")).kitUi);
vi.mock("../../kit/app/index", () => ({ remember: (_key: string, value: unknown) => value, openAppPath: state.open }));

const { LoopDirective, LoopsDirective, loopsSummary } = await import("./LoopCard");
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { enabled: true, view: { loop: base, history: [] }, error: null, live: [] });
  state.call.mockClear(); state.toThread.mockClear(); state.open.mockClear();
  state.openPanel.mockReset(); state.openPanel.mockReturnValue(false); state.groups = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const message = { id: "m1", threadId: "thr_bot", turnId: null, projectId: null };
const render = async (attributes: Record<string, string> = { id: "loop_1" }, loop?: Partial<Loop>, history: { type: string; at: number; data: string }[] = []) => {
  if (loop) state.view = { loop: { ...base, ...loop }, history };
  await act(async () => root.render(<LoopDirective attributes={attributes} source="" message={message} openWorkspaceFile={null} />));
};
const button = (text: string) => {
  const found = [...container.querySelectorAll("button")].find((each) => each.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}" in: ${[...container.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};
const click = (text: string) => act(async () => button(text).click());

it("is a quiet placeholder while Todos are off, without fetching the todo", async () => {
  state.enabled = false;
  await render();
  expect(container.textContent).toBe("Todos are off");
  expect(state.live).not.toContain("loops.get");
});

it("draws nothing for a malformed id", async () => {
  await render({ id: "page_1" });
  expect(container.innerHTML).toBe("");
});

it("draws a do card with its release label, source, due and the four actions", async () => {
  await render(undefined, { due: NOW + 3 * 86_400_000 });
  expect(container.textContent).toContain("Reply to Sam about the Q3 planning doc");
  expect(container.textContent).toContain("He asked for your input");
  expect(container.textContent).toContain("Email from Sam B.");
  expect(container.textContent).toContain("Due Thu");
  for (const label of ["Done", "Snooze", "Give to", "Drop"]) expect(button(label)).toBeTruthy();
  await click("Done");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "done" });
});

it("snoozes with a preset and with Pick a time", async () => {
  await render();
  const tonight = [...container.querySelectorAll("[role=menuitem]")].find((each) => each.textContent?.startsWith("Tonight")) as HTMLButtonElement;
  await act(async () => tonight.click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "snooze", snooze: "tonight" });
  expect(container.textContent).toContain("When I’m home");
  expect(container.textContent).not.toContain("at my Mac");
  await click("Pick a time…");
  await click("Snooze until then");
  expect(state.call).toHaveBeenLastCalledWith("loops.update", { id: "loop_1", changes: { status: "snoozed", trigger: { type: "time", at: expect.any(Number) } } });
});

it("hands off to the Bot or a project lead", async () => {
  await render();
  await act(async () => { await Promise.resolve(); });
  await click("Larkspur lead");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "hand_off", owner: "thread:thr_lead" });
  await click("Chief of Staff");
  expect(state.call).toHaveBeenLastCalledWith("loops.act", { id: "loop_1", action: "hand_off", owner: "cos" });
});

it("shows up to three decide options inline and chooses one", async () => {
  await render(undefined, { kind: "decide", options: ["Bayside Decks · $4,200 · starts Nov 9", "Hudson Carpentry · $3,650 · starts Dec 1"] });
  expect(container.textContent).toContain("$3,650 · starts Dec 1");
  expect(() => button("Choose…")).toThrow();
  await click("Hudson Carpentry$3,650 · starts Dec 1");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "choose", option: "Hudson Carpentry · $3,650 · starts Dec 1" });
});

it("opens Choose… past three options", async () => {
  await render(undefined, { kind: "decide", options: ["A", "B", "C", "D"] });
  expect(button("Choose…")).toBeTruthy();
});

it("reads with Got it, and nudges through a draft, never a send", async () => {
  await render(undefined, { kind: "read" });
  await click("Got it");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "got_it" });
  await render(undefined, { kind: "waiting", title: "Signed lease addendum" });
  expect(container.textContent).toContain("Since Sun");
  await click("Nudge them");
  expect(state.call).toHaveBeenLastCalledWith("loops.act", { id: "loop_1", action: "nudge" });
  expect(container.textContent).toContain("drafting a nudge in the chat");
});

it("shows who has a handed-off todo, live, with Open thread and Take it back", async () => {
  await render(undefined, { owner: "thread:thr_lead", status: "in_progress" }, [{ type: "handed_off", at: NOW - 12 * 60_000, data: "{}" }]);
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelector("[data-testid=loop-progress]")?.textContent).toContain("Larkspur lead is on it· 12 min");
  await click("Open thread");
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
  await click("Take it back");
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_1", changes: { owner: "patrick", status: "surfaced" } });
});

it("collapses a closed todo to one line with how it ended, and Undo reopens it", async () => {
  await render(undefined, { status: "done", closedAt: NOW - 60_000, closedBy: "patrick", kind: "decide", options: ["Hudson Carpentry · $3,650"] }, [{ type: "closed", at: NOW, data: JSON.stringify({ action: "choose", option: "Hudson Carpentry · $3,650" }) }]);
  expect(container.querySelector("[data-testid=loop-closed]")?.textContent).toContain("Hudson Carpentry· Reply to Sam");
  await act(async () => (container.querySelector("[aria-label^=Undo]") as HTMLButtonElement).click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_1", changes: { status: "surfaced" } });
});

it("says a deleted todo was removed", async () => {
  state.view = null; state.error = "Todo not found";
  await render();
  expect(container.textContent).toContain("This todo was removed.");
});

it("draws a morning row that opens the full card", async () => {
  await render({ id: "loop_1", row: "1" }, { due: NOW });
  const row = container.querySelector("[data-testid=loop-row] button") as HTMLButtonElement;
  expect(row.textContent).toContain("Due today");
  expect(container.querySelector("[data-testid=loop-card]")).toBeNull();
  await act(async () => row.click());
  expect(container.querySelector("[data-testid=loop-card]")).not.toBeNull();
});

it("opens +N more beside the chat as the Todos pane when the thread has a side panel", async () => {
  state.openPanel.mockReturnValue(true);
  await act(async () => root.render(<LoopsDirective attributes={{ more: "3" }} source="" message={message} openWorkspaceFile={null} />));
  await act(async () => (container.querySelector("[data-testid=loops-more]") as HTMLButtonElement).click());
  expect(state.openPanel).toHaveBeenCalledWith({ actionId: "loops", title: "Todos" });
  expect(state.open).not.toHaveBeenCalled();
});

it("posts ::loops{open=pane} as a card that opens Todos beside the chat", async () => {
  const one = (id: string) => ({ ...base, id });
  state.groups = { needsYouNow: [one("a"), one("b")], comingUp: [one("c")], agentsOnIt: [], waitingOnOthers: [one("d")], done: [] };
  state.openPanel.mockReturnValue(true);
  await act(async () => root.render(<LoopsDirective attributes={{ open: "pane" }} source="" message={message} openWorkspaceFile={null} />));
  const card = container.querySelector("[data-testid=loops-open]")!;
  expect(card.textContent).toContain("2 need you · 1 coming up · 1 waiting on others");
  await click("Open Todos");
  expect(state.openPanel).toHaveBeenCalledWith({ actionId: "loops", title: "Todos" });
  // No side panel (a plugin page): the Todos tab instead.
  state.openPanel.mockReturnValue(false);
  await click("Open Todos");
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_1/loops");
  // Off, the card is the quiet line.
  state.enabled = false;
  await act(async () => root.render(<LoopsDirective attributes={{ open: "pane" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.querySelector("[data-testid=loop-off]")).not.toBeNull();
});

it("summarizes todos for the card", () => {
  expect(loopsSummary({ needsYouNow: [1], comingUp: [], agentsOnIt: [1, 2], waitingOnOthers: [] })).toBe("1 needs you · 2 with agents");
  expect(loopsSummary({ needsYouNow: [], comingUp: [], agentsOnIt: [], waitingOnOthers: [] })).toBe("No todos");
  expect(loopsSummary(null)).toBe("");
});

it("links +N more to the Todos tab without a side panel, and draws nothing for 0", async () => {
  await act(async () => root.render(<LoopsDirective attributes={{ more: "3" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.textContent).toBe("3 more in Todos");
  await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_1/loops");
  await act(async () => root.render(<LoopsDirective attributes={{ more: "0" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.innerHTML).toBe("");
});

it("offers Keep or Drop on a todo with no update in three days (the weekly review)", async () => {
  await render(undefined, { owner: "cos", status: "in_progress", updatedAt: NOW - 4 * 86_400_000 });
  expect(container.querySelector("[data-testid=loop-stale]")?.textContent).toContain("No update in 4 d");
  await click("Keep");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "keep" });
});

it("shows one placeholder per morning card while off: its first row, not every row or the more link", async () => {
  state.enabled = false;
  const rows = ["loop_a", "loop_b", "loop_c"];
  await act(async () => root.render(<>
    {rows.map((id) => <LoopDirective key={id} attributes={{ id, row: "1" }} source="" message={{ ...message, id: "m_morning" }} openWorkspaceFile={null} />)}
    <LoopsDirective attributes={{ more: "3" }} source="" message={{ ...message, id: "m_morning" }} openWorkspaceFile={null} />
  </>));
  expect(container.querySelectorAll("[data-testid=loop-off]")).toHaveLength(1);
  expect(container.querySelector("[data-testid=loops-more]")).toBeNull();
});

it("names a thread owner by the thread's title and links it", async () => {
  state.view = { loop: { ...base, owner: "thread:thr_demo000014", status: "in_progress", title: "Add the remaining utilities to the AI power Long read" }, history: [], owner: { owner: "thread:thr_demo000014", name: "AI power Long read", threadId: "thr_demo000014" } };
  await render();
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelector("[data-testid=loop-progress]")?.textContent).toContain("AI power Long read is on it");
  await click("Open thread");
  expect(state.toThread).toHaveBeenCalledWith("thr_demo000014");
});

it("opens the Bot's chat for a todo the CoS has", async () => {
  await render(undefined, { owner: "cos", status: "in_progress" });
  await click("Open chat");
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
});
