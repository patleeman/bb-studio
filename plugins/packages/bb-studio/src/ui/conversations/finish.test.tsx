// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { BotThreadInfo, FinishedConversation } from "../../bot-threads-contract";

const state = vi.hoisted(() => ({
  finished: null as unknown,
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ state: "finishing" })),
  navigate: { toThread: vi.fn(), toPluginPanel: vi.fn() },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => state.navigate }));
vi.mock("../live", () => ({
  useLive: () => ({ data: { finished: state.finished }, error: null, loading: false, refresh: () => {} }),
  useCall: () => state.call,
}));
vi.mock("../thread-header", () => ({ useThreadLookup: () => new Map() }));
vi.mock("../../kit/app/index", () => ({ Icon: () => null }));
vi.mock("../../kit/ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);

import { FinishedCard, isFinished } from "./finish";

const info = (over: Partial<BotThreadInfo>): BotThreadInfo => ({
  threadId: "prep", botId: "dot", botName: "Chief of Staff", kind: "conversation", isMain: false, title: "Launch prep", forkedFrom: null, owner: null, status: null, waitingOn: null, startedAt: 0,
  tag: null, branch: null, archivedAt: null, finishedSummary: null, finishing: false, needsYou: null, projectId: null, workers: [], ...over,
});

const directive = (thread: string) => ({ attributes: { thread }, message: { id: "m", threadId: "thr_main", turnId: null, projectId: null }, source: `::finished{thread="${thread}"}`, openWorkspaceFile: () => false }) as unknown as PluginMessageDirectiveProps;

let root: Root;
let host: HTMLDivElement;
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.call.mockClear();
  state.navigate.toThread.mockClear();
  state.navigate.toPluginPanel.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("tells a finished conversation from one that was only archived", () => {
  expect(isFinished(info({ archivedAt: 5, finishedSummary: "x" }))).toBe(true);
  expect(isFinished(info({ archivedAt: 5 }))).toBe(false);
  expect(isFinished(info({}))).toBe(false);
});

it("draws Main's card in the shared card shell: the title, dates, the summary's sections, and actions back to the conversation and to Memory", async () => {
  const year = new Date().getFullYear();
  const finished: FinishedConversation = {
    threadId: "prep", botId: "dot", title: "Launch prep", startedAt: new Date(year, 10, 3).getTime(), finishedAt: new Date(year, 10, 10).getTime(),
    summary: "**Decisions**\n- One 45-minute mock a day.\n- Mock boards go next to their Breakdown page.\n\n**Left open**\n- Book a paid mock before Nov 20?\n\n**Made**\n19 Breakdown pages and the outline.",
    records: 3, memoryHref: "/plugins/studio/studio/memory/dot", archived: true,
  };
  state.finished = finished;
  await act(async () => { root.render(<FinishedCard {...directive("prep")} />); });
  const card = $('[data-testid="finished-card"]')!;
  expect(card.hasAttribute("data-studio-card")).toBe(true);
  expect(card.querySelector("[data-studio-card-title]")?.textContent).toBe("Archived: Launch prep");
  expect(card.textContent).toContain("Nov 3 – Nov 10");
  expect([...card.querySelectorAll("h4")].map((each) => each.textContent)).toEqual(["Decisions", "Left open", "Made"]);
  expect([...card.querySelectorAll("li")].map((each) => each.textContent)).toEqual(["One 45-minute mock a day.", "Mock boards go next to their Breakdown page.", "Book a paid mock before Nov 20?"]);
  expect($('[data-testid="finished-memory"]')!.tagName).toBe("BUTTON");
  expect($('[data-testid="finished-memory"]')!.textContent).toBe("In Memory · 3 memory records");
  expect(card.textContent).not.toContain("Saved to Memory as");
  await act(async () => { $('[data-testid="finished-open"]')!.click(); });
  expect(state.navigate.toThread).toHaveBeenCalledWith("prep");
  await act(async () => { $('[data-testid="finished-memory"]')!.click(); });
  expect(state.navigate.toPluginPanel).toHaveBeenCalledWith("studio", { subPath: "memory/dot" });
  state.finished = null;
  await act(async () => { root.render(<FinishedCard {...directive("gone")} />); });
  expect($('[data-testid="finished-card-missing"]')).not.toBeNull();
});
