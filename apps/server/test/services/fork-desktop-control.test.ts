import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  callDesktopControl,
  readDesktopControlEndpoint,
  setDesktopControlEndpointForTest,
} from "../../src/services/fork-desktop-control.js";

const TOKEN = "t".repeat(32);
let server: Server | null = null;
let dir: string | null = null;

afterEach(() => {
  server?.close();
  server = null;
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
  setDesktopControlEndpointForTest(null);
});

function desktop(
  answer: (message: Record<string, unknown>) => unknown,
): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), "dc-"));
  const path = join(dir, "a.sock");
  server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      const message = JSON.parse(chunk.split("\n")[0] ?? "{}") as Record<
        string,
        unknown
      >;
      socket.write(`${JSON.stringify(answer(message))}\n`);
    });
  });
  return new Promise((resolve) => server?.listen(path, () => resolve(path)));
}

describe("desktop control from the server", () => {
  it("reads the endpoint the desktop app puts in the environment", () => {
    expect(
      readDesktopControlEndpoint(
        JSON.stringify({ socket: "/tmp/a.sock", token: TOKEN }),
      ),
    ).toEqual({ socket: "/tmp/a.sock", token: TOKEN });
    expect(readDesktopControlEndpoint(undefined)).toBeNull();
    expect(readDesktopControlEndpoint("{")).toBeNull();
    expect(
      readDesktopControlEndpoint(
        JSON.stringify({ socket: "relative", token: TOKEN }),
      ),
    ).toBeNull();
    expect(
      readDesktopControlEndpoint(
        JSON.stringify({ socket: "/tmp/a", token: "short" }),
      ),
    ).toBeNull();
  });

  it("removes the endpoint from its own environment so agents do not inherit it", () => {
    expect(process.env.BB_STUDIO_DESKTOP_CONTROL).toBeUndefined();
  });

  it("answers no desktop app without one", async () => {
    await expect(
      callDesktopControl({ threadId: "thr_1", agent: "Bot", tool: "status" }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("forwards the call with the token and returns the desktop's answer", async () => {
    let seen: Record<string, unknown> | null = null;
    const socket = await desktop((message) => {
      seen = message;
      return {
        id: message.id,
        ok: true,
        text: "done",
        images: [{ data: "AA", mimeType: "image/png" }, { bad: 1 }],
      };
    });
    setDesktopControlEndpointForTest({ socket, token: TOKEN });
    const result = await callDesktopControl({
      threadId: "thr_1",
      agent: "Bot",
      tool: "click",
      args: { x: 1 },
      caption: "clicking",
    });
    expect(result).toEqual({
      ok: true,
      text: "done",
      images: [{ data: "AA", mimeType: "image/png" }],
    });
    expect(seen).toMatchObject({
      token: TOKEN,
      request: { threadId: "thr_1", tool: "click", caption: "clicking" },
    });
  });

  it("passes a refusal through", async () => {
    const socket = await desktop((message) => ({
      id: message.id,
      ok: false,
      error: "Refused: password field",
    }));
    setDesktopControlEndpointForTest({ socket, token: TOKEN });
    await expect(
      callDesktopControl({ threadId: "thr_1", agent: "Bot", tool: "type" }),
    ).resolves.toEqual({ ok: false, error: "Refused: password field" });
  });
});
