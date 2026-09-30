import { describe, expect, it } from "vitest";
import { EVENT_PAGE, turnFiles, turnRows, type EventRow } from "./turn-files";

const item = (seq: number, value: Record<string, unknown>): EventRow => ({ seq, type: "item/completed", data: { item: value } });
const turn = (seq: number): EventRow => ({ seq, type: "client/turn/requested", data: {} });

/** Rows oldest first, handed over newest first as the server reads them. */
const newestFirst = (...rows: EventRow[]) => [...rows].reverse();

describe("turnFiles", () => {
  it("collects the images and files a turn made, oldest first", () => {
    const rows = newestFirst(
      turn(1),
      item(2, { type: "fileChange", status: "completed", changes: [{ path: "/w/old.md", kind: "add" }] }),
      turn(3),
      item(4, { type: "imageGeneration", status: "completed", path: "/s/cat.png" }),
      item(5, { type: "fileChange", status: "completed", changes: [{ path: "/w/a.ts", kind: "update" }, { path: "/w/b.md", kind: "add" }] }),
      item(6, { type: "agentMessage", text: "done" }),
    );
    expect(turnFiles(rows, 6)).toEqual([
      { path: "/s/cat.png", kind: "image" },
      { path: "/w/a.ts", kind: "changed" },
      { path: "/w/b.md", kind: "created" },
    ]);
  });

  it("reads the turn that ends at the given seq", () => {
    const rows = newestFirst(
      turn(1),
      item(2, { type: "imageGeneration", status: "completed", path: "/s/first.png" }),
      turn(3),
      item(4, { type: "imageGeneration", status: "completed", path: "/s/second.png" }),
    );
    expect(turnFiles(rows, 2)).toEqual([{ path: "/s/first.png", kind: "image" }]);
  });

  it("drops deleted files and failed items, follows moves, and counts created-then-changed as created", () => {
    const rows = newestFirst(
      turn(1),
      item(2, { type: "fileChange", status: "completed", changes: [{ path: "/w/new.md", kind: "add" }, { path: "/w/tmp.txt", kind: "add" }] }),
      item(3, { type: "fileChange", status: "completed", changes: [{ path: "/w/new.md", kind: "update" }, { path: "/w/tmp.txt", kind: "delete" }] }),
      item(4, { type: "fileChange", status: "completed", changes: [{ path: "/w/a.md", kind: "update", movePath: "/w/b.md" }] }),
      item(5, { type: "imageGeneration", status: "failed", path: "/s/broken.png" }),
      item(6, { type: "fileChange", status: "failed", changes: [{ path: "/w/nope.md", kind: "add" }] }),
    );
    expect(turnFiles(rows, 10)).toEqual([
      { path: "/w/new.md", kind: "created" },
      { path: "/w/b.md", kind: "changed" },
    ]);
  });

  it("ignores malformed rows", () => {
    const rows = newestFirst(turn(1), { seq: 2, type: "item/completed", data: null }, item(3, { type: "fileChange", changes: "nope" }));
    expect(turnFiles(rows, 3)).toEqual([]);
  });
});

describe("turnRows", () => {
  // A history of `count` rows with a turn request every 150 rows.
  const history = (count: number) =>
    Array.from({ length: count }, (_, index) => (index % 150 === 0 ? turn(index + 1) : item(index + 1, { type: "agentMessage" })));
  const pager = (rows: EventRow[]) => {
    const calls: (number | null)[] = [];
    const fetchPage = async (beforeSeq: number | null) => {
      calls.push(beforeSeq);
      return rows
        .filter((row) => beforeSeq === null || row.seq < beforeSeq)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, EVENT_PAGE);
    };
    return { calls, fetchPage };
  };

  it("pages back to the start of a long reply", async () => {
    const { calls, fetchPage } = pager(history(400));
    // The latest turn starts at seq 301; 400..301 is exactly one page.
    const rows = await turnRows(fetchPage, null);
    expect(calls).toEqual([null]);
    expect(rows.at(-1)).toMatchObject({ seq: 301, type: "client/turn/requested" });
  });

  it("keeps paging when a page doesn't reach the turn start", async () => {
    const { calls, fetchPage } = pager(history(400));
    // The turn ending at 300 starts at 151, two pages back.
    const rows = await turnRows(fetchPage, 300);
    expect(calls).toEqual([301, 201]);
    expect(rows.some((row) => row.seq === 151 && row.type === "client/turn/requested")).toBe(true);
  });

  it("stops at the start of history", async () => {
    const { calls, fetchPage } = pager([turn(1), item(2, { type: "agentMessage" })]);
    expect(await turnRows(fetchPage, null)).toHaveLength(2);
    expect(calls).toEqual([null]);
  });
});
