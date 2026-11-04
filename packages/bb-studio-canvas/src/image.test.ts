import { describe, expect, it } from "vitest";
import { mainImage, pickExaImage, pinnedTransport, privateAddress, safeFetch, stripTracking, type Transport } from "./image";

describe("canvas_image", () => {
  it("treats private, loopback, link-local and mapped addresses as off limits", () => {
    for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::", "fd00::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1", "not-an-ip"]) expect(privateAddress(address), address).toBe(true);
    for (const address of ["93.184.216.34", "2606:4700::1111", "172.32.0.1"]) expect(privateAddress(address), address).toBe(false);
  });

  it("re-checks every redirect and refuses non-http(s) addresses", async () => {
    const lookup = async (host: string) => [{ address: host === "public.example.com" ? "93.184.216.34" : "127.0.0.1" }];
    const transport: Transport = async () => ({ status: 302, location: "http://internal.example.com/admin", type: "", body: null, close() {} });
    await expect(safeFetch("https://public.example.com/", { transport, lookup })).rejects.toThrow(/isn't a public web page/);
    await expect(safeFetch("file:///etc/passwd", { transport, lookup })).rejects.toThrow(/Only http/);
    await expect(safeFetch("https://user:pw@public.example.com/", { transport, lookup })).rejects.toThrow(/credentials/);
  });

  it("connects to the address it checked, even when the resolver changes its answer (DNS rebinding)", async () => {
    let calls = 0;
    // First answer public, every later answer the metadata service.
    const lookup = async () => (calls++ === 0 ? [{ address: "93.184.216.34" }] : [{ address: "169.254.169.254" }]);
    const connected: { host: string; address: string }[] = [];
    const transport: Transport = async (url, address) => {
      connected.push({ host: url.hostname, address });
      return { status: 200, location: null, type: "text/html", body: (async function* () { yield new TextEncoder().encode("<title>ok</title>"); })(), close() {} };
    };
    const page = await safeFetch("https://rebind.example.com/page", { transport, lookup });
    expect(page.text).toBe("<title>ok</title>");
    expect(calls).toBe(1);
    expect(connected).toEqual([{ host: "rebind.example.com", address: "93.184.216.34" }]);
    // A redirect back to the same name is resolved again, and now refused.
    const redirecting: Transport = async () => ({ status: 301, location: "https://rebind.example.com/second", type: "", body: null, close() {} });
    calls = 0;
    await expect(safeFetch("https://rebind.example.com/page", { transport: redirecting, lookup })).rejects.toThrow(/isn't a public web page/);
    // Any private answer among several fails the check.
    await expect(safeFetch("https://mixed.example.com/", { transport, lookup: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }] })).rejects.toThrow(/isn't a public/);
  });

  it("pins the real connection to the checked address while keeping the host name", async () => {
    // A server on loopback, reached through a name that resolves elsewhere: the pinned lookup connects to the given address.
    const { createServer } = await import("node:http");
    const server = createServer((request, response) => { response.end(`host=${request.headers.host}`); });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const port = (server.address() as { port: number }).port;
    const exchange = await pinnedTransport(new URL(`http://pinned.example.invalid:${port}/`), "127.0.0.1", new AbortController().signal);
    let body = "";
    for await (const chunk of exchange.body!) body += new TextDecoder().decode(chunk);
    server.close();
    expect(exchange.status).toBe(200);
    expect(body).toBe(`host=pinned.example.invalid:${port}`);
  });

  it("drops tracking parameters from picture addresses", () => {
    expect(stripTracking("https://upload.wikimedia.org/a.png?utm_source=en.wikipedia.org&utm_campaign=index&width=600&fbclid=x")).toBe("https://upload.wikimedia.org/a.png?width=600");
    expect(mainImage('<meta property="og:image" content="https://upload.wikimedia.org/x.jpg?utm_source=en.wikipedia.org&utm_content=thumbnail">', "https://en.wikipedia.org/wiki/X")?.url).toBe("https://upload.wikimedia.org/x.jpg");
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
