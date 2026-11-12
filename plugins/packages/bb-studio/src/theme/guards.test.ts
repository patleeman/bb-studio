import { describe, expect, it } from "vitest";
import { FRONT_ENVIRONMENT, renderScale, sceneMode, watchEnvironment, type SceneEnvironment } from "./guards";

describe("when a scene runs", () => {
  it("runs while the window is frontmost and shown, pauses otherwise, and holds a still frame for reduced motion", () => {
    expect(sceneMode(FRONT_ENVIRONMENT, false)).toBe("run");
    expect(sceneMode({ ...FRONT_ENVIRONMENT, focused: false }, false)).toBe("paused");
    expect(sceneMode({ ...FRONT_ENVIRONMENT, visible: false }, false)).toBe("paused");
    expect(sceneMode({ ...FRONT_ENVIRONMENT, reducedMotion: true }, false)).toBe("still");
    expect(sceneMode({ ...FRONT_ENVIRONMENT, visible: false, reducedMotion: true }, false)).toBe("still");
    expect(sceneMode(FRONT_ENVIRONMENT, true)).toBe("still");
  });

  it("renders at the screen's pixel ratio on power, at half on battery, lower when it's nearly empty", () => {
    expect(renderScale({ onBattery: false, batteryLevel: 1, pixelRatio: 2 })).toBe(2);
    expect(renderScale({ onBattery: false, batteryLevel: 1, pixelRatio: 3 })).toBe(2);
    expect(renderScale({ onBattery: true, batteryLevel: 0.8, pixelRatio: 2 })).toBe(1);
    expect(renderScale({ onBattery: true, batteryLevel: 0.1, pixelRatio: 2 })).toBe(0.7);
    expect(renderScale({ onBattery: true, batteryLevel: 0.1, pixelRatio: 1 })).toBe(0.35);
  });
});

describe("watching the window", () => {
  function fakeTarget() {
    const docEvents = new EventTarget();
    const winEvents = new EventTarget();
    const media = Object.assign(new EventTarget(), { matches: false });
    const battery = Object.assign(new EventTarget(), { charging: true, level: 1 });
    const page = { visibilityState: "visible" as DocumentVisibilityState, focused: true };
    return {
      page, media, battery, winEvents, docEvents,
      target: {
        document: { get visibilityState() { return page.visibilityState; }, hasFocus: () => page.focused, addEventListener: docEvents.addEventListener.bind(docEvents), removeEventListener: docEvents.removeEventListener.bind(docEvents) },
        window: { devicePixelRatio: 2, addEventListener: winEvents.addEventListener.bind(winEvents), removeEventListener: winEvents.removeEventListener.bind(winEvents), matchMedia: () => media as unknown as MediaQueryList },
        navigator: { getBattery: async () => battery },
      },
    };
  }

  it("follows focus, visibility, reduced motion and the battery, and stops on cleanup", async () => {
    const fake = fakeTarget();
    const seen: SceneEnvironment[] = [];
    const stop = watchEnvironment(fake.target, (env) => seen.push(env));
    expect(seen.at(-1)).toMatchObject({ visible: true, focused: true, reducedMotion: false, onBattery: false, pixelRatio: 2 });
    fake.page.focused = false;
    fake.winEvents.dispatchEvent(new Event("blur"));
    expect(seen.at(-1)!.focused).toBe(false);
    fake.page.visibilityState = "hidden";
    fake.docEvents.dispatchEvent(new Event("visibilitychange"));
    expect(seen.at(-1)!.visible).toBe(false);
    fake.media.matches = true;
    fake.media.dispatchEvent(new Event("change"));
    expect(seen.at(-1)!.reducedMotion).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    fake.battery.charging = false;
    fake.battery.level = 0.5;
    fake.battery.dispatchEvent(new Event("chargingchange"));
    expect(seen.at(-1)).toMatchObject({ onBattery: true, batteryLevel: 0.5 });
    stop();
    const count = seen.length;
    fake.winEvents.dispatchEvent(new Event("focus"));
    fake.battery.dispatchEvent(new Event("levelchange"));
    expect(seen).toHaveLength(count);
  });

  it("works without a battery API", () => {
    const fake = fakeTarget();
    const seen: SceneEnvironment[] = [];
    const stop = watchEnvironment({ ...fake.target, navigator: {} }, (env) => seen.push(env));
    expect(seen.at(-1)!.onBattery).toBe(false);
    stop();
  });
});
