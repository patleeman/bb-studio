// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrandList, StrandView } from "../contract";
import type { Tags } from "./model";
import { clip, GAP_MS, lineAt, nodeAt, stepNode, timeRange, treeMatches, WHOLE, zoomLines, zoomTree, type ZoomLine } from "./zoom-model";

const T0 = Date.parse("2026-11-21T11:33:00Z");
const MIN = 60_000;

type Turn = { key: string; strand: string | null; kind?: "user" | "report"; line?: string; minutes: number };
type Reply = { key: string; tag: "status" | "needs-you"; ask?: string; resolved?: boolean; line?: string };
function tags(turns: Turn[], replies: Reply[] = [], done: string[] = []): Tags {
  const seqOf = (key: string) => (turns.findIndex((turn) => turn.key === key) + 1) * 10;
  return {
    tags: turns.map((turn) => ({ turnId: turn.key, seq: seqOf(turn.key), strandId: turn.strand, kind: turn.kind ?? "user", at: T0 + turn.minutes * MIN, line: turn.line ?? `${turn.key} message` })),
    strands: [{ id: "ios", title: "iOS rebuild" }, { id: "cx", title: "Context cuts" }, { id: "rn", title: "Replies that need you" }].map((strand) => ({ ...strand, done: done.includes(strand.id) })),
    replies: replies.map((reply) => ({ turnId: reply.key, seq: seqOf(reply.key) + 5, tag: reply.tag, ask: reply.ask ?? null, resolved: reply.resolved ?? false, line: reply.line ?? `${reply.key} reply` })),
  };
}

const DAY = tags(
  [
    { key: "a", strand: null, minutes: 0, line: "There is still a separate threads list" },
    { key: "b", strand: "ios", minutes: 3, line: "Is the iOS app a mess? Rebuild?" },
    { key: "c", strand: "cx", minutes: 12 },
    { key: "d", strand: "cx", kind: "report", minutes: 18 },
    { key: "e", strand: "cx", minutes: 25, line: "Add the merges" },
    { key: "f", strand: "rn", minutes: 30 },
    { key: "g", strand: "cx", kind: "report", minutes: 40 },
    { key: "h", strand: "ios", kind: "report", minutes: 280 },
    { key: "i", strand: "rn", kind: "report", minutes: 290 },
  ],
  [
    { key: "c", tag: "status", line: "A worker is measuring first" },
    { key: "d", tag: "needs-you", ask: "Pick one of two layouts", resolved: true },
    { key: "g", tag: "status", line: "Merged and pushed" },
    { key: "h", tag: "needs-you", ask: "It needs your go-ahead." },
    { key: "i", tag: "status", line: "Merged" },
  ],
  ["rn", "cx"],
);

const lines = (rows: ReturnType<typeof zoomLines>) => rows.filter((row): row is ZoomLine => row.kind === "line");

describe("level 1: one line per stretch of one strand (7b)", () => {
  it("draws each stretch with its glyph, count, key moment and time, with a gap for a long pause", () => {
    const rows = zoomLines(DAY);
    expect(rows.map((row) => row.kind === "gap" ? `gap ${row.hours}h` : `${row.glyph} ${row.name} ${row.count}`)).toEqual([
      `trunk ${WHOLE} 1`,
      "fork iOS rebuild 1",
      "fork Context cuts 3",
      "fork Replies that need you 1",
      "end Context cuts 1",
      "gap 4h",
      "cont iOS rebuild 1",
      "end Replies that need you 1",
    ]);
    const [, ios, cuts, , cutsEnd, , iosOpen] = rows as ZoomLine[];
    expect(ios).toMatchObject({ moment: "Is the iOS app a mess? Rebuild?", go: 20, mark: null });
    // An answered ask beats the user's own message and a status line.
    expect(cuts).toMatchObject({ moment: "Pick one of two layouts", go: 45, mark: "ask", seqs: [30, 40, 50] });
    expect(cutsEnd).toMatchObject({ moment: "Merged and pushed", go: 75 });
    // The open ask: amber, and its strand is the current one.
    expect(iosOpen).toMatchObject({ moment: "It needs your go-ahead.", go: 85, mark: "open", current: true });
    expect(lines(rows).filter((line) => line.current).map((line) => line.key)).toEqual([20, 80]);
    expect(GAP_MS).toBe(2 * 60 * MIN);
  });

  it("finds the line a message falls in, and writes the time range", () => {
    const rows = zoomLines(DAY);
    expect(lineAt(rows, 47)?.key).toBe(30);
    expect(lineAt(rows, 85)?.key).toBe(80);
    expect(lineAt(rows, 1)?.key).toBe(10);
    expect(lineAt(rows, null)).toBeNull();
    const format = (at: number) => `${(at - T0) / MIN}m`;
    expect(timeRange(T0, T0 + 5 * MIN, format)).toBe("0m–5m");
    expect(timeRange(T0, T0, format)).toBe("0m");
    expect(timeRange(null, null, format)).toBe("");
    expect(zoomLines(null)).toEqual([]);
  });
});

