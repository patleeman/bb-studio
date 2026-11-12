// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fakeWebGl } from "../../test/fake-webgl";
import { defaultAppearance } from "../appearance";
import { NORD } from "../builtin/classic";
import { GRID } from "../builtin/grid";
import { ThemeEngine, type EngineDeps } from "../engine";
import { FRONT_ENVIRONMENT } from "../guards";
import type { LiveUniforms, SceneDriver, SceneLayer } from "./live";

let engine: ThemeEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
  document.documentElement.removeAttribute("style");
});

function start() {
  const fake = fakeWebGl();
  let clock = 0;
  let queue: (() => void)[] = [];
  let publish: (uniforms: LiveUniforms, layer?: SceneLayer) => void = () => {};
  let started = 0;
  let stopped = 0;
  const driver: SceneDriver = (next) => { started += 1; publish = next; return () => { stopped += 1; }; };
  const deps: EngineDeps = {
    root: document.documentElement,
    host: document.body,
    createContext: () => fake.gl,
    requestFrame: (callback) => { queue.push(() => callback(clock)); return queue.length; },
    cancelFrame: () => { queue = []; },
    now: () => clock,
    size: () => ({ width: 400, height: 300 }),
    drivers: { grid: driver },
  };
  engine = new ThemeEngine(deps);
  engine.setEnvironment(FRONT_ENVIRONMENT);
  const advance = (ms: number) => {
    for (let spent = 0; spent < ms; spent += 16) {
      clock += 16;
      const due = queue;
      queue = [];
      for (const run of due) run();
    }
  };
  return { fake, engine, advance, publish: (uniforms: LiveUniforms, layer?: SceneLayer) => publish(uniforms, layer), counts: () => ({ started, stopped }) };
}

describe("a scene's live uniforms", () => {
  it("start the theme's driver with its layer and reach the shader in place of the package's values", () => {
    const run = start();
    run.engine.show({ key: "a:grid", theme: GRID, appearance: defaultAppearance(GRID) }, "dark");
    run.advance(32);
    expect(run.counts()).toEqual({ started: 1, stopped: 0 });
    expect(run.fake.uniform("u_scroll")).toEqual([0.14]);
    run.publish({ u_scroll: 2.5, u_unknown: 4 });
    run.advance(32);
    expect(run.fake.uniform("u_scroll")).toEqual([2.5]);
    expect(run.fake.uniform("u_horizon")).toEqual([0.42]);
    expect(run.fake.uniform("u_unknown")).toBeUndefined();
  });

  it("upload a driver's picture as the u_layer texture once for each version, and keep it when only uniforms change", () => {
    const run = start();
    run.engine.show({ key: "a:grid", theme: GRID, appearance: defaultAppearance(GRID) }, "dark");
    run.advance(32);
    const uploads = () => run.fake.calls.filter((call) => call.name === "texImage2D" && call.args.length === 6);
    expect(uploads()).toHaveLength(0);
    expect(run.fake.uniform("u_layer")).toEqual([0]);
    const picture = { width: 4, height: 4 } as unknown as TexImageSource;
    run.publish({ u_scroll: 1 }, { source: picture, version: 1 });
    run.advance(64);
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0]!.args[5]).toBe(picture);
    run.publish({ u_scroll: 2 });
    run.advance(64);
    expect(uploads()).toHaveLength(1);
    run.publish({ u_scroll: 2 }, { source: picture, version: 2 });
    run.advance(32);
    expect(uploads()).toHaveLength(2);
    expect(run.fake.calls.filter((call) => call.name === "createTexture")).toHaveLength(1);
    run.engine.show(null, "dark");
    run.advance(2000);
    expect(run.fake.calls.filter((call) => call.name === "deleteTexture")).toHaveLength(1);
  });

  it("redraw a held still frame when they change", () => {
    const run = start();
    run.engine.setEnvironment({ ...FRONT_ENVIRONMENT, reducedMotion: true });
    run.engine.show({ key: "a:grid", theme: GRID, appearance: defaultAppearance(GRID) }, "dark");
    run.advance(64);
    const held = run.fake.draws();
    run.advance(64);
    expect(run.fake.draws()).toBe(held);
    run.publish({ u_scroll: 3 });
    run.advance(32);
    expect(run.fake.draws()).toBe(held + 1);
    expect(run.fake.uniform("u_scroll")).toEqual([3]);
  });

  it("redraw a paused scene once when they change, so a window in the background shows what its variant was chosen for", () => {
    const run = start();
    run.engine.show({ key: "a:grid", theme: GRID, appearance: defaultAppearance(GRID) }, "dark");
    run.advance(64);
    run.engine.setEnvironment({ ...FRONT_ENVIRONMENT, focused: false });
    run.advance(64);
    const held = run.fake.draws();
    const time = run.engine.snapshot().sceneTime;
    run.advance(200);
    expect(run.fake.draws()).toBe(held);
    run.publish({ u_scroll: 4 });
    run.advance(64);
    expect(run.fake.draws()).toBe(held + 1);
    expect(run.fake.uniform("u_scroll")).toEqual([4]);
    expect(run.engine.snapshot().sceneTime).toBe(time);
    expect(run.engine.snapshot().mode).toBe("paused");
  });

  it("stop the driver when the scene leaves", () => {
    const run = start();
    run.engine.show({ key: "a:grid", theme: GRID, appearance: defaultAppearance(GRID) }, "dark");
    run.advance(32);
    run.engine.show({ key: "a:nord", theme: NORD, appearance: defaultAppearance(NORD) }, "dark");
    run.advance(2000);
    expect(run.counts()).toEqual({ started: 1, stopped: 1 });
  });
});
