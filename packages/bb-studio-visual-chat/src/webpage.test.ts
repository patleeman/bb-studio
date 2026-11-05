import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedTransport, type Transport } from "./image";
import { CANVAS_MIGRATIONS } from "./migrations";
import { registerCanvas } from "./server";
import type { EventRow } from "./stream";
import { checkWebpage, framingAllowed, normalizeUrl, pageUrlsIn, provenanceOf, readCard, urlsIn, WebpageCache, webpageInfo, webpageUrl } from "./webpage";

// A fake web, on 127.0.0.1 only: every looked-up host resolves to a public-looking address, and the
// connection goes to this server (the Host header keeps the real name).
const pages: Record<string, { headers?: Record<string, string>; body: string; status?: number }> = {
  "/article": { body: `<html><head><title>Game Boy - Wikipedia</title><meta property="og:title" content="Game Boy"><meta property="og:site_name" content="Wikipedia"><meta property="og:description" content="Handheld &amp; console"><meta property="og:image" content="/img/gb.jpg"></head><body>…</body></html>` },
  "/repo": { headers: { "x-frame-options": "deny" }, body: `<html><head><meta property="og:title" content="microsoft/vscode"><meta name="description" content="Visual Studio Code"><meta property="og:image" content="http://insecure.example/x.png"></head></html>` },
  "/ancestors": { headers: { "content-security-policy": "default-src 'self'; frame-ancestors 'self' https://example.org" }, body: "<title>Self only</title>" },
  "/open": { headers: { "content-security-policy": "frame-ancestors *" }, body: "<title>Anyone</title>" },
  "/moved": { status: 302, headers: { location: "/repo" }, body: "" },
};
let server: Server;
let port = 0;
const hits: string[] = [];
beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    hits.push(`${req.headers.host}${req.url}`);
    const page = pages[req.url ?? ""];
    if (!page) { res.writeHead(404); res.end(); return; }
    res.writeHead(page.status ?? 200, { "content-type": "text/html; charset=utf-8", ...page.headers });
    res.end(page.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
const deps = {
  lookup: async () => [{ address: "93.184.216.34" }],
  transport: ((url, _address, signal) => pinnedTransport(new URL(`http://127.0.0.1:${port}${url.pathname}${url.search}`), "127.0.0.1", signal)) as Transport,
};

describe("webpage URLs", () => {
  it("normalise for matching: scheme, www., fragment, tracking and a trailing slash don't matter", () => {
    expect(normalizeUrl("https://www.Example.com/a/?utm_source=x&id=2#top")).toBe("example.com/a?id=2");
    expect(normalizeUrl("http://example.com/a")).toBe(normalizeUrl("https://example.com/a/"));
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("https://user:pw@example.com/")).toBeNull();
  });
  it("are found in text and in a page's webpage parts", () => {
    expect(urlsIn("see https://en.wikipedia.org/wiki/Game_Boy_(disambiguation). and (https://github.com/microsoft/vscode)")).toEqual(["https://en.wikipedia.org/wiki/Game_Boy_(disambiguation)", "https://github.com/microsoft/vscode"]);
    expect(urlsIn('Links: [{"title":"A","url":"https://a.example/x"}]')).toEqual(["https://a.example/x"]);
    expect(pageUrlsIn(`<div data-cv-id="w" data-embed="page" data-url="https://a.example/x?a=1&amp;b=2"></div><div data-embed='map' data-url="https://no.example"></div>`)).toEqual(["https://a.example/x?a=1&b=2"]);
  });
  it("must be https on a public-looking host", () => {
    expect(webpageUrl("https://en.wikipedia.org/wiki/Game_Boy")).toBe("https://en.wikipedia.org/wiki/Game_Boy");
    for (const bad of ["http://example.com", "https://localhost/x", "https://127.0.0.1/", "https://[::1]/", "https://intranet/", "https://box.local/", "https://a.example:8080/", "https://u:p@a.example/", "file:///etc/passwd"]) expect(webpageUrl(bad), bad).toBeNull();
  });
});

