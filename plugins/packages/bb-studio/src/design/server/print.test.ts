import { describe, expect, it } from "vitest";
import { printCsp, printPage } from "./print";

describe("Export PDF", () => {
  const html = printPage({ title: "Deck <1>", width: 1920, height: 1080, nonce: "n0", frames: [{ url: "/s?a=1&b=2#title", label: "Title" }, { url: "/s#plan", label: "Plan" }] });

  it("prints one page per frame at the frame's size", () => {
    expect(html).toContain("@page { size: 1920px 1080px; margin: 0; }");
    expect(html.match(/<section class="page">/g)).toHaveLength(2);
    expect(html).toContain('src="/s?a=1&#38;b=2#title"');
    expect(html).toContain("<title>Deck &#60;1&#62;</title>");
  });

  it("keeps screens sandboxed and runs only its own script", () => {
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('<script nonce="n0">');
    expect(printCsp("n0")).toContain("script-src 'nonce-n0'");
    expect(printCsp("n0")).toContain("frame-src 'self'");
  });
});
