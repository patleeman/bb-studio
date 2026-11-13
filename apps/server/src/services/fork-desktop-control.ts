import { createConnection } from "node:net";
import type {
  ExperimentalDesktopControlCall,
  ExperimentalDesktopControlResult,
} from "@get-bb/plugin-sdk";

export const DESKTOP_CONTROL_ENV = "BB_STUDIO_DESKTOP_CONTROL";
const CALL_TIMEOUT_MS = 200_000;
const MAX_RESPONSE = 32 * 1024 * 1024;

export interface DesktopControlEndpoint {
  socket: string;
  token: string;
}

export function readDesktopControlEndpoint(
  raw: string | undefined,
): DesktopControlEndpoint | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.socket !== "string" || typeof value.token !== "string") {
      return null;
    }
    if (!value.socket.startsWith("/") || value.token.length < 16) return null;
    return { socket: value.socket, token: value.token };
  } catch {
    return null;
  }
}

let endpoint: DesktopControlEndpoint | null = readDesktopControlEndpoint(
  process.env[DESKTOP_CONTROL_ENV],
);
delete process.env[DESKTOP_CONTROL_ENV];

export function setDesktopControlEndpointForTest(
  next: DesktopControlEndpoint | null,
): void {
  endpoint = next;
}

function readResult(value: unknown): ExperimentalDesktopControlResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "The desktop app sent no answer." };
  }
  const record = value as Record<string, unknown>;
  const result: ExperimentalDesktopControlResult = { ok: record.ok === true };
  if (typeof record.text === "string") result.text = record.text;
  if (typeof record.error === "string") result.error = record.error;
  if (Array.isArray(record.images)) {
    result.images = record.images.filter(
      (image): image is { data: string; mimeType: string } =>
        typeof image === "object" &&
        image !== null &&
        typeof (image as { data?: unknown }).data === "string" &&
        typeof (image as { mimeType?: unknown }).mimeType === "string",
    );
  }
  return result;
}

export function callDesktopControl(
  call: ExperimentalDesktopControlCall,
): Promise<ExperimentalDesktopControlResult> {
  const target = endpoint;
  if (target === null) {
    return Promise.resolve({
      ok: false,
      error: "Desktop control needs the BB Studio desktop app on macOS.",
    });
  }
  return new Promise((resolve) => {
    const socket = createConnection(target.socket);
    let buffer = "";
    let settled = false;
    const finish = (result: ExperimentalDesktopControlResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({ ok: false, error: "The desktop app did not answer in time." }),
      CALL_TIMEOUT_MS,
    );
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({ id: 1, token: target.token, request: call })}\n`,
      );
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_RESPONSE) {
        finish({ ok: false, error: "The desktop app's answer was too large." });
        return;
      }
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      try {
        finish(readResult(JSON.parse(buffer.slice(0, index))));
      } catch {
        finish({ ok: false, error: "The desktop app's answer was malformed." });
      }
    });
    socket.once("error", () =>
      finish({ ok: false, error: "The desktop app is not reachable." }),
    );
    socket.once("close", () =>
      finish({ ok: false, error: "The desktop app closed the connection." }),
    );
  });
}
