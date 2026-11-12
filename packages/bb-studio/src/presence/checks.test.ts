import { describe, expect, it } from "vitest";
import { coverage, difference, evaluateMeasurement, fullReport, standout, staticChecks, usesImport, type Measurement, type RenderSample } from "./checks";
import { PRESENCE_STATES, type PresenceStateName } from "./forms";
import { MAX_CODE } from "./schema";
import { PRESENCE_TEMPLATE_CODE } from "./template";

const pack = (code: string, over: Record<string, unknown> = {}) => ({ id: "crane", name: "Crane", description: "", code, ...over });
const failed = (code: string) => staticChecks(pack(code)).results.filter((line) => !line.pass).map((line) => line.id);
const draw = (body: string) => `function draw(ctx, t, state, palette, size) { ${body} }`;

describe("the checks on a presence's source", () => {
  it("pass the template", () => {
    const report = staticChecks(pack(PRESENCE_TEMPLATE_CODE));
    expect(report.results.map((line) => [line.id, line.pass])).toEqual([["schema", true], ["size", true], ["api", true], ["network", true], ["isolation", true]]);
    expect(report.pass).toBe(true);
  });

  it("refuse a bad package, a built-in id, an oversized source and a module without draw", () => {
    expect(staticChecks({ id: "Crane!", name: "", code: "" }).results[0]).toMatchObject({ id: "schema", pass: false });
    expect(staticChecks(pack(draw(""), { id: "tesseract" })).results.find((line) => line.id === "id")).toMatchObject({ pass: false });
    expect(failed(draw(`/* ${"x".repeat(MAX_CODE)} */`))).toEqual(["size"]);
    expect(failed("const draw = (ctx) => {};")).toEqual(["api"]);
    expect(failed("// function draw(ctx) {}\nfunction paint() {}")).toEqual(["api"]);
  });

  it.each([
    ["fetch", `fetch("/api/v1/threads")`],
    ["XMLHttpRequest", "new XMLHttpRequest()"],
    ["WebSocket", `new WebSocket("wss://example.com")`],
    ["EventSource", `new EventSource("/x")`],
    ["importScripts", `importScripts("x.js")`],
    ["sendBeacon", `navigator.sendBeacon("/x")`],
    ["Worker", `new Worker("x.js")`],
    ["dynamic import", `import("./x.js")`],
    ["static import", `}\nimport x from "y";\nfunction other() {`],
    ["a URL", `ctx.font = "10px x"; var u = "https://example.com/a.png";`],
    ["WebTransport", `new WebTransport("https://example.com")`],
    ["RTCPeerConnection", "new RTCPeerConnection()"],
  ])("refuse network access: %s", (_name, body) => {
    expect(failed(draw(body))).toContain("network");
  });

  it.each([
    ["the parent window", "parent.postMessage(1, '*')"],
    ["the document", "document.cookie"],
    ["window", "window.top.location = 'x'"],
    ["self", "self.onmessage = null"],
    ["globalThis", "globalThis.x = 1"],
    ["eval", "eval('1')"],
    ["the Function constructor", "new Function('return this')()"],
    ["a constructor chain", "(0)['constructor']['constructor']('return this')()"],
    ["timers", "setTimeout(function () {}, 1)"],
    ["storage", "localStorage.setItem('a', 'b')"],
    ["the harness hook", "__presenceStart(function () {})"],
    ["a blocking wait", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)"],
  ])("refuse reaching outside the drawing: %s", (_name, body) => {
    expect(failed(draw(body))).toContain("isolation");
  });

  it("don't trip on words inside other words or on comments", () => {
    expect(failed(draw("var refetch = 1, selfish = 2, windowed = 3, topmost = 4; // fetch window document\n/* parent eval */"))).toEqual([]);
    expect(usesImport("var important = 1; ctx.imported()")).toBe(false);
  });
});

function sample(size: number, state: PresenceStateName, fill: (index: number, pixels: Uint8ClampedArray) => void): RenderSample {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index++) fill(index, pixels);
  return { size, state, t: 3, width: size, height: size, pixels };
}

const STATE_SHADE: Record<PresenceStateName, number> = { idle: 60, thinking: 120, working: 180, needs: 240 };
const solid = (size: number, state: PresenceStateName, shift = 0) => sample(size, state, (index, pixels) => {
  if ((index + shift) % 3) return;
  pixels[index * 4] = STATE_SHADE[state]; pixels[index * 4 + 1] = 40; pixels[index * 4 + 2] = 200; pixels[index * 4 + 3] = 255;
});

