import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { findImages, ImageCache, wikipediaImage, IMAGE_CACHE_MS, mainImage, pickExaImage, pickWikipediaImage, pinnedTransport, privateAddress, safeFetch, stripTracking, wikipediaSearchText, type Transport } from "./image";
import { CANVAS_MIGRATIONS } from "./migrations";

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

  it("searches Wikipedia by the thing's name and takes the article that names it", () => {
    expect(wikipediaSearchText("Tetris DX Game Boy Color box art")).toBe("Tetris DX Game Boy Color");
    expect(wikipediaSearchText("cover")).toBe("cover");
    const pic = (name: string) => ({ source: `https://upload.wikimedia.org/${name}.jpg`, width: 300, height: 400 });
    const hits = [
      { title: "Tetris (Game Boy video game)", index: 1, original: pic("tetris-gb") },
      { title: "Tetris DX", index: 2, fullurl: "https://en.wikipedia.org/wiki/Tetris_DX", original: pic("tetris-dx") },
      { title: "List of best-selling Game Boy video games", index: 3, original: pic("list") },
      { title: "Game Boy Color", index: 5, original: pic("gbc") },
    ];
    expect(pickWikipediaImage(hits, "Tetris DX Game Boy Color box art")).toEqual({ url: "https://upload.wikimedia.org/tetris-dx.jpg", alt: "Tetris DX", source: "https://en.wikipedia.org/wiki/Tetris_DX", width: 300, height: 400 });
    // No hit names it: search order, lists last, vector art skipped.
    expect(pickWikipediaImage([{ title: "List of Metal Gear media", index: 1, original: pic("list") }, { title: "Logo", index: 2, original: { source: "https://upload.wikimedia.org/a.svg" } }, { title: "Metal Gear: Ghost Babel", index: 3, original: pic("babel") }], "Metal Gear Solid Game Boy Color")?.url).toBe("https://upload.wikimedia.org/babel.jpg");
    expect(pickWikipediaImage([{ title: "No picture", index: 1 }], "x")).toBeNull();
    // Only the platform matched: nothing, rather than a picture of a Game Boy.
    expect(pickWikipediaImage([{ title: "List of Game Boy Color games", index: 1, original: pic("list") }, { title: "Game Boy Color", index: 2, original: pic("gbc") }], "Link's Awakening DX Game Boy Color cartridge")).toBeNull();
  });

  it("searches again with just the name when no hit is about the thing", async () => {
    const searched: string[] = [];
    const transport: Transport = async (url) => {
      const search = url.searchParams.get("gsrsearch")!;
      searched.push(search);
      const pages = search === "Link's Awakening DX"
        ? [{ title: "The Legend of Zelda: Link's Awakening DX", index: 1, original: { source: "https://upload.wikimedia.org/la-dx.png" } }]
        : [{ title: "Game Boy Color", index: 1, original: { source: "https://upload.wikimedia.org/gbc.png" } }];
      return { status: 200, location: null, type: "application/json", body: (async function* () { yield new TextEncoder().encode(JSON.stringify({ query: { pages } })); })(), close() {} };
    };
    const found = await wikipediaImage("Link's Awakening DX Game Boy Color cartridge box art", { transport, lookup: async () => [{ address: "93.184.216.34" }] });
    expect(searched).toEqual(["Link's Awakening DX Game Boy Color", "Link's Awakening DX"]);
    expect(found?.url).toBe("https://upload.wikimedia.org/la-dx.png");
  });

  it("looks a batch up in parallel, in the order asked, one failure not stopping the rest", async () => {
    let inFlight = 0, most = 0;
    const transport: Transport = async (url) => {
      inFlight++; most = Math.max(most, inFlight);
      await new Promise((done) => setTimeout(done, 30));
      inFlight--;
      const search = url.searchParams.get("gsrsearch")!;
      if (search === "broken") throw new Error("timed out");
      const pages = [{ title: search, index: 1, original: { source: `https://upload.wikimedia.org/${search}.jpg` } }];
      return { status: 200, location: null, type: "application/json", body: (async function* () { yield new TextEncoder().encode(JSON.stringify({ query: { pages } })); })(), close() {} };
    };
    const items = ["a", "b", "broken", "d", "e", "f"].map((name) => ({ key: `k-${name}`, query: name }));
    const started = Date.now();
    const found = await findImages(items, { exaKey: async () => "", transport, lookup: async () => [{ address: "93.184.216.34" }] });
    expect(Date.now() - started).toBeLessThan(150);
    expect(most).toBe(6);
    expect(Object.keys(found)).toEqual(items.map((item) => item.key));
    expect(found["k-a"]).toMatchObject({ url: "https://upload.wikimedia.org/a.jpg" });
    expect(found["k-broken"]).toMatchObject({ error: expect.stringContaining("timed out") });
  });

  it("keeps found pictures for a day, in memory and in the database", () => {
    const db = new Database(":memory:");
    for (const statement of CANVAS_MIGRATIONS) db.exec(statement);
    let now = 1_000_000;
    const cache = new ImageCache(db, () => now);
    const image = { url: "https://upload.wikimedia.org/a.jpg", alt: "A", source: "https://en.wikipedia.org/wiki/A" };
    cache.set("q:a", image);
    expect(cache.get("q:a")).toEqual(image);
    // A new process (a fresh cache on the same database) still has it.
    expect(new ImageCache(db, () => now).get("q:a")).toEqual(image);
    now += IMAGE_CACHE_MS + 1;
    expect(cache.get("q:a")).toBeNull();
    expect(new ImageCache(db, () => now).get("q:a")).toBeNull();
  });
});
