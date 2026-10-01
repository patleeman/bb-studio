import { describe, expect, it } from "vitest";
import { MAX_MARKDOWN, cleanExplainer, explainerHtml, explainerText, htmlBlock } from "./markdown";

const body = "## What it is\n\nThe job queue retries failed jobs with exponential backoff, stored in `jobs`.\n\n## Why it matters\n\nBilling depends on it.";

describe("cleaning the worker's Markdown", () => {
  it("lifts the trailing ::explore line into follow-ups", () => {
    const result = cleanExplainer(`${body}\n\n::explore{items="🔗 Where retries are scheduled|🐛 Timeout is never reset|🕐 A|🏗️ B"}\n`);
    expect(result.markdown).toBe(body);
    expect(result.followUps).toEqual([
      { emoji: "🔗", label: "Where retries are scheduled" },
      { emoji: "🐛", label: "Timeout is never reset" },
      { emoji: "🕐", label: "A" },
    ]);
  });

  it("drops a ::reactions line after it too", () => {
    const result = cleanExplainer(`${body}\n::explore{items="🔗 Next"}\n::reactions{items="👍 Thanks"}`);
    expect(result.markdown).toBe(body);
    expect(result.followUps).toEqual([{ emoji: "🔗", label: "Next" }]);
  });

  it("drops a stray ::reactions line mid-document, but not inside code", () => {
    const code = "```md\n::reactions{items=\"👍 Kept\"}\n```";
    const result = cleanExplainer(`${body}\n::reactions{items="👍 Thanks"}\n\n${code}\n\nMore.`);
    expect(result.markdown).toBe(`${body}\n\n${code}\n\nMore.`);
  });

  it("leaves ::explore alone when it isn't trailing", () => {
    const text = `${body}\n\n::explore{items="🔗 Mid"}\n\nMore text after it.`;
    expect(cleanExplainer(text)).toEqual({ markdown: text, followUps: [] });
  });

  it("unwraps a fence around the whole document", () => {
    expect(cleanExplainer(`\`\`\`markdown\n${body}\n\`\`\``).markdown).toBe(body);
    expect(cleanExplainer(`\`\`\`\n${body}\n\`\`\``).markdown).toBe(body);
  });

  it("keeps a document that is one diagram or code block", () => {
    const diagram = "```mermaid\ngraph TD\n  A[Enqueue] --> B[Worker] --> C[Retry with backoff] --> B\n  B --> D[Done]\n```";
    expect(cleanExplainer(diagram).markdown).toBe(diagram);
  });

  it("drops a preamble and a leading title", () => {
    expect(cleanExplainer(`Here's the explainer:\n\n# The job queue\n\n${body}`).markdown).toBe(body);
    expect(cleanExplainer(`# The job queue\n${body}`).markdown).toBe(body);
  });

  it("rejects an empty or tiny result", () => {
    expect(() => cleanExplainer("")).toThrow(/empty/);
    expect(() => cleanExplainer(null)).toThrow(/empty/);
    expect(() => cleanExplainer('Done.\n::explore{items="🔗 X"}')).toThrow(/empty/);
  });

  it("caps the size, closing a fence it cut through", () => {
    const huge = `${body}\n\n\`\`\`ts\n${"const x = 1;\n".repeat(20_000)}\`\`\``;
    const { markdown } = cleanExplainer(huge);
    expect(markdown.length).toBeLessThanOrEqual(MAX_MARKDOWN + 100);
    expect(markdown).toMatch(/cut short/);
    expect((markdown.match(/^```/gm) ?? []).length % 2).toBe(0);
  });

  it("closes a longer fence it cut through with the same fence", () => {
    const huge = `${body}\n\n\`\`\`\`html\n<pre>\n\`\`\`\n</pre>\n${"<p>x</p>\n".repeat(30_000)}\`\`\`\``;
    const { markdown } = cleanExplainer(huge);
    expect(markdown).toMatch(/\n````\n\n\*This explainer was cut short/);
  });

  it("normalizes line endings", () => {
    expect(cleanExplainer(body.replace(/\n/g, "\r\n")).markdown).toBe(body);
  });
});

const doc = "<!doctype html>\n<html><head><style>body{font:14px system-ui}</style></head>\n<body><p class=lede>The job queue retries failed jobs &amp; backs off.</p><script>const s = `x`;</script></body></html>";

describe("cleaning the worker's HTML", () => {
  it("saves the document as one html block, with follow-ups lifted out", () => {
    const result = cleanExplainer(`${doc}\n\n::explore{items="🔗 Where retries are scheduled"}\n::reactions{items="👍 Thanks"}`);
    expect(result.markdown).toBe(htmlBlock(doc));
    expect(result.followUps).toEqual([{ emoji: "🔗", label: "Where retries are scheduled" }]);
    expect(explainerHtml(`${result.markdown}\n\n---\n\n*Explored from this thread.*`)).toBe(doc);
  });

  it("unwraps a fence and drops a preamble around it", () => {
    const result = cleanExplainer(`Here's the explainer:\n\n\`\`\`html\n${doc}\n\`\`\`\n::explore{items="🐛 Timeout is never reset"}`);
    expect(result.markdown).toBe(htmlBlock(doc));
    expect(result.followUps).toEqual([{ emoji: "🐛", label: "Timeout is never reset" }]);
  });

  it("fences past backtick runs inside the document", () => {
    const block = htmlBlock("<html><body><pre>```\n````</pre></body></html>");
    expect(block.startsWith("`````html\n")).toBe(true);
    expect(block.endsWith("\n`````")).toBe(true);
  });

  it("leaves an HTML example deep in a Markdown explainer alone", () => {
    const text = `${body}\n\n## Example\n\nIt renders this:\n\n\`\`\`xml\n<html><body>Hi</body></html>\n\`\`\``;
    expect(cleanExplainer(text).markdown).toBe(text);
    expect(explainerHtml(text)).toBeNull();
  });

  it("rejects an empty or oversized document", () => {
    expect(() => cleanExplainer("<!doctype html><html></html>")).toThrow(/empty/);
    expect(() => cleanExplainer(`<!doctype html><html><body>${"<p>x</p>".repeat(30_000)}</body></html>`)).toThrow(/too long/);
  });

  it("reads as text when briefing a follow-up", () => {
    const text = explainerText(htmlBlock(doc));
    expect(text).toBe("The job queue retries failed jobs & backs off.");
    expect(explainerText(body)).toBe(body);
  });
});
