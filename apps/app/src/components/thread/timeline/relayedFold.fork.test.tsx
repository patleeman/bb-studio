// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import type { ExperimentalMessageClassificationContext } from "@get-bb/plugin-sdk";
import { buildTimelineViewRows } from "@bb/thread-view";
import {
  commandRow,
  conversationRow,
  systemRow,
} from "@/test/fixtures/thread-timeline-rows";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { foldRelayedRows, isAlertRow } from "./relayedFold.fork";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

const WATCHER = "Watcher Morning card: ";

function classifyMessage(
  text: string,
  context: ExperimentalMessageClassificationContext,
) {
  if (text.startsWith(WATCHER)) {
    return { sender: "watcher Morning card", previewStart: WATCHER.length };
  }
  if (context.part !== "body") return null;
  const tag = /^LEAD[^:\n]*:\s+/u.exec(text);
  return tag ? { previewStart: tag[0].length } : null;
}

function registerStudioLike() {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      replyClassifiers: [
        {
          id: "pass",
          classify: (text) => ({ quiet: text.trim() === "[PASS]" }),
          classifyMessage,
        },
      ],
    }),
  );
}

let seq = 0;
function exchange(
  key: string,
  message: { text: string; initiator: "user" | "agent" | "system" },
  reply: string,
): TimelineRow[] {
  const turnId = `turn_${key}`;
  seq += 10;
  return [
    conversationRow({
      id: `${key}_message`,
      role: "user",
      initiator: message.initiator,
      text: message.text,
      sourceSeqStart: seq,
      sourceSeqEnd: seq,
      threadId: "thr_main",
      turnId,
    }),
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

const LEAD =
  "[bb message from thread:thr_lead]\n\nLEAD studio: desktop 1.0.4 shipped.\n\nMore detail.";

describe("foldRelayedRows", () => {
  it("folds an agent message and its quiet reply into the message's row", () => {
    registerStudioLike();
    const rows = buildTimelineViewRows(
      exchange("a", { text: LEAD, initiator: "agent" }, "[PASS]"),
    );
    const fold = foldRelayedRows(rows, null);
    expect(fold.rows.map((row) => row.id)).toEqual(["a_message"]);
    expect([...fold.folded]).toEqual(["a_message"]);
  });

  it("keeps the reply when it is real text", () => {
    registerStudioLike();
    const rows = buildTimelineViewRows(
      exchange("b", { text: LEAD, initiator: "agent" }, "Noted."),
    );
    const fold = foldRelayedRows(rows, null);
    expect(fold.rows).toBe(rows);
    expect(fold.folded.size).toBe(0);
  });

  it("never folds a message the user typed", () => {
    registerStudioLike();
    const rows = buildTimelineViewRows(
      exchange(
        "c",
        {
          text: "Why does [bb message from thread:thr_lead] show?",
          initiator: "user",
        },
        "[PASS]",
      ),
    );
    expect(foldRelayedRows(rows, null).folded.size).toBe(0);
  });

  it("folds a Studio line only when a plugin calls it relayed", () => {
    const rows = buildTimelineViewRows(
      exchange(
        "d",
        { text: `${WATCHER}Write today's card.`, initiator: "user" },
        "[PASS]",
      ),
    );
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        replyClassifiers: [
          { id: "pass", classify: (text) => ({ quiet: text === "[PASS]" }) },
        ],
      }),
    );
    expect(foldRelayedRows(rows, null).folded.size).toBe(0);
    registerStudioLike();
    expect([...foldRelayedRows(rows, null).folded]).toEqual(["d_message"]);
  });

  it("does not fold while the reply is still streaming", () => {
    registerStudioLike();
    const rows = buildTimelineViewRows(
      exchange("e", { text: LEAD, initiator: "agent" }, "[PASS]"),
    );
    expect(foldRelayedRows(rows, "e_reply").folded.size).toBe(0);
  });
});

