import { describe, expect, it, vi } from "vitest";
import { MAX_STEP, PresenceLoop, type LoopEnvironment } from "./loop";

function setup(cap?: number) {
  const world = { active: true, shown: true, reduced: false, queued: [] as ((time: number) => void)[], requests: 0, cancels: 0, watchers: new Set<() => void>() };
  const env: LoopEnvironment = {
    request: (run) => { world.requests++; world.queued.push(run); return world.requests; },
    cancel: () => { world.cancels++; world.queued.length = 0; },
    active: () => world.active,
    shown: () => world.shown,
    reduced: () => world.reduced,
    watch: (changed) => { world.watchers.add(changed); return () => { world.watchers.delete(changed); }; },
  };
  const loop = new PresenceLoop(env, cap);
  const step = (time: number) => { const run = world.queued.shift(); run?.(time); return !!run; };
  const change = (next: Partial<Pick<typeof world, "active" | "shown" | "reduced">>) => { Object.assign(world, next); for (const watcher of [...world.watchers]) watcher(); };
  const item = (seen = true) => { const made = { seen, frame: vi.fn(), still: vi.fn(), visible: () => made.seen }; return made; };
  return { world, loop, step, change, item };
}

describe("the shared presence loop", () => {
  it("runs one animation frame request for every presence on screen", () => {
    const { world, loop, step, item } = setup();
    const items = [item(), item(), item()];
    for (const each of items) loop.add(each);
    expect(world.requests).toBe(1);
    expect(world.queued).toHaveLength(1);
    step(1000);
    step(1016);
    expect(world.requests).toBe(3);
    for (const each of items) expect(each.frame.mock.calls).toEqual([[0], [expect.closeTo(0.016, 5)]]);
    expect(loop.frames).toBe(2);
  });

  it("skips a presence that is off screen, and caps a long gap", () => {
    const { loop, step, item } = setup();
    const shown = item(), hidden = item(false);
    loop.add(shown);
    loop.add(hidden);
    step(0);
    step(5000);
    expect(shown.frame).toHaveBeenLastCalledWith(MAX_STEP);
    expect(hidden.frame).not.toHaveBeenCalled();
    hidden.seen = true;
    step(5016);
    expect(hidden.frame).toHaveBeenCalledTimes(1);
  });

  it("stops when the window isn't frontmost and starts again when it is", () => {
    const { world, loop, step, change, item } = setup();
    const one = item();
    loop.add(one);
    step(0);
    change({ active: false });
    expect(loop.running).toBe(false);
    expect(world.cancels).toBe(1);
    expect(step(16)).toBe(false);
    expect(one.still).toHaveBeenCalledTimes(1);
    change({ active: true });
    expect(loop.running).toBe(true);
    step(9000);
    expect(one.frame).toHaveBeenLastCalledWith(0);
  });

  it("under reduced motion draws a still frame and never animates", () => {
    const { world, loop, change, item } = setup();
    world.reduced = true;
    const one = item();
    loop.add(one);
    expect(world.requests).toBe(0);
    expect(one.still).toHaveBeenCalledTimes(1);
    expect(one.frame).not.toHaveBeenCalled();
    change({ reduced: false });
    expect(loop.running).toBe(true);
    change({ reduced: true });
    expect(loop.running).toBe(false);
    expect(one.still).toHaveBeenCalledTimes(2);
  });

  it("stops and stops watching when the last presence leaves", () => {
    const { world, loop, item } = setup();
    const removeA = loop.add(item()), removeB = loop.add(item());
    removeA();
    expect(loop.running).toBe(true);
    removeB();
    expect(loop.running).toBe(false);
    expect(world.watchers.size).toBe(0);
    expect(loop.size).toBe(0);
  });

  it("draws at most the cap each frame and takes turns, so every presence keeps its own time", () => {
    const { loop, step, item } = setup(2);
    const items = [item(), item(), item(), item(), item()];
    for (const each of items) loop.add(each);
    step(0);
    for (let k = 1; k <= 5; k++) step(k * 20);
    expect(loop.drawn).toBe(12);
    for (const each of items) expect(each.frame.mock.calls.length).toBeGreaterThanOrEqual(2);
    const total = (each: (typeof items)[number]) => each.frame.mock.calls.reduce((sum, call) => sum + (call[0] as number), 0);
    expect(total(items[0]!)).toBeCloseTo(0.1, 5);
    expect(total(items[1]!)).toBeCloseTo(0.1, 5);
  });

  it("keeps running in a window that asked to run unfocused, and stops there when the window is hidden", () => {
    const { world, loop, step, change, item } = setup();
    const one = item();
    loop.add(one);
    change({ active: false });
    expect(loop.running).toBe(false);
    const release = loop.runUnfocused();
    expect(loop.running).toBe(true);
    step(0); step(16);
    expect(one.frame).toHaveBeenCalledTimes(2);
    change({ shown: false });
    expect(loop.running).toBe(false);
    change({ shown: true });
    expect(loop.running).toBe(true);
    release();
    expect(loop.running).toBe(false);
    expect(world.queued).toHaveLength(0);
  });
});
