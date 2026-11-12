import { describe, expect, it } from "vitest";
import type { Transport } from "../guarded-fetch";
import { fetchPreview, parsePreview } from "./unfurl";

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

describe("fetchPreview", () => {
  const resolve = async (host: string) => ({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.35"], "intranet.example": ["10.0.0.1"] })[host] ?? [];

  it("checks every hop and connects only to the addresses it checked", async () => {
    const pinned: [string, readonly string[]][] = [];
    const transport: Transport = async (url, _init, addresses) => {
      pinned.push([url.host, addresses]);
      if (url.host === "a.example") return new Response(null, { status: 301, headers: { location: "https://b.example/post" } });
      return new Response("<title>Post</title>", { headers: { "content-type": "text/html" } });
    };
    expect(await fetchPreview("https://a.example/", { resolve, transport })).toMatchObject({ title: "Post" });
    expect(pinned).toEqual([["a.example", ["93.184.216.34"]], ["b.example", ["93.184.216.35"]]]);
  });

  it("has no preview for a local link, or one that redirects to one", async () => {
    let hops = 0;
    const transport: Transport = async () => { hops += 1; return new Response(null, { status: 302, headers: { location: "http://intranet.example/" } }); };
    await expect(fetchPreview("https://a.example/", { resolve, transport })).rejects.toThrow("Local links have no preview.");
    await expect(fetchPreview("http://127.0.0.1:3000/", { resolve, transport })).rejects.toThrow("Local links have no preview.");
    await expect(fetchPreview("http://printer.local/", { resolve, transport })).rejects.toThrow("Local links have no preview.");
    expect(hops).toBe(1);
  });
});
