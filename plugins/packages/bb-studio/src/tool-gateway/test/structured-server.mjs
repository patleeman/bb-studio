// A fake stdio MCP server for the tests whose one tool returns structuredContent with booleans.
let buffer = "";
const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
async function handle(m) {
  if (m.id === undefined) return;
  if (m.method === "initialize") return send(m.id, { protocolVersion: m.params?.protocolVersion ?? "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "s", version: "1" } });
  if (m.method === "tools/list") return send(m.id, { tools: [{ name: "status", description: "Status.", inputSchema: { type: "object", properties: {} } }] });
  if (m.method === "tools/call") return send(m.id, { content: [{ type: "text", text: "ok: info" }], structuredContent: { ok: true, level: "info" } });
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } })}\n`);
}
process.stdin.on("data", (c) => { buffer += c; let i; while ((i = buffer.indexOf("\n")) >= 0) { const l = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); if (l) void handle(JSON.parse(l)); } });
process.stdin.on("end", () => process.exit(0));