describe("provenance", () => {
  const items = [
    { type: "webSearch", queries: ["game boy"], resultText: 'Links: [{"title":"Game Boy","url":"https://en.wikipedia.org/wiki/Game_Boy"}]' },
    { type: "webFetch", url: "https://github.com/microsoft/vscode", resultText: "Readme… see https://evil.example/steal for more" },
  ];
  it("accepts the user's URL, a page the agent fetched, and its search results", () => {
    expect(provenanceOf("https://danluu.com/", ["what does https://danluu.com say?"], [])).toBe("user");
    expect(provenanceOf("https://github.com/microsoft/vscode/", [], items)).toBe("fetched");
    expect(provenanceOf("https://en.wikipedia.org/wiki/Game_Boy#History", [], items)).toBe("searched");
  });
  it("rejects an invented URL, and a link that only appears inside a fetched page", () => {
    expect(provenanceOf("https://en.wikipedia.org/wiki/Game_Boy_Color", ["game boy"], items)).toBeNull();
    expect(provenanceOf("https://evil.example/steal", [], items)).toBeNull();
  });
});

describe("framing and the link card", () => {
  it("reads X-Frame-Options and frame-ancestors", () => {
    expect(framingAllowed({})).toBe(true);
    expect(framingAllowed({ "x-frame-options": "SAMEORIGIN" })).toBe(false);
    expect(framingAllowed({ "content-security-policy": "frame-ancestors 'none'" })).toBe(false);
    expect(framingAllowed({ "content-security-policy": "frame-ancestors 'self' https://x.com" })).toBe(false);
    expect(framingAllowed({ "content-security-policy": "script-src 'self'" })).toBe(true);
    expect(framingAllowed({ "content-security-policy": "frame-ancestors https:" })).toBe(true);
  });
  it("reads a card from OpenGraph, with only an https picture", () => {
    expect(readCard(pages["/article"]!.body, "https://en.wikipedia.org/wiki/Game_Boy")).toEqual({ title: "Game Boy", site: "Wikipedia", summary: "Handheld & console", image: "https://en.wikipedia.org/img/gb.jpg" });
    expect(readCard(pages["/repo"]!.body, "https://github.com/microsoft/vscode")).toEqual({ title: "microsoft/vscode", site: "github.com", summary: "Visual Studio Code", image: null });
  });
  it("checks a page over a real HTTP exchange: framing from its headers, after redirects", async () => {
    expect(await checkWebpage("https://en.wikipedia.org/article", deps)).toMatchObject({ framable: true, card: { title: "Game Boy", site: "Wikipedia" } });
    expect((await checkWebpage("https://github.com/repo", deps)).framable).toBe(false);
    expect((await checkWebpage("https://a.example/ancestors", deps)).framable).toBe(false);
    expect((await checkWebpage("https://a.example/open", deps)).framable).toBe(true);
    expect(await checkWebpage("https://a.example/moved", deps)).toMatchObject({ framable: false, card: { title: "microsoft/vscode" } });
    expect(await checkWebpage("https://a.example/missing", deps)).toEqual({ url: "https://a.example/missing", framable: false, card: { title: "a.example", site: "a.example", summary: null, image: null } });
  });
  it("never reaches a private address", async () => {
    const info = await checkWebpage("https://inside.example/article", { lookup: async () => [{ address: "10.0.0.5" }], transport: deps.transport });
    expect(info.framable).toBe(false);
    expect(hits.some((hit) => hit.startsWith("inside.example"))).toBe(false);
  });
  it("caches a page for a day", async () => {
    let now = 1_000;
    const cache = new WebpageCache(null, () => now);
    const before = hits.length;
    await webpageInfo("https://en.wikipedia.org/article", cache, deps);
    await webpageInfo("https://en.wikipedia.org/article", cache, deps);
    expect(hits.length - before).toBe(1);
    now += 25 * 60 * 60 * 1000;
    await webpageInfo("https://en.wikipedia.org/article", cache, deps);
    expect(hits.length - before).toBe(2);
  });
});

