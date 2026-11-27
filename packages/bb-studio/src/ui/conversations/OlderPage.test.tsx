// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-10T15:00:00").getTime();
const DAY = 86_400_000;
const state = vi.hoisted(() => ({
  page: null as unknown,
  search: null as unknown,
  searches: [] as unknown[],
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  refresh: vi.fn(),
  toThread: vi.fn(),
  openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })),
}));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: state.toThread }) }));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (method: string, input: unknown, options: { enabled?: boolean } = {}) => {
    if (method === "bot_conversations_search" && options.enabled !== false) state.searches.push(input);
    const data = method === "bot_conversations_all" ? state.page
      : method === "bot_conversations_search" ? (options.enabled === false ? null : state.search)
        : method === "bot_spaces" ? { bots: [{ id: "bot_main", name: "Chief of Staff" }] } : null;
    return { data, error: null, refresh: state.refresh };
  },
}));
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} />, openAppPath: vi.fn(), StudioBar: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));

const { default: OlderPage, SEARCH_DEBOUNCE_MS } = await import("./OlderPage");
const conversation = (threadId: string, title: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  threadId, title, isMain: false, forkedFrom: null, projectId: null, updatedAt, archivedAt: null, summary: null, latest: "The last reply", running: false, needsYou: null, failed: false, ...extra,
});
const worker = (threadId: string, title: string, status: string, updatedAt: number, tag: string | null = null) => ({ threadId, title, status, ownerConversationId: null, ownerTitle: "Main", projectId: null, updatedAt, tag, branch: null, mirrored: false, sameTitle: 1 });

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear(); state.refresh.mockClear(); state.toThread.mockClear(); state.openLink.mockClear();
  state.searches = [];
  state.search = null;
  state.page = {
    botId: "bot_main",
    conversations: [
      conversation("thr_main", "Main", NOW - 60_000, { isMain: true, latest: "Morning check-in done" }),
      conversation("thr_trip", "Great Wolf trip", NOW - 2 * DAY, { needsYou: { reason: "Pick a date", at: NOW - DAY } }),
      conversation("thr_prep", "Launch prep", NOW - 3 * DAY, { archivedAt: NOW - 3 * DAY, summary: "Shipped the launch checklist. The press kit is left." }),
      conversation("thr_old", "Tax questions", NOW - 30 * DAY, { archivedAt: NOW - 20 * DAY, latest: "Filed the extension" }),
      conversation("thr_hello", "Say hello.", NOW - 40 * DAY, { archivedAt: NOW - 39 * DAY, failed: true, latest: null }),
    ],
    workers: [worker("thr_sweep", "Staff sweep", "failed", NOW - 10 * DAY, "homelab"), worker("thr_fix", "Fix the CI flake", "failed", NOW - DAY), worker("thr_docs", "Docs pass", "done", NOW - 4 * DAY)],
  };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = () => act(() => root.render(<OlderPage botId="bot_main" />));
