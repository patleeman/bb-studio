import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { isListQuiet, markListQuiet } from "../../src/ws/list-quiet.fork.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("list-quiet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks only a socket opened with listEvents=status", () => {
    const quiet = createMockHubSocket();
    const plain = createMockHubSocket();
    const other = createMockHubSocket();
    markListQuiet(quiet, "http://127.0.0.1:38986/ws?listEvents=status");
    markListQuiet(plain, "http://127.0.0.1:38986/ws");
    markListQuiet(other, "/ws?listEvents=all");
    markListQuiet(createMockHubSocket(), undefined);

    expect(isListQuiet(quiet)).toBe(true);
    expect(isListQuiet(plain)).toBe(false);
    expect(isListQuiet(other)).toBe(false);
  });

  it("keeps the list's events-appended from a quiet socket, but not its own thread's or list changes", () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const quiet = createMockHubSocket();
    const plain = createMockHubSocket();
    markListQuiet(quiet, "/ws?listEvents=status");
    for (const socket of [quiet, plain]) {
      hub.registerClient(socket);
      hub.subscribe(socket, { kind: "thread-list" });
    }
    hub.subscribe(quiet, { kind: "thread-detail", threadId: "open" });

    hub.notifyThread("running", ["events-appended"]);
    vi.advanceTimersByTime(5_000);
    expect(plain.messages.length).toBeGreaterThan(0);
    expect(quiet.messages).toHaveLength(0);

    hub.notifyThread("open", ["events-appended"]);
    expect(quiet.messages.map((raw) => JSON.parse(raw).id)).toEqual(["open"]);

    hub.notifyThread("running", ["status-changed"]);
    expect(quiet.messages.map((raw) => JSON.parse(raw).id)).toEqual([
      "open",
      "running",
    ]);
  });
});
