import { describe, expect, it } from "vitest";
import { cutOffByHost, listenForHostEvents } from "./host-events";

describe("host events", () => {
  it("passes BB's three events on, and says it is listening", () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const seen: unknown[] = [];
    const listening = listenForHostEvents({ events: { on: (event: string, handler: (payload: unknown) => void) => { handlers.set(event, handler); } } }, {
      turnInterrupted: (threadId, reason) => seen.push(["interrupted", threadId, reason]),
      hostConnected: (hostId, restarted) => seen.push(["connected", hostId, restarted]),
      hostDisconnected: (hostId) => seen.push(["disconnected", hostId]),
    });
    handlers.get("experimental_turn.interrupted")?.({ thread: { id: "thr_1" }, reason: "host-daemon-restarted" });
    handlers.get("experimental_host.connected")?.({ host: { id: "host_1" }, restarted: true });
    handlers.get("experimental_host.disconnected")?.({ host: { id: "host_1" }, reason: "expired" });
    expect(listening).toBe(true);
    expect(seen).toEqual([["interrupted", "thr_1", "host-daemon-restarted"], ["connected", "host_1", true], ["disconnected", "host_1"]]);
  });

  it("is not listening on a BB that refuses the event names", () => {
    expect(listenForHostEvents({ events: { on: () => { throw new Error("unknown event"); } } }, { turnInterrupted: () => {}, hostConnected: () => {}, hostDisconnected: () => {} })).toBe(false);
  });

  it("tells a machine cut-off from a stop by hand", () => {
    expect(cutOffByHost("host-connection-lost")).toBe(true);
    expect(cutOffByHost("manual-stop")).toBe(false);
  });
});

describe("files an agent changed", () => {
  it("passes on the thread and its changes where BB has the event", async () => {
    const { listenForFileChanges } = await import("./host-events");
    const handlers = new Map<string, (payload: unknown) => void>();
    const seen: unknown[] = [];
    expect(listenForFileChanges({ events: { on: (event: string, handler: (payload: unknown) => void) => { handlers.set(event, handler); } } }, (threadId, changes) => seen.push([threadId, changes]))).toBe(true);
    handlers.get("experimental_thread.fileChanged")!({ thread: { id: "thr_1" }, changes: [{ itemId: "i1", path: "/repo/a.ts", kind: "update" }] });
    expect(seen).toEqual([["thr_1", [{ itemId: "i1", path: "/repo/a.ts", kind: "update" }]]]);
  });

  it("says it isn't listening on a BB that refuses the event, so the caller keeps its timer", async () => {
    const { listenForFileChanges } = await import("./host-events");
    expect(listenForFileChanges({ events: { on: () => { throw new Error("Unknown event"); } } }, () => undefined)).toBe(false);
  });
});
