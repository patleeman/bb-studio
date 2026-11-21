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

  it("always gives at least one block, even one larger than the limit", () => {
    const text = page(2, 20_000);
    const part = readPart(text, undefined, READ_PART_CHARS);
    expect(part.text).toContain("Paragraph 0");
    expect(part.next).toBe("blk00001");
  });
});
