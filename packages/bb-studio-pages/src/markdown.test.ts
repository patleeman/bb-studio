import { blocksToYDoc, yDocToBlocks } from "@blocknote/core/yjs";
import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks, type PageBlock } from "./markdown";
import { DOCUMENT_FRAGMENT, MAX_HTML_CHARS } from "./schema-config";
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

describe("html blocks", () => {
  const HTML = `<style>
  body { font: 14px system-ui; }
  @media (prefers-color-scheme: dark) { body { color: #eee; } }
</style>
<div id="app"></div>
<script>
  const tpl = \`\`\`;
  document.getElementById("app").textContent = "Hi";
</script>`;

  it("round-trips an html fence losslessly through the Yjs document", () => {
    const markdown = `# Widget\n\n\`\`\`\`html\n${HTML}\n\`\`\`\`\n\nAfter the widget.\n`;
    const blocks = markdownToBlocks(markdown);
    expect(blocks.map((block) => block.type)).toEqual(["heading", "html", "paragraph"]);
    expect(blocks[1]).toMatchObject({ type: "html", content: HTML });
    const back = throughYjs(blocks);
    expect(back[1]).toMatchObject({ type: "html", content: [{ text: HTML }] });
    const serialized = blocksToMarkdown(back);
    // The fence is longer than the backtick run inside the script.
    expect(serialized).toBe(markdown);
    expect(blocksToMarkdown(throughYjs(markdownToBlocks(serialized)))).toBe(serialized);
  });

  it("finds html fences inside other content", () => {
    const blocks = markdownToBlocks("- Item\n\n  ```html\n  <b>nested</b>\n  ```\n\n> quote\n\n```HTML\n<i>upper</i>\n```\n");
    expect(blocks[0]).toMatchObject({ type: "bulletListItem", children: [{ type: "html", content: "<b>nested</b>" }] });
    expect(blocks[2]).toMatchObject({ type: "html", content: "<i>upper</i>" });
    expect(blocksToMarkdown(throughYjs(blocks))).toBe("- Item\n\n  ```html\n  <b>nested</b>\n  ```\n\n> quote\n\n```html\n<i>upper</i>\n```\n");
  });

  it("keeps an existing HTML code block as code through a read and write", () => {
    const code: PageBlock[] = [{ type: "codeBlock", props: { language: "html" }, content: "<b>shown as source</b>" }];
    const markdown = blocksToMarkdown(throughYjs(code));
    expect(markdown).toBe("```html source\n<b>shown as source</b>\n```\n");
    const [block] = markdownToBlocks(markdown);
    expect(block).toMatchObject({ type: "codeBlock", props: { language: "html" }, content: "<b>shown as source</b>" });
  });

  it("keeps oversized HTML as an unrendered code block", () => {
    const big = `<p>${"x".repeat(MAX_HTML_CHARS)}</p>`;
    const [block] = markdownToBlocks(`\`\`\`html\n${big}\n\`\`\`\n`);
    expect(block).toMatchObject({ type: "codeBlock", props: { language: "html" }, content: big });
    const [atCap] = markdownToBlocks(`\`\`\`html\n${"y".repeat(MAX_HTML_CHARS)}\n\`\`\`\n`);
    expect(atCap!.type).toBe("html");
  });
});

describe("nested list items", () => {
  it("keep their children through a read and write", () => {
    const blocks: PageBlock[] = [
      { type: "numberedListItem", content: [{ type: "text", text: "One", styles: {} }], children: [{ type: "bulletListItem", content: [{ type: "text", text: "Under one", styles: {} }] }] },
      { type: "bulletListItem", content: [{ type: "text", text: "Item", styles: {} }], children: [
        { type: "paragraph", content: [{ type: "text", text: "Item note", styles: {} }] },
        { type: "divider" },
        { type: "paragraph", content: [{ type: "text", text: "Last", styles: {} }] },
      ] },
    ];
    const markdown = blocksToMarkdown(throughYjs(blocks));
    expect(markdownToBlocks(markdown)).toMatchObject([
      { type: "numberedListItem", content: [{ text: "One" }], children: [{ type: "bulletListItem", content: [{ text: "Under one" }] }] },
      { type: "bulletListItem", content: [{ text: "Item" }], children: [{ type: "paragraph", content: [{ text: "Item note" }] }, { type: "divider" }, { type: "paragraph", content: [{ text: "Last" }] }] },
    ]);
    expect(blocksToMarkdown(throughYjs(markdownToBlocks(markdown)))).toBe(markdown);
  });
});

describe("toggles", () => {
  const MARKDOWN = `<details>
<summary>**More** details</summary>

Hidden paragraph

- inside

<details>
<summary>Nested</summary>

Deep

</details>

</details>

<details>
<summary>## Section</summary>

Section body

</details>

<details>
<summary>Empty</summary>

</details>
`;

  it("reads <details> as toggle list items and toggle headings", () => {
    const blocks = markdownToBlocks(MARKDOWN);
    expect(blocks).toMatchObject([
      {
        type: "toggleListItem",
        content: [{ text: "More", styles: { bold: true } }, { text: " details" }],
        children: [
          { type: "paragraph", content: [{ text: "Hidden paragraph" }] },
          { type: "bulletListItem", content: [{ text: "inside" }] },
          { type: "toggleListItem", content: [{ text: "Nested" }], children: [{ type: "paragraph" }] },
        ],
      },
      { type: "heading", props: { level: 2, isToggleable: true }, content: [{ text: "Section" }], children: [{ type: "paragraph" }] },
      { type: "toggleListItem", content: [{ text: "Empty" }] },
    ]);
  });

  it("round-trips toggles through the Yjs document", () => {
    const back = throughYjs(markdownToBlocks(MARKDOWN));
    expect(back.map((block) => block.type)).toEqual(["toggleListItem", "heading", "toggleListItem"]);
    expect(blocksToMarkdown(back)).toBe(MARKDOWN);
  });

  it("accepts compact <details> without blank lines, and inside lists", () => {
    const blocks = markdownToBlocks(
      "<details><summary>Short</summary>\nBody **text**\n</details>\n\n- Item\n\n  <details>\n  <summary>In list</summary>\n\n  Child\n\n  </details>\n",
    );
    expect(blocks).toMatchObject([
      { type: "toggleListItem", content: [{ text: "Short" }], children: [{ type: "paragraph", content: [{ text: "Body " }, { text: "text", styles: { bold: true } }] }] },
      { type: "bulletListItem", children: [{ type: "toggleListItem", content: [{ text: "In list" }], children: [{ type: "paragraph" }] }] },
    ]);
  });

  it("closes an unclosed <details> at the end", () => {
    expect(markdownToBlocks("<details>\n<summary>Open</summary>\n\nTail\n")).toMatchObject([
      { type: "toggleListItem", content: [{ text: "Open" }], children: [{ type: "paragraph", content: [{ text: "Tail" }] }] },
    ]);
  });
});
