import { describe, expect, it } from "vitest";
import { decodeBody, fetchUrl, keepValue, parseFeed, runScript, scriptHash, type Exec, type Fetch } from "./sources";

const respond = (body: string | Uint8Array | ReadableStream<Uint8Array>, init: ResponseInit = {}) => new Response(body as BodyInit, init);

describe("fetchUrl", () => {
  it("follows a few redirects, each to http or https", async () => {
    const seen: string[] = [];
    const fetch: Fetch = async (url) => {
      seen.push(url);
      if (url.endsWith("/a")) return respond("", { status: 302, headers: { location: "/b" } });
      return respond("{\"ok\":true}", { headers: { "content-type": "application/json" } });
    };
    expect(await fetchUrl("https://example.com/a", { fetch })).toMatchObject({ text: "{\"ok\":true}", url: "https://example.com/b" });
    expect(seen).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("stops after five redirects and refuses other schemes", async () => {
    let hops = 0;
    const loop: Fetch = async () => { hops += 1; return respond("", { status: 301, headers: { location: `/r${hops}` } }); };
    await expect(fetchUrl("https://example.com/", { fetch: loop })).rejects.toThrow(/More than 5 redirects/);
    expect(hops).toBe(6);
    const toFile: Fetch = async () => respond("", { status: 302, headers: { location: "file:///etc/passwd" } });
    await expect(fetchUrl("https://example.com/", { fetch: toFile })).rejects.toThrow(/Only http and https/);
    await expect(fetchUrl("ftp://example.com/", { fetch: toFile })).rejects.toThrow(/Only http and https/);
  });

  it("caps the body at 2 MB, by header or while reading", async () => {
    const big: Fetch = async () => respond("x", { headers: { "content-length": String(3 * 1024 * 1024) } });
    await expect(fetchUrl("https://example.com/", { fetch: big })).rejects.toThrow(/over 2 MB/);
    let pulled = 0;
    const endless: Fetch = async () => respond(new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(256 * 1024)); } }));
    await expect(fetchUrl("https://example.com/", { fetch: endless })).rejects.toThrow(/over 2 MB/);
    expect(pulled).toBeLessThan(12);
  });

  it("times out and reports HTTP errors", async () => {
    const hang: Fetch = (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(fetchUrl("https://example.com/", { fetch: hang, timeoutMs: 20 })).rejects.toThrow(/Timed out after 0 s|Timed out/);
    const missing: Fetch = async () => respond("nope", { status: 404, statusText: "Not Found" });
    await expect(fetchUrl("https://example.com/", { fetch: missing })).rejects.toThrow("HTTP 404 Not Found");
  });
});

describe("decoding", () => {
  it("reads JSON and RSS and Atom feeds", () => {
    expect(decodeBody({ text: "[1,2]", contentType: "text/plain" })).toEqual([1, 2]);
    const rss = `<?xml version="1.0"?><rss><channel><title>News</title><item><title>One &amp; two</title><link>https://a.example/1</link><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Hello <b>world</b></p>]]></description></item></channel></rss>`;
    expect(decodeBody({ text: rss, contentType: "application/rss+xml" })).toEqual({
      title: "News",
      items: [{ title: "One & two", link: "https://a.example/1", date: "2026-10-12T10:00:00.000Z", summary: "Hello world" }],
    });
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>Post</title><link rel="alternate" href="https://b.example/p"/><updated>2026-10-01T00:00:00Z</updated><summary>Short</summary></entry></feed>`;
    expect(parseFeed(atom)?.items[0]).toEqual({ title: "Post", link: "https://b.example/p", date: "2026-10-01T00:00:00.000Z", summary: "Short" });
    expect(() => decodeBody({ text: "<html></html>", contentType: "text/html" })).toThrow(/neither JSON nor/);
    expect(() => decodeBody({ text: "{oops", contentType: "application/json" })).toThrow(/isn't valid JSON/);
  });

  it("selects into the result and caps what it keeps", () => {
    expect(keepValue({ data: { items: [{ v: 3 }] } }, "data.items[0].v")).toBe(3);
    expect(() => keepValue({ a: 1 }, "b")).toThrow(/Nothing at "b"/);
    expect(() => keepValue("x".repeat(1024 * 1024 + 1), undefined)).toThrow(/over 1024 KB/);
  });
});

describe("scripts", () => {
  const fake = (result: { error?: Error & { code?: unknown; killed?: boolean }; stdout?: string; stderr?: string }, seen?: unknown[]): Exec =>
    (file, args, options, done) => { seen?.push({ file, args, options }); done(result.error ?? null, result.stdout ?? "", result.stderr ?? ""); };

  it("pins approval to the exact command and directory", () => {
    expect(scriptHash({ command: "echo 1" })).toBe(scriptHash({ command: "echo 1" }));
    expect(scriptHash({ command: "echo 1" })).not.toBe(scriptHash({ command: "echo 1 " }));
    expect(scriptHash({ command: "echo 1" })).not.toBe(scriptHash({ command: "echo 1", cwd: "/tmp" }));
  });

  it("runs with a 30 s timeout and a 1 MB cap, and reads JSON or text", async () => {
    const seen: { options: { timeout: number; maxBuffer: number } }[] = [];
    expect(await runScript({ command: "echo" }, { exec: fake({ stdout: "{\"a\":1}\n" }, seen) })).toEqual({ a: 1 });
    expect(seen[0]!.options).toMatchObject({ timeout: 30_000, maxBuffer: 1024 * 1024 });
    expect(await runScript({ command: "echo" }, { exec: fake({ stdout: "42 users\n" }) })).toBe("42 users");
  });

  it("explains timeouts, big output and failures", async () => {
    await expect(runScript({ command: "x" }, { exec: fake({ error: Object.assign(new Error("killed"), { killed: true }) }) })).rejects.toThrow(/longer than 30 s/);
    await expect(runScript({ command: "x" }, { exec: fake({ error: Object.assign(new Error("big"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }) }) })).rejects.toThrow(/more than 1024 KB/);
    await expect(runScript({ command: "x" }, { exec: fake({ error: Object.assign(new Error("failed"), { code: 2 }), stderr: "no such file" }) })).rejects.toThrow("exited with code 2: no such file");
  });

  it.skipIf(process.platform === "win32")("really runs a command on this machine", async () => {
    expect(await runScript({ command: "printf '{\"n\": 7}'" })).toEqual({ n: 7 });
    await expect(runScript({ command: "sleep 2" }, { timeoutMs: 100 })).rejects.toThrow(/longer than 0 s|was stopped/);
  });
});
