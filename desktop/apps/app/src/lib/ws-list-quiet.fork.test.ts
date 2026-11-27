import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withListQuiet } from "./ws-list-quiet.fork";

const state = vi.hoisted(() => {
  const urls: string[] = [];
  class FakeReconnectingWebSocket {
    onclose: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    readyState = 1;
    constructor(url: string) {
      urls.push(url);
    }
    close(): void {}
    send(): void {}
  }
  return { urls, FakeReconnectingWebSocket };
});

vi.mock("partysocket/ws", () => ({
  default: state.FakeReconnectingWebSocket,
}));

vi.mock("./dev-websocket-url", () => ({
  buildBrowserWebSocketUrl: () => "ws://bb.test/ws",
}));

import { WebSocketManager } from "./ws";

describe("list-quiet websocket URL", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    state.urls.length = 0;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  it("appends listEvents=status while preserving scheme, host, path, and existing params", () => {
    expect(withListQuiet("ws://127.0.0.1:38986/ws")).toBe(
      "ws://127.0.0.1:38986/ws?listEvents=status",
    );
    expect(withListQuiet("wss://studio.example/ws?token=abc")).toBe(
      "wss://studio.example/ws?token=abc&listEvents=status",
    );
  });

  it("connects WebSocketManager in quiet list mode", () => {
    const manager = new WebSocketManager();
    manager.connect();
    expect(state.urls).toEqual(["ws://bb.test/ws?listEvents=status"]);
    manager.disconnect();
  });
});
