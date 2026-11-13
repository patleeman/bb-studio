import { describe, expect, it } from "vitest";
import type { ForkDesktopControlState } from "@/lib/fork-desktop-control";
import { modeBarItems } from "./ForkDesktopOverlay";

const base: ForkDesktopControlState = {
  supported: true,
  driver: { status: "ready", version: "0.47.24", error: null },
  helper: true,
  permissions: {
    accessibility: true,
    screenRecording: true,
    inputMonitoring: true,
    checked: true,
  },
  restartAdvised: false,
  hud: { shown: true, threadId: "thr_1" },
  pointing: false,
  talkKey: "fn",
  talking: false,
  hover: null,
  pins: [],
  activity: null,
  grant: { kind: "none", threadId: null },
  ask: null,
};

const activity = {
  threadId: "thr_1",
  agent: "Bot",
  caption: "clicking",
  app: "Safari",
  phase: "acting" as const,
  x: 1,
  y: 1,
  clickAt: null,
  foreground: false,
  updatedAt: 0,
};

describe("the desktop mode bar", () => {
  it("shows nothing while the HUD just floats", () => {
    expect(modeBarItems(base)).toBeNull();
  });

  it("names the talk key while pointing", () => {
    const items =
      modeBarItems({ ...base, pointing: true, talkKey: "AltRight" }) ?? [];
    expect(items.map((item) => item.key)).toEqual([
      "mode",
      "click",
      "talk",
      "esc",
    ]);
    expect(items.find((item) => item.key === "talk")?.kbd).toBe("right ⌥");
  });

  it("puts an agent's activity and its ask ahead of pointing", () => {
    expect(modeBarItems({ ...base, pointing: true, activity })?.[0]?.text).toBe(
      "Bot is acting",
    );
    expect(
      modeBarItems({ ...base, activity: { ...activity, phase: "paused" } })?.[0]
        ?.text,
    ).toBe("Bot paused");
    expect(
      modeBarItems({
        ...base,
        activity,
        ask: {
          id: "a",
          threadId: "thr_1",
          agent: "Bot",
          reason: "canvas",
          app: null,
        },
      })?.[0]?.text,
    ).toBe("Bot asks to drive");
  });
});
