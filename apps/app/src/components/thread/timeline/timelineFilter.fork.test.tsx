// @vitest-environment jsdom


import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import type { ExperimentalTimelineFilter } from "@get-bb/plugin-sdk";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { useQuietReply } from "@/lib/fork-reply-classifiers";
import {
  TimelineFilterExpandContext,
  useTimelineFilterExpanded,
  useTimelineFilterExpandsRow,
} from "@/lib/fork-timeline-filter";
import {
  filterTimelineRows,
  needsOlderRows,
  withTimelineFilter,
} from "./timelineFilter.fork";
import { useRelayedFold } from "./relayedFold.fork";
import { SearchMessageLocationProvider } from "./useScrollToSearchedMessage";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

const row = (id: string, turnId: string | null, seq: number): TimelineRow =>
  ({ id, turnId, sourceSeqStart: seq, sourceSeqEnd: seq, threadId: "thr_1", kind: "conversation" }) as unknown as TimelineRow;

const ROWS = [row("a1", "t1", 10), row("sys", null, 12), row("b1", "t2", 14), row("b2", "t2", 15), row("c1", "t3", 20)];

function filterStore() {
  let filter: ExperimentalTimelineFilter | null = null;
  const listeners = new Set<() => void>();
  return {
    set(next: ExperimentalTimelineFilter | null) {
      filter = next;
      for (const listener of listeners) listener();
    },
    registration: {
      id: "strands",
      get: (threadId: string) => (threadId === "thr_1" ? filter : null),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

interface SurfaceProps {
  threadId: string;
  timelineRows: TimelineRow[];
  hasOlderTimelineRows?: boolean;
  isLoadingOlderTimelineRows?: boolean;
  onLoadOlderRows?: () => Promise<void> | void;
  isStopping?: boolean;
}

const seen: { props: SurfaceProps; expanded: boolean }[] = [];
function Probe(props: SurfaceProps) {
  seen.push({ props, expanded: useTimelineFilterExpanded() });
  return null;
}
const Surface = withTimelineFilter(Probe);
const last = () => seen.at(-1)!;

describe("the timeline filter's rules", () => {
  it("keeps the filter's turns and drops rows with no turn", () => {
    expect(filterTimelineRows(ROWS, new Set(["t2"])).map((each) => each.id)).toEqual(["b1", "b2"]);
  });

  it("needs older rows until the loaded rows reach the first message, while there are older ones", () => {
    expect(needsOlderRows(ROWS, { firstSeq: 5 }, true)).toBe(true);
    expect(needsOlderRows(ROWS, { firstSeq: 10 }, true)).toBe(false);
    expect(needsOlderRows(ROWS, { firstSeq: 5 }, false)).toBe(false);
    expect(needsOlderRows(ROWS, { firstSeq: null }, true)).toBe(false);
    expect(needsOlderRows([], { firstSeq: 5 }, true)).toBe(true);
  });
});

describe("withTimelineFilter", () => {
  it("passes everything through unchanged with no filter", () => {
    const store = filterStore();
    setPluginSlotRegistrations("studio", makePluginRegistrationSet({ timelineFilters: [store.registration] }));
    const props = { threadId: "thr_1", timelineRows: ROWS, hasOlderTimelineRows: true, isStopping: true };
    render(<Surface {...props} />);
    expect(last().props.timelineRows).toBe(ROWS);
    expect(last().props).toMatchObject({ hasOlderTimelineRows: true, isStopping: true });
    expect(last().expanded).toBe(false);
  });

  it("narrows to the filter's turns, opens everything and hides the pending stop row; clearing it brings all back", () => {
    const store = filterStore();
    setPluginSlotRegistrations("studio", makePluginRegistrationSet({ timelineFilters: [store.registration] }));
    render(<Surface threadId="thr_1" timelineRows={ROWS} hasOlderTimelineRows={false} isStopping />);
    act(() => store.set({ turnIds: ["t1", "t3"], firstSeq: 10 }));
    expect(last().props.timelineRows.map((each) => each.id)).toEqual(["a1", "c1"]);
    expect(last().props.isStopping).toBe(false);
    expect(last().expanded).toBe(true);
    act(() => store.set(null));
    expect(last().props.timelineRows).toBe(ROWS);
    expect(last().expanded).toBe(false);
  });

  it("leaves another thread alone, and survives a plugin whose get throws", () => {
    const store = filterStore();
    const broken = { id: "broken", get: () => { throw new Error("no"); }, subscribe: () => () => {} };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations("a-broken", makePluginRegistrationSet({ timelineFilters: [broken] }));
    setPluginSlotRegistrations("studio", makePluginRegistrationSet({ timelineFilters: [store.registration] }));
    store.set({ turnIds: ["t2"], firstSeq: null });
    render(<Surface threadId="thr_2" timelineRows={ROWS} />);
    expect(last().props.timelineRows).toBe(ROWS);
    render(<Surface threadId="thr_1" timelineRows={ROWS} hasOlderTimelineRows />);
    expect(last().props.timelineRows.map((each) => each.id)).toEqual(["b1", "b2"]);
    expect(last().props.hasOlderTimelineRows).toBe(true);
  });

  it("pages back one load at a time until the loaded rows reach the first message", async () => {
    const store = filterStore();
    setPluginSlotRegistrations("studio", makePluginRegistrationSet({ timelineFilters: [store.registration] }));
    store.set({ turnIds: ["t0", "t1"], firstSeq: 2 });
    let rows = ROWS;
    let resolve: () => void = () => {};
    const onLoadOlder = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const view = render(<Surface threadId="thr_1" timelineRows={rows} hasOlderTimelineRows onLoadOlderRows={onLoadOlder} />);
    await act(async () => {});
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(last().props.hasOlderTimelineRows).toBe(false);
    view.rerender(<Surface threadId="thr_1" timelineRows={rows} hasOlderTimelineRows onLoadOlderRows={onLoadOlder} />);
    await act(async () => {});
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    rows = [row("z", "t0", 6), ...rows];
    await act(async () => { resolve(); });
    view.rerender(<Surface threadId="thr_1" timelineRows={rows} hasOlderTimelineRows onLoadOlderRows={onLoadOlder} />);
    await act(async () => {});
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
    rows = [row("y", "t0", 2), ...rows];
    await act(async () => { resolve(); });
    view.rerender(<Surface threadId="thr_1" timelineRows={rows} hasOlderTimelineRows onLoadOlderRows={onLoadOlder} />);
    await act(async () => {});
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
    expect(last().props.timelineRows.map((each) => each.id)).toEqual(["y", "z", "a1"]);
  });

  it("stops when there are no older rows, or when a load brings nothing older", async () => {
    const store = filterStore();
    setPluginSlotRegistrations("studio", makePluginRegistrationSet({ timelineFilters: [store.registration] }));
    store.set({ turnIds: ["t1"], firstSeq: 1 });
    const none = vi.fn();
    render(<Surface threadId="thr_1" timelineRows={ROWS} hasOlderTimelineRows={false} onLoadOlderRows={none} />);
    await act(async () => {});
    expect(none).not.toHaveBeenCalled();
    cleanup();
    const empty = vi.fn(async () => {});
    const view = render(<Surface threadId="thr_1" timelineRows={ROWS} hasOlderTimelineRows onLoadOlderRows={empty} />);
    await act(async () => {});
    view.rerender(<Surface threadId="thr_1" timelineRows={ROWS} hasOlderTimelineRows onLoadOlderRows={empty} />);
    await act(async () => {});
    expect(empty).toHaveBeenCalledTimes(1);
  });
});

describe("what a filter opens", () => {
  const slots = () => setPluginSlotRegistrations("studio", makePluginRegistrationSet({ replyClassifiers: [{ id: "pass", classify: (text) => ({ quiet: text === "[PASS]" }) }] }));

  it("draws a quiet reply in full", () => {
    slots();
    let quiet: boolean[] = [];
    function Reply() { quiet.push(useQuietReply("[PASS]")); return null; }
    render(<Reply />);
    expect(quiet.at(-1)).toBe(true);
    quiet = [];
    render(<TimelineFilterExpandContext.Provider value><Reply /></TimelineFilterExpandContext.Provider>);
    expect(quiet.at(-1)).toBe(false);
  });

  it("opens step and command groups only", () => {
    const opened: boolean[] = [];
    function Group({ kind }: { kind: string }) { opened.push(useTimelineFilterExpandsRow({ kind })); return null; }
    render(<TimelineFilterExpandContext.Provider value><Group kind="bundle-summary" /><Group kind="step-summary" /><Group kind="work" /></TimelineFilterExpandContext.Provider>);
    expect(opened).toEqual([true, true, false]);
    render(<Group kind="bundle-summary" />);
    expect(opened.at(-1)).toBe(false);
  });

  it("unfolds the relayed fold", () => {
    slots();
    const rows = [
      { id: "m", kind: "conversation", role: "user", initiator: "agent", text: "[bb automation due:x] check", turnId: "t1" },
      { id: "r", kind: "conversation", role: "assistant", text: "[PASS]", turnId: "t1" },
    ] as never[];
    const results: { rows: readonly unknown[]; folded: number }[] = [];
    function Fold() { const fold = useRelayedFold(rows, true, () => null); results.push({ rows: fold.rows, folded: fold.folded.size + fold.folded.quiet.size }); return null; }
    const located = (children: ReactNode) => <MemoryRouter><SearchMessageLocationProvider threadId={undefined}>{children}</SearchMessageLocationProvider></MemoryRouter>;
    render(located(<Fold />));
    expect(results.at(-1)!.folded).toBeGreaterThan(0);
    render(located(<TimelineFilterExpandContext.Provider value><Fold /></TimelineFilterExpandContext.Provider>));
    expect(results.at(-1)).toEqual({ rows, folded: 0 });
  });
});
