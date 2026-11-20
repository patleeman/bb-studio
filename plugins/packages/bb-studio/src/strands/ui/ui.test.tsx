// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrandList, StrandView } from "../contract";
import { ageOf, decisionButtons, groupsOf, seqsOf, stepSeq, stripOf, tagOf, type Tags } from "./model";

const NOW = Date.parse("2026-11-20T14:20:00Z");
const MIN = 60_000;

const view = (id: string, title: string, over: Partial<StrandView> = {}): StrandView => ({
  id, title, summary: null, named: true, state: "active", detail: null, asks: [], workers: [], lastAt: NOW - 10 * MIN,
  latestSeq: 10, latestTurnId: `t_${id}`, messages: 1, unsure: 0, pinned: false, origin: "jev", taskId: null, ...over,
});
const approval = (id: string, label: string) => ({ id, kind: "approval" as const, threadId: "thr_main", label, decisions: ["deny", "allow_once"] as ("deny" | "allow_once")[] });
const LIST: StrandList = {
  threadId: "thr_main", enabled: true, backfill: { done: true, at: NOW - 60 * MIN, messages: 300, sorted: 300 }, jevCallsToday: 12, jevDailyCap: 300, sortingTurn: false,
  strands: [
    view("s_doc", "Blood pressure log", { state: "needs-you", asks: [approval("int_1", "Approve: npm publish")] }),
    view("s_pr", "bb-plugins PR #15", { state: "needs-you", asks: [{ id: "int_2", kind: "question", threadId: "thr_worker", label: "PR fix: Which branch?", decisions: [] }] }),
    view("s_hvac", "Furnace tune-up", { state: "needs-you", detail: "Router fix needs you" }),
    view("s_cx", "CodexBar quota", { state: "running", detail: "codexbar-fix", latestSeq: 40 }),
    view("s_red4", "red4 mitigation", { state: "waiting", detail: "Unraid's fix" }),
    view("s_macos", "macOS update", { state: "quiet", lastAt: NOW - 2 * 24 * 60 * MIN }),
  ],
  earlier: [view("s_old", "Old trip", { state: "quiet", lastAt: NOW - 9 * 24 * 60 * MIN })],
};
const TAGS: Tags = {
  tags: [
    { turnId: "t1", seq: 4, strandId: "s_cx" },
    { turnId: "t2", seq: 8, strandId: "s_cx" },
    { turnId: "t3", seq: 12, strandId: null },
    { turnId: "t4", seq: 16, strandId: "s_cx" },
    { turnId: "t5", seq: 20, strandId: "s_hvac" },
    { turnId: "t6", seq: 24, strandId: "s_cx" },
  ],
  strands: LIST.strands.map(({ id, title }) => ({ id, title })),
};

describe("the strands UI model (design 4a)", () => {
  it("puts a divider where the strand changes from the last sorted turn, skipping turns in none", () => {
    expect(tagOf(TAGS, "t1")).toEqual({ strandId: "s_cx", title: "CodexBar quota", divider: true });
    expect(tagOf(TAGS, "t2")?.divider).toBe(false);
    expect(tagOf(TAGS, "t3")).toBeNull();
    expect(tagOf(TAGS, "t4")?.divider).toBe(false);
    expect(tagOf(TAGS, "t5")?.divider).toBe(true);
    expect(tagOf(TAGS, "t6")?.divider).toBe(true);
    expect(tagOf(TAGS, "unknown")).toBeNull();
  });

  it("steps through a strand's messages, older and newer, from its newest", () => {
    const seqs = seqsOf(TAGS, "s_cx");
    expect(seqs).toEqual([4, 8, 16, 24]);
    expect(stepSeq(seqs, null, -1)).toBe(24);
    expect(stepSeq(seqs, 24, -1)).toBe(16);
    expect(stepSeq(seqs, 4, -1)).toBe(4);
    expect(stepSeq(seqs, 16, 1)).toBe(24);
    expect(stepSeq(seqs, 20, -1)).toBe(16);
  });

  it("shows at most 2 asks, then how many more, then a chip per other strand", () => {
    const strip = stripOf(LIST);
    expect(strip.asks.map((row) => [row.strand.id, row.ask?.id ?? null])).toEqual([["s_doc", "int_1"], ["s_pr", "int_2"]]);
    expect(strip.more).toBe(1);
    expect(strip.chips.map((strand) => strand.id)).toEqual(["s_cx", "s_red4", "s_macos"]);
    expect(stripOf(LIST, { all: true }).asks).toHaveLength(3);
  });

  it("groups the tab by state and names an approval's buttons in BB's words", () => {
    expect(groupsOf(LIST).map((group) => [group.label, group.strands.length])).toEqual([["Needs you", 3], ["Running", 1], ["Waiting on someone else", 1], ["Quiet", 1]]);
    expect(decisionButtons(approval("i", "x")).map((button) => button.label)).toEqual(["Approve", "Deny"]);
    expect(ageOf(NOW - 2 * 24 * 60 * MIN, NOW)).toBe("2 days");
    expect(ageOf(NOW - 5 * MIN, NOW)).toBe("5m");
  });
});

