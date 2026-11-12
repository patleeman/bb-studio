import { createServer, type IncomingHttpHeaders } from "node:http";
import { createServer as createTlsServer } from "node:tls";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { guardedFetch, isPrivateAddress, pinnedTransport, PrivateAddressError, type Transport } from "./guarded-fetch";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const listen = async <T extends { listen(port: number, host: string, done: () => void): unknown; address(): unknown; close(done: () => void): unknown }>(server: T) => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  closers.push(() => new Promise((done) => server.close(() => done())));
  return (server.address() as AddressInfo).port;
};

const get = { method: "GET", headers: {}, body: null };
const ok: Transport = async () => new Response("ok");

describe("isPrivateAddress", () => {
  it("refuses loopback, private, link-local, metadata and other non-public addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::", "::1", "fd00::1", "fd00:ec2::254", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "not-an-ip"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1::")).toBe(false);
  });
});

describe("guardedFetch", () => {
  it("refuses a host that resolves to this machine or a private network, before connecting", async () => {
    let connected = false;
    const transport: Transport = async () => { connected = true; return new Response("secret"); };
    for (const [url, addresses] of [
      ["http://router.example/", ["192.168.1.1"]],
      ["http://mixed.example/", ["93.184.216.34", "127.0.0.1"]],
      ["http://none.example/", []],
      ["http://127.0.0.1:8080/", []],
      ["http://2130706433/", []],
      ["http://[::1]/", []],
      ["http://169.254.169.254/latest/meta-data/", []],
    ] as const) {
      await expect(guardedFetch(new URL(url), get, { resolve: async () => [...addresses], transport })).rejects.toThrow(PrivateAddressError);
    }
    expect(connected).toBe(false);
  });

  it("says what it refused, in the caller's words", async () => {
    await expect(guardedFetch(new URL("http://localhost:3000/"), get, { resolve: async () => ["127.0.0.1"], transport: ok, refuse: (host) => `No ${host} for you.` })).rejects.toThrow("No localhost for you.");
    await expect(guardedFetch(new URL("http://localhost:3000/"), get, { resolve: async () => ["127.0.0.1"], transport: ok })).rejects.toThrow(/localhost is on this machine or a private network/);
  });

  it("connects to the addresses it checked, so a second DNS answer can't point it elsewhere", async () => {
    const answers = [["93.184.216.34"], ["127.0.0.1"]];
    let lookups = 0;
    const pinned: (readonly string[])[] = [];
    const transport: Transport = async (_url, _init, addresses) => { pinned.push(addresses); return new Response("ok"); };
    const response = await guardedFetch(new URL("https://rebind.example/"), get, { resolve: async () => answers[lookups++]!, transport });
    expect(await response.text()).toBe("ok");
    expect(lookups).toBe(1);
    expect(pinned).toEqual([["93.184.216.34"]]);
  });
});

describe("pinnedTransport", () => {
  it("connects to the pinned address and keeps the URL's host in the Host header", async () => {
    const seen: { headers: IncomingHttpHeaders; url?: string; body: string }[] = [];
    const port = await listen(createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        seen.push({ headers: request.headers, url: request.url, body });
        response.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip", "set-cookie": ["a=1", "b=2"] });
        response.end(gzipSync("hello from the pinned address"));
      });
    }));
    // .invalid never resolves, so reaching the server proves the pinned address was used.
    const response = await pinnedTransport(new URL(`http://pinned.invalid:${port}/path?q=1`), { method: "POST", headers: { "x-test": "1", host: "evil.example" }, body: "{}" }, ["127.0.0.1"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("hello from the pinned address");
    expect(seen[0]).toMatchObject({ url: "/path?q=1", body: "{}", headers: { host: `pinned.invalid:${port}`, "x-test": "1", "content-length": "2" } });
  });

  it("sends the URL's host name as the TLS server name", async () => {
    let servername: string | null = null;
    const port = await listen(createTlsServer({
      SNICallback: (name, done) => { servername = name; done(new Error("no certificate here")); },
    }));
    await expect(pinnedTransport(new URL(`https://sni.invalid:${port}/`), get, ["127.0.0.1"])).rejects.toThrow();
    expect(servername).toBe("sni.invalid");
  });

  it("stops when the signal aborts", async () => {
    const port = await listen(createServer(() => { /* never answers */ }));
    const signal = AbortSignal.timeout(50);
    await expect(pinnedTransport(new URL(`http://slow.invalid:${port}/`), { ...get, signal }, ["127.0.0.1"])).rejects.toThrow(/aborted|timed? ?out/i);
  });
});
