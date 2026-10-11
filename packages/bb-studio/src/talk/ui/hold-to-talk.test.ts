import { describe, expect, it } from "vitest";
import { HOLD_DELAY_MS, HoldToTalk } from "./hold-to-talk";

function harness(options: { code?: string | null; busy?: boolean } = {}) {
  const events: string[] = [];
  let pending: (() => void) | null = null;
  const hold = new HoldToTalk({
    code: () => (options.code === undefined ? "AltRight" : options.code),
    start: () => {
      events.push("start");
      return !options.busy;
    },
    finish: () => events.push("finish"),
    setTimer: (run, ms) => {
      expect(ms).toBe(HOLD_DELAY_MS);
      pending = run;
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
  });
  const elapse = () => {
    const run = pending;
    pending = null;
    run?.();
  };
  return { hold, events, elapse, pending: () => pending !== null };
}

describe("hold to talk", () => {
  it("starts after the delay and finishes on release", () => {
    const { hold, events, elapse } = harness();
    hold.keydown({ code: "AltRight" });
    expect(events).toEqual([]);
    elapse();
    hold.keydown({ code: "AltRight", repeat: true });
    hold.keyup({ code: "AltRight" });
    expect(events).toEqual(["start", "finish"]);
  });

  it("ignores a tap", () => {
    const { hold, events, elapse } = harness();
    hold.keydown({ code: "AltRight" });
    hold.keyup({ code: "AltRight" });
    elapse();
    expect(events).toEqual([]);
  });

  it("treats another key during the delay as a chord", () => {
    const { hold, events, pending } = harness();
    hold.keydown({ code: "AltRight" });
    hold.keydown({ code: "KeyE" });
    expect(pending()).toBe(false);
    hold.keyup({ code: "AltRight" });
    expect(events).toEqual([]);
  });

  it("keeps dictating when other keys are pressed after it starts", () => {
    const { hold, events, elapse } = harness();
    hold.keydown({ code: "AltRight" });
    elapse();
    hold.keydown({ code: "KeyA" });
    hold.blur();
    expect(events).toEqual(["start", "finish"]);
  });

  it("does not finish a dictation it didn't start", () => {
    const { hold, events, elapse } = harness({ busy: true });
    hold.keydown({ code: "AltRight" });
    elapse();
    hold.keyup({ code: "AltRight" });
    expect(events).toEqual(["start"]);
  });

  it("does nothing when off", () => {
    const { hold, pending } = harness({ code: null });
    hold.keydown({ code: "AltRight" });
    expect(pending()).toBe(false);
  });
});