function good(): Measurement {
  const samples = [24, 36, 160].flatMap((size) => PRESENCE_STATES.map((state) => solid(size, state)));
  return { failure: null, samples, light: PRESENCE_STATES.map((state) => solid(24, state)), repeat: solid(160, "idle"), later: solid(160, "idle", 1), frameMs: [1.2, 0.8, 1.1, 2.4, 0.9] };
}

describe("the checks on a presence's renders", () => {
  it("measure coverage and difference", () => {
    expect(coverage(solid(24, "idle"))).toBeCloseTo(1 / 3, 2);
    expect(difference(solid(24, "idle"), solid(24, "idle"))).toBe(0);
    expect(difference(solid(24, "idle"), solid(24, "needs"))).toBeGreaterThan(0.2);
    expect(difference(solid(24, "idle"), solid(36, "idle"))).toBe(1);
  });

  it("pass a presence that draws at each size, in time, with four distinct states, moving, and still at one time", () => {
    const lines = evaluateMeasurement(good());
    expect(lines.map((line) => line.id)).toEqual(["runs", "render:24", "render:36", "render:160", "frame-time", "states", "light", "states:24", "motion", "still"]);
    expect(lines.filter((line) => !line.pass)).toEqual([]);
  });

  it("fail when the module threw, stalled or never started", () => {
    expect(evaluateMeasurement({ ...good(), failure: "A frame took longer than 120 ms." })).toEqual([{ id: "runs", pass: false, reason: "A frame took longer than 120 ms." }]);
  });

  const failing = (change: (measurement: Measurement) => Measurement) => evaluateMeasurement(change(good())).filter((line) => !line.pass).map((line) => line.id);

  it("fail an empty picture at any one size", () => {
    expect(failing((m) => ({ ...m, samples: m.samples.map((each) => (each.size === 24 && each.state === "working" ? sample(24, "working", () => {}) : each)) }))).toEqual(["render:24"]);
    expect(failing((m) => ({ ...m, samples: m.samples.filter((each) => !(each.size === 160 && each.state === "needs")) }))).toContain("render:160");
  });

  it("fail two states that look the same", () => {
    const lines = evaluateMeasurement({ ...good(), samples: good().samples.map((each) => (each.state === "thinking" ? { ...solid(each.size, "working"), state: "thinking" as const } : each)) });
    const states = lines.find((line) => line.id === "states")!;
    expect(states.pass).toBe(false);
    expect(states.reason).toContain("thinking/working at 36 px");
  });

  it("fail a picture that vanishes on a white ground, and states that look alike at 24 px in the light palette", () => {
    const pale = (state: PresenceStateName) => sample(24, state, (index, pixels) => { pixels.set([240, 240, 245, 255], index * 4); });
    expect(standout(pale("idle"))).toBe(0);
    expect(standout(solid(24, "idle"))).toBeCloseTo(1 / 3, 2);
    expect(failing((m) => ({ ...m, light: m.light.map((each) => (each.state === "working" ? pale("working") : each)) }))).toEqual(["light"]);
    expect(failing((m) => ({ ...m, light: m.light.slice(1) }))).toEqual(["light", "states:24"]);
    const alike = evaluateMeasurement({ ...good(), light: good().light.map((each) => (each.state === "thinking" ? { ...solid(24, "working"), state: "thinking" as const } : each)) });
    expect(alike.filter((line) => !line.pass).map((line) => line.id)).toEqual(["states:24"]);
    expect(alike.find((line) => line.id === "states:24")!.reason).toContain("thinking/working");
  });

  it("fail a slow median, one very slow frame, a frozen idle, and a frame that changes at the same time", () => {
    expect(failing((m) => ({ ...m, frameMs: [9, 9, 9, 1] }))).toEqual(["frame-time"]);
    expect(failing((m) => ({ ...m, frameMs: [1, 1, 1, 90] }))).toEqual(["frame-time"]);
    expect(failing((m) => ({ ...m, frameMs: [] }))).toEqual(["frame-time"]);
    expect(failing((m) => ({ ...m, later: solid(160, "idle") }))).toEqual(["motion"]);
    expect(failing((m) => ({ ...m, repeat: solid(160, "idle", 1) }))).toEqual(["still"]);
  });

  it("a presence nobody measured doesn't pass", () => {
    const first = staticChecks(pack(PRESENCE_TEMPLATE_CODE));
    expect(fullReport(first, null).pass).toBe(false);
    expect(fullReport(first, null).results.at(-1)).toMatchObject({ id: "runs", pass: false });
    expect(fullReport(first, evaluateMeasurement(good())).pass).toBe(true);
    const bad = staticChecks(pack(draw("fetch('/x')")));
    expect(fullReport(bad, evaluateMeasurement(good()))).toBe(bad);
  });
});