const titles = (scope: ParentNode = container) => [...scope.querySelectorAll("[data-testid=bot-page-row-title]")].map((each) => each.textContent);
const groups = () => [...container.querySelectorAll("section")].map((each) => each.getAttribute("aria-label"));
const pill = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=bot-page-pill]")].find((each) => each.textContent?.startsWith(label))!;
const row = (threadId: string) => container.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`)!;
const detail = (threadId: string) => row(threadId)?.querySelector("[data-testid=bot-page-row-detail]")?.textContent ?? null;
const type = (text: string) => {
  const search = container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, text); search.dispatchEvent(new Event("input", { bubbles: true })); });
  return search;
};
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50)); });

it("is the Conversations page: active ones first, then the archived ones, then workers; each row leads with its summary", () => {
  render();
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toBe("Conversations·Chief of Staff");
  expect([...container.querySelectorAll("[data-testid=bot-page-pill]")].map((each) => each.textContent)).toEqual(["All", "Active2", "Archived3", "Workers3", "Failed3"]);
  expect(groups()).toEqual(["Active", "Archived", "Workers"]);
  expect(titles(container.querySelector("section[aria-label=Active]")!)).toEqual(["Main", "Great Wolf trip"]);
  // Archived conversations appear, with or without a summary.
  expect(titles(container.querySelector("section[aria-label=Archived]")!)).toEqual(["Launch prep", "Tax questions", "Say hello."]);
  // The summary's line in place of a bare status; without one, the latest reply; a conversation that needs the user says why.
  expect(detail("thr_prep")).toBe("Shipped the launch checklist. The press kit is left.");
  expect(row("thr_prep").querySelector("[data-testid=bot-page-row-status]")).toBeNull();
  expect(row("thr_prep").querySelector("[data-testid=bot-page-row-meta]")?.textContent).toBe("Nov 7");
  expect(detail("thr_old")).toBe("Filed the extension");
  expect(detail("thr_main")).toBe("Morning check-in done");
  expect(detail("thr_trip")).toBe("Pick a date");
  expect(row("thr_hello").querySelector("[data-testid=bot-page-row-status]")?.textContent).toBe("Failed");
  // Workers keep their one line: a failure older than 7 days is grey, a recent one red.
  expect(row("thr_sweep").querySelector("[data-testid=bot-page-row-meta]")?.textContent).toBe("homelab · 1w");
  expect(row("thr_sweep").querySelector("[data-testid=bot-page-row-status]")?.className).toContain("text-muted-foreground");
  expect(row("thr_fix").querySelector("[data-testid=bot-page-row-status]")?.className).toContain("text-destructive");
  // Only archived ones have Reopen.
  expect(row("thr_main").querySelector("[data-testid=conversations-reopen]")).toBeNull();
  expect(row("thr_prep").querySelector("[data-testid=conversations-reopen]")).not.toBeNull();
});

it("narrows with the pills: Active, Archived, Workers, Failed", () => {
  render();
  act(() => pill("Active").click());
  expect(groups()).toEqual(["Active"]);
  expect(titles()).toEqual(["Main", "Great Wolf trip"]);
  act(() => pill("Archived").click());
  expect(groups()).toEqual(["Archived"]);
  expect(titles()).toEqual(["Launch prep", "Tax questions", "Say hello."]);
  act(() => pill("Workers").click());
  expect(titles()).toEqual(["Staff sweep", "Fix the CI flake", "Docs pass"]);
  act(() => pill("Failed").click());
  expect(groups()).toEqual(["Failed, archived", "Failed workers"]);
  expect(titles()).toEqual(["Say hello.", "Staff sweep", "Fix the CI flake"]);
  act(() => pill("All").click());
  expect(titles()).toHaveLength(8);
});

it("matches titles at once, then after a pause finds a word only in a message, with its snippet", async () => {
  render();
  type("press");
  // Before the pause: no title has it, and the server isn't asked yet.
  expect(state.searches).toEqual([]);
  expect(container.querySelector("[data-testid=conversations-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("No conversations or workers match “press”");
  state.search = { hits: [
    { threadId: "thr_old", kind: "conversation", field: "message", snippet: "…we sent the press release to the county office on Friday" },
    { threadId: "thr_prep", kind: "conversation", field: "summary", snippet: "Shipped the launch checklist. The press kit is left." },
  ], indexing: false };
  await settle();
  expect(state.searches.at(-1)).toEqual({ botId: "bot_main", query: "press" });
  expect(titles()).toEqual(["Launch prep", "Tax questions"]);
  // The snippet in place of the summary, the word set off.
  expect(detail("thr_old")).toBe("…we sent the press release to the county office on Friday");
  expect(row("thr_old").hasAttribute("data-snippet")).toBe(true);
  expect([...row("thr_old").querySelectorAll("mark")].map((each) => each.textContent)).toEqual(["press"]);
  expect(container.querySelector("[data-testid=conversations-indexing]")).toBeNull();
  // A title match shows at once, without waiting for the server.
  state.search = null;
  type("wolf");
  expect(titles()).toEqual(["Great Wolf trip"]);
  expect(detail("thr_trip")).toBe("Pick a date");
});

it("says when older messages are still being read", async () => {
  render();
  state.search = { hits: [], indexing: true };
  type("contract");
  await settle();
  expect(container.querySelector("[data-testid=conversations-indexing]")?.textContent).toBe("Still reading older messages");
  act(() => container.querySelector<HTMLButtonElement>("[data-testid=conversations-empty] [data-testid=bot-page-empty-action]")!.click());
  expect(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!.value).toBe("");
  expect(titles().length).toBe(8);
});

it("opens a row's thread through the link router as a conversation tab, and reopens an archived one", async () => {
  render();
  act(() => row("thr_trip").querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_trip", { source: "botPage", title: "Great Wolf trip", modifiers: { meta: false, ctrl: false, shift: false } });
  expect(row("thr_trip").dataset.selected).toBe("true");
  act(() => { row("thr_sweep").querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_sweep", expect.objectContaining({ source: "botPage", modifiers: { meta: false, ctrl: false, shift: true } }));
  act(() => row("thr_old").querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_old", expect.objectContaining({ title: "Tax questions" }));
  await act(async () => row("thr_old").querySelector<HTMLButtonElement>("[data-testid=conversations-reopen]")!.click());
  expect(state.call).toHaveBeenCalledWith("bot_reopen", { threadId: "thr_old" });
  expect(state.refresh).toHaveBeenCalled();
  expect(state.openLink).toHaveBeenCalledTimes(3);
  expect(state.toThread).not.toHaveBeenCalled();
});

it("says No conversations yet when the Bot has none", () => {
  state.page = { botId: "bot_main", conversations: [], workers: [] };
  render();
  expect(container.querySelector("[data-testid=conversations-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("No conversations yet");
});
