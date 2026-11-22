import { describe, expect, it } from "vitest";
import { callText, clipLine, nextLine, pageItems, pageSections, pageText, staleCursor } from "./paging";

const items = Array.from({ length: 57 }, (_, index) => ({ id: `it_${index}`, text: `item ${index} ${"x".repeat(index % 7 * 40)}` }));
const walk = (budget: number, max?: number) => {
  const seen: string[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const part: ReturnType<typeof pageItems<(typeof items)[number]>> = pageItems(items, (item) => item.id, (item) => item.text.length, { after, budget, max });
    seen.push(...part.items.map((item) => item.id));
    if (part.next === null) break;
    expect(part.next).toBe(part.items.at(-1)!.id);
    after = part.next;
  }
  return seen;
};

describe("parts of a list", () => {
  it("covers every item once, in order, whatever the budget or count", () => {
    for (const [budget, max] of [[300, undefined], [1_000, 5], [80, undefined], [10_000, 1], [100_000, undefined]] as const) {
      expect(walk(budget, max)).toEqual(items.map((item) => item.id));
    }
  });

  it("always gives at least one item, even one larger than the budget", () => {
    const part = pageItems([{ id: "a", text: "y".repeat(500) }, { id: "b", text: "z" }], (item) => item.id, (item) => item.text.length, { budget: 10 });
    expect(part.items.map((item) => item.id)).toEqual(["a"]);
    expect(part.next).toBe("a");
  });

  it("says a cursor is stale instead of starting over", () => {
    expect(pageItems(items, (item) => item.id, (item) => item.text.length, { after: "it_gone" })).toMatchObject({ missing: true, items: [] });
    expect(staleCursor("Record mem_1", "memory search")).toBe("Record mem_1 is no longer in this list (it was removed or changed); call memory search without after to start again.");
  });

  it("ends with no Next on the last part", () => {
    const last = pageItems(items, (item) => item.id, (item) => item.text.length, { after: "it_55" });
    expect(last.items.map((item) => item.id)).toEqual(["it_56"]);
    expect(nextLine(last, () => "x")).toBeNull();
  });
});

describe("the Next line", () => {
  it("names the part and the call, under the merged tool's name", () => {
    expect(callText("memory_search", { query: "launch", after: "mem_9" })).toBe('memory { op: "search", query: "launch", after: "mem_9" }');
    expect(callText("bot_conversations", { after: "thr_1" })).toBe('bot_info { view: "conversations", after: "thr_1" }');
    expect(callText("minis_data", { miniId: "mini_1", op: "find", collection: "c", query: { offset: 25 } })).toBe('minis_data { miniId: "mini_1", op: "find", collection: "c", query: {"offset":25} }');
    expect(nextLine({ from: 1, to: 10, total: 34, next: "mem_10" }, (after) => callText("memory_search", { query: "x", after }), "records")).toBe('(Showing 1–10 of 34 records. Next: memory { op: "search", query: "x", after: "mem_10" }.)');
  });
});

describe("parts of a sectioned list", () => {
  it("repeats a section's heading in each part that has its rows", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, index) => ({ id: `c${index}`, section: "Conversations:", line: `- c${index}` })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: `w${index}`, section: "Workers:", line: `- w${index}` })),
    ];
    const first = pageSections(rows, { max: 4 })!;
    expect(first.lines).toEqual(["Conversations:", "- c0", "- c1", "- c2", "Workers:", "- w0"]);
    const second = pageSections(rows, { after: first.page.next, max: 4 })!;
    expect(second.lines).toEqual(["Workers:", "- w1", "- w2"]);
    expect(pageSections(rows, { after: "gone" })).toBeNull();
  });
});

describe("parts of a text", () => {
  const text = Array.from({ length: 400 }, (_, index) => `line ${index} ${"w".repeat(index % 50)}`).join("\n");
  it("covers the text once, cutting at line ends", () => {
    let offset = 0;
    let joined = "";
    for (let guard = 0; guard < 100; guard++) {
      const part = pageText(text, offset, 2_000);
      joined += part.text;
      if (part.next === null) break;
      expect(text[part.next - 1]).toBe("\n");
      offset = part.next;
    }
    expect(joined).toBe(text);
  });

  it("says an offset past the end is stale", () => {
    expect(pageText("short", 99)).toMatchObject({ missing: true });
    expect(pageText("short", 5)).toEqual({ text: "", next: null });
  });

  it("clips a line", () => {
    expect(clipLine("\n  first line here\nsecond", 10)).toBe("first lin…");
  });
});
