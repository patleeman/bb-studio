import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORK_DESKTOP_CONTROL_ENV } from "./fork-desktop-control-ipc.js";

export interface AgentRequest {
  threadId: string;
  agent: string;
  tool: string;
  args: unknown;
  caption: string | null;
}

export interface AgentResponse {
  ok: boolean;
  text?: string;
  images?: { data: string; mimeType: string }[];
  error?: string;
}

const MAX_LINE = 256 * 1024;

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

export function readAgentRequest(value: unknown): AgentRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const threadId = clip(record.threadId, 200);
  const tool = clip(record.tool, 40);
  if (threadId === null || tool === null) return null;
  return {
    threadId,
    tool,
    agent: clip(record.agent, 60) ?? "Agent",
    args: record.args ?? {},
    caption: clip(record.caption, 120),
  };
}

export function tokensMatch(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startAgentSocket(
  env: NodeJS.ProcessEnv,
  handle: (request: AgentRequest) => Promise<AgentResponse>,
): { server: Server; path: string; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), "bbsdc-"));
  const path = join(dir, "a.sock");
  const token = randomBytes(24).toString("base64url");
  const serve = (socket: Socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE) {
        socket.destroy();
        return;
      }
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        void answer(socket, line);
      }
    });
    socket.on("error", () => socket.destroy());
  };
  const answer = async (socket: Socket, line: string) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = message.id;
    const reply = (response: AgentResponse) => {
      if (!socket.destroyed)
        socket.write(`${JSON.stringify({ id, ...response })}\n`);
    };
    if (!tokensMatch(token, message.token)) {
      reply({ ok: false, error: "not allowed" });
      socket.end();
      return;
    }
    const request = readAgentRequest(message.request);
    if (request === null) {
      reply({ ok: false, error: "malformed request" });
      return;
    }
    try {
      reply(await handle(request));
    } catch (error) {
      reply({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const server = createServer(serve);
  server.listen(path);
  env[FORK_DESKTOP_CONTROL_ENV] = JSON.stringify({ socket: path, token });
  return {
    server,
    path,
    close() {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
