import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { experimental_runBridgeConformance, experimental_formatConformanceReport } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createGrokBridge, grokHistoryStore, grokModels } from "./grok.js";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); });

async function fixture() {
  const bodies: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.headers.authorization !== "Bearer fixture-key") { res.statusCode = 401; res.end(); return; }
    if (req.url === "/v1/models") { res.setHeader("Content-Type", "application/json"); res.end('{"data":[{"id":"grok-4"},{"id":"grok-2-image"}]}'); return; }
    if (req.url === "/v1/chat/completions") {
      bodies.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const text of ["o", "k"]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.statusCode = 404; res.end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture port");
  process.env.GROK_TEST_KEY = "fixture-key";
  cleanups.push(() => { delete process.env.GROK_TEST_KEY; });
  return { bodies, providerOptions: { provider: "grok", baseUrl: `http://127.0.0.1:${address.port}/v1`, tokenEnv: "GROK_TEST_KEY", enabled: true } };
}
const store = () => grokHistoryStore(mkdtempSync(join(tmpdir(), "grok-history-")));

it("lists chat models only", () => {
  expect(grokModels({ data: [{ id: "grok-4" }, { id: "grok-2-image" }] }).map(m => m.id)).toEqual(["grok-4"]);
});

it("streams a reply and sends the whole conversation on the next turn", async () => {
  const { bodies, providerOptions } = await fixture();
  const messages: any[] = [];
  const bridge = createGrokBridge(line => messages.push(JSON.parse(line)), store());
  cleanups.push(() => bridge.onClose?.());
  const options = { permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null, model: "grok-4", instructions: "Be brief.", providerOptions };
  const send = (id: number, method: string, params: unknown) => bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  const reply = async (id: number) => { await expect.poll(() => messages.find(m => m.id === id)).toBeDefined(); const found = messages.find(m => m.id === id)!; expect(found.error).toBeUndefined(); return found.result; };
  send(1, "model/list", { providerOptions }); expect((await reply(1)).models.map((m: any) => m.id)).toEqual(["grok-4"]);
  send(2, "thread/start", { threadId: "t", cwd: "/tmp", instructionMode: "append", options });
  const { providerThreadId } = await reply(2);
  send(3, "turn/start", { threadId: "t", providerThreadId, clientRequestId: "creq_23456789ab", input: [{ type: "text", text: "Hi" }], options });
  await reply(3);
  const deltas = () => messages.flatMap(m => m.params?.deltas ?? []);
  await expect.poll(() => deltas().some(d => d.kind === "turn.boundary" && d.status === "completed")).toBe(true);
  expect(deltas().find(d => d.kind === "item.textClose").text).toBe("ok");
  send(4, "turn/start", { threadId: "t", providerThreadId, clientRequestId: "creq_23456789ac", input: [{ type: "text", text: "Again" }], options });
  await reply(4);
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ model: "grok-4", stream: true, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }, { role: "assistant", content: "ok" }, { role: "user", content: "Again" }] });
});

it("reports a missing key without calling xAI", async () => {
  const messages: any[] = [];
  const bridge = createGrokBridge(line => messages.push(JSON.parse(line)), store());
  bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "model/list", params: { providerOptions: { baseUrl: "https://api.x.ai/v1", tokenEnv: "GROK_KEY_THAT_IS_UNSET", enabled: true } } }));
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0].error.message).toContain("GROK_KEY_THAT_IS_UNSET");
});

it("passes the published BB bridge conformance suite with an xAI fixture", async () => {
  const { providerOptions } = await fixture();
  const messages: any[] = [];
  const bridge = createGrokBridge(line => messages.push(JSON.parse(line)), store());
  cleanups.push(() => bridge.onClose?.());
  const report = await experimental_runBridgeConformance({
    transport: { send: bridge.handleLine, takeMessages: () => messages.splice(0) },
    providerId: "grok",
    session: { cwd: "/tmp", promptInput: [{ type: "text", text: "Reply with ok", mentions: [] }], options: { permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null, providerOptions } },
    timeoutMs: 2000,
  });
  expect(report.passed, experimental_formatConformanceReport(report)).toBe(true);
}, 20_000);
