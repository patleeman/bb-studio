import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { listThreads, createThread } from "./comments";
import { readBlocks, seedMarkdown } from "./doc";
import { DOCUMENT_FRAGMENT } from "./schema-config";
import { snapPositions, snapToWords } from "./word-snap";

const LINE = "The rollout pauses if the crash rate goes above 1 percent.";
const snapped = (text: string, part: string) => {
  const start = text.indexOf(part);
  const [from, to] = snapToWords(text, start, start + part.length);
  return text.slice(from, to);
};

describe("snapToWords", () => {
  it("widens a selection that starts or ends inside a word to the whole words", () => {
    expect(snapped(LINE, "h rate goes")).toBe("crash rate goes");
    expect(snapped(LINE, "rash rate go")).toBe("crash rate goes");
    expect(snapped(LINE, "ollou")).toBe("rollout");
    expect(snapped("Ça marche très bien", "rès bi")).toBe("très bien");
    expect(snapped("We don't ship", "on't")).toBe("don't");
  });

  it("keeps a selection already on word boundaries, drops spaces at its edges and doesn't swallow punctuation", () => {
    expect(snapped(LINE, "crash rate")).toBe("crash rate");
    expect(snapped(LINE, " crash rate ")).toBe("crash rate");
    expect(snapped(LINE, "1 percent.")).toBe("1 percent.");
    expect(snapped("to the first 40 teams.", "eams.")).toBe("teams.");
    expect(snapToWords("a   b", 1, 4)).toEqual([1, 4]);
  });
});

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    mention: { inline: true, group: "inline", atom: true, leafText: () => "@Plan" },
  },
});

describe("snapPositions", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("See "), schema.node("mention"), schema.text(" before the crash rate check.")]),
    schema.node("paragraph", null, [schema.text("Second paragraph here.")]),
  ]);
  const at = (text: string) => {
    let found = -1;
    doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text);
    });
    return found;
  };

  it("widens a selection in one block to whole words, counting a mention as one position", () => {
    const from = at("rash");
    const range = snapPositions(doc, from, from + "rash ra".length);
    expect(doc.textBetween(range.from, range.to)).toBe("crash rate");
  });

  it("widens each end of a selection across blocks in its own block", () => {
    const from = at("ate check");
    const to = at("cond") + 2;
    const range = snapPositions(doc, from, to);
    expect(doc.textBetween(range.from, range.to, "\n")).toBe("rate check.\nSecond");
  });
});

describe("stored quotes", () => {
  it("show widened to whole words without changing the comment's mark", async () => {
    const doc = new Y.Doc();
    seedMarkdown(doc, `${LINE}\n`);
    const block = readBlocks(doc)[0]!.id!;
    await createThread(doc, "user", { block, quote: "h rate goes", text: "Lower it?" }, "test");
    expect(listThreads(doc)[0]!.quote).toBe("crash rate goes");
    const marked: string[] = [];
    const walk = (node: Y.XmlFragment | Y.XmlElement) => {
      for (const child of node.toArray()) {
        if (child instanceof Y.XmlText) {
          for (const part of child.toDelta() as { insert: string; attributes?: Record<string, unknown> }[]) if (Object.keys(part.attributes ?? {}).some((key) => key.startsWith("comment"))) marked.push(part.insert);
        } else if (child instanceof Y.XmlElement) walk(child);
      }
    };
    walk(doc.getXmlFragment(DOCUMENT_FRAGMENT));
    expect(marked.join("")).toBe("h rate goes");
  });
});
