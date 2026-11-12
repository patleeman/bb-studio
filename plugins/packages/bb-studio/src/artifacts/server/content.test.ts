import { describe, expect, it } from "vitest";
import { SANDBOX_CSP, contentHeaders, rangeResponse, withQuoteScript } from "./content";
import { artifactType } from "../shared";

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

describe("media", () => {
  it("plays audio and video by name, with their own types", () => {
    expect(artifactType("office_theme.wav", "application/octet-stream")).toBe("audio");
    expect(artifactType("clip.mp4", "application/octet-stream")).toBe("video");
    expect(artifactType("voice", "audio/webm")).toBe("audio");
    expect(contentHeaders({ name: "office_theme.wav", mime: "application/octet-stream" }, new Uint8Array([1]))["content-type"]).toBe("audio/wav");
    expect(contentHeaders({ name: "clip.mov", mime: "video/quicktime" }, new Uint8Array([1]))["content-type"]).toBe("video/quicktime");
  });

  it("answers a player's range requests", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const whole = rangeResponse(bytes, { "content-type": "audio/wav" }, undefined);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    const part = rangeResponse(bytes, { "content-type": "audio/wav" }, "bytes=2-4");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4]);
    expect((rangeResponse(bytes, {}, "bytes=-3").headers.get("content-range"))).toBe("bytes 7-9/10");
    expect(rangeResponse(bytes, {}, "bytes=20-").status).toBe(416);
  });
});
