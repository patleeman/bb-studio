import { describe, expect, it, vi } from "vitest";
import { fakeWebGl } from "../../test/fake-webgl";
import { GRID } from "../builtin/grid";
import { NORD } from "../builtin/classic";
import { THEME_TEMPLATE } from "../template";
import { livePreviews, PreviewHub, type PreviewDeps } from "./preview";

describe("livePreviews", () => {
  const base = { order: ["grid", "aurora", "ember"], visible: new Set(["grid", "aurora", "ember"]), hovered: null, selected: null, reducedMotion: false, hidden: false };

  it("runs one live preview: the hovered card, else the chosen one", () => {
    expect(livePreviews(base)).toEqual([]);
    expect(livePreviews({ ...base, selected: "grid" })).toEqual(["grid"]);
    expect(livePreviews({ ...base, selected: "grid", hovered: "ember" })).toEqual(["ember"]);
    expect(livePreviews({ ...base, selected: "grid", hovered: "ember", budget: 2 })).toEqual(["ember", "grid"]);
  });

  it("runs none off screen, under reduced motion or in a hidden window; a classic or unknown id never runs", () => {
    expect(livePreviews({ ...base, selected: "grid", visible: new Set(["aurora"]) })).toEqual([]);
    expect(livePreviews({ ...base, selected: "grid", hovered: "aurora", visible: new Set(["grid"]) })).toEqual(["grid"]);
    expect(livePreviews({ ...base, selected: "grid", reducedMotion: true })).toEqual([]);
    expect(livePreviews({ ...base, selected: "grid", hidden: true })).toEqual([]);
    expect(livePreviews({ ...base, selected: "nord" })).toEqual([]);
  });
});

describe("PreviewHub", () => {
  const setup = () => {
    const fake = fakeWebGl();
    let frames: ((time: number) => void)[] = [];
    let clock = 0;
    const painted: string[] = [];
    const deps: PreviewDeps = {
      createContext: vi.fn(() => ({ gl: fake.gl, canvas: { id: "gl" } as unknown as HTMLCanvasElement })),
      paint: (target) => { painted.push(target.dataset.id!); },
      requestFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelFrame: () => { frames = []; },
      now: () => clock,
    };
    const hub = new PreviewHub(deps);
    const canvas = (id: string) => { const target = { dataset: { id }, width: 0, height: 0 } as unknown as HTMLCanvasElement; return target; };
    const tick = (count: number) => { for (let n = 0; n < count; n += 1) { clock += 16; const due = frames; frames = []; for (const callback of due) callback(clock); } };
    return { hub, deps, painted, tick, canvas, fake, pending: () => frames.length };
  };
  const aurora = { ...structuredClone(THEME_TEMPLATE), id: "aurora" };

  it("draws a still of every visible scene once, and only the live one each frame, from one WebGL context", () => {
    const { hub, deps, painted, tick, canvas } = setup();
    hub.register(GRID, canvas("grid"));
    hub.register(aurora, canvas("aurora"));
    hub.register(NORD, canvas("nord"));
    expect(painted).toEqual(["grid", "aurora"]);
    expect(hub.snapshot()).toEqual({ live: [], stills: ["grid", "aurora"], frames: 0 });
    hub.setSelected("grid");
    painted.length = 0;
    tick(5);
    expect(painted).toEqual(Array(5).fill("grid"));
    painted.length = 0;
    hub.setHovered("aurora");
    tick(3);
    expect(painted).toEqual(["grid", "aurora", "aurora", "aurora"]);
    expect(hub.snapshot().live).toEqual(["aurora"]);
    expect(deps.createContext).toHaveBeenCalledTimes(1);
  });

  it("stops the loop under reduced motion or a hidden window and off screen, holding still frames", () => {
    const { hub, painted, tick, canvas, pending } = setup();
    hub.register(GRID, canvas("grid"));
    hub.setSelected("grid");
    expect(pending()).toBe(1);
    hub.setReducedMotion(true);
    expect(pending()).toBe(0);
    expect(hub.snapshot()).toMatchObject({ live: [], stills: ["grid"] });
    painted.length = 0;
    tick(4);
    expect(painted).toEqual([]);
    hub.setReducedMotion(false);
    hub.setVisible("grid", false);
    expect(pending()).toBe(0);
    hub.setVisible("grid", true);
    hub.setHidden(true);
    expect(pending()).toBe(0);
    hub.setHidden(false);
    tick(2);
    expect(hub.snapshot().frames).toBe(2);
  });

  it("frees its context and renderers when it goes, and draws nothing after", () => {
    const { hub, tick, canvas, fake, painted } = setup();
    hub.register(GRID, canvas("grid"));
    hub.setSelected("grid");
    hub.dispose();
    painted.length = 0;
    tick(3);
    expect(painted).toEqual([]);
    expect(fake.calls.some((call) => call.name === "deleteProgram")).toBe(true);
  });
});
