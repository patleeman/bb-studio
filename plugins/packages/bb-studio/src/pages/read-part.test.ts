import { describe, expect, it } from "vitest";
import { READ_PART_CHARS, readPart } from "./tools";

const page = (count: number, size: number) => Array.from({ length: count }, (_, index) => `<!-- ^blk${String(index).padStart(5, "0")} -->\nParagraph ${index} ${"x".repeat(size)}\n\n`).join("");

describe("pages_read parts", () => {
  it("gives a short page whole", () => {
    const text = page(3, 100);
    expect(readPart(text, undefined, READ_PART_CHARS)).toEqual({ text, next: null, shown: text.length, total: text.length });
  });

  it("cuts a long page at a block, names the next block, and goes on from it", () => {
    const text = page(40, 1000);
    const first = readPart(text, undefined, READ_PART_CHARS);
    expect(first.shown).toBeLessThanOrEqual(READ_PART_CHARS);
    expect(first.next).toMatch(/^blk\d+$/);
    expect(first.text.endsWith("\n\n")).toBe(true);
    const second = readPart(text, first.next!, READ_PART_CHARS);
    expect(second.text.startsWith(`<!-- ^${first.next} -->`)).toBe(true);
    let at: string | null = first.next;
    let seen = first.text.length;
    while (at) { const part = readPart(text, at, READ_PART_CHARS); seen += part.text.length; at = part.next; }
    expect(seen).toBe(text.length);
  });

  it("cuts a single block larger than the limit at the limit, and says so", () => {
    const text = page(2, 20_000);
    const part = readPart(text, undefined, READ_PART_CHARS);
    expect(part.text.length).toBe(READ_PART_CHARS);
    expect(part.cut).toEqual({ block: "blk00000", size: expect.any(Number) });
    expect(part.cut!.size).toBeGreaterThan(READ_PART_CHARS);
    expect(part.next).toBe("blk00001");
  });

  it("says when from names a block that is gone, instead of starting over", () => {
    expect(readPart(page(40, 1000), "blkgone", READ_PART_CHARS)).toMatchObject({ missing: true, text: "" });
  });

  it("takes block markers only at the start of a line", () => {
    const text = "<!-- ^aaa -->\nsays <!-- ^bbb --> inline\n\n<!-- ^ccc -->\nlast\n";
    expect(readPart(text, "bbb", READ_PART_CHARS).missing).toBe(true);
    expect(readPart(text, "ccc", READ_PART_CHARS).text).toBe("<!-- ^ccc -->\nlast\n");
  });
});
