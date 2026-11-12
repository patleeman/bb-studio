import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { fakeWebGl } from "../test/fake-webgl";
import { MIGRATIONS } from "../migrations";
import { GRID } from "./builtin/grid";
import { blurredPeak, checkTheme, FRAME_BUDGET_MS, FRAME_SIZE, STATIC_BUDGET, staticCost } from "./checks";
import { BUILTIN_THEMES } from "./registry";
import { ThemeStore } from "./store";

const scene = (source: string, uniforms: Record<string, number> = {}) => {
  const theme = structuredClone(GRID);
  theme.id = "trial";
  if (theme.scene.kind === "shader") { theme.scene.source = source; theme.scene.uniforms = uniforms; }
  return theme;
};
const line = (report: ReturnType<typeof checkTheme>, id: string) => report.results.find((each) => each.id === id);

describe("the theme checks", () => {
  it("pass every built-in theme, with a reason on each line", () => {
    for (const theme of BUILTIN_THEMES) {
      const report = checkTheme(theme);
      expect(report.pass, report.results.filter((each) => !each.pass).map((each) => each.reason).join("; ")).toBe(true);
      expect(report.results.map((each) => each.id)).toEqual(expect.arrayContaining(["schema", "frame-time", "reduced-motion"]));
      for (const each of report.results) expect(each.reason.length).toBeGreaterThan(0);
    }
  });

  it("stop at the schema with every problem named", () => {
    const report = checkTheme({ format: 1, id: "Bad Id" });
    expect(report.pass).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ id: "schema", pass: false });
    expect(report.results[0]!.reason).toContain("id: A theme id is lowercase letters, digits and dashes.");
    expect(report.results[0]!.reason).toContain("scene:");
  });

  it("estimate a shader's cost without WebGL, loops multiplied, and fail one over the budget", () => {
    expect(staticCost("void main() { gl_FragColor = vec4(sin(1.0)); }")).toBe(4);
    expect(staticCost("float f(float x) { return exp(x) + sqrt(x); } void main() { for (int i = 0; i < 10; i++) { f(1.0); } }")).toBe(60);
    const heavy = scene("void main() { vec3 c = vec3(0.0); for (int i = 0; i < 64; i++) { for (int j = 0; j < 64; j++) { c += sin(vec3(float(i * j))); } } gl_FragColor = vec4(c, 1.0); }");
    const report = checkTheme(heavy);
    expect(line(report, "frame-time")).toMatchObject({ pass: false });
    expect(line(report, "frame-time")!.reason).toBe(`Static estimate, no WebGL here: 16384 weighted calls per pixel (budget ${STATIC_BUDGET})`);
    expect(line(checkTheme(GRID), "frame-time")!.reason).toMatch(/^Static estimate, no WebGL here: \d+ weighted calls per pixel/);
  });

  it("name what's wrong with a shader's shape", () => {
    const report = checkTheme(scene("uniform float u_time;\nuniform float u_speed;\nvoid main() { }", { u_speed: 1, u_other: 2 }));
    expect(line(report, "shader")!.reason).toBe("It never writes gl_FragColor. It declares u_time, which the engine declares. u_other has a value but no declaration.");
    expect(report.pass).toBe(false);
  });

  it("time frames and measure a stored scene's backdrop behind text from a blurred full-size frame where WebGL exists, leaving the open strip beside the transcript card to the scene", () => {
    const copy = { ...GRID, id: "my-grid" };
    const fake = fakeWebGl();
    let clock = 0;
    const report = checkTheme(copy, { createContext: () => fake.gl, now: () => (clock += 1), frames: 10 });
    expect(line(report, "frame-time")).toEqual({ id: "frame-time", pass: true, reason: `10 frames at 640×400: 0.1 ms each (budget ${FRAME_BUDGET_MS} ms)` });
    expect(line(report, "backdrop")).toMatchObject({ pass: true });
    const reads = fake.calls.filter((call) => call.name === "readPixels");
    expect(reads.slice(0, 11).every((call) => call.args[2] === 1 && call.args[3] === 1)).toBe(true);
    expect(reads.at(-1)!.args.slice(2, 4)).toEqual([FRAME_SIZE.width, FRAME_SIZE.height]);
    fake.setPixels((index) => (index % FRAME_SIZE.width === 320 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(line(checkTheme(copy, { createContext: () => fake.gl, now: () => 0 }), "backdrop")!.pass).toBe(true);
    fake.setPixels((index) => (index % FRAME_SIZE.width >= 560 && index / FRAME_SIZE.width < 300 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(line(checkTheme(copy, { createContext: () => fake.gl, now: () => 0 }), "backdrop")).toMatchObject({ pass: true, reason: expect.stringMatching(/^Brightest blurred backdrop behind text 0(\.0\d+)? \(/) });
    fake.setPixels((index) => (index % FRAME_SIZE.width >= 300 && index % FRAME_SIZE.width < 420 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(line(checkTheme(copy, { createContext: () => fake.gl, now: () => 0 }), "backdrop")!.pass).toBe(false);
    fake.setPixels(() => [250, 250, 250, 255]);
    const bright = checkTheme(copy, { createContext: () => fake.gl, now: () => 0 });
    expect(line(bright, "backdrop")!.pass).toBe(false);
    expect(line(bright, "backdrop")!.reason).toMatch(/^Brightest blurred backdrop behind text 0\.95\d* \(declared 0\.\d+\)$/);
  });

  it("keep a built-in scene's declared backdrop, measured or not", () => {
    const fake = fakeWebGl();
    fake.setPixels(() => [250, 250, 250, 255]);
    const report = checkTheme(GRID, { createContext: () => fake.gl, now: () => 0 });
    expect(line(report, "backdrop")).toEqual({ id: "backdrop", pass: true, reason: "Declared #010305–#a6c8cc; built-in scene" });
    expect(line(checkTheme(GRID, { measured: [{ id: "frame-time", pass: true, reason: "1 ms" }, { id: "backdrop", pass: false, reason: "Brightest blurred backdrop 1 (declared 0.08)" }] }), "backdrop")!.pass).toBe(true);
  });

  it("blur the frame before taking its brightest point, as the glass does", () => {
    const width = 64;
    const height = 40;
    const frame = (lit: (x: number, y: number) => boolean) => {
      const pixels = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels.set(lit(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * width + x) * 4);
      return pixels;
    };
    const dot = frame((x, y) => x === 32 && y === 20);
    expect(blurredPeak(dot, width, height, 0)).toBe(1);
    expect(blurredPeak(dot, width, height, 4)).toBeLessThan(0.01);
    expect(blurredPeak(frame((x) => x === 32), width, height, 4)).toBeLessThan(0.15);
    expect(blurredPeak(frame((x) => x < 32), width, height, 4)).toBeGreaterThan(0.99);
  });

  it("fail a slow shader and one that doesn't compile", () => {
    const slow = fakeWebGl();
    let clock = 0;
    expect(line(checkTheme(GRID, { createContext: () => slow.gl, now: () => (clock += 50), frames: 4 }), "frame-time")!.pass).toBe(false);
    const broken = fakeWebGl();
    broken.failCompile("ERROR: 0:12: 'foo' : undeclared identifier");
    expect(line(checkTheme(GRID, { createContext: () => broken.gl }), "frame-time")).toEqual({ id: "frame-time", pass: false, reason: "The shader didn't compile: ERROR: 0:12: 'foo' : undeclared identifier" });
  });
});

describe("stored themes", () => {
  const store = () => {
    const db = new Database(":memory:");
    for (const migration of MIGRATIONS) db.exec(migration);
    let at = 1000;
    return new ThemeStore(db, () => (at += 1));
  };

  it("saves a theme that passes the checks, lists it beside the built-ins, updates and removes it", () => {
    const themes = store();
    const own = { ...structuredClone(GRID), id: "after-dark", name: "After Dark" };
    expect(themes.save(own)).toMatchObject({ ok: true });
    expect(themes.list().find((entry) => entry.theme.id === "after-dark")).toMatchObject({ source: "stored", theme: { name: "After Dark" } });
    expect(themes.save({ ...own, name: "After Dark 2" })).toMatchObject({ ok: true });
    expect(themes.stored().map((theme) => theme.name)).toEqual(["After Dark 2"]);
    expect(themes.remove("after-dark")).toBe(true);
    expect(themes.get("after-dark")).toBeNull();
    expect(themes.get("grid")).toBe(GRID);
  });

  it("refuses a built-in id and a theme that fails a check, with the report", () => {
    const themes = store();
    const taken = themes.save(GRID);
    expect(taken.ok).toBe(false);
    expect(taken.report.results.at(-1)).toEqual({ id: "id", pass: false, reason: "grid is a built-in theme" });
    const unreadable = { ...structuredClone(GRID), id: "murk" };
    unreadable.variants.dark!.ink = "#05080a";
    const failed = themes.save(unreadable);
    expect(failed.ok).toBe(false);
    expect(failed.report.results.some((each) => each.id.startsWith("contrast:") && !each.pass)).toBe(true);
    expect(themes.stored()).toEqual([]);
  });
});
