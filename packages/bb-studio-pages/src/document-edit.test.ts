import { describe, expect, it } from "vitest";
import { planDocumentEdit } from "./document-edit";

const blocks = (...markdown: string[]) => markdown.map((text, index) => ({ id: `b${index}`, markdown: text }));

describe("planDocumentEdit", () => {
  it("does nothing when the text is unchanged", () => {
    expect(planDocumentEdit(blocks("A", "B"), ["A", "B"])).toEqual([]);
  });

  it("replaces edited blocks in place and inserts after the last kept block", () => {
    expect(planDocumentEdit(blocks("A", "B", "C"), ["A", "B2", "New", "C"])).toEqual([
      { op: "replace", block: "b1", markdown: "B2" },
      { op: "insert_after", block: "b1", markdown: "New" },
    ]);
  });

  it("prepends before the first block and deletes removed ones", () => {
    expect(planDocumentEdit(blocks("A", "B", "C"), ["Top", "A", "C"])).toEqual([
      { op: "prepend", markdown: "Top" },
      { op: "delete", block: "b1" },
    ]);
  });

  it("joins a run of new blocks into one insert", () => {
    expect(planDocumentEdit(blocks("A"), ["A", "B", "C"])).toEqual([
      { op: "insert_after", block: "b0", markdown: "B\n\nC" },
    ]);
  });
});
