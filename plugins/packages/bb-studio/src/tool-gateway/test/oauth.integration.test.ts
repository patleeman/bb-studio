// Ported from Agent Plugins (oauth.integration.test.ts): a fake OAuth MCP
// server over HTTP, run through Tool Gateway's engine.
import * as http from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { ToolGatewayEngine, type EngineDeps } from "../server/engine";
import { McpOAuthProvider, type OAuthCredentialRecord, type OAuthCredentialStore } from "../server/oauth";
import { configHash, defaultConfig, redact } from "../server/config";
import type { ServerRecord } from "../server/store";

const servers: http.Server[] = [];

class MemorySecrets implements OAuthCredentialStore {
  readonly records = new Map<string, OAuthCredentialRecord>();
  async get(key: string) { return this.records.get(key); }
  async set(key: string, value: OAuthCredentialRecord) { this.records.set(key, value); }
  async delete(key: string) { this.records.delete(key); }
}

function urlServer(id: string, url: string, headers: Record<string, string> = {}): { record: ServerRecord; values: { env: Record<string, string>; headers: Record<string, string> } } {
  const config = { ...defaultConfig("streamable-http"), url, headerNames: Object.keys(headers) };
  const values = { env: {}, headers };
  return {
    record: { id, label: id, config, enabled: true, approvedHash: configHash(config, values), approvedAt: 1, disabledTools: [], projects: null, source: "added", status: "stopped", lastError: null, approvedTools: null, createdAt: 1, updatedAt: 1 },
    values,
  };
}

