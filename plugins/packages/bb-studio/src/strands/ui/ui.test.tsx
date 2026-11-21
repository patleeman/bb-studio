// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrandList, StrandView } from "../contract";
import { ageOf, countsOf, currentOf, decisionButtons, groupsOf, hasOpen, seqsOf, stepSeq, tagOf, type Tags } from "./model";

const NOW = Date.parse("2026-11-20T14:20:00Z");
const MIN = 60_000;

const view = (id: string, title: string, over: Partial<StrandView> = {}): StrandView => ({
  id, title, summary: null, named: true, state: "active", detail: null, asks: [], workers: [], lastAt: NOW - 10 * MIN,
  latestSeq: 10, latestTurnId: `t_${id}`, messages: 1, unsure: 0, pinned: false, origin: "jev", taskId: null, ...over,
});
const approval = (id: string, label: string) => ({ id, kind: "approval" as const, threadId: "thr_main", label, details: ["Command: npm publish --tag latest --access public --otp-from-env", "Cwd: /tmp/release"], decisions: ["deny", "allow_once"] as ("deny" | "allow_once")[] });
const LIST: StrandList = {
  threadId: "thr_main", enabled: true, backfill: { done: true, at: NOW - 60 * MIN, messages: 300, sorted: 300 }, jevCallsToday: 12, jevDailyCap: 300, sortingTurn: false,
  strands: [
    view("s_doc", "Blood pressure log", { state: "needs-you", asks: [approval("int_1", "Approve: npm publish")] }),
    view("s_pr", "bb-plugins PR #15", { state: "needs-you", asks: [{ id: "int_2", kind: "question", threadId: "thr_worker", label: "PR fix: Which branch?", details: [], decisions: [] }] }),
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
  overview: null as unknown,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toThread: state.toThread, experimental_toAppPath: state.toAppPath }),
  experimental_useAppPanel: () => ({ openTab: state.openTab }),
}));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "strands.list" ? state.list : method === "strands.tags" ? state.tags : method === "strands.overview" ? state.overview : null, error: null, loading: false, refresh: vi.fn() }),
  useCall: () => state.call,
}));
vi.mock("../../kit/ui/index", async () => ({ ...(await import("../../loops/ui/test-kit")).kitUi, Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock("../../kit/app/route", () => ({ usePathname: () => "/threads/thr_main" }));
vi.mock("../../kit/composer", () => ({ useComposerThread: () => state.composerThread }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: { strandsOverview: true } }) }));
vi.mock("../../kit/app/index", () => ({ PageColumn: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../ui/conversations/bot-thread-owners", () => ({ useIsBotThread: () => true }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { StrandsLineBanner } = await import("./Strip");
const { StrandsOverview } = await import("./Overview");
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

describe("the strands line above a conversation's composer", () => {
  const Banners = () => <StrandsLineBanner />;
  const line = () => container.querySelector('[data-testid="strands-strip"]');

  it("shows where strands run, and takes no space when nothing is open or strands don't run there", () => {
    render(<Banners />);
    expect(line()).not.toBeNull();
    state.list = { ...LIST, strands: [view("q", "Quiet one", { state: "quiet" })] };
    render(<Banners />);
    expect(container.innerHTML).toBe("");
    state.list = { ...LIST, enabled: false, strands: [], earlier: [] };
    render(<Banners />);
    expect(container.innerHTML).toBe("");
  });

  it("is one line of text: the current strand, then counts, amber only for need you; no pills, no ask rows", () => {
    render(<Banners />);
    expect(text(line())).toBe("◆CodexBar quota3 need you·1 running·1 waiting·1 quiet");
    expect(container.querySelectorAll("[data-strand-chip], [data-strand-ask], .rounded-full.border")).toHaveLength(0);
    expect([...container.querySelectorAll(".text-warning, .bg-warning")].every((element) => element.closest("[data-strands-needs]"))).toBe(true);
    expect(container.querySelector('[data-testid="strands-menu"]')).toBeNull();
  });

  it("opens a compact list: one line per strand, an ask with its buttons inline, All strands", () => {
    render(<Banners />);
    click(container.querySelector("[data-strands-line]"));
    const rows = [...container.querySelectorAll("[data-strand-row]")];
    expect(rows.map((row) => row.getAttribute("data-strand-row"))).toEqual(["s_doc", "s_pr", "s_hvac", "s_cx", "s_red4", "s_macos"]);
    expect(text(rows[0])).toContain("Approve: npm publish");
    // The whole command and its folder, before the buttons, never cut.
    expect(text(rows[0])).toContain("Command: npm publish --tag latest --access public --otp-from-env");
    expect(text(rows[0])).toContain("Cwd: /tmp/release");
    expect([...rows[0]!.querySelectorAll("button")].map(text).slice(1)).toEqual(["Approve", "Deny"]);
    expect([...rows[1]!.querySelectorAll("button")].map(text).slice(1)).toEqual(["Open"]);
    expect(text(rows[5])).toContain("2 days");
    click([...container.querySelectorAll("button")].find((button) => text(button) === "All strands"));
    expect(state.openTab).toHaveBeenCalledWith(expect.objectContaining({ tab: expect.objectContaining({ id: "strands" }), title: "Strands" }));
  });

  it("moves through the list with the arrow keys", () => {
    render(<Banners />);
    click(container.querySelector("[data-strands-line]"));
    const options = [...container.querySelectorAll<HTMLElement>("[data-strand-option]")];
    options[0]!.focus();
    const key = (name: string) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
    key("ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    key("End");
    expect(document.activeElement?.getAttribute("data-strand-option")).toBe("all");
    key("Home");
    expect(document.activeElement).toBe(options[0]);
  });

  it("approves from the list through BB's own resolution", async () => {
    render(<Banners />);
    click(container.querySelector("[data-strands-needs]"));
    const approve = [...container.querySelectorAll('[data-strand-row="s_doc"] button')].find((button) => text(button) === "Approve");
    await act(async () => { (approve as HTMLElement).click(); });
    expect(state.call).toHaveBeenCalledWith("bot_worker_approval_resolve", { threadId: "thr_main", interactionId: "int_1", decision: "allow_once" });
  });

  it("picking a strand selects it: opens its newest message, marks it seen, and the line steps through it", () => {
    render(<Banners />);
    click(container.querySelector("[data-strands-line]"));
    click(container.querySelector('[data-strand-option="s_cx"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=40", { replace: true });
    expect(state.call).toHaveBeenCalledWith("strands.opened", { strandId: "s_cx" });
    expect(container.querySelector('[data-testid="strands-menu"]')).toBeNull();
    expect(text(line())).toContain("CodexBar quota· 4 messages");
    const showOnly = [...line()!.querySelectorAll("button")].find((button) => text(button) === "Show only this") as HTMLButtonElement;
    expect(showOnly.disabled).toBe(true);
    click(line()!.querySelector('[aria-label="Previous message in this strand"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=24", { replace: true });
    click(line()!.querySelector('[aria-label="Previous message in this strand"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=16", { replace: true });
    // Picking it again from the list keeps it selected.
    click(container.querySelector("[data-strands-line]"));
    click(container.querySelector('[data-strand-option="s_cx"]'));
    expect(line()!.querySelector("[data-strand-selection]")).not.toBeNull();
    click(line()!.querySelector('[aria-label="Clear"]'));
    expect(line()!.querySelector("[data-strand-selection]")).toBeNull();
  });
});

describe("the tag above each message", () => {
  const message = (turnId: string, role: "user" | "assistant") => ({ id: `m_${turnId}_${role}`, threadId: "thr_main", turnId, role, createdAt: NOW, ...(role === "user" ? { initiator: "user" as const } : {}) });
  const row = (turnId: string, role: "user" | "assistant") => <div data-timeline-row-id={`${turnId}-${role}`}><StrandTag message={message(turnId, role) as never} /></div>;

  it("draws a divider with the strand's name where the strand changes, and the muted name otherwise", () => {
    render(<>{row("t4", "user")}{row("t5", "user")}{row("t5", "assistant")}</>);
    expect(container.querySelectorAll("[data-strand-divider]")).toHaveLength(1);
    expect(text(container.querySelector('[data-strand-divider="s_hvac"] button'))).toBe("Furnace tune-up");
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

describe("Move to… on a message's tag", () => {
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
    click(container.querySelector("[data-strand-move]"));
    await act(async () => { (container.querySelector('[data-strand-option="new"]') as HTMLElement).click(); });
    expect(state.call).toHaveBeenCalledWith("strands.split", { threadId: "thr_main", seq: 16 });
  });
});

describe("the Strands tab's row menu", () => {
  it("renames inline, pins, and merges into another strand", async () => {
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
    expect(state.call).toHaveBeenCalledWith("strands.merge", { strandId: "s_cx", into: "s_red4" });
    // The menu's clicks don't select the row.
    expect(state.toAppPath).not.toHaveBeenCalled();
  });
});

describe("the strands overview", () => {
  it("shows each conversation with up to 2 asks, then chips; a chip opens the conversation at that strand", () => {
    state.overview = {
      needs: 3, running: 1,
      conversations: [
        { threadId: "thr_main", title: "Main", isMain: true, lastActiveAt: NOW, strands: LIST.strands },
        { threadId: "thr_studio", title: "BB Studio", isMain: false, lastActiveAt: NOW, strands: [view("s_ws", "Workspace fix", { state: "running", latestSeq: 7 })] },
      ],
    };
    render(<StrandsOverview botId="bot_1" now={NOW} />);
    expect(text(container.querySelector("h1"))).toBe("Strands3 need you · 1 running");
    expect(container.querySelectorAll("[data-overview-conversation]")).toHaveLength(2);
    const main = container.querySelector('[data-overview-conversation="thr_main"]')!;
    expect(main.querySelectorAll("[data-strand-ask]")).toHaveLength(2);
    expect(text(main)).toContain("1 more need you");
    expect(text(main)).toContain("Command: npm publish --tag latest --access public --otp-from-env");
    expect([...main.querySelectorAll("[data-strand-chip]")].map((chip) => chip.getAttribute("data-strand-chip"))).toEqual(["s_cx", "s_red4", "s_macos"]);
    click(container.querySelector('[data-overview-conversation="thr_studio"] [data-strand-chip="s_ws"]'));
    expect(state.toAppPath.mock.calls.at(-1)?.[0]).toBe("/threads/thr_studio#msg=7");
    click([...container.querySelectorAll('[data-overview-conversation="thr_studio"] button')].find((button) => text(button).startsWith("Open")));
    expect(state.toThread).toHaveBeenCalledWith("thr_studio");
  });
});

describe("the Strands tab", () => {
  it("lists strands by state, needs you first with its buttons, and folds Earlier", () => {
    render(<StrandsTab threadId="thr_main" environment={null} params={null} />);
    const groups = [...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
    expect(groups).toEqual(["Needs you", "Running", "Waiting on someone else", "Quiet", "Earlier"]);
    const needs = container.querySelector('[data-strand-row="s_doc"]');
    expect([...needs!.querySelectorAll("[data-strand-ask-buttons] button")].map(text)).toEqual(["Approve", "Deny"]);
    expect(container.querySelector('[data-strand-row="s_old"]')).toBeNull();
    click([...container.querySelectorAll("button")].find((button) => text(button).startsWith("Earlier")));
    expect(container.querySelector('[data-strand-row="s_old"]')).not.toBeNull();
    click(container.querySelector('[data-strand-row="s_red4"]'));
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=10", { replace: true });
  });
});