const state = vi.hoisted(() => ({
  list: null as StrandList | null,
  tags: null as Tags | null,
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({})),
  toAppPath: vi.fn((_path: string, _options?: unknown) => true),
  toThread: vi.fn(),
  openTab: vi.fn(() => true),
  composerThread: "thr_main" as string | null,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toThread: state.toThread, experimental_toAppPath: state.toAppPath }),
  experimental_useAppPanel: () => ({ openTab: state.openTab }),
}));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "strands.list" ? state.list : method === "strands.tags" ? state.tags : null, error: null, loading: false, refresh: vi.fn() }),
  useCall: () => state.call,
}));
vi.mock("../../kit/ui/index", async () => ({ ...(await import("../../loops/ui/test-kit")).kitUi, Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock("../../kit/app/route", () => ({ usePathname: () => "/threads/thr_main" }));
vi.mock("../../kit/composer", () => ({ useComposerThread: () => state.composerThread }));
vi.mock("../../work/ui/InFlight", () => ({ InFlightBanner: () => <div data-testid="in-flight" /> }));
vi.mock("../../ui/conversations/bot-thread-owners", () => ({ useIsBotThread: () => true }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { StrandsOrInFlightBanner } = await import("./Strip");
const { StrandTag } = await import("./Tag");
const { StrandsTab } = await import("./Tab");
const { select } = await import("./selection");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { list: LIST, tags: TAGS, composerThread: "thr_main" });
  state.call.mockClear(); state.toAppPath.mockClear(); state.toThread.mockClear(); state.openTab.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); select("thr_main", null); vi.unstubAllGlobals(); });

const render = (node: React.ReactNode) => act(() => root.render(node));
const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click(); });
const text = (element: Element | null | undefined) => element?.textContent ?? "";