describe("level 2: the tree on one time axis (7c)", () => {
  it("draws a lane per strand from the trunk, nodes only for your messages, asks and results, and a gap for a long pause", () => {
    const tree = zoomTree(DAY);
    expect(tree.columns).toBe(4);
    expect(tree.lanes.map((lane) => [lane.name, lane.column, lane.parentColumn, lane.endY !== null, lane.current])).toEqual([
      ["iOS rebuild", 1, 0, false, true],
      ["Context cuts", 2, 0, true, false],
      ["Replies that need you", 3, 0, true, false],
    ]);
    expect(tree.nodes.map((node) => [node.kind, node.column, node.name, node.label])).toEqual([
      ["dec", 0, null, "There is still a separate threads list"],
      ["dec", 1, "iOS rebuild", "Is the iOS app a mess? Rebuild?"],
      ["dec", 2, "Context cuts", "c message"],
      ["ask", 2, null, "Pick one of two layouts"],
      ["dec", 2, null, "Add the merges"],
      ["dec", 3, "Replies that need you", "f message"],
      ["res", 2, null, "Merged and pushed"],
      ["open", 1, null, "It needs your go-ahead."],
      ["res", 3, null, "Merged"],
    ]);
    expect(tree.gaps).toHaveLength(1);
    expect(tree.nodes[7]!.y).toBeGreaterThan(tree.gaps[0]!.y);
    // A done strand's column goes to a strand that starts after it ended.
    const reused = zoomTree(tags(
      [{ key: "a", strand: "cx", minutes: 0 }, { key: "b", strand: "cx", minutes: 1 }, { key: "c", strand: "rn", minutes: 2 }, { key: "d", strand: "ios", minutes: 3 }],
      [], ["cx"],
    ));
    expect(reused.lanes.map((lane) => [lane.strandId, lane.column])).toEqual([["cx", 1], ["rn", 1], ["ios", 2]]);
    expect(reused.columns).toBe(3);
    // A strand with a parent branches from the parent's lane.
    const nested = zoomTree({ ...DAY, strands: DAY.strands.map((strand) => (strand.id === "rn" ? { ...strand, parentId: "cx" } : strand)) });
    expect(nested.lanes.find((lane) => lane.strandId === "rn")?.parentColumn).toBe(2);
  });

  it("finds the node of a message and steps through the nodes with the keys", () => {
    const tree = zoomTree(DAY);
    expect(nodeAt(tree, 47)?.label).toBe("Pick one of two layouts");
    const ask = nodeAt(tree, 45)!;
    expect(stepNode(tree, ask, "down")?.label).toBe("Add the merges");
    expect(stepNode(tree, ask, "up")?.label).toBe("c message");
    expect(stepNode(tree, ask, "left")?.column).toBe(1);
    expect(stepNode(tree, ask, "right")?.column).toBe(3);
    // With a search, ↑↓ go through the matches only.
    expect(stepNode(tree, ask, "down", "merged")?.label).toBe("Merged and pushed");
    expect(stepNode(tree, null, "up")?.label).toBe("Merged");
    // The search reads the whole first line and the strand's name, once per query.
    const long = zoomTree(tags([{ key: "a", strand: "cx", minutes: 0, line: `${"x".repeat(70)} needle` }]));
    expect(long.nodes[0]!.label.endsWith("…")).toBe(true);
    expect(treeMatches(long, "needle")?.seqs.has(10)).toBe(true);
    expect(treeMatches(tree, "context cuts")?.strands.has("cx")).toBe(true);
    expect(treeMatches(tree, "  ")).toBeNull();
  });

  it("never splits an emoji when it clips, and clips a long strand name at its fork", () => {
    expect(clip("ab😀cd", 3)).toBe("ab…");
    expect(clip("😀😀😀😀", 3)).toBe("😀😀…");
    const named = zoomTree({ ...DAY, strands: DAY.strands.map((strand) => (strand.id === "ios" ? { ...strand, title: "A very long strand name that keeps going on" } : strand)) });
    expect(named.nodes[1]!.name).toBe("A very long strand name that ke…");
    expect(Array.from(named.nodes[1]!.name!)).toHaveLength(32);
  });
});

