// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrandList, StrandView } from "../contract";
import { ageOf, countsOf, currentOf, decisionButtons, groupsOf, hasOpen, seqsOf, stepSeq, tagOf, type Tags } from "./model";

const NOW = Date.parse("2026-11-20T14:20:00Z");
const MIN = 60_000;

const view = (id: string, title: string, over: Partial<StrandView> = {}): StrandView => ({
  id, title, summary: null, named: true, state: "active", detail: null, asks: [], workers: [], lastAt: NOW - 10 * MIN, firstAt: NOW - 3 * 60 * MIN, firstSeq: 4,
  latestSeq: 10, latestTurnId: `t_${id}`, messages: 1, unsure: 0, pinned: false, origin: "jev", taskId: null, parentId: null, trunk: false, ...over,
});
const approval = (id: string, label: string) => ({ id, kind: "approval" as const, threadId: "thr_main", label, details: ["Command: npm publish --tag latest --access public --otp-from-env", "Cwd: /tmp/release"], turnId: "t5" as string | null, decisions: ["deny", "allow_once"] as ("deny" | "allow_once")[], seq: null as number | null });
const LIST: StrandList = {
  threadId: "thr_main", enabled: true, backfill: { done: true, at: NOW - 60 * MIN, messages: 300, sorted: 300 }, jevCallsToday: 12, jevDailyCap: 300, sortingTurn: false,
  strands: [
    view("s_doc", "Blood pressure log", { state: "needs-you", asks: [approval("int_1", "Approve: npm publish")] }),
    view("s_pr", "bb-plugins PR #15", { state: "needs-you", asks: [{ id: "int_2", kind: "question", threadId: "thr_worker", label: "PR fix: Which branch?", details: [], turnId: null, decisions: [], seq: null }] }),
    view("s_hvac", "Furnace tune-up", { state: "needs-you", detail: "Router fix needs you" }),
    view("s_cx", "CodexBar quota", { state: "running", detail: "codexbar-fix", summary: "Moving the quota read to the new usage endpoint.", latestSeq: 40, messages: 4, workers: [{ threadId: "thr_w", title: "codexbar-fix tests", status: "running", endedAt: null }] }),
    view("s_red4", "red4 mitigation", { state: "waiting", detail: "Unraid's fix" }),
    view("s_macos", "macOS update", { state: "quiet", lastAt: NOW - 2 * 24 * 60 * MIN }),
  ],
  earlier: [view("s_old", "Old trip", { state: "quiet", lastAt: NOW - 9 * 24 * 60 * MIN })],
  strayWorkers: [],
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
    expect(tagOf(TAGS, "t1")).toEqual({ strandId: "s_cx", title: "CodexBar quota", divider: true, seq: 4 });
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

  it("counts the strands by state, finds the line's strand, and knows when nothing is open", () => {
    expect(countsOf(LIST)).toEqual({ needs: 3, running: 1, finished: 0, waiting: 1, open: 0, quiet: 1 });
    // The strand of the newest sorted message, unless one is selected.
    expect(currentOf(LIST, null)?.id).toBe("s_cx");
    expect(currentOf(LIST, { strandId: "s_red4" })?.id).toBe("s_red4");
    expect(currentOf(LIST, { strandId: "s_old" })?.id).toBe("s_old");
    expect(hasOpen(LIST)).toBe(true);
    expect(hasOpen({ ...LIST, strands: [view("q", "Quiet one", { state: "quiet" })] })).toBe(false);
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
  error: null as string | null,
  refresh: vi.fn(),
  toast: vi.fn((_message: string, _options?: { action?: { label: string; onClick(): void } }) => undefined),
}));
const { submittedComposer, submitted } = vi.hoisted(() => {
  const submitted = new Set<() => void>();
  return { submitted, submittedComposer: { scope: { kind: "thread", threadId: "thr_main" }, onSubmitted: (listener: () => void) => { submitted.add(listener); return () => { submitted.delete(listener); }; } } };
});
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useComposer: () => submittedComposer,
  useBbNavigate: () => ({ toThread: state.toThread, experimental_toAppPath: state.toAppPath }),
  experimental_useAppPanel: () => ({ openTab: state.openTab }),
  experimental_InfoSection: ({ label, children }: { label: string; children?: React.ReactNode }) => <section aria-label={label}>{children}</section>,
}));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "strands.list" ? state.list : method === "strands.tags" ? state.tags : null, error: state.error, loading: false, refresh: state.refresh }),
  useCall: () => state.call,
  peekLive: (method: string) => (method === "strands.list" ? state.list : null),
}));
vi.mock("../../kit/ui/index", async () => ({ ...(await import("../../loops/ui/test-kit")).kitUi, Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock("../../kit/app/route", () => ({ usePathname: () => "/threads/thr_main", currentPathname: () => "/threads/thr_main" }));
vi.mock("../../kit/composer", () => ({ useComposerThread: () => state.composerThread }));
vi.mock("../../kit/app/index", () => ({ PageColumn: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../ui/conversations/bot-thread-owners", () => ({ useIsBotThread: () => true }));
vi.mock("sonner", () => ({ toast: Object.assign(state.toast, { error: vi.fn() }) }));

const { StrandsBoxBanner } = await import("./Strip");
const { ContextInfoSection } = await import("./ContextInfoSection");
const { promptStackSource, resetPromptStackForTests } = await import("./prompt-stack");
const { StrandMarks, StrandTag } = await import("./Tag");
const { StrandsTab } = await import("./Tab");
const { select, selectionOf, registerTimelineFilter, timelineFilterOf, resetSelectionForTests } = await import("./selection");
const { flashReply, resetAskMarksForTests, takeFlash } = await import("./ask-mark");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { list: LIST, tags: TAGS, composerThread: "thr_main", error: null });
  state.call.mockClear(); state.toast.mockClear(); state.toAppPath.mockClear(); state.toThread.mockClear(); state.openTab.mockClear(); state.refresh.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); resetSelectionForTests(); resetPromptStackForTests(); vi.unstubAllGlobals(); });

const render = (node: React.ReactNode) => act(() => root.render(node));
const box2 = () => container.querySelector('[data-testid="strands-strip"]');
const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click(); });
const text = (element: Element | null | undefined) => element?.textContent ?? "";