describe("the strip above Main's composer", () => {
  it("takes In flight's place only where strands run", () => {
    render(<StrandsOrInFlightBanner />);
    expect(container.querySelector('[data-testid="strands-strip"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="in-flight"]')).toBeNull();
    state.list = { ...LIST, enabled: false, strands: [], earlier: [] };
    render(<StrandsOrInFlightBanner />);
    expect(container.querySelector('[data-testid="in-flight"]')).not.toBeNull();
  });

  it("shows 2 asks with their buttons, N more, and text-only chips with neutral marks", () => {
    render(<StrandsOrInFlightBanner />);
    const asks = container.querySelectorAll("[data-strand-ask]");
    expect(asks).toHaveLength(2);
    expect(text(asks[0])).toContain("Blood pressure log");
    expect(text(asks[0])).toContain("Approve: npm publish");
    expect([...asks[0]!.querySelectorAll("button")].map(text).slice(1)).toEqual(["Approve", "Deny"]);
    // A worker's question opens the worker.
    expect([...asks[1]!.querySelectorAll("button")].map(text).slice(1)).toEqual(["Open"]);
    expect(text(container)).toContain("1 more need you");
    const chips = [...container.querySelectorAll("[data-strand-chip]")];
    expect(chips.map((chip) => chip.getAttribute("data-strand-chip"))).toEqual(["s_cx", "s_red4", "s_macos"]);
    expect(chips[0]!.querySelector('[aria-label="Running"]')).not.toBeNull();
    expect(chips[1]!.querySelector('[aria-label="Waiting"]')).not.toBeNull();
    expect(text(chips[2])).toContain("2 days");
    // Amber only for needs you.
    expect(container.querySelectorAll(".bg-warning").length).toBe(3);
    expect(chips.every((chip) => !chip.querySelector(".bg-warning"))).toBe(true);
  });

  it("approves from the strip through BB's own resolution", async () => {
    render(<StrandsOrInFlightBanner />);
    const approve = [...container.querySelectorAll("[data-strand-ask] button")].find((button) => text(button) === "Approve");
    await act(async () => { (approve as HTMLElement).click(); });
    expect(state.call).toHaveBeenCalledWith("bot_worker_approval_resolve", { threadId: "thr_main", interactionId: "int_1", decision: "allow_once" });
  });

  it("a chip selects its strand: opens its newest message, marks it seen, and shows the bar that steps through it", () => {
    render(<StrandsOrInFlightBanner />);
    click(container.querySelector('[data-strand-chip="s_cx"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=40", { replace: true });
    expect(state.call).toHaveBeenCalledWith("strands.opened", { strandId: "s_cx" });
    const bar = container.querySelector('[data-strand-selection="s_cx"]');
    expect(text(bar)).toContain("CodexBar quota");
    expect(text(bar)).toContain("4 messages");
    expect(container.querySelector('[data-strand-chip="s_cx"]')!.getAttribute("aria-pressed")).toBe("true");
    const showOnly = [...bar!.querySelectorAll("button")].find((button) => text(button) === "Show only this") as HTMLButtonElement;
    expect(showOnly.disabled).toBe(true);
    click(bar!.querySelector('[aria-label="Previous message in this strand"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=24", { replace: true });
    click(bar!.querySelector('[aria-label="Previous message in this strand"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=16", { replace: true });
    click(container.querySelector('[aria-label="Clear"]'));
    expect(container.querySelector("[data-strand-selection]")).toBeNull();
  });

  it("opens the Strands tab in the workbench", () => {
    render(<StrandsOrInFlightBanner />);
    click(container.querySelector('[aria-label="All strands"]'));
    expect(state.openTab).toHaveBeenCalledWith(expect.objectContaining({ tab: expect.objectContaining({ id: "strands" }), title: "Strands" }));
  });
});

describe("the tag above each message", () => {
  const message = (turnId: string, role: "user" | "assistant") => ({ id: `m_${turnId}_${role}`, threadId: "thr_main", turnId, role, createdAt: NOW, ...(role === "user" ? { initiator: "user" as const } : {}) });
  const row = (turnId: string, role: "user" | "assistant") => <div data-timeline-row-id={`${turnId}-${role}`}><StrandTag message={message(turnId, role) as never} /></div>;

  it("draws a divider with the strand's name where the strand changes, and the muted name otherwise", () => {
    render(<>{row("t4", "user")}{row("t5", "user")}{row("t5", "assistant")}</>);
    expect(container.querySelectorAll("[data-strand-divider]")).toHaveLength(1);
    expect(text(container.querySelector('[data-strand-divider="s_hvac"]'))).toBe("Furnace tune-up");
    expect([...container.querySelectorAll("[data-strand-tag]")].map(text)).toEqual(["CodexBar quota", "Furnace tune-up"]);
  });

  it("dims the other strands' messages while one is selected", () => {
    render(<>{row("t4", "user")}{row("t3", "user")}{row("t5", "user")}</>);
    act(() => select("thr_main", { strandId: "s_cx", seq: null }));
    const dimmed = [...container.querySelectorAll("[data-timeline-row-id]")].map((element) => element.hasAttribute("data-studio-strand-dim"));
    expect(dimmed).toEqual([false, true, true]);
    act(() => select("thr_main", null));
    expect(container.querySelectorAll("[data-studio-strand-dim]")).toHaveLength(0);
  });
});

describe("the Strands tab", () => {
  it("lists strands by state, needs you first with its buttons, and folds Earlier", () => {
    render(<StrandsTab threadId="thr_main" environment={null} params={null} />);
    const groups = [...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
    expect(groups).toEqual(["Needs you", "Running", "Waiting on someone else", "Quiet", "Earlier"]);
    const needs = container.querySelector('[data-strand-row="s_doc"]');
    expect([...needs!.querySelectorAll("button")].map(text)).toEqual(["Approve", "Deny"]);
    expect(container.querySelector('[data-strand-row="s_old"]')).toBeNull();
    click([...container.querySelectorAll("button")].find((button) => text(button).startsWith("Earlier")));
    expect(container.querySelector('[data-strand-row="s_old"]')).not.toBeNull();
    click(container.querySelector('[data-strand-row="s_red4"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=10", { replace: true });
  });
});
