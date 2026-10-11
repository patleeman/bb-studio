import { describe, expect, it } from "vitest";
import { isPrivateAddress, parsePreview } from "./unfurl";

describe("parsePreview", () => {
  it("prefers Open Graph tags and resolves a relative image", () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Offline sync &amp; more">
      <meta name="description" content='Plain description'>
      <meta property="og:image" content="/img/card.png">
      </head><body><meta property="og:title" content="Not this"></body></html>`;
    expect(parsePreview(html, new URL("https://example.com/blog/post"))).toEqual({
      title: "Offline sync & more",
      description: "Plain description",
      image: "https://example.com/img/card.png",
    });
  });

  it("falls back to the <title>", () => {
    expect(parsePreview("<title>\n  Hello&#x21; </title>", new URL("https://example.com"))).toEqual({ title: "Hello!", description: "", image: "" });
  });
});

describe("isPrivateAddress", () => {
  it("rejects local and private addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1::")).toBe(false);
  });
});
