import { describe, expect, it } from "vitest";
import { applyTextEdit } from "./text-edit";

describe("editing text on the canvas", () => {
  it("replaces the one matching element text and keeps its whitespace", () => {
    const html = `<h1>\n  Hello\n</h1><p>Hello world</p>`;
    expect(applyTextEdit(html, "\n  Hello\n", "Hi there")).toEqual({ ok: true, html: `<h1>\n  Hi there\n</h1><p>Hello world</p>` });
  });

  it("matches text the source spells with entities, and escapes the new text", () => {
    const html = `<p>Don&rsquo;t &amp; won&#39;t</p>`;
    expect(applyTextEdit(html, "Don’t &amp; won't", "Fish & <chips>")).toEqual({ ok: true, html: `<p>Fish &amp; &lt;chips&gt;</p>` });
  });

  it("changes nothing when the text is missing or appears more than once", () => {
    expect(applyTextEdit(`<p>Next</p><a>Next</a>`, "Next", "Go")).toEqual({ ok: false, reason: "ambiguous" });
    expect(applyTextEdit(`<p>Next</p>`, "Back", "Go")).toEqual({ ok: false, reason: "missing" });
    expect(applyTextEdit(`<img alt="Next"><p>Other</p>`, "Next", "Go")).toEqual({ ok: false, reason: "missing" });
  });
});
