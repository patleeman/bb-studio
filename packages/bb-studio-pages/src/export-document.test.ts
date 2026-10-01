import { describe, expect, it } from "vitest";
import { pageHtml, pagePdf } from "./export-document";

describe("page exports", () => {
  it("renders headings and escapes untrusted HTML", () => {
    const html = pageHtml("A <title>", "## Section\n\nHello **world**\n\n<script>alert(1)</script>");
    expect(html).toContain("<h2>Section</h2>");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("A &lt;title&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("@media print");
  });
  it("creates a PDF document", async () => {
    expect(Buffer.from(await pagePdf("Review", "# Findings\n\nReady")).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
