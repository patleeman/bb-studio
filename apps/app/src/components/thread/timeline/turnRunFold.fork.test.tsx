// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import type {
  ExperimentalTimelineFilter,
  ExperimentalTimelineFold,
} from "@get-bb/plugin-sdk";
import { buildTimelineViewRows } from "@bb/thread-view";
import {
  commandRow,
  conversationRow,
} from "@/test/fixtures/thread-timeline-rows";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { timelineFoldsOf } from "@/lib/fork-timeline-filter";
import { TimelineFilterExpandContext } from "@/lib/fork-timeline-filter";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { foldTurnRuns } from "./turnRunFold.fork";
import { collectSearchedMessageAncestorRowIds } from "./useScrollToSearchedMessage";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

let seq = 0;
/** One turn: its message (the user's, or another thread's notice), a command, and its reply. */
function turn(
  key: string,
  message: string | null,
  initiator: "user" | "agent",
  reply: string,
): TimelineRow[] {
  const turnId = `turn_${key}`;
  seq += 10;
  return [
    ...(message === null
      ? []
      : [
          conversationRow({
            id: `${key}_message`,
            role: "user",
            initiator,
            text: message,
            sourceSeqStart: seq,
            sourceSeqEnd: seq,
            threadId: "thr_main",
            turnId,
          }),
        ]),
    commandRow({
      id: `${key}_command`,
      command: "ls",
      exitCode: 0,
      sourceSeqStart: seq + 1,
      sourceSeqEnd: seq + 2,
      threadId: "thr_main",
      turnId,
    }),
    conversationRow({
      id: `${key}_reply`,
      role: "assistant",
      text: reply,
      sourceSeqStart: seq + 3,
      sourceSeqEnd: seq + 3,
      threadId: "thr_main",
      turnId,
    }),
  ];
}

function day(): TimelineRow[] {
  return [
    ...turn("a", "take both, please", "user", "Started two workers."),
    ...turn(
      "b",
      "[bb message from thread:thr_w1] codexbar: found it",
      "agent",
      "The worker found the old endpoint.",
    ),
    ...turn(
      "c",
      "[bb message from thread:thr_w2] router: tests running",
      "agent",
      "Tests are running.",
    ),
    ...turn(
      "d",
      "[bb message from thread:thr_w1] codexbar: done",
      "agent",
      "The CodexBar fix is in.",
    ),
    ...turn("e", "merge it", "user", "Merged."),
  ];
}

const FOLD: ExperimentalTimelineFold = {
  id: "run_a",
  turnIds: ["turn_a", "turn_b", "turn_c", "turn_d"],
  label: "4 updates · last: The CodexBar fix is in.",
};

describe("foldTurnRuns", () => {
  it("draws a run as one line where its first row was, and keeps the message the user typed", () => {
    const rows = buildTimelineViewRows(day());
    const fold = foldTurnRuns(rows, [FOLD]);
    expect(fold.rows.map((row) => row.id)).toEqual([
      "a_message",
      "a_reply",
      "e_message",
      "e_command",
      "e_reply",
    ]);
    expect(fold.markers.get("a_reply")).toEqual({
      foldId: "run_a",
      threadId: "thr_main",
      label: FOLD.label,
    });
  });

  it("keeps another turn's reply inside the run's span, and changes nothing with no folds", () => {
    const rows = buildTimelineViewRows(day());
    const fold = foldTurnRuns(rows, [
      { ...FOLD, turnIds: ["turn_b", "turn_d"] },
    ]);
    expect(fold.rows.map((row) => row.id)).toEqual([
      "a_message",
      "a_command",
      "a_reply",
      "b_message",
      "c_message",
      "c_command",
      "c_reply",
      "e_message",
      "e_command",
      "e_reply",
    ]);
    expect([...fold.markers.keys()]).toEqual(["b_message"]);
    expect(foldTurnRuns(rows, []).rows).toBe(rows);
  });

  it("keeps the rows the caller keeps (an error, an alert) in view", () => {
    const rows = buildTimelineViewRows(day());
    const kept = new Set(["c_command", "c_message"]);
    const fold = foldTurnRuns(rows, [FOLD], { kept: (row) => kept.has(row.id) });
    expect(fold.rows.map((row) => row.id)).toEqual([
      "a_message",
      "a_reply",
      "c_message",
      "c_command",
      "e_message",
      "e_command",
      "e_reply",
    ]);
  });

  it("ends a run at a message the user typed, even when the plugin's run goes on", () => {
    const rows = buildTimelineViewRows(day());
    const fold = foldTurnRuns(rows, [
      { ...FOLD, turnIds: ["turn_b", "turn_c", "turn_e"] },
    ]);
    expect(fold.rows.map((row) => row.id)).toEqual([
      "a_message",
      "a_command",
      "a_reply",
      "b_message",
      "d_message",
      "d_command",
      "d_reply",
      "e_message",
      "e_command",
      "e_reply",
    ]);
  });

  it("never hides another turn's rows, even when a member turn's late row comes after them", () => {
    const rows = buildTimelineViewRows([
      ...day().slice(0, 9),
      conversationRow({
        id: "x_reply",
        role: "assistant",
        text: "Approve the deploy?",
        sourceSeqStart: 5_000,
        sourceSeqEnd: 5_000,
        threadId: "thr_main",
        turnId: "turn_x",
      }),
      commandRow({
        id: "b_late",
        command: "late",
        exitCode: 0,
        sourceSeqStart: 5_002,
        sourceSeqEnd: 5_003,
        threadId: "thr_main",
        turnId: "turn_b",
      }),
    ]);
    const fold = foldTurnRuns(rows, [{ ...FOLD, turnIds: ["turn_a", "turn_b", "turn_c"] }]);
    expect(fold.rows.map((row) => row.id)).toEqual(["a_message", "a_reply", "x_reply"]);
  });

  it("never draws the line on a quiet reply", () => {
    const rows = buildTimelineViewRows(day());
    const fold = foldTurnRuns(rows, [FOLD], { isQuiet: (row) => row.id === "a_reply" });
    expect([...fold.markers.keys()]).toEqual(["b_message"]);
    expect(fold.rows.map((row) => row.id)).toContain("b_message");
  });

  it("leaves open the fold that holds the linked row, and says so", () => {
    const rows = buildTimelineViewRows(day());
    const target = rows.find((row) => row.id === "c_reply")!;
    const ids = collectSearchedMessageAncestorRowIds(rows, target.sourceSeqStart, "message");
    expect([...ids]).toEqual(["c_reply"]);
    const fold = foldTurnRuns(rows, [FOLD], { targetRowIds: ids });
    expect(fold.rows).toBe(rows);
    expect(fold.opened).toEqual(["run_a"]);
    expect(foldTurnRuns(rows, [FOLD], { targetRowIds: new Set(["e_reply"]) }).opened).toEqual([]);
  });

  it("asks the plugin for the line when it folds fewer turns than the run has", () => {
    const rows = buildTimelineViewRows(day());
    const labelFor = vi.fn((turns: readonly string[]) => `${turns.length} updates · last: ${turns.at(-1)}`);
    const short = foldTurnRuns(rows, [{ ...FOLD, turnIds: ["turn_b", "turn_c", "turn_e"], labelFor }]);
    expect(labelFor).toHaveBeenCalledWith(["turn_b", "turn_c"]);
    expect(short.markers.get("b_message")?.label).toBe("2 updates · last: turn_c");
    labelFor.mockClear();
    expect(foldTurnRuns(rows, [{ ...FOLD, labelFor }]).markers.get("a_reply")?.label).toBe(FOLD.label);
    expect(labelFor).not.toHaveBeenCalled();
    const broken = foldTurnRuns(rows, [{ ...FOLD, turnIds: ["turn_b", "turn_c", "turn_e"], labelFor: () => { throw new Error("no"); } }]);
    expect(broken.markers.get("b_message")?.label).toBe(FOLD.label);
  });
});

