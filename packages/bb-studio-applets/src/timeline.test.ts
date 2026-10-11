import { describe, expect, it } from "vitest";
import { timelineItems } from "./timeline";

const base = { createdAt: 1, sourceSeqStart: 0, sourceSeqEnd: 0, startedAt: 1, threadId: "t", turnId: "u" };

describe("timelineItems", () => {
  it("flattens turns into messages and tool lines, skipping agent-only text", () => {
    const rows = [
      { ...base, kind: "conversation", id: "m1", role: "user", text: "Fix the build" },
      {
        ...base,
        kind: "turn",
        id: "turn1",
        children: [
          { ...base, kind: "conversation", id: "hidden", role: "user", text: "context", visibility: "agent-only" },
          { ...base, kind: "work", id: "w1", workKind: "command", command: "pnpm   test", status: "completed" },
          { ...base, kind: "work", id: "w2", workKind: "tool", toolName: "pages_read", status: "running" },
          { ...base, kind: "conversation", id: "m2", role: "assistant", text: "Fixed.", status: "completed" },
        ],
      },
      { kind: "conversation", role: "assistant", text: "no id" },
    ];
    expect(timelineItems(rows, 10).map((item) => [item.type, item.text])).toEqual([
      ["user", "Fix the build"],
      ["tool", "$ pnpm test"],
      ["tool", "pages_read"],
      ["assistant", "Fixed."],
    ]);
  });

  it("keeps only the newest items", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...base, kind: "conversation", id: `m${i}`, role: "user", text: `${i}` }));
    expect(timelineItems(rows, 2).map((item) => item.text)).toEqual(["3", "4"]);
  });
});