describe("sending a message", () => {
  it("clears the strand filter and zoom, so the new message is drawn at once", async () => {
    const { setZoom, zoomOf } = await import("./selection");
    render(<StrandsBoxBanner />);
    act(() => { select("thr_main", { strandId: "s1", seq: 3, turnIds: ["turn_1"] }); setZoom("thr_main", 1); });
    expect(timelineFilterOf("thr_main")).not.toBeNull();
    act(() => { for (const listener of submitted) listener(); });
    expect(selectionOf("thr_main")).toBeNull();
    expect(timelineFilterOf("thr_main")).toBeNull();
    expect(zoomOf("thr_main")).toBe(0);
  });

  it("from another conversation's composer leaves this one's filter alone", async () => {

    state.composerThread = "thr_other";
    render(<StrandsBoxBanner />);
    act(() => { select("thr_main", { strandId: "s1", seq: 3, turnIds: ["turn_1"] }); });
    act(() => { for (const listener of submitted) listener(); });
    expect(selectionOf("thr_main")).not.toBeNull();
    expect(timelineFilterOf("thr_main")).not.toBeNull();
  });
});

describe("the strands box above a conversation's composer", () => {
  const box = () => container.querySelector('[data-testid="strands-strip"]');
  const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const key = (target: Element, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });

  it("shows where strands run, and takes no space when nothing is open or strands don't run there", () => {
    render(<StrandsBoxBanner />);
    expect(box()).not.toBeNull();
    state.list = { ...LIST, strands: [view("q", "Quiet one", { state: "quiet" })] };
    render(<StrandsBoxBanner />);
    expect(container.innerHTML).toBe("");
    state.list = { ...LIST, enabled: false, strands: [], earlier: [] };
    render(<StrandsBoxBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("is compact: the current strand, what it is about, then the counts; amber only for need you", () => {
    render(<StrandsBoxBanner />);
    const header = text(box());
    expect(header).toContain("CodexBar quota");
    expect(header).toContain("Moving the quota read to the new usage endpoint.");
    expect(header).toContain("3 need you");
    expect(header).toContain("1 running");
    expect(container.querySelector('[data-testid="strands-menu"]')).toBeNull();
    expect([...container.querySelectorAll(".text-warning, .bg-warning")].every((element) => element.closest("[data-strands-needs]"))).toBe(true);
  });

  it("expands in place into a filter field: grouped strands with their summaries, narrowed as you type", async () => {
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-line]"));
    // In place, inside the box: no floating popover.
    const menu = box()!.querySelector('[data-testid="strands-menu"]')!;
    expect([...menu.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"))).toEqual(["Needs you", "Active", "Quiet"]);
    expect(text(menu.querySelector('[data-strand-row="s_cx"]'))).toContain("codexbar-fix");
    expect(text(menu.querySelector('[data-strand-row="s_doc"]'))).toContain("Command: npm publish --tag latest --access public --otp-from-env");
    const input = menu.querySelector<HTMLInputElement>("[data-strand-query]")!;
    expect(document.activeElement).toBe(input);
    await typeInto(input, "usage end");
    expect([...menu.querySelectorAll("[data-strand-option]")].map((option) => option.getAttribute("data-strand-option"))).toEqual(["s_cx", "all"]);
    // Earlier strands are found by name too.
    await typeInto(input, "trip");
    expect([...menu.querySelectorAll("[data-strand-row]")].map((row) => row.getAttribute("data-strand-row"))).toEqual(["s_old"]);
    await typeInto(input, "zzz");
    expect(text(menu)).toContain("No strands match");
    key(input, "Escape");
    expect(input.value).toBe("");
    key(input, "Escape");
    expect(container.querySelector('[data-testid="strands-menu"]')).toBeNull();
  });

  it("under a filter, a jump to the conversation's opening message (BB's filter never shows it) lands on its reply, or doesn't navigate", async () => {
    state.tags = { ...TAGS, opening: { seq: 4, replySeq: 6 } };
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-line]"));
    await typeInto(box()!.querySelector<HTMLInputElement>("[data-strand-query]")!, "codex");
    key(box()!.querySelector("[data-strand-query]")!, "Enter");
    const previous = () => click(box()!.querySelector('[aria-label="Previous message in this strand"]'));
    previous(); previous(); previous();
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=8", { replace: true });
    previous();
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=6", { replace: true });
    state.tags = { ...TAGS, opening: { seq: 4, replySeq: null } };
    render(<StrandsBoxBanner />);
    state.toAppPath.mockClear();
    click(box()!.querySelector('[aria-label="Next message in this strand"]'));
    previous();
    expect(state.toAppPath.mock.calls.map((call) => call[0])).toEqual(["/threads/thr_main#msg=8"]);
  });

  it("applies the picked strand as a filter: a token with ×, BB's timeline filter, stepping; × and Esc clear it", async () => {
    const slot = vi.fn();
    registerTimelineFilter({ experimental_timelineFilter: slot });
    expect(slot).toHaveBeenCalledWith(expect.objectContaining({ id: "strands" }));
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-line]"));
    await typeInto(box()!.querySelector<HTMLInputElement>("[data-strand-query]")!, "codex");
    key(box()!.querySelector("[data-strand-query]")!, "Enter");
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=40", { replace: true });
    expect(state.call).toHaveBeenCalledWith("strands.opened", { strandId: "s_cx" });
    expect(text(container.querySelector('[data-strand-filter="s_cx"]'))).toBe("CodexBar quota");
    // The strand's turns, and t5 where another strand's approval waits.
    expect(timelineFilterOf("thr_main")).toEqual({ turnIds: ["t1", "t2", "t4", "t6", "t5"], firstSeq: 4 });
    expect(text(box())).toContain("4 messages");
    click(box()!.querySelector('[aria-label="Previous message in this strand"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=24", { replace: true });
    click(box()!.querySelector('[aria-label="Clear filter"]'));
    expect(timelineFilterOf("thr_main")).toBeNull();
    expect(container.querySelector("[data-strand-filter]")).toBeNull();
    // Esc clears it too.
    click(container.querySelector("[data-strands-line]"));
    click(box()!.querySelector('[data-strand-option="s_red4"]'));
    expect(container.querySelector('[data-strand-filter="s_red4"]')).not.toBeNull();
    key(document.body, "Escape");
    expect(container.querySelector("[data-strand-filter]")).toBeNull();
  });

  it("opens on the asks from 'need you', approves through BB's own resolution, and opens the full tab", async () => {
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-needs]"));
    const approve = [...box()!.querySelectorAll('[data-strand-row="s_doc"] button')].find((button) => text(button) === "Approve");
    await act(async () => { (approve as HTMLElement).click(); });
    expect(state.call).toHaveBeenCalledWith("bot_worker_approval_resolve", { threadId: "thr_main", interactionId: "int_1", decision: "allow_once" });
    click([...box()!.querySelectorAll("button")].find((button) => text(button) === "All strands"));
    expect(state.openTab).toHaveBeenCalledWith(expect.objectContaining({ tab: expect.objectContaining({ id: "strands" }), title: "Strands" }));
  });

  it("moves through the list with the arrow keys", () => {
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-line]"));
    const input = box()!.querySelector("[data-strand-query]")!;
    const options = [...box()!.querySelectorAll<HTMLElement>("[data-strand-option]")];
    key(input, "ArrowDown");
    expect(document.activeElement).toBe(options[0]);
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    key(document.activeElement!, "End");
    expect(document.activeElement?.getAttribute("data-strand-option")).toBe("all");
  });

  it("shows a strand's workers on its row: a running count, then each one (running, waiting on you, failed, finished); old finished ones drop off", () => {
    const now = Date.now();
    state.list = { ...LIST, strands: [
      view("s_cx", "CodexBar quota", { state: "running", detail: "codexbar docs, codexbar build", summary: "Moving the quota read to the new usage endpoint.", workers: [
        { threadId: "thr_w1", title: "codexbar-fix tests", status: "done", endedAt: now - 10 * MIN },
        { threadId: "thr_w2", title: "codexbar lint", status: "failed", endedAt: now - 30 * MIN },
        { threadId: "thr_w3", title: "codexbar spike", status: "done", endedAt: now - 3 * 24 * 60 * MIN },
        { threadId: "thr_w4", title: "codexbar docs", status: "running", endedAt: null },
        { threadId: "thr_w5", title: "codexbar build", status: "running", endedAt: null },
      ] }),
    ] };
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-line]"));
    const row = box()!.querySelector('[data-strand-row="s_cx"]')!;
    expect(text(row.querySelector("[data-strand-running]"))).toBe("2 running");
    const workers = [...row.querySelectorAll<HTMLElement>("[data-strand-worker]")];
    expect(workers.map((worker) => [worker.dataset.strandWorker, worker.dataset.status, text(worker)])).toEqual([
      ["thr_w4", "running", "codexbar docsrunning"],
      ["thr_w5", "running", "codexbar buildrunning"],
      ["thr_w2", "failed", "codexbar lintfailed"],
      ["thr_w1", "done", "codexbar-fix testsfinished"],
    ]);
    // The row says what the strand is about, not its workers' names again.
    expect(text(row)).toContain("Moving the quota read to the new usage endpoint.");
    expect(text(row)).not.toContain("codexbar docs, codexbar build");
    expect(row.querySelector(".text-warning, .bg-warning, .text-destructive, .text-success")).toBeNull();
  });

  it("marks a worker waiting on you in amber on its strand's row", () => {
    state.list = { ...LIST, strands: [view("s_cx", "CodexBar quota", { state: "needs-you", detail: "Router fix needs you", workers: [{ threadId: "thr_w", title: "Router fix", status: "needs-you", endedAt: null }] })] };
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-line]"));
    const worker = box()!.querySelector<HTMLElement>('[data-strand-worker="thr_w"]')!;
    expect(text(worker)).toBe("Router fixneeds you");
    expect(worker.querySelector(".text-warning, .bg-warning")).not.toBeNull();
  });

  it("counts workers no strand holds in the line and lists them under \"In no strand\"; a failed one is \"1 failed\", and a row opens its worker", async () => {
    const now = Date.now();
    state.list = { ...LIST, strayWorkers: [
      { threadId: "thr_ask", title: "Mail sort", status: "needs-you", endedAt: null },
      { threadId: "thr_run", title: "Photo import", status: "running", endedAt: null },
      { threadId: "thr_lost", title: "Router probe", status: "failed", endedAt: now - 20 * MIN },
    ] };
    render(<StrandsBoxBanner />);
    const header = text(box());
    expect(header).toContain("4 need you");
    expect(header).toContain("2 running");
    expect(text(container.querySelector("[data-strands-failed]"))).toBe("1 failed");
    click(container.querySelector("[data-strands-failed]"));
    const stray = box()!.querySelector("[data-strands-stray]")!;
    expect(stray.getAttribute("aria-label")).toBe("In no strand");
    expect([...stray.querySelectorAll<HTMLElement>("[data-strand-worker]")].map((worker) => worker.dataset.status)).toEqual(["needs-you", "running", "failed"]);
    // Typing narrows it like the strands.
    const input = box()!.querySelector<HTMLInputElement>("[data-strand-query]")!;
    await typeInto(input, "zzz");
    expect(box()!.querySelector("[data-strands-stray]")).toBeNull();
    await typeInto(input, "router");
    click(box()!.querySelector('[data-strand-option="worker:thr_lost"]'));
    expect(state.toThread).toHaveBeenCalledWith("thr_lost");
    expect(box()!.querySelector('[data-testid="strands-menu"]')).toBeNull();
  });

  it("shows the box for stray workers alone, with no strands; none, no box", () => {
    state.list = { ...LIST, strands: [], earlier: [], strayWorkers: [{ threadId: "thr_run", title: "Photo import", status: "running", endedAt: null }] };
    render(<StrandsBoxBanner />);
    expect(text(box())).toContain("Strands");
    expect(text(box())).toContain("1 running");
    state.list = { ...LIST, strands: [], earlier: [], strayWorkers: [] };
    render(<StrandsBoxBanner />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the strand tag in each message's footer row", () => {
  const message = (turnId: string, role: "user" | "assistant") => ({ id: `m_${turnId}_${role}`, threadId: "thr_main", turnId, role, createdAt: NOW, ...(role === "user" ? { initiator: "user" as const } : {}) });
  const row = (turnId: string, role: "user" | "assistant") => (
    <div data-timeline-row-id={`${turnId}-${role}`}>
      <div data-above><StrandMarks message={message(turnId, role) as never} /></div>
      <div data-footer><StrandTag message={message(turnId, role) as never} /></div>
    </div>
  );

  it("draws the strand's name and Move to… in the footer of user and assistant messages, and nothing above them", () => {
    render(<>{row("t4", "user")}{row("t5", "user")}{row("t5", "assistant")}</>);
    expect(container.querySelectorAll("[data-strand-divider]")).toHaveLength(0);
    for (const above of container.querySelectorAll("[data-above]")) expect(above.innerHTML).toBe("");
    expect([...container.querySelectorAll("[data-footer] [data-strand-tag]")].map(text)).toEqual(["CodexBar quota", "Furnace tune-up", "Furnace tune-up"]);
    expect(container.querySelectorAll("[data-footer] [data-strand-move]")).toHaveLength(3);
    expect(container.querySelector("[data-strand-move]")!.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("filters to the strand on click, and clears on a second click", () => {
    render(row("t4", "user"));
    const tag = container.querySelector<HTMLButtonElement>('[data-strand-tag="s_cx"]')!;
    click(tag);
    expect(selectionOf("thr_main")?.strandId).toBe("s_cx");
    expect(tag.getAttribute("aria-pressed")).toBe("true");
    click(tag);
    expect(selectionOf("thr_main")).toBeNull();
  });

  it("dims the other strands' messages while one is picked, only where BB's timeline can't hide them", () => {
    render(<>{row("t4", "user")}{row("t3", "user")}{row("t5", "user")}</>);
    act(() => select("thr_main", { strandId: "s_cx", seq: null }));
    const dimmed = [...container.querySelectorAll("[data-timeline-row-id]")].map((element) => element.hasAttribute("data-studio-strand-dim"));
    expect(dimmed).toEqual([false, true, true]);
    act(() => select("thr_main", null));
    expect(container.querySelectorAll("[data-studio-strand-dim]")).toHaveLength(0);
    registerTimelineFilter({ experimental_timelineFilter: () => {} });
    act(() => select("thr_main", { strandId: "s_cx", seq: null }));
    expect(container.querySelectorAll("[data-studio-strand-dim]")).toHaveLength(0);
  });
});

describe("replies that need you, marked in place (design: Replies that need you, round 3 option a)", () => {
  // The Custom Highlight API and range geometry, which jsdom lacks.
  class FakeHighlight { ranges = new Set<Range>(); add(range: Range) { this.ranges.add(range); } delete(range: Range) { this.ranges.delete(range); } }
  const highlights = new Map<string, FakeHighlight>();
  beforeEach(() => {
    highlights.clear();
    resetAskMarksForTests();
    vi.stubGlobal("Highlight", FakeHighlight);
    (globalThis.CSS as unknown as { highlights?: unknown }) = Object.assign(globalThis.CSS ?? {}, { highlights });
    (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = () => [{ left: 10, right: 300, top: 40, bottom: 58, width: 290, height: 18 } as DOMRect];
  });
  const marked = (name = "studio-reply-ask") => [...(highlights.get(name)?.ranges ?? [])].map((range) => range.toString());
  const msg = (id: string, turnId: string, createdAt: number) => ({ id, threadId: "thr_main", turnId, role: "assistant" as const, createdAt });
  const row = (key: string, id: string, turnId: string, createdAt: number, text: string) => (
    <div key={key} data-timeline-row-id={key}>
      <div aria-label="Message metadata"><StrandMarks message={msg(id, turnId, createdAt) as never} /></div>
      <p>{text}</p>
    </div>
  );
  const replies: Tags["replies"] = [
    { turnId: "t5", seq: 22, tag: "needs-you", ask: "Want me to book Ace for Saturday 9 AM?", resolved: false },
    { turnId: "t4", seq: 18, tag: "status", ask: null, resolved: false },
    { turnId: "t6", seq: 26, tag: "needs-you", ask: "Should I merge it?", resolved: true },
  ];

  it("highlights only the asking sentence of the turn's newest message; nothing is added above it, and status replies look as they are", () => {
    state.tags = { ...TAGS, replies };
    render(<>
      {row("a", "m5a", "t5", NOW - 2_000, "Looking at the slots now.")}
      {row("b", "m5b", "t5", NOW - 1_000, "Ace has Saturday 9 AM open. Want me to book Ace for Saturday 9 AM? I'll confirm by email.")}
      {row("c", "m4", "t4", NOW - 5_000, "Freed 18 GB.")}
      {row("d", "m6", "t6", NOW, "Merged. Should I merge it?")}
    </>);
    expect(marked()).toEqual(["Want me to book Ace for Saturday 9 AM?"]);
    expect(container.querySelector("[data-reply-needs-you]")).toBeNull();
    expect(container.textContent).not.toContain("Needs you");
    expect(container.querySelectorAll("[data-studio-reply-status]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-reply-done-mark]")).toHaveLength(1);
  });

  it("marks the last paragraph when Jev named no sentence", () => {
    state.tags = { ...TAGS, replies: [{ turnId: "t5", seq: 22, tag: "needs-you", ask: null, resolved: false }] };
    render(row("a", "m5", "t5", NOW, "Ace has Saturday 9 AM open; it needs your account."));
    expect(marked()).toEqual(["Ace has Saturday 9 AM open; it needs your account."]);
  });

  it("marks nothing when the named sentence isn't there, and the reply's own one when it was quoted earlier", () => {
    state.tags = { ...TAGS, replies };
    render(row("b", "m5b", "t5", NOW, "Ace has Saturday 9 AM open; it needs your account."));
    expect(marked()).toEqual([]);
    render(<div data-timeline-row-id="q">
      <div aria-label="Message metadata"><StrandMarks message={msg("m5q", "t5", NOW) as never} /></div>
      <p>You asked: Want me to book Ace for Saturday 9 AM?</p>
      <p>Two slots are open. Want me to book Ace for Saturday 9 AM?</p>
    </div>);
    const ranges = [...(highlights.get("studio-reply-ask")?.ranges ?? [])];
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.startContainer.textContent).toBe("Two slots are open. Want me to book Ace for Saturday 9 AM?");
  });

  it("Done shows on hover or keyboard focus of the sentence, and marks the reply done", async () => {
    state.tags = { ...TAGS, replies };
    render(row("b", "m5b", "t5", NOW, "Ace has Saturday 9 AM open. Want me to book Ace for Saturday 9 AM?"));
    const done = container.querySelector<HTMLButtonElement>("[data-reply-done-mark]")!;
    expect(done.getAttribute("aria-label")).toBe("Done: this reply no longer needs you");
    expect(done.hasAttribute("data-shown")).toBe(false);
    act(() => { container.querySelector("[data-timeline-row-id]")!.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 50, bubbles: true })); });
    expect(done.hasAttribute("data-shown")).toBe(true);
    act(() => { container.querySelector("[data-timeline-row-id]")!.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 200, bubbles: true })); });
    expect(done.hasAttribute("data-shown")).toBe(false);
    act(() => { done.focus(); });
    expect(done.hasAttribute("data-shown")).toBe(true);
    state.call.mockResolvedValueOnce({ ok: true });
    await act(async () => { done.click(); });
    expect(state.call).toHaveBeenCalledWith("strands.resolveReply", { threadId: "thr_main", seq: 22 });
  });

  it("Jump to reply flashes the marked sentence", () => {
    vi.useFakeTimers();
    try {
      state.tags = { ...TAGS, replies };
      render(row("b", "m5b", "t5", NOW, "Ace has Saturday 9 AM open. Want me to book Ace for Saturday 9 AM?"));
      act(() => flashReply("thr_main", 22));
      act(() => { vi.advanceTimersByTime(350); });
      expect(marked("studio-reply-ask-flash")).toEqual(["Want me to book Ace for Saturday 9 AM?"]);
      act(() => { vi.advanceTimersByTime(1_300); });
      expect(marked("studio-reply-ask-flash")).toEqual([]);
      expect(marked()).toEqual(["Want me to book Ace for Saturday 9 AM?"]);
    } finally { vi.useRealTimers(); }
  });

  it("lists the reply in the box under Needs you; Jump to reply opens it and asks for the flash, Done marks it done", async () => {
    const ask = { id: "reply:22", kind: "reply" as const, threadId: "thr_main", label: "Want me to book Ace for Saturday 9 AM?", details: [], decisions: [], turnId: "t5", seq: 22 };
    state.list = { ...LIST, strands: [view("s_hvac", "Furnace tune-up", { state: "needs-you", asks: [ask], latestSeq: 30 }), ...LIST.strands.filter((strand) => strand.id !== "s_hvac" && strand.state !== "needs-you")] };
    render(<StrandsBoxBanner />);
    expect(text(box2())).toContain("1 need you");
    click(box2()!.querySelector("[data-strands-needs]"));
    const boxRow = box2()!.querySelector('[data-strand-row="s_hvac"]')!;
    expect(text(boxRow)).toContain("Want me to book Ace for Saturday 9 AM?");
    state.call.mockResolvedValueOnce({ ok: true });
    await act(async () => { (boxRow.querySelector("[data-reply-done]") as HTMLElement).click(); });
    expect(state.call).toHaveBeenCalledWith("strands.resolveReply", { threadId: "thr_main", seq: 22 });
    click(boxRow.querySelector("[data-reply-jump]"));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=22", { replace: true });
    expect(takeFlash("thr_main", 22)).toBe(true);
    expect(container.querySelector('[data-testid="strands-menu"]')).toBeNull();
    click(box2()!.querySelector("[data-strands-needs]"));
    click(box2()!.querySelector('[data-strand-option="s_hvac"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=22", { replace: true });
  });
});

describe("the filter keeps what waits for an answer, and gives the scroll back", () => {
  it("keeps the turn of a pending ask from another strand in the filter, its tag saying where it is from", () => {
    registerTimelineFilter({ experimental_timelineFilter: () => {} });
    render(<StrandsBoxBanner />);
    click(container.querySelector("[data-strands-line]"));
    click(box2()!.querySelector('[data-strand-option="s_cx"]'));
    // s_doc's approval waits in turn t5: it stays in view under the CodexBar filter.
    expect(timelineFilterOf("thr_main")!.turnIds).toEqual(["t1", "t2", "t4", "t6", "t5"]);
    act(() => root.render(<>
      <div data-timeline-row-id="t5"><StrandTag message={{ id: "m5", threadId: "thr_main", turnId: "t5", role: "assistant", createdAt: NOW } as never} /></div>
      <div data-timeline-row-id="t4"><StrandTag message={{ id: "m4", threadId: "thr_main", turnId: "t4", role: "assistant", createdAt: NOW } as never} /></div>
    </>));
    expect(text(container.querySelector('[data-strand-tag="s_hvac"]'))).toBe("from Furnace tune-up");
    expect(text(container.querySelector('[data-strand-tag="s_cx"]'))).toBe("CodexBar quota");
  });

  it("puts the first row in view back at the same place when the filter clears", () => {
    vi.useFakeTimers();
    try {
      const scroller = document.createElement("div");
      scroller.style.overflowY = "auto";
      const rows = ["r1", "r2", "r3"].map((id) => { const row = document.createElement("div"); row.setAttribute("data-timeline-row-id", id); scroller.appendChild(row); return row; });
      document.body.appendChild(scroller);
      let scrollTop = 400;
      Object.defineProperty(scroller, "scrollTop", { get: () => scrollTop, set: (value: number) => { scrollTop = value; }, configurable: true });
      const rect = (top: number, height = 100) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      scroller.getBoundingClientRect = () => rect(0, 600);
      // r2 is the first row in view, 30px below the top.
      rows[0]!.getBoundingClientRect = () => rect(-130 - (scrollTop - 400));
      rows[1]!.getBoundingClientRect = () => rect(30 - (scrollTop - 400));
      rows[2]!.getBoundingClientRect = () => rect(130 - (scrollTop - 400));
      select("thr_main", { strandId: "s_cx", seq: 40 });
      // Filtering scrolls elsewhere, and 200px of older rows load above.
      scrollTop = 1900;
      rows[1]!.getBoundingClientRect = () => rect(30 + 200 - (scrollTop - 400));
      select("thr_main", null);
      vi.advanceTimersByTime(900);
      expect(rows[1]!.getBoundingClientRect().top).toBe(30);
      expect(scrollTop).toBe(600);
      scroller.remove();
    } finally { vi.useRealTimers(); }
  });
});

describe("Move to… in a message's footer", () => {
  const message = { id: "m_t4", threadId: "thr_main", turnId: "t4", role: "user" as const, initiator: "user" as const, createdAt: NOW };

  it("moves the message's turn to another strand, or starts a new strand from it", async () => {
    render(<div data-timeline-row-id="t4"><StrandTag message={message as never} /></div>);
    click(container.querySelector("[data-strand-move]"));
    const menu = container.querySelector('[data-testid="strand-move-menu"]')!;
    const options = [...menu.querySelectorAll<HTMLButtonElement>("[data-strand-option]")];
    expect(options.map((option) => option.getAttribute("data-strand-option"))).toEqual([...TAGS.strands.map((strand) => strand.id), "new"]);
    // Its own strand is checked and can't be picked.
    expect(options.find((option) => option.getAttribute("data-strand-option") === "s_cx")!.disabled).toBe(true);
    state.call.mockResolvedValue({ ok: true });
    await act(async () => { options.find((option) => option.getAttribute("data-strand-option") === "s_red4")!.click(); });
    expect(state.call).toHaveBeenCalledWith("strands.move", { threadId: "thr_main", seq: 16, strandId: "s_red4" });
    // Undo, for 10 seconds.
    const [toastText, toastOptions] = state.toast.mock.calls.at(-1)!;
    expect(toastText).toBe("Moved to red4 mitigation");
    expect(toastOptions).toMatchObject({ duration: 10_000, action: { label: "Undo" } });
    await act(async () => { toastOptions!.action!.onClick(); });
    expect(state.call).toHaveBeenCalledWith("strands.unmove", { threadId: "thr_main", seq: 16 });
    click(container.querySelector("[data-strand-move]"));
    await act(async () => { (container.querySelector('[data-strand-option="new"]') as HTMLElement).click(); });
    expect(state.call).toHaveBeenCalledWith("strands.split", { threadId: "thr_main", seq: 16 });
  });
});

describe("the Strands tab's row menu", () => {
  it("renames inline, pins, and merges into another strand after a confirm, with Undo", async () => {
    state.call.mockResolvedValue({ ok: true });
    render(<StrandsTab threadId="thr_main" environment={null} params={null} />);
    const row = () => container.querySelector('[data-strand-row="s_cx"]')!;
    const item = (label: string) => [...row().querySelectorAll("button")].find((button) => text(button) === label) as HTMLElement;
    click(item("Rename…"));
    const input = row().querySelector<HTMLInputElement>("[data-strand-rename]")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Quota fix");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(state.call).toHaveBeenCalledWith("strands.rename", { strandId: "s_cx", title: "Quota fix" });
    await act(async () => { item("Pin").click(); });
    expect(state.call).toHaveBeenCalledWith("strands.pin", { strandId: "s_cx", pinned: true });
    await act(async () => { item("red4 mitigation").click(); });
    // Nothing merges until confirmed.
    expect(state.call).not.toHaveBeenCalledWith("strands.merge", expect.anything());
    const confirm = row().querySelector("[data-strand-merge-confirm]")!;
    expect(text(confirm)).toContain("Merge “CodexBar quota” into “red4 mitigation”?");
    click([...confirm.querySelectorAll("button")].find((button) => text(button) === "Cancel"));
    expect(row().querySelector("[data-strand-merge-confirm]")).toBeNull();
    await act(async () => { item("red4 mitigation").click(); });
    await act(async () => { ([...row().querySelectorAll("[data-strand-merge-confirm] button")].find((button) => text(button) === "Merge") as HTMLElement).click(); });
    expect(state.call).toHaveBeenCalledWith("strands.merge", { strandId: "s_cx", into: "s_red4" });
    const [message, options] = state.toast.mock.calls.at(-1)!;
    expect(message).toBe("Merged into red4 mitigation");
    expect(options).toMatchObject({ duration: 10_000, action: { label: "Undo" } });
    await act(async () => { options!.action!.onClick(); });
    expect(state.call).toHaveBeenCalledWith("strands.unmerge", { strandId: "s_cx" });
    // The menu's clicks don't select the row.
    expect(state.toAppPath).not.toHaveBeenCalled();
  });
});

describe("the Strands tab", () => {
  it("lists a strand's finished and failed workers on its card", () => {
    state.list = { ...LIST, strands: [view("s_cx", "CodexBar quota", { state: "done-unseen", workers: [
      { threadId: "thr_w1", title: "codexbar-fix tests", status: "done", endedAt: NOW - 10 * MIN },
      { threadId: "thr_w2", title: "codexbar lint", status: "failed", endedAt: NOW - 30 * MIN },
    ] })] };
    render(<StrandsTab threadId="thr_main" environment={null} params={null} now={NOW} />);
    const items = [...container.querySelectorAll('[data-strand-row="s_cx"] [aria-label="Workers"] li')].map(text);
    expect(items).toEqual(["codexbar-fix testsfinished", "codexbar lintfailed"]);
  });

  it("shows each strand as a card: name, summary, state, messages, first and last activity, workers, and its ask; a card filters", () => {
    render(<StrandsTab threadId="thr_main" environment={null} params={null} now={NOW} />);
    const groups = [...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
    expect(groups).toEqual(["Needs you", "Running", "Waiting on someone else", "Quiet", "Earlier"]);
    const cx = container.querySelector('[data-strand-row="s_cx"]')!;
    expect(cx.tagName).toBe("LI");
    expect(text(cx)).toContain("Moving the quota read to the new usage endpoint.");
    expect(text(cx.querySelector("[data-strand-facts]"))).toBe("Running4 messagesfirst 3h ago · last 10m ago");
    expect(text(cx.querySelector('[aria-label="Workers"]'))).toBe("codexbar-fix testsrunning");
    expect(text(container.querySelector('[data-strand-row="s_red4"] [data-strand-facts]'))).toContain("Waiting on Unraid's fix");
    expect(text(container.querySelector('[data-strand-row="s_macos"] [data-strand-facts]'))).toContain("Quiet · 2 days");
    const needs = container.querySelector('[data-strand-row="s_doc"]');
    expect([...needs!.querySelectorAll("[data-strand-ask-buttons] button")].map(text)).toEqual(["Approve", "Deny"]);
    expect(container.querySelector('[data-strand-row="s_old"]')).toBeNull();
    click([...container.querySelectorAll("button")].find((button) => text(button).startsWith("Earlier")));
    expect(container.querySelector('[data-strand-row="s_old"]')).not.toBeNull();
    click(cx);
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=40", { replace: true });
    expect(timelineFilterOf("thr_main")?.turnIds).toEqual(["t1", "t2", "t4", "t6", "t5"]);
  });
});

describe("one box above the composer: what Studio hides of BB's stack, thread by thread", () => {
  const Segments = ({ threadId }: { threadId: string }) => <p data-testid="bb-context-row">{threadId}</p>;
  const withFork = () => vi.stubGlobal("__bbPluginRuntime", { pluginSdkApp: { experimental_ThreadContextSegments: Segments } });

  it("hides BB's running children where the strands box shows, and the context row where strands run (drawn in Info instead)", () => {
    withFork();
    render(<StrandsBoxBanner />);
    expect(promptStackSource.get("thr_main")).toEqual(["active-child-threads", "thread-context"]);
    expect(promptStackSource.get("thr_plain")).toEqual([]);
    // Strands run but nothing is open: no box, so BB's children stay; the context row still lives in Info.
    state.list = { ...LIST, strands: [view("q", "Quiet one", { state: "quiet" })] };
    render(<StrandsBoxBanner />);
    expect(promptStackSource.get("thr_main")).toEqual(["thread-context"]);
    // A thread strands don't run in (a plain BB thread, a worker, a finished conversation): BB keeps both.
    state.list = { ...LIST, enabled: false, strands: [], earlier: [] };
    render(<StrandsBoxBanner />);
    expect(promptStackSource.get("thr_main")).toEqual([]);
    // Gone with the box.
    state.list = LIST;
    render(<StrandsBoxBanner />);
    act(() => root.unmount());
    expect(promptStackSource.get("thr_main")).toEqual([]);
    root = createRoot(container);
  });

  it("on a BB without the context row component, never hides the row (it stays above the composer)", () => {
    render(<StrandsBoxBanner />);
    expect(promptStackSource.get("thr_main")).toEqual(["active-child-threads"]);
  });

  it("draws BB's context row in a strands conversation's Info tab; nothing in other threads or on an older BB", () => {
    render(<ContextInfoSection threadId="thr_main" projectId="proj" environment={null} />);
    expect(container.innerHTML).toBe("");
    withFork();
    render(<ContextInfoSection threadId="thr_main" projectId="proj" environment={null} />);
    expect(container.querySelector('section[aria-label="Context"] [data-testid="bb-context-row"]')?.textContent).toBe("thr_main");
    state.list = { ...LIST, enabled: false, strands: [], earlier: [] };
    render(<ContextInfoSection threadId="thr_main" projectId="proj" environment={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("error states with Retry", () => {
  it("renders a Retry button on a StrandsTab error that invokes refresh()", () => {
    state.list = null as never;
    state.error = "Studio is starting";

    render(<StrandsTab threadId="thr_main" environment={null} params={null} />);
    const tabRetry = [...container.querySelectorAll("button")].find((b) => b.textContent === "Retry");
    expect(tabRetry).toBeTruthy();
    expect(container.textContent).toContain("Studio is starting");
    act(() => { tabRetry!.click(); });
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });
});