const view = (id: string, title: string, over: Partial<StrandView> = {}): StrandView => ({
  id, title, summary: null, named: true, state: "active", detail: null, asks: [], workers: [], lastAt: T0, firstAt: T0, firstSeq: 10,
  latestSeq: 80, latestTurnId: `t_${id}`, messages: 1, unsure: 0, pinned: false, origin: "jev", taskId: null, parentId: null, trunk: false, ...over,
});
const LIST: StrandList = {
  threadId: "thr_main", enabled: true, backfill: { done: true, at: T0, messages: 9, sorted: 9 }, jevCallsToday: 1, jevDailyCap: 300, sortingTurn: false,
  strands: [view("ios", "iOS rebuild", { state: "needs-you", asks: [{ id: "reply:85", kind: "reply", threadId: "thr_main", label: "It needs your go-ahead.", details: [], turnId: "h", decisions: [], seq: 85 }] }), view("cx", "Context cuts")],
  earlier: [], strayWorkers: [],
};

const state = vi.hoisted(() => ({
  list: null as StrandList | null,
  tags: null as Tags | null,
  toAppPath: vi.fn((_path: string, _options?: unknown) => true),
  toThread: vi.fn(),
  openTab: vi.fn(() => true),
}));
const { submittedComposer } = vi.hoisted(() => {
  const submitted = new Set<() => void>();
  return { submitted, submittedComposer: { scope: { kind: "thread", threadId: "thr_main" }, onSubmitted: (listener: () => void) => { submitted.add(listener); return () => { submitted.delete(listener); }; } } };
});
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useComposer: () => submittedComposer,
  useBbNavigate: () => ({ toThread: state.toThread, experimental_toAppPath: state.toAppPath }),
  experimental_useAppPanel: () => ({ openTab: vi.fn() }),
}));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "strands.list" ? state.list : method === "strands.tags" ? state.tags : null, error: null, loading: false, refresh: vi.fn() }),
  useCall: () => vi.fn(async () => ({})),
}));
vi.mock("../../kit/ui/index", async () => ({ ...(await import("../../loops/ui/test-kit")).kitUi, Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock("../../kit/app/route", () => ({ usePathname: () => "/threads/thr_main" }));
vi.mock("../../kit/composer", () => ({ useComposerThread: () => "thr_main" }));
vi.mock("../../kit/app/thread-panel", () => ({ openThreadTab: state.openTab }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { ZoomSwitch, ZoomView, canZoom, resetZoomForTests, zoomBlocked, zoomThreadBy } = await import("./Zoom");
const { holdZoomable, keyboardModeOf, registerTimelineFilter, resetSelectionForTests, select, selectionOf, setKeyboardMode, setZoom, zoomInHost, zoomOf } = await import("./selection");
const { StrandsBoxFor, useStrandFilter } = await import("./Strip");
const { promptStackSource, resetPromptStackForTests } = await import("./prompt-stack");

let root: Root, container: HTMLDivElement;
const scrolled: Element[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { list: LIST, tags: DAY });
  state.toAppPath.mockClear();
  state.openTab.mockClear();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  container = document.createElement("div");
  container.dataset.timelineZoomThread = "thr_main";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); resetZoomForTests(); resetSelectionForTests(); resetPromptStackForTests(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(() => root.render(node));
const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click(); });

type Registration = { zoom?: { level(threadId: string): number; View: unknown } };
/** BB with the zoom seam: it takes the registration and answers that it zooms. */
function zoomingHost(): Registration {
  const registered: Registration[] = [];
  registerTimelineFilter({ experimental_timelineFilter: (registration: never) => { registered.push(registration); return { folds: true, zoom: true }; } }, ZoomView);
  return registered[0]!;
}
/** Today's desktop: it takes the registration, drops `zoom`, and answers nothing. */
function droppingHost(): Registration {
  const registered: Registration[] = [];
  registerTimelineFilter({ experimental_timelineFilter: (registration: never) => { registered.push(registration); } }, ZoomView);
  return registered[0]!;
}

describe("the zoomed-out view BB draws in the timeline's place", () => {
  it("hands BB its level and view; the level is 0 unless the conversation's strands run", () => {
    const registration = zoomingHost();
    expect(zoomInHost()).toBe(true);
    expect(registration.zoom?.View).toBe(ZoomView);
    setZoom("thr_main", 1);
    // No header has shown the switch (strands off, or not drawn yet): BB keeps the messages.
    expect(registration.zoom?.level("thr_main")).toBe(0);
    const release = holdZoomable("thr_main");
    const second = holdZoomable("thr_main");
    expect(registration.zoom?.level("thr_main")).toBe(1);
    release();
    expect(registration.zoom?.level("thr_main")).toBe(1);
    second();
    expect(registration.zoom?.level("thr_main")).toBe(0);
    setZoom("thr_main", 5);
    expect(zoomOf("thr_main")).toBe(2);
  });

  it("on a BB that drops zoom: the controls show disabled with why, and the box stays with BB's running children hidden behind it", () => {
    droppingHost();
    expect(zoomInHost()).toBe(false);
    render(<><ZoomSwitch threadId="thr_main" /><StrandsBoxFor threadId="thr_main" /></>);
    const controls = container.querySelector<HTMLElement>("[data-zoom-switch]")!;
    expect(controls.dataset.zoomBlocked).toContain("update the app");
    const levels = [...container.querySelectorAll<HTMLButtonElement>("[data-zoom-level]")];
    expect(levels.every((button) => button.disabled)).toBe(true);
    expect(levels[1]!.title).toContain("update the app");
    expect(container.querySelector("[data-zoom-strands-tab]")).toBeNull();
    expect(container.querySelector('[data-testid="strands-strip"]')).not.toBeNull();
    expect(promptStackSource.get("thr_main")).toContain("active-child-threads");
  });

  it("says why a conversation can't zoom: strands off (a Bot's conversation only), nothing sorted yet", () => {
    zoomingHost();
    expect(zoomBlocked(null, true, true)).toBeNull();
    expect(zoomBlocked({ ...LIST, enabled: false }, true, false)).toBeNull();
    expect(zoomBlocked({ ...LIST, enabled: false }, true, true)).toContain("strands are off");
    expect(zoomBlocked({ ...LIST, strands: [], earlier: [] }, true, true)).toContain("no messages are sorted");
    expect(zoomBlocked(LIST, true, false)).toBe("");
    state.list = { ...LIST, enabled: false };
    render(<ZoomSwitch threadId="thr_main" botConversation />);
    expect(container.querySelector<HTMLElement>("[data-zoom-switch]")?.dataset.zoomBlocked).toContain("strands are off");
    render(<ZoomSwitch threadId="thr_main" />);
    expect(container.querySelector("[data-zoom-switch]")).toBeNull();
  });

  it("draws one line per stretch, centres the line of the message that was in the middle, and zooms in where a line is clicked", () => {
    zoomingHost();
    const release = holdZoomable("thr_main");
    setZoom("thr_main", 1);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={47} latestUserSeq={null} />);
    const rows = [...container.querySelectorAll("[data-zoom-line]")];
    expect(rows).toHaveLength(7);
    expect(container.textContent).toContain("4 hours later");
    expect(scrolled.map((element) => (element as HTMLElement).dataset.zoomKey)).toEqual(["30"]);
    const open = container.querySelector('[data-zoom-mark="open"]');
    expect(open?.textContent).toContain("It needs your go-ahead.");
    click(rows[2]);
    expect(zoomOf("thr_main")).toBe(0);
    expect(state.toAppPath).toHaveBeenCalledWith("/threads/thr_main#msg=45", { replace: true });
    release();
  });

  it("takes a cold open's first rows as the baseline, not as a send", () => {
    zoomingHost();
    setZoom("thr_main", 1);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={null} latestUserSeq={null} />);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={null} latestUserSeq={70} />);
    expect(zoomOf("thr_main")).toBe(1);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={null} latestUserSeq={120} />);
    expect(zoomOf("thr_main")).toBe(0);
  });

  it("goes back to the messages when the list crashes", () => {
    zoomingHost();
    setZoom("thr_main", 1);
    state.tags = { ...DAY, replies: 5 as never };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={null} latestUserSeq={null} />);
    expect(container.querySelector("[data-zoom-view]")).toBeNull();
    expect(zoomOf("thr_main")).toBe(0);
    warn.mockRestore();
    error.mockRestore();
  });

  it("goes back to the messages when the user sends", () => {
    zoomingHost();
    setZoom("thr_main", 1);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={null} latestUserSeq={70} />);
    expect(zoomOf("thr_main")).toBe(1);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={null} latestUserSeq={70} />);
    expect(zoomOf("thr_main")).toBe(1);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={null} latestUserSeq={120} />);
    expect(zoomOf("thr_main")).toBe(0);
  });
});

