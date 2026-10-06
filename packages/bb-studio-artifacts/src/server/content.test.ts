import { describe, expect, it } from "vitest";
import { SANDBOX_CSP, contentHeaders, withQuoteScript } from "./content";

const text = (value: string) => new Uint8Array(Buffer.from(value));

describe("contentHeaders", () => {
  it("sandboxes HTML and serves it as HTML", () => {
    const headers = contentHeaders({ name: "page.html", mime: "text/html" }, text("<h1>x</h1>"));
    expect(headers).toMatchObject({ "content-type": "text/html; charset=utf-8", "content-security-policy": SANDBOX_CSP, "x-content-type-options": "nosniff" });
  });

  it("sandboxes SVG and other images", () => {
    for (const [name, mime] of [["a.svg", "image/svg+xml"], ["a.png", "image/png"]]) {
      expect(contentHeaders({ name, mime }, text("x"))).toMatchObject({ "content-type": mime, "content-security-policy": SANDBOX_CSP });
    }
  });

  it("serves a real PDF unsandboxed, for the browser's viewer", () => {
    const headers = contentHeaders({ name: "a.pdf", mime: "application/pdf" }, text("%PDF-1.7 ..."));
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-security-policy"]).toBeUndefined();
  });

  it("sandboxes a .pdf that isn't one", () => {
    const headers = contentHeaders({ name: "a.pdf", mime: "application/pdf" }, text("<script>alert(1)</script>"));
    expect(headers["content-type"]).toBe("application/octet-stream");
    expect(headers["content-security-policy"]).toBe(SANDBOX_CSP);
  });

  it("serves text types as plain text and the rest as bytes", () => {
    expect(contentHeaders({ name: "a.md", mime: "text/markdown" }, text("#"))["content-type"]).toBe("text/plain; charset=utf-8");
    expect(contentHeaders({ name: "a.ts", mime: "text/plain" }, text("x"))["content-type"]).toBe("text/plain; charset=utf-8");
    expect(contentHeaders({ name: "a.zip", mime: "application/zip" }, text("PK"))["content-type"]).toBe("application/octet-stream");
  });

  it("names downloads safely", () => {
    const headers = contentHeaders({ name: 'rapport "été".md', mime: "text/markdown" }, text("#"), { download: true });
    expect(headers["content-disposition"]).toBe(`attachment; filename="rapport __t__.md"; filename*=UTF-8''rapport%20%22%C3%A9t%C3%A9%22.md`);
  });
});

describe("withQuoteScript", () => {
  const html = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");

  it("adds the script before the closing body tag", () => {
    const out = html(withQuoteScript(text("<html><body><p>Hi</p></BODY></html>")));
    expect(out).toMatch(/<p>Hi<\/p><script>[\s\S]*bb-artifact-selection[\s\S]*<\/script><\/BODY><\/html>$/);
  });

  it("finds the closing body tag after text that lowercases longer", () => {
    const out = html(withQuoteScript(text("<html><body><p>İİİ</p></body></html>")));
    expect(out).toMatch(/<p>İİİ<\/p><script>[\s\S]*<\/script><\/body><\/html>$/);
  });

  it("appends it to a fragment without a body", () => {
    expect(html(withQuoteScript(text("<h1>x</h1>")))).toMatch(/^<h1>x<\/h1><script>/);
  });
});