function engineFor(server: ReturnType<typeof urlServer>, oauth: EngineDeps["oauth"], extra: Partial<EngineDeps> = {}) {
  const statuses: { status: string; error: string | null }[] = [];
  let changed = 0;
  const engine = new ToolGatewayEngine({
    server: (id) => (id === server.record.id ? server.record : null),
    secrets: () => server.values,
    blocked: () => null,
    serverDir: () => "/tmp",
    baseEnv: {},
    redact: (text) => redact(text, Object.values(server.values.headers)),
    log: () => {},
    setStatus: (_id, status, error) => { statuses.push({ status, error }); server.record = { ...server.record, status, lastError: error }; },
    changed: () => { changed += 1; },
    oauth,
    ...extra,
  });
  return { engine, statuses, changes: () => changed };
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: http.ServerResponse, value: unknown, status = 200, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("MCP SDK OAuth integration", () => {
  it("handles WWW-Authenticate discovery, dynamic registration, PKCE callback, and bearer retry", async () => {
    let port = 0;
    let mcpUrl = "";
    let protectedMetadata = "";
    let issuer = "";
    let authorizationUrl = "";
    let tokenRequests = 0;
    let requireAdditionalScope = false;
    const oauthRequestHeaders: Record<string, string | undefined>[] = [];
    let mcpHeader: string | undefined;
    const accessToken = "fixture-access-token";
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname.includes("oauth-protected-resource")) {
        oauthRequestHeaders.push({ fixed: headerValue(request.headers["x-fixed"]), authorization: headerValue(request.headers.authorization) });
        sendJson(response, { resource: mcpUrl, authorization_servers: [issuer] });
        return;
      }
      if (url.pathname.includes("oauth-authorization-server")) {
        oauthRequestHeaders.push({ fixed: headerValue(request.headers["x-fixed"]), authorization: headerValue(request.headers.authorization) });
        sendJson(response, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
        });
        return;
      }
      if (url.pathname.endsWith("/register")) {
        oauthRequestHeaders.push({ fixed: headerValue(request.headers["x-fixed"]), authorization: headerValue(request.headers.authorization) });
        await readBody(request);
        sendJson(response, { client_id: "fixture-client", redirect_uris: ["http://127.0.0.1/callback"], token_endpoint_auth_method: "none" });
        return;
      }
      if (url.pathname.endsWith("/token")) {
        oauthRequestHeaders.push({ fixed: headerValue(request.headers["x-fixed"]), authorization: headerValue(request.headers.authorization) });
        const body = await readBody(request);
        const form = new URLSearchParams(body);
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("code_verifier")).toBeTruthy();
        tokenRequests += 1;
        sendJson(response, { access_token: accessToken, token_type: "Bearer", refresh_token: "fixture-refresh-token", expires_in: 3600 });
        return;
      }
      if (url.pathname === "/auth/authorize") {
        authorizationUrl = url.toString();
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("fixture authorization page");
        return;
      }
      if (url.pathname === "/mcp") {
        mcpHeader = headerValue(request.headers["x-fixed"]);
        if (request.headers.authorization !== `Bearer ${accessToken}`) {
          response.setHeader("www-authenticate", `Bearer resource_metadata="${protectedMetadata}"`);
          response.writeHead(401);
          response.end();
          return;
        }
        const body = await readBody(request);
        if (!body.trim()) { response.writeHead(202); response.end(); return; }
        const message = JSON.parse(body) as { id: number; method: string };
        if (message.method === "initialize") {
          sendJson(response, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "oauth-fixture", version: "1" } } }, 200, { "mcp-session-id": "oauth-session" });
        } else if (message.method === "notifications/initialized") {
          response.writeHead(202); response.end();
        } else if (message.method === "tools/list") {
          sendJson(response, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "oauth-tool", description: "OAuth tool", inputSchema: { type: "object" } }] } }, 200, { "mcp-session-id": "oauth-session" });
        } else if (message.method === "tools/call" && requireAdditionalScope) {
          response.setHeader("www-authenticate", `Bearer error="insufficient_scope" scope="calendar.write" resource_metadata="${protectedMetadata}"`);
          response.writeHead(403);
          response.end();
        } else {
          sendJson(response, { jsonrpc: "2.0", id: message.id, result: {} }, 200, { "mcp-session-id": "oauth-session" });
        }
        return;
      }
      response.writeHead(404); response.end();
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as { port: number }).port;
    mcpUrl = `http://127.0.0.1:${port}/mcp`;
    protectedMetadata = `http://127.0.0.1:${port}/.well-known/oauth-protected-resource`;
    issuer = `http://127.0.0.1:${port}/auth`;

    const target = urlServer("fastmail", mcpUrl, { "X-Fixed": "mcp-secret" });
    const secrets = new MemorySecrets();
    let provider: McpOAuthProvider | undefined;
    const { engine: gateway } = engineFor(target, {
      async getProvider(serverId, serverUrl) {
        provider ??= new McpOAuthProvider(serverId, serverUrl, new URL("http://127.0.0.1/callback"), secrets);
        return provider;
      },
    });

    await expect(gateway.ensureServer("fastmail")).rejects.toThrow("sign in");
    expect(target.record.status).toBe("needs-sign-in");
    const url = await gateway.signIn("fastmail");
    expect(url).toBeTruthy();
    expect(url).toContain("code_challenge");
    expect(authorizationUrl).toBe("");
    const state = new URL(url!).searchParams.get("state");
    expect(state).toBeTruthy();

    await expect(gateway.finishSignIn("fastmail", new URLSearchParams({ code: "fixture-code" }))).rejects.toThrow("state mismatch");
    await expect(gateway.finishSignIn("fastmail", new URLSearchParams({ code: "fixture-code", state: "wrong" }))).rejects.toThrow("state mismatch");
    expect(tokenRequests).toBe(0);
    await gateway.finishSignIn("fastmail", new URLSearchParams({ code: "fixture-code", state: state! }));
    await expect(gateway.finishSignIn("fastmail", new URLSearchParams({ code: "fixture-code", state: state! }))).rejects.toThrow("state mismatch");
    const tools = await gateway.catalog([target.record]);
    expect(tools.map((tool) => tool.name)).toEqual(["oauth-tool"]);
    expect(tokenRequests).toBe(1);
    expect(mcpHeader).toBe("mcp-secret");
    expect(oauthRequestHeaders.every((headers) => !headers.fixed && !headers.authorization)).toBe(true);
    expect(await gateway.signInStatus("fastmail")).toBe("signed-in");
    expect(gateway.liveStatus("fastmail").status).toBe("running");

    requireAdditionalScope = true;
    await expect(gateway.call("fastmail", "oauth-tool", {})).rejects.toThrow();
    expect(target.record.status).toBe("needs-sign-in");
    expect(await gateway.signInStatus("fastmail")).toBe("signing-in");
    const stepUpUrl = (await provider!.authorizationUrlValue()) ?? null;
    const stepUpState = new URL(stepUpUrl!).searchParams.get("state");
    expect(stepUpState).toBeTruthy();
    await gateway.finishSignIn("fastmail", new URLSearchParams({ code: "step-up-code", state: stepUpState! }));
    expect(gateway.liveStatus("fastmail").status).toBe("running");
    expect(await gateway.signInStatus("fastmail")).toBe("signed-in");

    // Signing in again while signed in reconnects with the stored credentials.
    expect(await gateway.signIn("fastmail")).toBeNull();
    expect(gateway.liveStatus("fastmail").status).toBe("running");

    await gateway.signOut("fastmail");
    expect(target.record.status).toBe("stopped");
    expect(await gateway.signInStatus("fastmail")).toBe("signed-out");
    expect(secrets.records.get("fastmail")).toBeUndefined();
    await gateway.close();
  }, 30_000);

  it("bounds a hanging OAuth token exchange and clears pending transport state", async () => {
    let port = 0;
    let mcpUrl = "";
    let protectedMetadata = "";
    let issuer = "";
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        sendJson(response, { resource: mcpUrl, authorization_servers: [issuer] });
        return;
      }
      if (url.pathname.includes("oauth-authorization-server")) {
        sendJson(response, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
        });
        return;
      }
      if (url.pathname === "/auth/register") {
        await readBody(request);
        sendJson(response, { client_id: "hanging-client", redirect_uris: ["http://127.0.0.1/callback"], token_endpoint_auth_method: "none" });
        return;
      }
      if (url.pathname === "/auth/token") {
        // Deliberately never respond. The gateway must bound this request and
        // tear down the pending transport instead of wedging BB's server.
        return;
      }
      if (url.pathname === "/mcp") {
        response.setHeader("www-authenticate", `Bearer resource_metadata="${protectedMetadata}"`);
        response.writeHead(401);
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as { port: number }).port;
    mcpUrl = `http://127.0.0.1:${port}/mcp`;
    protectedMetadata = `http://127.0.0.1:${port}/.well-known/oauth-protected-resource`;
    issuer = `http://127.0.0.1:${port}/auth`;

    const target = urlServer("hanging-oauth", mcpUrl);
    const secrets = new MemorySecrets();
    const { engine: gateway, changes } = engineFor(target, {
      async getProvider(serverId, serverUrl) {
        return new McpOAuthProvider(serverId, serverUrl, new URL("http://127.0.0.1/callback"), secrets);
      },
    }, { limits: { oauthMs: 30 } });

    await expect(gateway.ensureServer("hanging-oauth")).rejects.toThrow("sign in");
    const url = await gateway.signIn("hanging-oauth");
    const state = new URL(url!).searchParams.get("state");
    await expect(gateway.finishSignIn("hanging-oauth", new URLSearchParams({ code: "hang", state: state! }))).rejects.toThrow("Sign-in to hanging-oauth timed out");
    expect(target.record.status).toBe("needs-sign-in");
    expect(target.record.lastError).toContain("Sign-in to hanging-oauth timed out");
    expect(changes()).toBeGreaterThan(0);
    expect(await gateway.signInStatus("hanging-oauth")).toBe("signed-out");
    await gateway.close();
  }, 5_000);
});
