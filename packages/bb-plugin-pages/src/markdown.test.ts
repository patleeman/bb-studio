import { blocksToYDoc, yDocToBlocks } from "@blocknote/core/yjs";
import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks, type PageBlock } from "./markdown";
import { DOCUMENT_FRAGMENT } from "./schema-config";
import { createServerEditor } from "./schema-server";

const editor = createServerEditor();

function throughYjs(blocks: PageBlock[]): PageBlock[] {
  const doc = blocksToYDoc(editor, blocks as never, DOCUMENT_FRAGMENT);
  return yDocToBlocks(editor, doc, DOCUMENT_FRAGMENT) as unknown as PageBlock[];
}

const SAMPLE = `# Launch plan

Ship **v2** by *Friday* with ~~no~~ \`zero\` regressions. See [docs](https://example.com).

> [!WARNING] Freeze starts Thursday

> A plain quote

- [x] Write spec
- [ ] Review with @[Ops Bot](bot:bot_123)
  - nested bullet

1. First
2. Second

\`\`\`ts
const x = 1;
\`\`\`

\`\`\`chart
{"type":"bar","data":[{"week":"W1","signups":10}]}
\`\`\`

\`\`\`stats
[{"label":"MRR","value":"$12k","trend":"up"}]
\`\`\`

\`\`\`embed
{"kind":"thread","target":"thr_abc","title":"Kickoff"}
\`\`\`

---

| Owner | Task |
| --- | --- |
| Ana | Docs |

![Diagram](https://example.com/a.png)
`;

describe("markdown", () => {
  it("parses page syntax into blocks", () => {
    const blocks = markdownToBlocks(SAMPLE);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "callout",
      "quote",
      "checkListItem",
      "checkListItem",
      "numberedListItem",
      "numberedListItem",
      "codeBlock",
      "chart",
      "stats",
      "embed",
      "divider",
      "table",
      "image",
    ]);
    expect(blocks[2]).toMatchObject({ props: { tone: "warning" }, content: [{ text: "Freeze starts Thursday" }] });
    expect(blocks[5]).toMatchObject({
      props: { checked: false },
      content: [{ type: "text", text: "Review with " }, { type: "mention", props: { kind: "bot", target: "bot_123", label: "Ops Bot" } }],
      children: [{ type: "bulletListItem" }],
    });
    expect(blocks[11]).toMatchObject({ props: { kind: "thread", target: "thr_abc", title: "Kickoff" } });
  });

  it("round-trips through the Yjs document", () => {
    const first = blocksToMarkdown(throughYjs(markdownToBlocks(SAMPLE)));
    const second = blocksToMarkdown(throughYjs(markdownToBlocks(first)));
    expect(second).toBe(first);
    expect(first).toContain("> [!WARNING] Freeze starts Thursday");
    expect(first).toContain("- [ ] Review with @[Ops Bot](bot:bot_123)\n  - nested bullet");
    expect(first).toContain("**v2**");
    expect(first).toContain("| Ana | Docs |");
    expect(first).toContain('```chart\n{"type":"bar","data":[{"week":"W1","signups":10}]}\n```');
  });

  it("annotates and ignores block ids", () => {
    const blocks = throughYjs(markdownToBlocks("# Title\n\n- one\n  - two\n"));
    const annotated = blocksToMarkdown(blocks, { ids: true });
    const id = blocks[0]!.id!.replace(/-/g, "").slice(0, 8);
    expect(annotated).toContain(`<!-- ^${id} -->\n# Title`);
    expect(blocksToMarkdown(markdownToBlocks(annotated))).toBe("# Title\n\n- one\n  - two\n");
  });
});

describe("diagrams and Studio embeds", () => {
  const MARKDOWN = `\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

\`\`\`embed
{"kind":"drawing","target":"drw_1"}
\`\`\`

\`\`\`embed
{"kind":"item","target":"notes:nt_1"}
\`\`\`

\`\`\`embed
{"kind":"hologram","target":"x"}
\`\`\`

See @[Roadmap](item:excalidraw:drw_1).
`;

  it("round-trips mermaid, Studio embeds and item mentions", () => {
    const blocks = markdownToBlocks(MARKDOWN);
    expect(blocks[0]).toMatchObject({ type: "mermaid", content: "flowchart LR\n  A --> B" });
    expect(blocks[1]).toMatchObject({ type: "embed", props: { kind: "drawing", target: "drw_1" } });
    expect(blocks[2]).toMatchObject({ type: "embed", props: { kind: "item", target: "notes:nt_1" } });
    // An unknown kind would break the editor, so it becomes a bookmark.
    expect(blocks[3]).toMatchObject({ type: "embed", props: { kind: "bookmark", target: "x" } });
    expect(blocks[4]).toMatchObject({
      content: [{ text: "See " }, { type: "mention", props: { kind: "item", target: "excalidraw:drw_1", label: "Roadmap" } }, { text: "." }],
    });
    const back = throughYjs(blocks);
    expect(back[0]).toMatchObject({ type: "mermaid", content: [{ text: "flowchart LR\n  A --> B" }] });
    const markdown = blocksToMarkdown(back);
    expect(markdown).toContain("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(markdown).toContain('{"kind":"drawing","target":"drw_1"}');
    expect(markdown).toContain("@[Roadmap](item:excalidraw:drw_1)");
  });
});
