// A Unix socket the applets plugin uses to see that the shell is running and
// to ask it to open, close or reload applets. One JSON request per line; the
// first must carry the token from the token file (mode 0600).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { root, socketPath, tokenPath } from "./paths";

export type SocketHandlers = Record<string, (params: Record<string, unknown>) => unknown>;

async function ensureToken(): Promise<string> {
  const existing = (await readFile(tokenPath, "utf8").catch(() => "")).trim();
  if (existing.length >= 32) return existing;
  const token = randomBytes(32).toString("hex");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
  return token;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function startSocket(handlers: SocketHandlers): Promise<Server> {
  await mkdir(root, { recursive: true });
  const token = await ensureToken();
  await rm(socketPath, { force: true });
  const server = createServer((socket) => {
    let authed = false;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", async (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1_000_000) return socket.destroy();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let request: { id?: unknown; token?: unknown; method?: unknown; params?: unknown };
        try {
          request = JSON.parse(line);
        } catch {
          socket.write(`${JSON.stringify({ ok: false, error: "invalid JSON" })}\n`);
          continue;
        }
        const reply = (body: Record<string, unknown>) => socket.write(`${JSON.stringify({ id: request.id ?? null, ...body })}\n`);
        if (!authed) {
          if (typeof request.token === "string" && same(request.token, token)) authed = true;
          else {
            reply({ ok: false, error: "unauthorized" });
            socket.end();
            return;
          }
        }
        const handler = typeof request.method === "string" ? handlers[request.method] : undefined;
        if (!handler) {
          reply({ ok: false, error: `unknown method ${String(request.method)}` });
          continue;
        }
        try {
          reply({ ok: true, result: (await handler((request.params as Record<string, unknown>) ?? {})) ?? null });
        } catch (error) {
          reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600).catch(() => {});
  return server;
}
