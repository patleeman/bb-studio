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

describe("editDocument", () => {
  it("won't rewrite a block whose nested block holds a comment", async () => {
    const Y = await import("yjs");
    const { addCommentMark, commentAnchors, readBlocks, seedMarkdown } = await import("./doc");
    const { editDocument } = await import("./document-edit");
    const doc = new Y.Doc();
    seedMarkdown(doc, "- Parent\n  - Child with note\n\nAfter\n");
    const child = readBlocks(doc)[0]!.children![0]!.id!;
    addCommentMark(doc, child, "thread-1", "note", "test");
    const locked = new Set([...commentAnchors(doc).values()].map((anchor) => anchor.blockId));
    expect(() => editDocument(doc, "- Parent edited\n  - Child with note\n\nAfter\n", locked, "client")).toThrow(/has comments/);
    expect(commentAnchors(doc).get("thread-1")).toEqual({ blockId: child, text: "note" });
    editDocument(doc, "- Parent\n  - Child with note\n\nAfter edited\n", locked, "client");
    expect(commentAnchors(doc).get("thread-1")).toEqual({ blockId: child, text: "note" });
  });
});