function renderRows(rows: TimelineRow[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowText(container: HTMLElement, id: string): string {
  return (
    container.querySelector(`[data-timeline-row-id="${id}"]`)?.textContent ?? ""
  );
}

describe("relayed rows in the thread view", () => {
  it("draws a relayed message with a quiet reply as one row, without the header or the tag", () => {
    registerStudioLike();
    const { container } = renderRows(
      exchange("f", { text: LEAD, initiator: "agent" }, "[PASS]"),
    );
    const text = container.textContent ?? "";
    expect(rowText(container, "f_message")).toContain("Message from");
    expect(rowText(container, "f_message")).toContain("desktop 1.0.4 shipped.");
    expect(text).not.toContain("[bb message from");
    expect(text).not.toContain("LEAD studio");
    expect(text).not.toContain("Quiet check");
    expect(text).not.toContain("[PASS]");
    expect(
      container.querySelector('[data-timeline-row-id="f_reply"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-timeline-row-id="f_command"]'),
    ).toBeNull();
  });

  it("draws a relayed message, then a real reply as usual", () => {
    registerStudioLike();
    const { container } = renderRows(
      exchange("g", { text: LEAD, initiator: "agent" }, "Noted, thanks."),
    );
    expect(rowText(container, "g_message")).toContain("Message from");
    expect(rowText(container, "g_reply")).toContain("Noted, thanks.");
  });

  it("draws a Studio line as a system row from its sender", () => {
    registerStudioLike();
    const { container } = renderRows(
      exchange(
        "h",
        { text: `${WATCHER}Write today's card.`, initiator: "user" },
        "Here is today's card.",
      ),
    );
    const row = rowText(container, "h_message");
    expect(row).toContain("Message from");
    expect(row).toContain("watcher Morning card");
    expect(row).toContain("Write today's card.");
    expect(row).not.toContain(WATCHER);
  });

  it("leaves a typed message as the user's own message, and its quiet reply as a Quiet check", () => {
    registerStudioLike();
    const { container } = renderRows(
      exchange("i", { text: "Status?", initiator: "user" }, "[PASS]"),
    );
    expect(rowText(container, "i_message")).toContain("Status?");
    expect(rowText(container, "i_message")).not.toContain("Message from");
    expect(container.textContent).toContain("Quiet check");
  });
});

describe("folds never hide failures", () => {
  function alertExchange(
    key: string,
    systemMessageKind: "child-failed" | "child-needs-attention" | "child-interrupted",
  ): TimelineRow[] {
    const rows = exchange(key, { text: "[bb system] Worker stopped.", initiator: "system" }, "[PASS]");
    const [message, ...rest] = rows;
    return [{ ...message!, systemMessageKind } as TimelineRow, ...rest];
  }

  it.each(["child-failed", "child-needs-attention", "child-interrupted"] as const)(
    "never folds a %s notice, so it keeps its own icon",
    (kind) => {
      registerStudioLike();
      const rows = buildTimelineViewRows(alertExchange(`alert_${kind}`, kind));
      expect(isAlertRow(rows[0]!)).toBe(true);
      const fold = foldRelayedRows(rows, null);
      expect(fold.folded.size).toBe(0);
      expect(fold.rows).toBe(rows);
    },
  );

  it("never folds an urgent relay (⚠️), with or without a header", () => {
    registerStudioLike();
    for (const text of [
      "[bb message from thread:thr_runner]\n\n⚠️ From runner House: the backup failed.",
      '⚠️ "Morning card" stopped again (3 times)',
      "From runner House: ⚠️ disk full",
    ]) {
      const rows = buildTimelineViewRows(exchange(`urgent_${text.length}`, { text, initiator: "agent" }, "[PASS]"));
      expect(foldRelayedRows(rows, null).folded.size).toBe(0);
    }
  });

  it("keeps error and reconnect rows and failed steps visible inside a fold", () => {
    registerStudioLike();
    const [message, command, reply] = exchange("k", { text: LEAD, initiator: "agent" }, "[PASS]");
    const turnId = "turn_k";
    const rows = buildTimelineViewRows([
      message!,
      command!,
      systemRow({ id: "k_error", systemKind: "error", title: "Tool call failed", status: "error", turnId, threadId: "thr_main", sourceSeqStart: 5001, sourceSeqEnd: 5001 }),
      systemRow({ id: "k_reconnect", systemKind: "reconnect", title: "Reconnecting", status: "completed", turnId, threadId: "thr_main", sourceSeqStart: 5002, sourceSeqEnd: 5002 }),
      commandRow({ id: "k_failed", command: "false", exitCode: 1, status: "error", sourceSeqStart: 5003, sourceSeqEnd: 5004, threadId: "thr_main", turnId }),
      reply!,
    ] as TimelineRow[]);
    const fold = foldRelayedRows(rows, null);
    const ids = fold.rows.map((row) => row.id);
    expect([...fold.folded]).toEqual(["k_message"]);
    expect(ids).toContain("k_error");
    expect(ids).toContain("k_reconnect");
    expect(ids).not.toContain("k_reply");
    expect(ids).not.toContain("k_command");
    expect(ids).toContain("k_failed");
  });
});

