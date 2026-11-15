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
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ changed: [], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, isLoading: false, error: null, set: async () => {}, ...(({ values: { loopsEnabled: state.enabled } })) }), readStudioSettingsNow: () => ({}) }));
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

const { LoopsDirective, loopsSummary } = await import("./LoopCard");
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
const button = (text: string) => {
  const found = [...container.querySelectorAll("button")].find((each) => each.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}" in: ${[...container.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};
const click = (text: string) => act(async () => button(text).click());

it("opens +N more beside the chat as the Tasks pane when the thread has a side panel", async () => {
  state.openPanel.mockReturnValue(true);
  await act(async () => root.render(<LoopsDirective attributes={{ more: "3" }} source="" message={message} openWorkspaceFile={null} />));
  await act(async () => (container.querySelector("[data-testid=loops-more]") as HTMLButtonElement).click());
  expect(state.openPanel).toHaveBeenCalledWith({ actionId: "loops", title: "Tasks" });
  expect(state.open).not.toHaveBeenCalled();
});

it("posts ::loops{open=pane} as a card that opens Tasks beside the chat", async () => {
  const one = (id: string) => ({ ...base, id });
  state.groups = { needsYouNow: [one("a"), one("b")], comingUp: [one("c")], agentsOnIt: [], waitingOnOthers: [one("d")], done: [] };
  state.openPanel.mockReturnValue(true);
  await act(async () => root.render(<LoopsDirective attributes={{ open: "pane" }} source="" message={message} openWorkspaceFile={null} />));
  const card = container.querySelector("[data-testid=loops-open]")!;
  expect(card.textContent).toContain("2 need you · 1 coming up · 1 waiting on others");
  await click("Open Tasks");
  expect(state.openPanel).toHaveBeenCalledWith({ actionId: "loops", title: "Tasks" });
  // No side panel (a plugin page): the Tasks page instead.
  state.openPanel.mockReturnValue(false);
  await click("Open Tasks");
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_1/loops");
  state.enabled = false;
  await act(async () => root.render(<LoopsDirective attributes={{ open: "pane" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.textContent).toContain("Open Tasks");
});

it("summarizes tasks for the card", () => {
  expect(loopsSummary({ needsYouNow: [1], comingUp: [], agentsOnIt: [1, 2], waitingOnOthers: [] })).toBe("1 needs you · 2 with agents");
  expect(loopsSummary({ needsYouNow: [], comingUp: [], agentsOnIt: [], waitingOnOthers: [] })).toBe("No tasks");
  expect(loopsSummary(null)).toBe("");
});

it("links +N more to the Tasks page without a side panel, and draws nothing for 0", async () => {
  await act(async () => root.render(<LoopsDirective attributes={{ more: "3" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.textContent).toBe("3 more in Tasks");
  await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_1/loops");
  await act(async () => root.render(<LoopsDirective attributes={{ more: "0" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.innerHTML).toBe("");
});

