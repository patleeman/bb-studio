import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: {},
  clipboard: {},
  Menu: {},
  shell: {},
}));

import {
  createActivityTracker,
  type ActivityMonitor,
} from "../src/fork-activity.js";

function monitor(idle: { seconds: number; state: string }) {
  const listeners = new Map<string, () => void>();
  const fake: ActivityMonitor = {
    getSystemIdleTime: () => idle.seconds,
    getSystemIdleState: () => idle.state,
    on: (event, listener) => listeners.set(event, listener),
  };
  return { fake, emit: (event: string) => listeners.get(event)?.() };
}

describe("system activity", () => {
  it("reads the idle seconds and whether the Mac is locked", () => {
    const idle = { seconds: 12.7, state: "active" };
    const { fake } = monitor(idle);
    const read = createActivityTracker(fake, () => {});
    expect(read()).toEqual({ idleSeconds: 12, locked: false });
    idle.state = "locked";
    expect(read()).toEqual({ idleSeconds: 12, locked: true });
  });

  it("lock and unlock are told at once, and lock holds until unlock", () => {
    const idle = { seconds: 0, state: "active" };
    const { fake, emit } = monitor(idle);
    const changes: unknown[] = [];
    const read = createActivityTracker(fake, (activity) => changes.push(activity));
    emit("lock-screen");
    expect(read().locked).toBe(true);
    emit("unlock-screen");
    expect(changes).toEqual([
      { idleSeconds: 0, locked: true },
      { idleSeconds: 0, locked: false },
    ]);
  });
});
