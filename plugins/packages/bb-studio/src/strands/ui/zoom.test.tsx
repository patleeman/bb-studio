// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrandList, StrandView } from "../contract";
import type { Tags } from "./model";
import { GAP_MS, lineAt, timeRange, WHOLE, zoomLines, type ZoomLine } from "./zoom-model";

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
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { ZoomSwitch, ZoomView, canZoom, zoomThreadBy } = await import("./Zoom");
const { registerTimelineFilter, resetSelectionForTests, setZoom, zoomOf } = await import("./selection");
const { StrandsBoxFor } = await import("./Strip");

let root: Root, container: HTMLDivElement;
const scrolled: Element[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { list: LIST, tags: DAY });
  state.toAppPath.mockClear();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); resetSelectionForTests(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(() => root.render(node));
const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click(); });

/** BB with the zoom seam: the registration it got, and the zoom host around the timeline. */
function zoomingHost() {
  const registered: { zoom?: { level(threadId: string): number; View: unknown } }[] = [];
  registerTimelineFilter({ experimental_timelineFilter: (registration: never) => registered.push(registration) }, ZoomView);
  return registered[0]!;
}

describe("the zoomed-out view BB draws in the timeline's place", () => {
  it("hands BB its level and view, only where BB zooms", () => {
    const registration = zoomingHost();
    expect(registration.zoom?.View).toBe(ZoomView);
    expect(registration.zoom?.level("thr_main")).toBe(0);
    setZoom("thr_main", 1);
    expect(registration.zoom?.level("thr_main")).toBe(1);
    setZoom("thr_main", 5);
    expect(zoomOf("thr_main")).toBe(1);
    const older: { zoom?: unknown }[] = [];
    resetSelectionForTests();
    registerTimelineFilter({ experimental_timelineFilter: (registration: never) => older.push(registration) });
    expect(older[0]!.zoom).toBeUndefined();
  });

  it("draws one line per stretch, centres the line of the message that was in the middle, and zooms in where a line is clicked", () => {
    zoomingHost();
    setZoom("thr_main", 1);
    render(<ZoomView threadId="thr_main" level={1} anchorSeq={47} />);
    const rows = [...container.querySelectorAll("[data-zoom-line]")];
    expect(rows).toHaveLength(7);
    expect(container.textContent).toContain("4 hours later");
    expect(scrolled.map((element) => (element as HTMLElement).dataset.zoomKey)).toEqual(["30"]);
    const open = container.querySelector('[data-zoom-mark="open"]');
    expect(open?.textContent).toContain("It needs your go-ahead.");
    click(rows[2]);
    expect(zoomOf("thr_main")).toBe(0);
    expect(state.toAppPath).toHaveBeenCalledWith("/threads/thr_main#msg=45", { replace: true });
  });
});

describe("the header's switch, gestures and keys", () => {
  it("shows Messages · Strands · Tree (Tree not yet) and N need you where BB zooms; the strands box goes", () => {
    render(<ZoomSwitch threadId="thr_main" />);
    expect(container.querySelector("[data-zoom-switch]")).toBeNull();
    zoomingHost();
    render(<><ZoomSwitch threadId="thr_main" /><StrandsBoxFor threadId="thr_main" /></>);
    expect(container.querySelector('[data-testid="strands-strip"]')).toBeNull();
    const levels = [...container.querySelectorAll<HTMLButtonElement>("[data-zoom-level]")];
    expect(levels.map((button) => [button.textContent, button.disabled])).toEqual([["Messages", false], ["Strands", false], ["Tree", true]]);
    expect(levels[0]!.getAttribute("title")).toContain("⌥⌘−");
    click(levels[1]);
    expect(zoomOf("thr_main")).toBe(1);
    expect(levels[1]!.getAttribute("aria-pressed")).toBe("true");
    const needs = container.querySelector("[data-zoom-needs]");
    expect(needs?.textContent).toBe("1 need you");
    click(needs);
    expect(zoomOf("thr_main")).toBe(0);
    expect(state.toAppPath).toHaveBeenLastCalledWith("/threads/thr_main#msg=85", { replace: true });
  });

  it("zooms by command and by pinch over the conversation", () => {
    zoomingHost();
    const host = document.createElement("div");
    host.dataset.timelineZoomThread = "thr_main";
    const row = document.createElement("p");
    host.appendChild(row);
    document.body.appendChild(host);
    render(<ZoomSwitch threadId="thr_main" />);
    expect(canZoom("thr_main")).toBe(true);
    expect(canZoom("thr_other")).toBe(false);
    act(() => { zoomThreadBy("thr_main", 1); });
    expect(zoomOf("thr_main")).toBe(1);
    act(() => { zoomThreadBy("thr_main", -1); });
    expect(zoomOf("thr_main")).toBe(0);
    const pinch = (deltaY: number, timeStamp: number) => {
      const event = new WheelEvent("wheel", { deltaY, ctrlKey: true, bubbles: true, cancelable: true });
      Object.defineProperty(event, "timeStamp", { value: timeStamp });
      act(() => { row.dispatchEvent(event); });
      return event;
    };
    expect(pinch(30, 1_000).defaultPrevented).toBe(true);
    expect(zoomOf("thr_main")).toBe(0);
    pinch(40, 1_050);
    expect(zoomOf("thr_main")).toBe(1);
    pinch(80, 1_100);
    expect(zoomOf("thr_main")).toBe(1);
    const plain = new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true });
    act(() => { row.dispatchEvent(plain); });
    expect(plain.defaultPrevented).toBe(false);
    host.remove();
  });
});
