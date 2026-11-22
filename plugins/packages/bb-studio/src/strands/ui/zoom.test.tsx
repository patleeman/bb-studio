// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrandList, StrandView } from "../contract";
import type { Tags } from "./model";
import { GAP_MS, lineAt, nodeAt, stepNode, timeRange, WHOLE, zoomLines, zoomTree, type ZoomLine } from "./zoom-model";

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
  });
});

const view = (id: string, title: string, over: Partial<StrandView> = {}): StrandView => ({
  id, title, summary: null, named: true, state: "active", detail: null, asks: [], workers: [], lastAt: T0, firstAt: T0, firstSeq: 10,
  latestSeq: 80, latestTurnId: `t_${id}`, messages: 1, unsure: 0, pinned: false, origin: "jev", taskId: null, ...over,
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
vi.mock("@get-bb/plugin-sdk/app", () => ({
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

const { ZoomSwitch, ZoomView, canZoom, zoomThreadBy } = await import("./Zoom");
const { holdZoomable, keyboardModeOf, registerTimelineFilter, resetSelectionForTests, select, selectionOf, setKeyboardMode, setZoom, zoomInHost, zoomOf } = await import("./selection");
const { StrandsBoxFor } = await import("./Strip");
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
afterEach(() => { act(() => root.unmount()); container.remove(); resetSelectionForTests(); resetPromptStackForTests(); vi.unstubAllGlobals(); });
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

  it("on a BB that drops zoom: no switch, and the box stays with BB's running children hidden behind it", () => {
    droppingHost();
    expect(zoomInHost()).toBe(false);
    render(<><ZoomSwitch threadId="thr_main" /><StrandsBoxFor threadId="thr_main" /></>);
    expect(container.querySelector("[data-zoom-switch]")).toBeNull();
    expect(container.querySelector('[data-testid="strands-strip"]')).not.toBeNull();
    expect(promptStackSource.get("thr_main")).toContain("active-child-threads");
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

  it("opens on Esc Esc: the tree with the search; ↑↓ move, typing fades the rest, Enter zooms in, Esc leaves", () => {
    zoomingHost();
    render(<ZoomSwitch threadId="thr_main" />);
    const esc = (timeStamp: number) => {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      Object.defineProperty(event, "timeStamp", { value: timeStamp });
      act(() => { document.dispatchEvent(event); });
    };
    esc(1_000);
    esc(2_000);
    expect(keyboardModeOf("thr_main")).toBe(false);
    esc(2_200);
    expect(keyboardModeOf("thr_main")).toBe(true);
    expect(zoomOf("thr_main")).toBe(2);
    const tree = document.createElement("div");
    document.body.appendChild(tree);
    const treeRoot = createRoot(tree);
    act(() => treeRoot.render(<ZoomView threadId="thr_main" level={2} anchorSeq={47} latestUserSeq={null} />));
    const input = tree.querySelector<HTMLInputElement>('[data-zoom-search] input')!;
    expect(document.activeElement).toBe(input);
    const chosen = () => tree.querySelector("[data-zoom-chosen]")?.closest("[data-zoom-node]")?.getAttribute("data-zoom-node");
    expect(chosen()).toBe("45");
    const key = (name: string) => act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
    key("ArrowDown");
    expect(chosen()).toBe("50");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "merged");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(tree.querySelector('[data-zoom-lane="ios"]')?.getAttribute("opacity")).toBe("0.18");
    expect(tree.querySelector('[data-zoom-lane="cx"]')?.getAttribute("opacity")).toBe("1");
    expect(chosen()).toBe("95");
    key("Escape");
    expect(keyboardModeOf("thr_main")).toBe(false);
    expect(zoomOf("thr_main")).toBe(2);
    act(() => setKeyboardMode("thr_main", true));
    const again = tree.querySelector<HTMLInputElement>('[data-zoom-search] input')!;
    act(() => { again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(zoomOf("thr_main")).toBe(0);
    expect(keyboardModeOf("thr_main")).toBe(false);
    act(() => treeRoot.unmount());
    tree.remove();
  });
});

describe("the header where BB zooms", () => {
  it("shows Messages · Strands · Tree (Tree not yet), All strands and N need you; the box goes and BB's running children show", () => {
    render(<ZoomSwitch threadId="thr_main" />);
    expect(container.querySelector("[data-zoom-switch]")).toBeNull();
    zoomingHost();
    render(<><ZoomSwitch threadId="thr_main" /><StrandsBoxFor threadId="thr_main" /></>);
    expect(container.querySelector('[data-testid="strands-strip"]')).toBeNull();
    expect(promptStackSource.get("thr_main")).not.toContain("active-child-threads");
    const levels = [...container.querySelectorAll<HTMLButtonElement>("[data-zoom-level]")];
    expect(levels.map((button) => [button.textContent, button.disabled])).toEqual([["Messages", false], ["Strands", false], ["Tree", false]]);
    expect(levels[0]!.getAttribute("title")).toContain("⌃⌘−");
    click(levels[1]);
    expect(zoomOf("thr_main")).toBe(1);
    expect(levels[1]!.getAttribute("aria-pressed")).toBe("true");
    click(container.querySelector("[data-zoom-strands-tab]"));
    expect(state.openTab).toHaveBeenCalledTimes(1);
    const needs = container.querySelector("[data-zoom-needs]");
    expect(needs?.textContent).toBe("1 need you");
    click(needs);
    expect(zoomOf("thr_main")).toBe(0);
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=85", { replace: true });
  });

  it("shows the strand filter: its name, clear, count, previous and next, and Esc clears it", () => {
    zoomingHost();
    act(() => select("thr_main", { strandId: "cx", seq: 50 }));
    render(<ZoomSwitch threadId="thr_main" />);
    const chip = container.querySelector('[data-strand-filter="cx"]');
    expect(chip?.textContent).toContain("Context cuts");
    expect(chip?.textContent).toContain("4 messages");
    click(chip?.querySelector('[aria-label="Previous message in this strand"]'));
    expect(selectionOf("thr_main")?.seq).toBe(40);
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=40", { replace: true });
    click(chip?.querySelector('[aria-label="Clear filter"]'));
    expect(selectionOf("thr_main")).toBeNull();
    act(() => select("thr_main", { strandId: "cx", seq: 50 }));
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(selectionOf("thr_main")).toBeNull();
  });

  it("opens the Strands tab when only stray workers need the user", () => {
    zoomingHost();
    state.list = { ...LIST, strands: [view("cx", "Context cuts")], strayWorkers: [{ threadId: "thr_w", title: "router worker", status: "needs-you", endedAt: null }] };
    render(<ZoomSwitch threadId="thr_main" />);
    const needs = container.querySelector("[data-zoom-needs]");
    expect(needs?.textContent).toBe("1 need you");
    click(needs);
    expect(state.openTab).toHaveBeenCalledTimes(1);
    expect(state.toAppPath).not.toHaveBeenCalled();
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
