import { describe, expect, it } from "vitest";
import { callText, clipLine, counted, decodeKey, encodeKey, nextLine, pageByKey, pageItems, pageSections, pageText, safeEnd, safeStart, staleCursor } from "./paging";

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
    expect(staleCursor("Record mem_1", 'memory { op: "search", query: "x" }')).toBe('Record mem_1 is no longer in this list (it was removed or changed). Start again: memory { op: "search", query: "x" }.');
  });

  it("ends with no Next on the last part", () => {
    const last = pageItems(items, (item) => item.id, (item) => item.text.length, { after: "it_55" });
    expect(last.items.map((item) => item.id)).toEqual(["it_56"]);
    expect(nextLine(last, () => "x")).toBeNull();
  });
});

describe("the Next line", () => {
  it("names the part and the call, under the merged tool's name", () => {
    expect(callText("talk_search", { query: "launch", after: "rec_9" })).toBe('talk { op: "search", query: "launch", after: "rec_9" }');
    expect(callText("bot_conversations", { after: "thr_1" })).toBe('bot_info { view: "conversations", after: "thr_1" }');
    expect(callText("minis_data", { miniId: "mini_1", op: "find", collection: "c", query: { offset: 25 } })).toBe('minis_data { miniId: "mini_1", op: "find", collection: "c", query: {"offset":25} }');
    expect(nextLine({ from: 1, to: 10, total: 34, next: "rec_10" }, (after) => callText("talk_search", { query: "x", after }), "recordings")).toBe('(Showing 1–10 of 34 recordings. Next: talk { op: "search", query: "x", after: "rec_10" }.)');
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

describe("parts by keyset while the list changes", () => {
  type Item = { id: string; created: number; title: string };
  const make = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `r${String(index).padStart(3, "0")}`, created: 1000 + index, title: `t${index}` }));
  const keyOf = (item: Item) => [item.created, item.id];

  it("shows each item that stays once, though items change, arrive and go between parts", () => {
    let list: Item[] = make(60);
    const seen: string[] = [];
    let after: string | null = null;
    for (let round = 0; round < 50; round++) {
      const part: ReturnType<typeof pageByKey<Item>> = pageByKey(list, keyOf, () => 50, { after, max: 7, descending: [true, true] });
      seen.push(...part.items.map((item) => item.id));
      if (part.next === null) break;
      after = part.next;
      // Between parts: an item already shown and one not yet shown change (their order key doesn't), a new one arrives, an old one goes.
      list = list.map((item) => (item.id === part.items[0]!.id || item.id === "r010" ? { ...item, title: "changed" } : item));
      list.push({ id: `n${round}`, created: 5000 + round, title: "new" });
      if (round === 2) list = list.filter((item) => item.id !== "r020");
    }
    const stayed = make(60).map((item) => item.id).filter((id) => id !== "r020");
    expect(seen.filter((id) => id.startsWith("r")).sort()).toEqual(stayed.filter((id) => seen.includes(id)).sort());
    expect(new Set(seen).size).toBe(seen.length);
    expect(stayed.every((id) => seen.includes(id))).toBe(true);
  });

  it("refuses a cursor it can't read", () => {
    expect(pageByKey(make(3), keyOf, () => 1, { after: "not-a-cursor" })).toMatchObject({ missing: true });
    expect(decodeKey(encodeKey([1, "a"]))).toEqual([1, "a"]);
  });

  it("never splits a surrogate pair", () => {
    const text = "a".repeat(9) + "🙂" + "b".repeat(50);
    expect(safeEnd(text, 10)).toBe(9);
    expect(pageText(text, 0, 10).text).toBe("a".repeat(9));
    expect(clipLine("🙂".repeat(10), 4)).toBe("🙂…");
  });

  it("moves on with a budget smaller than one emoji, taking the whole emoji", () => {
    expect(pageText("a😀b", 1, 1)).toEqual({ text: "😀", next: 3 });
    const text = "😀".repeat(20);
    let offset = 0;
    let joined = "";
    for (let guard = 0; guard < 100; guard++) {
      const part = pageText(text, offset, 1);
      joined += part.text;
      if (part.next === null) break;
      expect(part.next).toBeGreaterThan(offset);
      offset = part.next;
    }
    expect(joined).toBe(text);
    expect(safeStart("ab😀", 3)).toBe(2);
  });

  it("says at least when a count hit its cap", () => {
    expect(counted(500, 500)).toBe("At least 500");
    expect(counted(42, 500)).toBe("42");
    // A filter after a capped fetch: the count is still a floor.
    expect(counted(480, 500, 500)).toBe("At least 480");
  });
});
