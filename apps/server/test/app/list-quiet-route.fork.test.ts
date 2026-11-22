import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

// Seam `list-quiet` through the real /ws route: the query reaches the socket
// the hub uses, so a quiet list gets no other thread's events-appended.
const sockets = new Set<WebSocket>();
let server: RunningTestServer | null = null;

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  sockets.clear();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url.href;
}

/** Opens a socket, subscribes it to the thread list, and waits for the pong that follows. */
async function openListSocket(
  url: string,
): Promise<{ socket: WebSocket; messages: unknown[] }> {
  const socket = new WebSocket(url);
  sockets.add(socket);
  const messages: unknown[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const ponged = new Promise<void>((resolve) => {
    socket.on("message", (data: Buffer) => {
      const message: unknown = JSON.parse(data.toString("utf8"));
      if ((message as { type?: string }).type === "pong") {
        resolve();
        return;
      }
      messages.push(message);
    });
  });
  socket.send(
    JSON.stringify({ type: "subscribe", target: { kind: "thread-list" } }),
  );
  socket.send(JSON.stringify({ type: "ping" }));
  await ponged;
  return { socket, messages };
}

describe("list-quiet through /ws", () => {
  it("sends the list's events-appended to a plain socket only", async () => {
    server = await startTestServer();
    const plain = await openListSocket(websocketUrl(server.baseUrl, "/ws"));
    const quiet = await openListSocket(
      websocketUrl(server.baseUrl, "/ws?listEvents=status"),
    );

    server.hub.notifyThread("thr_running", ["events-appended"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(plain.messages).toMatchObject([
      {
        type: "changed",
        entity: "thread",
        id: "thr_running",
        changes: ["events-appended"],
      },
    ]);
    expect(quiet.messages).toEqual([]);
  });
});
