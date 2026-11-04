import { describe, expect, it } from "vitest";
import { mainImage, pickExaImage, privateAddress, safeFetch } from "./image";

describe("canvas_image", () => {
  it("treats private, loopback, link-local and mapped addresses as off limits", () => {
    for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"]) expect(privateAddress(address), address).toBe(true);
    for (const address of ["93.184.216.34", "2606:4700::1111", "172.32.0.1"]) expect(privateAddress(address), address).toBe(false);
  });

  it("re-checks every redirect and refuses non-http(s) addresses", async () => {
    const lookup = async (host: string) => [{ address: host === "public.example.com" ? "93.184.216.34" : "127.0.0.1" }];
    const fetch = (async () => new Response(null, { status: 302, headers: { location: "http://internal.example.com/admin" } })) as unknown as typeof globalThis.fetch;
    await expect(safeFetch("https://public.example.com/", { fetch, lookup })).rejects.toThrow(/isn't a public web page/);
    await expect(safeFetch("file:///etc/passwd", { fetch, lookup })).rejects.toThrow(/Only http/);
    await expect(safeFetch("https://user:pw@public.example.com/", { fetch, lookup })).rejects.toThrow(/credentials/);
  });

  it("takes og:image, else the largest content image, as https", () => {
    expect(mainImage('<meta content="http://cdn.example.com/a.jpg" property="og:image">', "https://site.example.com/p")?.url).toBe("https://cdn.example.com/a.jpg");
    const page = '<title>Box</title><img src="/logo.png" width="900" height="900"><img src="/small.jpg" width="100" height="100"><img src="/cover.jpg" width="600" height="800" alt="Cover">';
    expect(mainImage(page, "https://site.example.com/p")).toEqual({ url: "https://site.example.com/cover.jpg", alt: "Cover", source: "https://site.example.com/p", width: 600, height: 800 });
    expect(mainImage("<p>no pictures</p>", "https://site.example.com/")).toBeNull();
  });

  it("prefers Exa candidates that match the query, skipping logos and vector art", () => {
    const picked = pickExaImage([
      { url: "https://a.example.com", title: "Store", image: "https://a.example.com/logo.png", extras: { richImageLinks: [{ url: "https://a.example.com/pokemon-red-box.jpg", alt: "Pokemon Red box art" }] } },
      { url: "https://b.example.com", title: "Something else", image: "https://b.example.com/hero.jpg" },
    ], "Pokemon Red box art");
    expect(picked).toEqual({ url: "https://a.example.com/pokemon-red-box.jpg", alt: "Pokemon Red box art", source: "https://a.example.com" });
    expect(pickExaImage([], "x")).toBeNull();
  });
});