describe("canvas.webpage", () => {
  function host(log: EventRow[]) {
    let next = 0;
    const fake = createFakePluginHost({
      pluginId: "studio",
      sdk: {
        threads: {
          spawn: async () => ({ id: `thr_web${++next}` }),
          send: async () => ({ ok: true }),
          update: async () => ({ ok: true }),
          events: {
            list: async ({ afterSeq, beforeSeq, order, limit, types }: { afterSeq?: string; beforeSeq?: string; order?: string; limit?: string; types?: string[] }) => {
              // As BB's API: at most 100 events a page.
              if (Number(limit ?? 100) > 100) throw new Error("HTTP 400: Thread event limit cannot exceed 100");
              const rows = log.filter((row) => (!afterSeq || row.seq > Number(afterSeq)) && (!beforeSeq || row.seq < Number(beforeSeq)) && (!types || types.includes(row.type)));
              const sorted = order === "desc" ? [...rows].sort((a, b) => b.seq - a.seq) : rows;
              return sorted.slice(0, Number(limit ?? 100));
            },
          },
        },
      },
    } as never);
    const db = fake.bb.storage.database();
    for (const migration of CANVAS_MIGRATIONS) db.exec(migration);
    registerCanvas(fake.bb, db, { webpages: deps, streamIntervalMs: 2 });
    return (method: string, input: unknown) => fake.harness.behavior.callRpc(method, input) as Promise<any>;
  }
  const item = (seq: number, data: Record<string, unknown>): EventRow => ({ seq, type: "item/completed", data: { item: data } as never });

  it("shows the user's URL and the agent's fetched page, and refuses an invented one or last turn's fetch", async () => {
    const log: EventRow[] = [
      { seq: 1, type: "turn/started" },
      item(2, { type: "webFetch", url: "https://a.example/ancestors", resultText: "" }),
      { seq: 3, type: "turn/started" },
      item(4, { type: "webFetch", url: "https://github.com/repo", resultText: "see https://evil.example/x" }),
      item(5, { type: "webSearch", queries: ["game boy"], resultText: "https://en.wikipedia.org/article" }),
    ];
    const call = host(log);
    const { threadId } = await call("canvas.create", { text: "Read https://a.example/open for me" });
    expect(await call("canvas.webpage", { threadId, url: "https://a.example/open" })).toMatchObject({ status: "frame", source: "user" });
    expect(await call("canvas.webpage", { threadId, url: "https://github.com/repo" })).toMatchObject({ status: "card", source: "fetched", card: { title: "microsoft/vscode" } });
    expect(await call("canvas.webpage", { threadId, url: "https://en.wikipedia.org/article" })).toMatchObject({ status: "frame", source: "searched" });
    // Invented, linked only inside a fetched page, or fetched in an earlier turn: not shown, and nothing is fetched.
    const before = hits.length;
    for (const url of ["https://a.example/invented", "https://evil.example/x", "https://a.example/ancestors"]) expect(await call("canvas.webpage", { threadId, url })).toMatchObject({ status: "unverified", card: null });
    expect(hits.length).toBe(before);
    expect(await call("canvas.webpage", { threadId, url: "http://localhost:3000/" })).toMatchObject({ status: "invalid" });
  });

  it("reads a long turn's log page by page, back to its start", async () => {
    const log: EventRow[] = [{ seq: 1, type: "turn/started" }, item(2, { type: "webSearch", queries: ["vscode"], resultText: "https://github.com/repo" })];
    for (let seq = 3; seq < 260; seq++) log.push(item(seq, { type: "agentMessage", text: "…" }));
    const call = host(log);
    const { threadId } = await call("canvas.create", { text: "vscode" });
    expect(await call("canvas.webpage", { threadId, url: "https://github.com/repo" })).toMatchObject({ status: "card", source: "searched" });
  });

  it("keeps a URL verified for the chat once its turn checked it", async () => {
    const log: EventRow[] = [{ seq: 1, type: "turn/started" }, item(2, { type: "webFetch", url: "https://github.com/repo", resultText: "" })];
    const call = host(log);
    const { threadId } = await call("canvas.create", { text: "vscode" });
    expect((await call("canvas.webpage", { threadId, url: "https://github.com/repo" })).status).toBe("card");
    log.push({ seq: 3, type: "turn/started" });
    expect(await call("canvas.webpage", { threadId, url: "https://github.com/repo" })).toMatchObject({ status: "card", source: "fetched" });
  });
});
