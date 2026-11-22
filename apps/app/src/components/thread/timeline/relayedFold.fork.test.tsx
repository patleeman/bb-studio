// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
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

  it("leaves a group alone when a link points into it", () => {
    registerStudioLike();
    const rows = buildTimelineViewRows(
      exchange("a", { text: LEAD, initiator: "agent" }, "[PASS]"),
    );
    const reply = rows.at(-1)!;
    const fold = foldRelayedRows(rows, null, undefined, false, new Set([reply.id]));
    expect(fold.rows).toBe(rows);
    expect(fold.folded.size).toBe(0);
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

describe("folds after a launch or reload", () => {
  it("folds rows that loaded before Studio registered its classifier", () => {
    const rows = exchange("late", { text: LEAD, initiator: "agent" }, "[PASS]");
    const { container } = renderRows(rows);
    expect(container.querySelector('[data-timeline-row-id="late_reply"]')).not.toBeNull();
    act(() => registerStudioLike());
    expect(container.querySelector('[data-timeline-row-id="late_reply"]')).toBeNull();
    expect(container.textContent).not.toContain("Quiet check");
    expect(rowText(container, "late_message")).toContain("Message from");
  });

  it("folds with the classifiers it is given, not only the current ones", () => {
    const rows = buildTimelineViewRows(exchange("given", { text: LEAD, initiator: "agent" }, "[PASS]"));
    expect(foldRelayedRows(rows, null, []).folded.size).toBe(0);
    registerStudioLike();
    expect(foldRelayedRows(rows, null, []).folded.size).toBe(0);
    expect([...foldRelayedRows(rows, null).folded]).toEqual(["given_message"]);
  });
});

describe("two relayed lines in one turn", () => {
  function steered(): TimelineRow[] {
    const turnId = "turn_two";
    const at = (offset: number) => ({ sourceSeqStart: 9000 + offset, sourceSeqEnd: 9000 + offset, threadId: "thr_main", turnId });
    return [
      conversationRow({ id: "two_first", role: "user", initiator: "user", text: `${WATCHER}kettle-ok-09`, ...at(0) }),
      commandRow({ id: "two_command", command: "ls", exitCode: 0, ...at(1) }),
      conversationRow({ id: "two_second", role: "user", initiator: "user", text: `${WATCHER}kettle-ok-10`, ...at(2) }),
      conversationRow({ id: "two_reply_a", role: "assistant", text: "[PASS]", ...at(3) }),
      conversationRow({ id: "two_reply_b", role: "assistant", text: "[PASS]", ...at(4) }),
    ];
  }

  it("folds both lines and both quiet replies", () => {
    registerStudioLike();
    const fold = foldRelayedRows(buildTimelineViewRows(steered()), null);
    expect([...fold.folded].sort()).toEqual(["two_first", "two_second"]);
    expect(fold.rows.map((row) => row.id)).toEqual(["two_first", "two_second"]);
  });

  it("leaves no stray Quiet check", () => {
    registerStudioLike();
    const { container } = renderRows(steered());
    expect(container.textContent).not.toContain("Quiet check");
    expect(rowText(container, "two_first")).toContain("Message from");
    expect(rowText(container, "two_second")).toContain("Message from");
  });

  it("checks only the line the quiet reply answered when the turn ends in a real reply", () => {
    registerStudioLike();
    const rows = steered();
    rows[4] = conversationRow({ id: "two_reply_b", role: "assistant", text: "The kettle is fine.", sourceSeqStart: 9004, sourceSeqEnd: 9004, threadId: "thr_main", turnId: "turn_two" });
    const fold = foldRelayedRows(buildTimelineViewRows(rows), null);
    expect(fold.rows.map((row) => row.id)).toEqual(["two_first", "two_second", "two_reply_b"]);
    expect([...fold.folded]).toEqual(["two_first"]);
  });

  it("gives no check to a line whose turn ends in a real reply after a [PASS]", () => {
    registerStudioLike();
    const at = (offset: number) => ({ sourceSeqStart: 9100 + offset, sourceSeqEnd: 9100 + offset, threadId: "thr_main", turnId: "turn_one" });
    const rows = [
      conversationRow({ id: "one_line", role: "user", initiator: "user", text: `${WATCHER}kettle-ok-11`, ...at(0) }),
      conversationRow({ id: "one_pass", role: "assistant", text: "[PASS]", ...at(1) }),
      conversationRow({ id: "one_real", role: "assistant", text: "The kettle is off.", ...at(2) }),
    ];
    const fold = foldRelayedRows(buildTimelineViewRows(rows), null);
    expect(fold.folded.size).toBe(0);
    expect(fold.rows.map((row) => row.id)).toEqual(["one_line", "one_real"]);
  });

  it("waits for a streaming reply before checking the last line", () => {
    registerStudioLike();
    const rows = steered();
    rows.push(conversationRow({ id: "two_streaming", role: "assistant", text: "[PA", sourceSeqStart: 9005, sourceSeqEnd: 9005, threadId: "thr_main", turnId: "turn_two" }));
    const fold = foldRelayedRows(buildTimelineViewRows(rows), "two_streaming");
    expect([...fold.folded]).toEqual(["two_first"]);
  });
});


describe("a compaction bb ran on its own, with a reason", () => {
  const AT = 1_800_000_000_000;

  type Compaction = {
    status?: "pending" | "completed" | "error" | "interrupted";
    title?: string;
    turnId?: string;
  };

  function compactTurn(
    key: string,
    by: "system" | "user",
    compaction: Compaction | null = {},
    reason = "cache warming ended",
  ): TimelineRow[] {
    const turnId = `turn_${key}`;
    const at = (offset: number, turn = turnId) => ({
      sourceSeqStart: 7000 + offset,
      sourceSeqEnd: 7000 + offset,
      createdAt: AT + offset,
      threadId: "thr_main",
      turnId: turn,
    });
    const rows: TimelineRow[] = [
      conversationRow({
        id: `${key}_compact`,
        role: "user",
        initiator: by,
        text: "/compact",
        ...(by === "system"
          ? { systemMessageSubject: { kind: "compaction" as const, reason } }
          : {}),
        ...at(0),
      }),
    ];
    if (compaction !== null) {
      rows.push(
        systemRow({
          id: `${key}_compacted`,
          title: compaction.title ?? "Context compacted",
          operationKind: "compaction",
          status: compaction.status ?? "completed",
          ...at(1, compaction.turnId ?? turnId),
        }),
      );
    }
    return rows;
  }

  const fold = (rows: TimelineRow[]) =>
    foldRelayedRows(buildTimelineViewRows(rows), null, []);

  it("draws one quiet row with the reason: no user bubble, no Context compacted", () => {
    const { container } = renderRows(compactTurn("auto", "system"));
    const text = container.textContent ?? "";
    expect(text).toContain("Compacted · cache warming ended");
    expect(text).not.toContain("Context compacted");
    expect(text).not.toContain("/compact");
    expect(container.querySelector('[data-timeline-row-id="auto_compacted"]')).toBeNull();
    const marker = container.querySelector("[data-quiet-turn]");
    expect(marker?.getAttribute("data-quiet-turn")).toBe("done");
    const expected = new Date(AT).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    expect(marker?.getAttribute("title")).toBe(expected);
    expect(marker?.getAttribute("title")).toContain(String(new Date(AT).getFullYear()));
  });

  it("needs no plugin: it reads the reason off the row", () => {
    expect(fold(compactTurn("bare", "system")).folded.quiet.get("bare_compact")).toMatchObject({
      label: "Compacted · cache warming ended",
      state: "done",
    });
  });

  it("leaves a typed /compact as the user's own message, with its Context compacted row", () => {
    const { container } = renderRows(compactTurn("typed", "user"));
    expect(rowText(container, "typed_compact")).toContain("compact");
    expect(container.querySelector("[data-quiet-turn]")).toBeNull();
    expect(container.textContent).toContain("Context compacted");
  });

  it("says just Compacted when the reason is blank", () => {
    expect(fold(compactTurn("blank", "system", {}, " ")).folded.quiet.get("blank_compact")?.label).toBe("Compacted");
  });

  it("shows a compaction that hasn't started or is still running as running, not done", () => {
    for (const [key, compaction] of [["none", null], ["pending", { status: "pending", title: "Compacting context" }]] as const) {
      const result = fold(compactTurn(key, "system", compaction));
      expect(result.folded.quiet.get(`${key}_compact`)).toMatchObject({
        label: "Compacting… · cache warming ended",
        state: "running",
      });
      expect(result.rows.map((row) => row.id)).not.toContain(`${key}_compacted`);
    }
    const { container } = renderRows(compactTurn("spin", "system", { status: "pending", title: "Compacting context" }));
    expect(container.querySelector("[data-quiet-turn]")?.getAttribute("data-quiet-turn")).toBe("running");
    expect(container.textContent).not.toContain("Compacted ·");
  });

  it("doesn't fold a compaction that failed or was interrupted: the rows stay as they are", () => {
    for (const [status, title] of [["error", "Context compaction failed"], ["interrupted", "Context compaction interrupted"]] as const) {
      const result = fold(compactTurn(`k_${status}`, "system", { status, title }));
      expect(result.folded.quiet.size).toBe(0);
      expect(result.rows.map((row) => row.id)).toEqual([`k_${status}_compact`, `k_${status}_compacted`]);
      const { container } = renderRows(compactTurn(`r_${status}`, "system", { status, title }));
      expect(container.querySelector("[data-quiet-turn]")).toBeNull();
      expect(container.textContent).toContain(title);
      cleanup();
    }
  });

  it("says a skipped compaction was skipped, not compacted", () => {
    const result = fold(compactTurn("skip", "system", { title: "Context compaction skipped" }));
    expect(result.folded.quiet.get("skip_compact")).toMatchObject({
      label: "Compaction skipped · cache warming ended",
      state: "skipped",
    });
    expect(result.rows.map((row) => row.id)).not.toContain("skip_compacted");
  });

  it("only folds the compaction row of its own turn", () => {
    const result = fold(compactTurn("other", "system", { turnId: "turn_provider_auto" }));
    expect(result.folded.quiet.get("other_compact")?.state).toBe("running");
    expect(result.rows.map((row) => row.id)).toContain("other_compacted");
  });
});

describe("an automated input sent with a notice", () => {
  const ALERT_TEXT = "[bb studio] Watcher Kensico health: problems on red4: disk 91%";

  function noticeTurn(
    key: string,
    reply: string | null,
    options: {
      by?: "system" | "user" | "agent";
      text?: string;
      failed?: boolean;
      subject?: boolean;
      source?: string;
      label?: string;
      steer?: boolean;
    } = {},
  ): TimelineRow[] {
    const turnId = `turn_${key}`;
    const at = (offset: number) => ({
      sourceSeqStart: 8000 + offset,
      sourceSeqEnd: 8000 + offset,
      createdAt: 1_800_000_000_000 + offset,
      threadId: "thr_main",
      turnId,
    });
    const by = options.by ?? "system";
    const rows: TimelineRow[] = [
      conversationRow({
        id: `${key}_alert`,
        role: "user",
        initiator: by,
        text: options.text ?? ALERT_TEXT,
        ...(by !== "user" && options.subject !== false
          ? {
              systemMessageSubject: {
                kind: "automation" as const,
                source: options.source ?? "watcher",
                label: options.label ?? "Kensico health",
              },
            }
          : {}),
        ...(options.steer
          ? { turnRequest: { isGrouped: false, kind: "steer" as const, status: "accepted" as const } }
          : {}),
        ...at(0),
      }),
      commandRow({ id: `${key}_command`, command: "df -h", exitCode: 0, ...at(1) }),
    ];
    if (options.failed) {
      rows.push(
        systemRow({
          id: `${key}_error`,
          systemKind: "error",
          title: "Turn failed",
          status: "error",
          ...at(2),
        }),
      );
    }
    if (reply !== null) {
      rows.push(conversationRow({ id: `${key}_reply`, role: "assistant", text: reply, ...at(3) }));
    }
    return rows;
  }

  const fold = (rows: TimelineRow[], active = false) =>
    foldRelayedRows(buildTimelineViewRows(rows), null, undefined, active);

  it("folds a quiet [PASS] reply into one handled row naming its source and first line, with no user bubble", () => {
    registerStudioLike();
    const { container } = renderRows(noticeTurn("pass", "[PASS]"));
    const marker = container.querySelector("[data-quiet-turn]");
    expect(marker?.getAttribute("data-quiet-turn")).toBe("done");
    expect(marker?.textContent).toContain("Watcher Kensico health · problems on red4: disk 91% · handled");
    expect(container.textContent).not.toContain("[bb studio]");
    expect(container.textContent).not.toContain("Quiet check");
    expect(container.textContent).not.toContain("[PASS]");
    expect(container.querySelector('[data-timeline-row-id="pass_reply"]')).toBeNull();
    expect(container.querySelector('[data-timeline-row-id="pass_command"]')).toBeNull();
  });

  it("expands to the raw alert, what the Bot did and its short reply", () => {
    registerStudioLike();
    const { container } = renderRows(noticeTurn("open", "[PASS]"));
    const button = container.querySelector("[data-quiet-turn] button");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    act(() => (button as HTMLButtonElement).click());
    const details = container.querySelector("[data-quiet-turn-details]");
    expect(details?.textContent).toContain("Watcher Kensico health: problems on red4: disk 91%");
    expect(details?.textContent).not.toContain("[bb studio]");
    expect(details?.textContent).toContain("df -h");
    expect(details?.textContent).toContain("Replied: [PASS]");
  });

  it("shows a real reply as a message, with the alert as a quiet row above it", () => {
    registerStudioLike();
    const { container } = renderRows(noticeTurn("real", "red4's disk is at 91%; I cleared the cache."));
    const marker = container.querySelector("[data-quiet-turn]");
    expect(marker?.getAttribute("data-quiet-turn")).toBe("notice");
    expect(marker?.textContent).toContain("Watcher Kensico health · problems on red4: disk 91%");
    expect(marker?.textContent).not.toContain("handled");
    expect(rowText(container, "real_reply")).toContain("I cleared the cache.");
    act(() => (marker!.querySelector("button") as HTMLButtonElement).click());
    const details = container.querySelector("[data-quiet-turn-details]");
    expect(details?.textContent).toContain("problems on red4");
    expect(details?.textContent).not.toContain("Replied:");
    expect(container.querySelector('[data-timeline-row-id="real_command"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Message from");
  });

  it("draws an urgent (⚠) or critical input in full and folds nothing", () => {
    registerStudioLike();
    for (const [key, text] of [
      ["urgent", "[bb studio] ⚠️ From runner House: Backups failed twice\nCheck B2 auth."],
      ["critical", "[bb studio] Watcher Backups: CRITICAL nightly backup failed\ndisk1 at 97%"],
    ] as const) {
      const result = fold(noticeTurn(key, "[PASS]", { text }));
      expect(result.folded.quiet.get(`${key}_alert`)).toMatchObject({ state: "alert", details: { full: true } });
      expect(result.rows.map((row) => row.id)).toEqual([`${key}_alert`, `${key}_command`, `${key}_reply`]);
    }
    const { container } = renderRows(noticeTurn("shown", "[PASS]", { text: "[bb studio] ⚠️ From runner House: Backups failed twice\nCheck B2 auth." }));
    const full = container.querySelector("[data-quiet-turn-full]");
    expect(full?.textContent?.match(/Backups failed twice/gu)).toHaveLength(1);
    expect(full?.textContent).toContain("Check B2 auth.");
  });

  it("draws the input of a failed turn in full, and keeps the turn visible", () => {
    registerStudioLike();
    const result = fold(noticeTurn("broken", "[PASS]", { failed: true }));
    expect(result.folded.quiet.get("broken_alert")).toMatchObject({ state: "failed", details: { full: true } });
    expect(result.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining(["broken_command", "broken_error", "broken_reply"]),
    );
  });

  it("shows the latest turn of an active thread as running, but a turn that ended with no text as finished", () => {
    registerStudioLike();
    const running = fold(noticeTurn("running", null), true);
    expect(running.folded.quiet.get("running_alert")?.state).toBe("running");
    expect(running.rows.map((row) => row.id)).toContain("running_command");
    const ended = fold(noticeTurn("ended", null), false);
    expect(ended.folded.quiet.get("ended_alert")?.state).toBe("notice");
    const streaming = foldRelayedRows(buildTimelineViewRows(noticeTurn("stream", "[PASS]")), "stream_reply", undefined, true);
    expect(streaming.folded.quiet.get("stream_alert")?.state).toBe("running");
  });

  it("folds nothing for an input steered into another turn", () => {
    registerStudioLike();
    const result = fold(noticeTurn("steered", "[PASS]", { steer: true }));
    expect(result.folded.quiet.get("steered_alert")?.state).toBe("notice");
    expect(result.rows.map((row) => row.id)).toEqual(["steered_alert", "steered_command", "steered_reply"]);
  });

  it("leaves no row for a quiet cache keepalive, but shows one the Bot answered", () => {
    registerStudioLike();
    const quiet = fold(noticeTurn("ka", "[PASS]", { source: "keepalive", label: "Cache keepalive", text: "[bb cache-keepalive] keep warm" }));
    expect(quiet.rows.map((row) => row.id)).toEqual([]);
    const answered = fold(noticeTurn("kb", "Something odd: the cache was cold.", { source: "keepalive", label: "Cache keepalive", text: "[bb cache-keepalive] keep warm" }));
    expect(answered.folded.quiet.get("kb_alert")?.label).toBe("Cache keepalive · keep warm");
  });

  it("draws a runner's report (the runner's turn, not the system's) the same way", () => {
    registerStudioLike();
    const result = fold(noticeTurn("runner", "[PASS]", { by: "agent", source: "runner", label: "House", text: "From runner House: All clear on the boiler." }));
    expect(result.folded.quiet.get("runner_alert")?.label).toBe("Runner House · All clear on the boiler. · handled");
  });

  it("leaves a typed message as the user's own bubble", () => {
    registerStudioLike();
    const { container } = renderRows(noticeTurn("typed", "Here you go.", { by: "user", text: "How is red4?" }));
    expect(container.querySelector("[data-quiet-turn]")).toBeNull();
    expect(rowText(container, "typed_alert")).toContain("How is red4?");
    expect(rowText(container, "typed_alert")).not.toContain("Message from");
  });

  it("draws an input with no notice (an older host) as before", () => {
    registerStudioLike();
    const { container } = renderRows(noticeTurn("old", "[PASS]", { by: "user", text: "Watcher Morning card: kettle-ok-09" }));
    expect(container.querySelector("[data-quiet-turn]")).toBeNull();
    expect(rowText(container, "old_alert")).toContain("Message from");
  });
});