describe("the tree view and keyboard mode", () => {
  it("draws the tree at level 2 and zooms in to a node that is clicked", () => {
    zoomingHost();
    const release = holdZoomable("thr_main");
    setZoom("thr_main", 2);
    render(<ZoomView threadId="thr_main" level={2} anchorSeq={47} latestUserSeq={null} />);
    expect(container.querySelector('[data-zoom-view="2"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-zoom-node]")).toHaveLength(9);
    expect(scrolled.map((element) => element.getAttribute("data-zoom-node"))).toEqual(["45"]);
    expect(container.querySelector('[data-zoom-kind="open"]')?.textContent).toContain("It needs your go-ahead.");
    act(() => { container.querySelector('[data-zoom-node="20"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(zoomOf("thr_main")).toBe(0);
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=20", { replace: true });
    release();
  });

  const esc = async (target: EventTarget, timeStamp: number, handle?: (event: Event) => void) => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
    if (handle) window.addEventListener("keydown", handle, { once: true });
    await act(async () => {
      target.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it("opens on Esc Esc: the tree with the search; ↑↓ move, typing fades the rest, Enter zooms in, Esc leaves and gives focus back", async () => {
    zoomingHost();
    render(<ZoomSwitch threadId="thr_main" />);
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();
    await esc(before, 1_000);
    await esc(before, 2_000);
    expect(keyboardModeOf("thr_main")).toBe(false);
    await esc(before, 2_200);
    expect(keyboardModeOf("thr_main")).toBe(true);
    expect(zoomOf("thr_main")).toBe(2);
    const tree = document.createElement("div");
    document.body.appendChild(tree);
    const treeRoot = createRoot(tree);
    act(() => treeRoot.render(<ZoomView threadId="thr_main" level={2} anchorSeq={47} latestUserSeq={null} />));
    const input = tree.querySelector<HTMLInputElement>('[data-zoom-search] input')!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-activedescendant")).toBe("zoom-tree-thr_main-node-45");
    expect(tree.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Strand tree");
    const ask = tree.querySelector('[data-zoom-node="45"]')!;
    expect(ask.getAttribute("role")).toBe("option");
    expect(ask.getAttribute("aria-selected")).toBe("true");
    expect(ask.getAttribute("aria-label")).toContain("Asked you, ");
    expect(ask.getAttribute("aria-label")).toContain("Context cuts, Pick one of two layouts");
    const chosen = () => tree.querySelector("[data-zoom-chosen]")?.closest("[data-zoom-node]")?.getAttribute("data-zoom-node");
    expect(chosen()).toBe("45");
    const key = (target: Element, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
    key(input, "ArrowDown");
    expect(chosen()).toBe("50");
    const type = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    type("merged");
    expect(tree.querySelector('[data-zoom-lane="ios"]')?.getAttribute("opacity")).toBe("0.18");
    expect(tree.querySelector('[data-zoom-lane="cx"]')?.getAttribute("opacity")).toBe("1");
    expect(chosen()).toBe("95");
    // Nothing matches: nothing is chosen, and Enter does nothing.
    type("nothing like this");
    expect(chosen()).toBeUndefined();
    key(input, "Enter");
    expect(zoomOf("thr_main")).toBe(2);
    type("");
    key(input, "Escape");
    expect(keyboardModeOf("thr_main")).toBe(false);
    expect(zoomOf("thr_main")).toBe(2);
    expect(document.activeElement).toBe(before);
    act(() => setKeyboardMode("thr_main", true));
    const again = tree.querySelector<HTMLInputElement>('[data-zoom-search] input')!;
    key(again, "ArrowUp");
    key(again, "Enter");
    expect(zoomOf("thr_main")).toBe(0);
    expect(keyboardModeOf("thr_main")).toBe(false);
    act(() => treeRoot.unmount());
    tree.remove();
    before.remove();
  });

  it("leaves keyboard mode on an Esc from anywhere, or when the search loses focus to something outside the tree", async () => {
    zoomingHost();
    render(<ZoomSwitch threadId="thr_main" />);
    const tree = document.createElement("div");
    document.body.appendChild(tree);
    const treeRoot = createRoot(tree);
    act(() => setKeyboardMode("thr_main", true));
    act(() => treeRoot.render(<ZoomView threadId="thr_main" level={2} anchorSeq={47} latestUserSeq={null} />));
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    // Focus moves to the composer, say: keyboard mode ends (the tree stays).
    act(() => elsewhere.focus());
    expect(keyboardModeOf("thr_main")).toBe(false);
    expect(zoomOf("thr_main")).toBe(2);
    act(() => setKeyboardMode("thr_main", true));
    elsewhere.blur();
    await esc(document.body, 9_000);
    expect(keyboardModeOf("thr_main")).toBe(false);
    act(() => treeRoot.unmount());
    tree.remove();
    elsewhere.remove();
  });

  it("counts only Escs nothing else handled, in the focused pane, outside other text fields", async () => {
    zoomingHost();
    // Another pane has focus: this pane's switch ignores Esc Esc.
    container.dataset.splitPaneId = "right";
    container.dataset.focused = "false";
    render(<ZoomSwitch threadId="thr_main" />);
    await esc(document.body, 1_000);
    await esc(document.body, 1_100);
    expect(keyboardModeOf("thr_main")).toBe(false);
    // A lone pane carries the id without data-focused: it counts as focused.
    delete container.dataset.focused;
    await esc(document.body, 1_500);
    await esc(document.body, 1_600);
    expect(keyboardModeOf("thr_main")).toBe(true);
    act(() => setKeyboardMode("thr_main", false));
    container.dataset.focused = "true";
    // Something on window (a lightbox closing) handled the first: it doesn't count.
    await esc(document.body, 2_000, (event) => event.preventDefault());
    await esc(document.body, 2_100);
    expect(keyboardModeOf("thr_main")).toBe(false);
    // An Esc in a settings field doesn't count either.
    const field = document.createElement("input");
    document.body.appendChild(field);
    await esc(field, 3_000);
    await esc(document.body, 3_100);
    expect(keyboardModeOf("thr_main")).toBe(false);
    field.remove();
    // The strand filter's Esc clears the filter and is handled: the next Esc starts a new pair.
    act(() => select("thr_main", { strandId: "cx", seq: 50 }));
    render(<><ZoomSwitch threadId="thr_main" /><StrandFilterProbe /></>);
    await esc(document.body, 4_000);
    expect(selectionOf("thr_main")).toBeNull();
    await esc(document.body, 4_100);
    expect(keyboardModeOf("thr_main")).toBe(false);
    await esc(document.body, 4_200);
    expect(keyboardModeOf("thr_main")).toBe(true);
    delete container.dataset.splitPaneId;
    delete container.dataset.focused;
  });

  it("counts the composer's blur-Esc as the first press, but never while a menu, popup or dictation would take the Esc, or when it changed the draft", async () => {
    zoomingHost();
    render(<ZoomSwitch threadId="thr_main" />);
    // BB's composer: its Esc is prevented and only blurs it.
    const box = document.createElement("div");
    box.setAttribute("data-promptbox-editor-content", "");
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.tabIndex = 0;
    editor.textContent = "a draft";
    box.appendChild(editor);
    document.body.appendChild(box);
    const blurs = (event: Event) => { event.preventDefault(); editor.blur(); };
    editor.addEventListener("keydown", blurs);
    editor.focus();
    await esc(editor, 1_000);
    expect(keyboardModeOf("thr_main")).toBe(false);
    await esc(document.body, 1_200);
    expect(keyboardModeOf("thr_main")).toBe(true);
    // Esc from anywhere leaves keyboard mode and gives focus back to the composer.
    await esc(document.body, 1_400);
    expect(keyboardModeOf("thr_main")).toBe(false);
    expect(document.activeElement).toBe(editor);
    // An open menu (the slash or mention menu, a popup) takes the Esc: it doesn't count.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    editor.focus();
    await esc(editor, 5_000);
    await esc(document.body, 5_200);
    expect(keyboardModeOf("thr_main")).toBe(false);
    menu.remove();
    // A running dictation takes it too.
    const cancel = document.createElement("button");
    cancel.setAttribute("aria-label", "Cancel recording");
    document.body.appendChild(cancel);
    await esc(document.body, 7_000);
    await esc(document.body, 7_200);
    expect(keyboardModeOf("thr_main")).toBe(false);
    cancel.remove();
    // An Esc that changed the draft (say, it undid something) isn't a first press.
    editor.removeEventListener("keydown", blurs);
    const edits = (event: Event) => { event.preventDefault(); editor.textContent = "a dra"; editor.blur(); };
    editor.addEventListener("keydown", edits);
    editor.focus();
    await esc(editor, 9_000);
    await esc(document.body, 9_200);
    expect(keyboardModeOf("thr_main")).toBe(false);
    box.remove();
  });

  it("clears a strand filter that hides the node it zooms in to", () => {
    zoomingHost();
    setZoom("thr_main", 2);
    act(() => select("thr_main", { strandId: "cx", seq: 50 }));
    render(<ZoomView threadId="thr_main" level={2} anchorSeq={47} latestUserSeq={null} />);
    expect(container.querySelector('[data-zoom-node="45"]')?.getAttribute("data-zoom-seqs")).toBe("45");
    act(() => { container.querySelector('[data-zoom-node="20"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(selectionOf("thr_main")).toBeNull();
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=20", { replace: true });
  });
});

/** The strand filter's Esc handler, as the header's chip mounts it. */
function StrandFilterProbe() {
  useStrandFilter("thr_main");
  return null;
}

describe("the header where BB zooms", () => {
  it("shows Messages · Strands · Tree, All strands and N need you; the box goes and BB's running children show", () => {
    render(<ZoomSwitch threadId="thr_main" />);
    // Before a BB says it zooms, the controls say why they can't.
    expect(container.querySelector<HTMLElement>("[data-zoom-switch]")?.dataset.zoomBlocked).toContain("update the app");
    zoomingHost();
    render(<><ZoomSwitch threadId="thr_main" /><StrandsBoxFor threadId="thr_main" /></>);
    expect(container.querySelector<HTMLElement>("[data-zoom-switch]")?.dataset.zoomBlocked).toBeUndefined();
    expect(container.querySelector('[data-testid="strands-strip"]')).toBeNull();
    expect(promptStackSource.get("thr_main")).not.toContain("active-child-threads");
    const levels = [...container.querySelectorAll<HTMLButtonElement>("[data-zoom-level]")];
    expect(levels.map((button) => [button.getAttribute("aria-label"), button.disabled])).toEqual([["Messages", false], ["Strands", false], ["Tree", false]]);
    // Icons, each saying what it is and its keys.
    expect(levels.every((button) => button.querySelector("svg") !== null)).toBe(true);
    expect(levels[0]!.title).toContain("⌃⌘=");
    expect(levels[1]!.title).toContain("⌃⌘−");
    expect(levels[2]!.title).toContain("Esc Esc");
    // Out of the window's drag strip, so they take clicks in the desktop app.
    expect(container.querySelector<HTMLElement>("[data-zoom-switch]")!.className).toContain("[-webkit-app-region:no-drag]");
    click(levels[1]);
    expect(zoomOf("thr_main")).toBe(1);
    expect(levels[1]!.getAttribute("aria-pressed")).toBe("true");
    click(container.querySelector("[data-zoom-strands-tab]"));
    expect(state.openTab).toHaveBeenCalledTimes(1);
    // No "N need you" button in the header: the strands box and the Strands tab show what waits.
    expect(container.querySelector("[data-zoom-needs]")).toBeNull();
  });

  it("shows the strand filter: its name, clear, count, previous and next, and Esc clears it", () => {
    zoomingHost();
    act(() => select("thr_main", { strandId: "cx", seq: 50 }));
    render(<ZoomSwitch threadId="thr_main" />);
    const chip = container.querySelector('[data-strand-filter="cx"]');
    expect(chip?.textContent).toContain("Context cuts");
    expect(chip?.getAttribute("title")).toContain("4 messages");
    click(chip?.querySelector('[aria-label="Previous message in this strand"]'));
    expect(selectionOf("thr_main")?.seq).toBe(40);
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=40", { replace: true });
    click(chip?.querySelector('[aria-label="Clear filter"]'));
    expect(selectionOf("thr_main")).toBeNull();
    act(() => select("thr_main", { strandId: "cx", seq: 50 }));
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(selectionOf("thr_main")).toBeNull();
  });

  it("zooms by command and by pinch over the conversation, leaving alone what isn't its to zoom", () => {
    zoomingHost();
    const row = document.createElement("p");
    const image = document.createElement("img");
    render(<ZoomSwitch threadId="thr_main" />);
    container.append(row, image);
    expect(canZoom("thr_main")).toBe(true);
    expect(canZoom("thr_other")).toBe(false);
    act(() => { zoomThreadBy("thr_main", 1); });
    expect(zoomOf("thr_main")).toBe(1);
    act(() => { zoomThreadBy("thr_main", -1); });
    expect(zoomOf("thr_main")).toBe(0);
    const pinch = (target: Element, deltaY: number, timeStamp: number, handled = false) => {
      const event = new WheelEvent("wheel", { deltaY, ctrlKey: true, bubbles: true, cancelable: true });
      Object.defineProperty(event, "timeStamp", { value: timeStamp });
      if (handled) target.addEventListener("wheel", (each) => each.preventDefault(), { once: true });
      act(() => { target.dispatchEvent(event); });
      return event;
    };
    // Pinching out at the messages can't zoom in further: the event is left alone.
    expect(pinch(row, -80, 500).defaultPrevented).toBe(false);
    expect(pinch(row, 30, 1_000).defaultPrevented).toBe(true);
    expect(zoomOf("thr_main")).toBe(0);
    pinch(row, 40, 1_050);
    expect(zoomOf("thr_main")).toBe(1);
    pinch(row, 80, 1_100);
    expect(zoomOf("thr_main")).toBe(1);
    // The next pinch goes on to the tree; at the furthest level, pinching in further is left alone.
    pinch(row, 80, 2_000);
    expect(zoomOf("thr_main")).toBe(2);
    expect(pinch(row, 80, 3_000).defaultPrevented).toBe(false);
    // An image zooms itself; something that handled the pinch keeps it.
    expect(pinch(image, -80, 5_000).defaultPrevented).toBe(false);
    pinch(row, -80, 7_000, true);
    expect(zoomOf("thr_main")).toBe(2);
    const plain = new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true });
    act(() => { row.dispatchEvent(plain); });
    expect(plain.defaultPrevented).toBe(false);
    expect(zoomOf("thr_main")).toBe(2);
  });
});
