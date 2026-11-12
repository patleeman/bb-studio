// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fakeWebGl } from "../../test/fake-webgl";
import { defaultAppearance } from "../appearance";
import { studioAppearance } from "../backdrop";
import { GRID } from "../builtin/grid";
import { KYOTO_GARDEN } from "../builtin/kyoto-garden";
import { ThemeEngine, type EngineDeps } from "../engine";
import { FRONT_ENVIRONMENT } from "../guards";
import { resolveLook, type ResolvedLook } from "../look";
import type { Mode } from "../schema";
import { lookTokens } from "../tokens";
import type { SceneDriver, ScenePublish } from "./live";

let engine: ThemeEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
  document.documentElement.removeAttribute("style");
});

function start(first: Mode | null, options: { webgl?: boolean; reducedMotion?: boolean } = {}) {
  const fake = fakeWebGl();
  let clock = 0;
  let queue: (() => void)[] = [];
  let publish: ScenePublish = () => {};
  const looks: (ResolvedLook | null)[] = [];
  const driver: SceneDriver = (next) => { publish = next; if (first) next({}, undefined, first); return () => {}; };
  const deps: EngineDeps = {
    root: document.documentElement,
    host: document.body,
    createContext: () => (options.webgl === false ? null : fake.gl),
    requestFrame: (callback) => { queue.push(() => callback(clock)); return queue.length; },
    cancelFrame: () => { queue = []; },
    now: () => clock,
    size: () => ({ width: 400, height: 300 }),
    drivers: { "kyoto-garden": driver, grid: driver },
    publish: (look) => { looks.push(look); },
  };
  engine = new ThemeEngine(deps);
  engine.setEnvironment({ ...FRONT_ENVIRONMENT, reducedMotion: options.reducedMotion ?? false });
  const advance = (ms: number) => {
    for (let spent = 0; spent < ms; spent += 16) {
      clock += 16;
      const due = queue;
      queue = [];
      for (const run of due) run();
    }
  };
  return { engine, advance, looks, choose: (mode: Mode) => publish({}, undefined, mode) };
}

const appearance = defaultAppearance(KYOTO_GARDEN);
const shown = { key: "a:kyoto-garden", theme: KYOTO_GARDEN, appearance };
const tokensOf = (mode: Mode) => lookTokens(resolveLook(KYOTO_GARDEN, appearance, mode));

describe("a scene that chooses its variant", () => {
  it("shows the variant its driver publishes, whatever the app's mode, and sends that mode to the app", () => {
    const run = start("light");
    run.engine.show(shown, "dark");
    run.advance(32);
    expect(run.engine.snapshot().tokens).toEqual(tokensOf("light"));
    expect(run.engine.snapshot().crossfading).toBe(false);
    expect(run.looks.at(-1)).toMatchObject({ mode: "light", fixedMode: true });
    expect(studioAppearance(run.looks.at(-1)!)!.mode).toBe("light");
  });

  it("crossfades to the other variant when the driver turns, and holds while the driver repeats itself", () => {
    const run = start("light");
    run.engine.show(shown, "light");
    run.advance(32);
    run.choose("dark");
    expect(run.engine.snapshot().crossfading).toBe(true);
    run.advance(KYOTO_GARDEN.motion.crossfadeMs / 2 - 100);
    expect(run.looks.at(-1)!.mode).toBe("light");
    const midway = run.engine.snapshot().tokens;
    expect(midway).not.toEqual(tokensOf("light"));
    expect(midway).not.toEqual(tokensOf("dark"));
    run.advance(KYOTO_GARDEN.motion.crossfadeMs);
    expect(run.engine.snapshot().crossfading).toBe(false);
    expect(run.engine.snapshot().tokens).toEqual(tokensOf("dark"));
    expect(run.looks.at(-1)).toMatchObject({ mode: "dark", fixedMode: true });
    const settled = run.looks.length;
    run.choose("dark");
    run.advance(64);
    expect(run.engine.snapshot().crossfading).toBe(false);
    expect(run.looks).toHaveLength(settled);
  });

  it("follows the app's mode until a driver chooses, and keeps the driver's choice when the app's mode changes", () => {
    const run = start(null);
    run.engine.show(shown, "dark");
    run.advance(32);
    expect(run.looks.at(-1)).toMatchObject({ mode: "dark", fixedMode: false });
    expect(studioAppearance(run.looks.at(-1)!)!.mode).toBeUndefined();
    run.choose("light");
    run.advance(KYOTO_GARDEN.motion.crossfadeMs + 100);
    expect(run.looks.at(-1)).toMatchObject({ mode: "light", fixedMode: true });
    run.engine.show(shown, "dark");
    run.advance(64);
    expect(run.engine.snapshot().tokens).toEqual(tokensOf("light"));
  });

  it("turns at once under reduced motion", () => {
    const run = start("light", { reducedMotion: true });
    run.engine.show(shown, "light");
    run.advance(32);
    run.choose("dark");
    expect(run.engine.snapshot().crossfading).toBe(false);
    expect(run.engine.snapshot().tokens).toEqual(lookTokens(resolveLook(KYOTO_GARDEN, appearance, "dark", true)));
  });

  it("ignores a variant the theme doesn't have", () => {
    const run = start("light");
    run.engine.show({ key: "a:grid", theme: GRID, appearance: defaultAppearance(GRID) }, "light");
    run.advance(32);
    expect(run.looks.at(-1)).toMatchObject({ themeId: "grid", mode: "dark", fixedMode: true });
  });

  it("picks the variant that reads on the fallback color when the scene can't be drawn", () => {
    const run = start("dark", { webgl: false });
    run.engine.show(shown, "dark");
    run.advance(32);
    expect(run.engine.snapshot().layers).toEqual([{ themeId: "kyoto-garden", opacity: 1, live: false }]);
    expect(run.looks.at(-1)).toMatchObject({ mode: "light", fixedMode: true });
  });
});