function foldingStore(
  folds: readonly ExperimentalTimelineFold[] | null,
  filter: ExperimentalTimelineFilter | null = null,
) {
  const listeners = new Set<() => void>();
  const expandFold = vi.fn();
  return {
    expandFold,
    registration: {
      id: "strands",
      get: () => filter,
      folds: (threadId: string) => (threadId === "thr_main" ? folds : null),
      expandFold,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

function renderRows(rows: TimelineRow[], expanded = false, at = "/threads/thr_main") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[at]}>
        <TimelineFilterExpandContext.Provider value={expanded}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={rows}
            threadRuntimeDisplayStatus="idle"
          />
        </TimelineFilterExpandContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a plugin's folded runs in the timeline", () => {
  it("shows one line for the run; clicking it asks the plugin to open it", () => {
    const store = foldingStore([FOLD]);
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({ timelineFilters: [store.registration] }),
    );
    const { container } = renderRows(day());
    const line = container.querySelector<HTMLButtonElement>(
      '[data-turn-run-fold="run_a"]',
    );
    expect(line?.textContent).toBe(FOLD.label);
    expect(container.textContent).not.toContain("Tests are running.");
    expect(container.textContent).toContain("take both, please");
    expect(container.textContent).toContain("Merged.");
    act(() => {
      fireEvent.click(line!);
    });
    expect(store.expandFold).toHaveBeenCalledWith("thr_main", "run_a");
  });

  it("opens the run a message link points into, and tells the plugin", () => {
    const store = foldingStore([FOLD]);
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({ timelineFilters: [store.registration] }),
    );
    const rows = day();
    const target = rows.find((row) => row.id === "c_reply")!;
    const { container } = renderRows(rows, false, `/threads/thr_main#msg=${target.sourceSeqStart}`);
    expect(container.querySelector("[data-turn-run-fold]")).toBeNull();
    expect(container.querySelector('[data-timeline-row-id="c_reply"]')).not.toBeNull();
    expect(store.expandFold).toHaveBeenCalledWith("thr_main", "run_a");
  });

  it("leaves the runs alone for a link into another thread", () => {
    const store = foldingStore([FOLD]);
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({ timelineFilters: [store.registration] }),
    );
    const rows = day();
    const target = rows.find((row) => row.id === "c_reply")!;
    const { container } = renderRows(rows, false, `/threads/thr_other#msg=${target.sourceSeqStart}`);
    expect(container.querySelector('[data-turn-run-fold="run_a"]')).not.toBeNull();
    expect(store.expandFold).not.toHaveBeenCalled();
  });

  it("folds nothing while a timeline filter opens everything", () => {
    const store = foldingStore([FOLD]);
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({ timelineFilters: [store.registration] }),
    );
    const { container } = renderRows(day(), true);
    expect(container.querySelector("[data-turn-run-fold]")).toBeNull();
    expect(container.textContent).toContain("Tests are running.");
  });

  it("reads folds from the first registration that has any, and ignores malformed ones", () => {
    const empty = foldingStore(null);
    const broken = {
      ...foldingStore([{ id: 1 } as unknown as ExperimentalTimelineFold])
        .registration,
      id: "broken",
    };
    const good = foldingStore([FOLD]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      timelineFoldsOf(
        [
          { ...empty.registration, pluginId: "a", generation: 0 },
          { ...broken, pluginId: "b", generation: 0 },
          { ...good.registration, pluginId: "c", generation: 0 },
        ] as never,
        "thr_main",
      ),
    ).toEqual([FOLD]);
    warn.mockRestore();
  });
});
