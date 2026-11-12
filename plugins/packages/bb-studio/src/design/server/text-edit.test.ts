import { describe, expect, it } from "vitest";
import { applyTextEdit, isInlineMarkup } from "./text-edit";

describe("editing text on the canvas", () => {
  it("replaces the one matching element's content and keeps its whitespace", () => {
    const html = `<h1>\n  Hello\n</h1><p>Hello world</p>`;
    expect(applyTextEdit(html, "\n  Hello\n", "Hi there")).toEqual({ ok: true, html: `<h1>\n  Hi there\n</h1><p>Hello world</p>` });
  });

  it("matches text the source spells with entities", () => {
    const html = `<p>Don&rsquo;t &amp; won&#39;t</p>`;
    expect(applyTextEdit(html, "Don’t &amp; won't", "Fish &amp; &lt;chips&gt;")).toEqual({ ok: true, html: `<p>Fish &amp; &lt;chips&gt;</p>` });
  });

  it("edits a heading with inline formatting and keeps it", () => {
    const html = `<h1>Offline sync<br><em>is coming Friday</em></h1>`;
    expect(applyTextEdit(html, "Offline sync<br><em>is coming Friday</em>", "Offline sync<br><em>ships Friday</em>"))
      .toEqual({ ok: true, html: `<h1>Offline sync<br><em>ships Friday</em></h1>` });
  });

  it("edits only an element's whole content, not part of another element", () => {
    // The DOM's <span>Hello</span> isn't in the source; "Hello" begins a longer paragraph.
    expect(applyTextEdit(`<p>Hello<br>world</p>`, "Hello", "Bye")).toEqual({ ok: false, reason: "missing" });
    expect(applyTextEdit(`<p>Intro <b>x</b>Hello</p>`, "Hello", "Bye")).toEqual({ ok: false, reason: "missing" });
    expect(applyTextEdit(`<div><h2>Hello</h2></div>`, "<h2>Hello</h2>", "Bye")).toEqual({ ok: true, html: `<div>Bye</div>` });
    expect(applyTextEdit(`<p class="a">Hello</p >`, "Hello", "Bye")).toEqual({ ok: true, html: `<p class="a">Bye</p >` });
    expect(applyTextEdit(`<p>Hello<br>world</p>`, "Hello<br>world", "Bye")).toEqual({ ok: true, html: `<p>Bye</p>` });
  });

  it("changes nothing when the content is missing or appears more than once", () => {
    expect(applyTextEdit(`<p>Next</p><a>Next</a>`, "Next", "Go")).toEqual({ ok: false, reason: "ambiguous" });
    expect(applyTextEdit(`<p>Next</p>`, "Back", "Go")).toEqual({ ok: false, reason: "missing" });
    expect(applyTextEdit(`<img alt="Next"><p>Other</p>`, "Next", "Go")).toEqual({ ok: false, reason: "missing" });
    // Text a script draws isn't in the markup; its source string must not be rewritten.
    expect(applyTextEdit(`<div id=r></div><script>r.innerHTML = '<h1>Hello</h1>'</script>`, "Hello", "It's")).toEqual({ ok: false, reason: "missing" });
    expect(applyTextEdit(`<h1>Hello</h1><script>r.innerHTML = '<h1>Hello</h1>'</script><!-- <b>Hello</b> -->`, "Hello", "Hi")).toEqual({ ok: true, html: `<h1>Hi</h1><script>r.innerHTML = '<h1>Hello</h1>'</script><!-- <b>Hello</b> -->` });
  });

  it("takes only text and inline formatting", () => {
    expect(isInlineMarkup(`Hi <strong>there</strong><br>`)).toBe(true);
    for (const bad of [`<script>x()</script>`, `<img src=x onerror=alert(1)>`, `<a href="javascript:x()">y</a>`, `<span onclick="x()">y</span>`, `<div>y</div>`,
      `<span/onclick="x()">y</span>`, `<a href="java&#115;cript:x()">y</a>`, `<a href="java&#x09;script&colon;x()">y</a>`, `<a href=" javascript\n:x()">y</a>`])
      expect(isInlineMarkup(bad)).toBe(false);
    expect(applyTextEdit(`<p>Hi</p>`, "Hi", `<img src=x onerror=alert(1)>`)).toEqual({ ok: false, reason: "markup" });
  });
});
