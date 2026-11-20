// Ported from Agent Plugins: the OAuth callback URL (callback-url.test.ts) and
// the HTTP redirect guard (gateway.test.ts), adjusted to Studio's route.
import * as http from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { oauthCallbackUrl, validatePastedCallback } from "../server/callback-url";
import { redirectGuardFetch } from "../server/engine";

const servers: http.Server[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

describe("MCP OAuth loopback callback", () => {
  const expected = "http://localhost:38886/api/v1/plugins/studio/http/tool-gateway/oauth/callback?serverId=fastmail";

  it("uses localhost even when BB has a remote public URL", () => {
    expect(oauthCallbackUrl("http://127.0.0.1:38886", "studio", "fastmail").toString()).toBe(expected);
  });

  it("keeps an address that is already localhost", () => {
    expect(oauthCallbackUrl("http://localhost:38886", "studio", "fastmail").toString()).toBe(expected);
  });

  it("only accepts loopback as the callback base", () => {
    expect(() => oauthCallbackUrl("http://remote.example:38886", "studio", "fastmail")).toThrow();
  });

  it("accepts the whole pasted callback URL after a browser sign-in", () => {
    const params = validatePastedCallback(`${expected}&code=one-time-code&state=nonce`, new URL(expected));
    expect(params.get("code")).toBe("one-time-code");
    expect(params.get("state")).toBe("nonce");
  });

  it.each([
    "https://attacker.example/oauth/callback?code=secret&state=nonce",
    "http://localhost:38886/other?code=secret&state=nonce",
    "http://localhost:38886/api/v1/plugins/studio/http/tool-gateway/oauth/callback?serverId=other&code=secret&state=nonce",
  ])("refuses a callback from another URL or server without repeating it (%s)", (pasted) => {
    expect(() => validatePastedCallback(pasted, new URL(expected))).toThrow("Callback URL does not match this MCP connection");
  });
});

describe("redirectGuardFetch", () => {
  it("keeps fixed headers on legacy SSE session posts without leaking them to OAuth endpoints", async () => {
    const seen: Record<string, string | undefined>[] = [];
    const server = http.createServer((request, response) => {
      const fixed = request.headers["x-fixed"];
      seen.push({ path: request.url, fixed: typeof fixed === "string" ? fixed : undefined });
      response.writeHead(200);
      response.end("ok");
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const guarded = redirectGuardFetch(new URL(`${base}/sse`), { "X-Fixed": "secret" });
    const post = (path: string, contentType: string, body: string) => guarded(`${base}${path}`, { method: "POST", headers: { "content-type": contentType }, body });
    await post("/messages?session=1", "application/json", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" }));
    await post("/register", "application/json", JSON.stringify({ client_name: "BB Studio Tool Gateway" }));
    await post("/token", "application/x-www-form-urlencoded", "grant_type=authorization_code");
    await guarded(`${base}/sse`, { method: "GET", headers: { accept: "application/json" } });
    await post("/sse", "application/json", JSON.stringify({ client_name: "BB Studio Tool Gateway" }));
    await post("/sse", "application/x-www-form-urlencoded", "grant_type=authorization_code");
    await post("/sse", "application/json", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize" }));
    await guarded(`${base}/sse`, { method: "DELETE" });
    expect(seen).toEqual([
      { path: "/messages?session=1", fixed: "secret" },
      { path: "/register", fixed: undefined },
      { path: "/token", fixed: undefined },
      { path: "/sse", fixed: undefined },
      { path: "/sse", fixed: undefined },
      { path: "/sse", fixed: undefined },
      { path: "/sse", fixed: "secret" },
      { path: "/sse", fixed: "secret" },
    ]);
  });

  it("refuses redirects", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(302, { location: "https://elsewhere.example/" });
      response.end();
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const guarded = redirectGuardFetch(new URL(`http://127.0.0.1:${port}/mcp`), undefined);
    await expect(guarded(`http://127.0.0.1:${port}/mcp`)).rejects.toThrow(/redirect blocked/);
  });

  it("bounds stalled OAuth and MCP HTTP requests", async () => {
    const server = http.createServer(() => { /* Never answers. */ });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const guarded = redirectGuardFetch(new URL(`http://127.0.0.1:${port}/mcp`), undefined, 30);
    await expect(guarded(`http://127.0.0.1:${port}/mcp`)).rejects.toThrow(/timed out|aborted/i);
    server.closeAllConnections();
  });
});
