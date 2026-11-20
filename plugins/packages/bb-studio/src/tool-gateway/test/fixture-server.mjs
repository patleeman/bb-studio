// A fake stdio MCP server for Tool Gateway's tests. Newline-delimited
// JSON-RPC on stdin and stdout, no SDK. It holds no real data.
let buffer = "";
let active = 0;
let maxActive = 0;
let calls = 0;
const token = process.env.FAKE_TOKEN ?? "";

const tools = [
  {
    name: "echo",
    description: "Echo the arguments back.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", pattern: "^[a-z]+$" },
        format: { type: "string", format: "email" },
        type: { type: "string", enum: ["a", "b"] },
        properties: { type: "object" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  { name: "env", description: "Report the environment names and working folder.", inputSchema: { type: "object", properties: {} } },
  { name: "leak", description: `Say the token ${token}.`, inputSchema: { type: "object", properties: {} } },
  { name: "slow", description: "Wait, then report the most calls seen at once.", inputSchema: { type: "object", properties: { ms: { type: "number" } } } },
  { name: "big", description: "Return a large text.", inputSchema: { type: "object", properties: { bytes: { type: "number" } } } },
  { name: "odd", description: "A tool whose schema can't be compiled.", inputSchema: { type: "object", properties: { x: { type: "not-a-type" } } } },
  { name: "count", description: "How many calls arrived.", inputSchema: { type: "object", properties: {} } },
];

function send(id, result, error) {
  const message = { jsonrpc: "2.0", id };
  if (error) message.error = error;
  else message.result = result;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });

async function call(name, args) {
  calls += 1;
  if (name === "echo") return text(args);
  if (name === "env") return text({ names: Object.keys(process.env).sort(), cwd: process.cwd() });
  if (name === "leak") {
    process.stderr.write(`token is ${token}\n`);
    return text(`the token is ${token}`);
  }
  if (name === "slow") {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, Number(args.ms ?? 200)));
    active -= 1;
    return text({ maxActive });
  }
  if (name === "big") return text("x".repeat(Number(args.bytes ?? 2_000_000)));
  if (name === "odd") return text("odd");
  if (name === "count") return text({ calls });
  return { content: [{ type: "text", text: `no tool ${name}` }], isError: true };
}

async function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "fixture", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "tools/list") return send(message.id, { tools });
  if (message.method === "tools/call") return send(message.id, await call(message.params?.name, message.params?.arguments ?? {}));
  if (message.method === "ping") return send(message.id, {});
  send(message.id, undefined, { code: -32601, message: "Method not found" });
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) void handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
