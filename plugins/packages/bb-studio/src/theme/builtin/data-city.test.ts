import { describe, expect, it } from "vitest";
import { checkTheme, staticCost, STATIC_BUDGET } from "../checks";
import { hexToRgb, luminance } from "../color";
import { ATLAS, ATLAS_FACE, atlasMarks, GLYPH_ROWS, paintAtlas, type AtlasContext } from "../data-city/atlas";
import { dataCityDriver, type AtlasCanvas } from "../data-city/driver";
import { resolveLook } from "../look";
import { createThemeRegistry, SCENE_THEMES } from "../registry";
import type { LiveUniforms, SceneLayer } from "../scene/live";
import { themeModes } from "../schema";
import { DATA_CITY } from "./data-city";
import { BUILTIN_DRIVERS } from "./drivers";

function source(): string {
  if (DATA_CITY.scene.kind !== "shader") throw new Error("A scene theme has a shader");
  return DATA_CITY.scene.source;
}

function uniform(name: string): number {
  if (DATA_CITY.scene.kind !== "shader") throw new Error("A scene theme has a shader");
  const value = DATA_CITY.scene.uniforms[name];
  if (typeof value !== "number") throw new Error(`${name} is not a number`);
  return value;
}

function fakeCanvas() {
  const calls: { kind: "rect" | "text"; text: string; x: number; y: number; font: string; fill: string }[] = [];
  const context: AtlasContext = {
    fillStyle: "", font: "", textAlign: "start", textBaseline: "alphabetic",
    fillRect(x, y, width, height) { calls.push({ kind: "rect", text: `${width}x${height}`, x, y, font: this.font, fill: String(this.fillStyle) }); },
    fillText(text, x, y) { calls.push({ kind: "text", text, x, y, font: this.font, fill: String(this.fillStyle) }); },
  };
  const canvas: AtlasCanvas = { width: 0, height: 0, getContext: () => context };
  return { canvas, context, calls };
}

describe("Data City", () => {
  it("comes after Tonight's Sky and before Deep Sea in the scene row, and has a driver", () => {
    const ids = createThemeRegistry().scenes().map((entry) => entry.theme.id);
    expect(ids.at(-2)).toBe("data-city");
    expect(ids.at(-3)).toBe("tonights-sky");
    expect(SCENE_THEMES.at(-2)).toBe(DATA_CITY);
    expect(BUILTIN_DRIVERS["data-city"]).toBeTypeOf("function");
  });

  it("passes every check under the static budget, with its glass at the declared opacity at the default setting", () => {
    const report = checkTheme(DATA_CITY);
    expect(report.pass, report.results.filter((line) => !line.pass).map((line) => line.reason).join("; ")).toBe(true);
    expect(staticCost(source())).toBeLessThanOrEqual(STATIC_BUDGET);
    expect(themeModes(DATA_CITY)).toEqual(["dark"]);
    expect(DATA_CITY.glass).toMatchObject({ sidebar: { opacity: 0.14, blur: 6 }, main: { opacity: 0.03, blur: 0 }, transcript: { opacity: 0.16, blur: 6 }, composer: { opacity: 0.42, blur: 10 } });
    const look = resolveLook(DATA_CITY, DATA_CITY.defaults, "dark");
    expect(look.alpha.sidebar).toBeCloseTo(0.14, 5);
    expect(look.alpha.transcript).toBeCloseTo(0.16, 5);
    if (DATA_CITY.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    expect(luminance(hexToRgb(DATA_CITY.scene.backdrop.light))).toBeGreaterThanOrEqual(0.4);
  });

  it("sets headings in the system monospace face, with small corners and a cyan accent", () => {
    expect(DATA_CITY.type.heading).toMatch(/^ui-monospace, "SF Mono", Menlo, monospace$/);
    expect(DATA_CITY.type.headingWeight).toBe(600);
    expect(DATA_CITY.radius).toBeGreaterThanOrEqual(2);
    expect(DATA_CITY.radius).toBeLessThanOrEqual(4);
    expect(DATA_CITY.variants.dark!.accent).toBe("#3fd8ff");
    expect(DATA_CITY.effects.worker.character).toBe("data packet on a light lane");
  });

  it("loops without a seam: time enters once as a turn of the period, and every moving part is a whole number of cycles of it", () => {
    const text = source();
    expect(text.match(/\bu_time\b/g)).toHaveLength(1);
    expect(text).toMatch(/float turn = fract\(u_time \/ u_period\);\s*float ang = 6\.2831853 \* turn;/);
    const period = uniform("u_period");
    expect(period).toBeGreaterThanOrEqual(40);
    expect(period).toBeLessThanOrEqual(60);
    const turn = (time: number) => (time / period) % 1;
    for (const time of [0, 3.5, 14, 41.25]) expect(turn(time + period)).toBeCloseTo(turn(time), 9);
    const steps = [...text.matchAll(/turn \* (\d+\.\d+)/g)].map((found) => Number(found[1]));
    expect(steps.length).toBeGreaterThanOrEqual(6);
    for (const step of steps) expect(Number.isInteger(step), `turn * ${step}`).toBe(true);
    const swings = [...text.matchAll(/sin\((\d+\.\d+) \* turn\)/g)].map((found) => Number(found[1]) / (2 * Math.PI));
    expect(swings).toHaveLength(1);
    for (const cycles of swings) expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-5);
    const angles = [...text.matchAll(/(?:sin|cos)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((found) => found[1]!).filter((inside) => inside.includes("ang"));
    expect(angles.length).toBeGreaterThanOrEqual(6);
    for (const inside of angles) expect(inside).toMatch(/^(?:2\.0 \* ang|ang \* 2\.0|ang \* \(1\.0 \+ fi\)|ang)(?: \+ [^a-z]*(?:fi)?)?$/);
    expect(uniform("u_blocks") % 8).toBe(0);
    expect(text).toMatch(/hash21\(vec2\(cell\.x, mod\(cell\.y, u_blocks\)\)\)/);
    expect(text).toMatch(/rel = mod\(4\.5 \+ 8\.0 \* fi - ro\.z, u_blocks\)/);
  });

  it("draws towers in depth: a block walk that keeps two faces, fog, far towers, streets and panes", () => {
    const text = source();
    expect(text).toMatch(/for \(int i = 0; i < 24; i\+\+\) \{\s*vec3 tw = tower\(cell\);/);
    expect(text).toMatch(/if \(hits < 0\.5\) hitA = rec; else hitB = rec;/);
    expect(text).toMatch(/col \+= \(1\.0 - cover\) \* f\.rgb;/);
    expect(text).toMatch(/if \(enter < tw\.y && enter > 0\.0\) \{/);
    expect(text).toMatch(/float fog = exp\(-t \* u_fog\);/);
    expect(text).toMatch(/float lod = 1\.0 - smoothstep\(2\.5, 6\.0, size\);/);
    expect(text).toMatch(/if \(lod > 0\.98\) return 0\.34;/);
    expect(text).toMatch(/vec3 skyline\(vec3 rd, float turn\)/);
    expect(text).toMatch(/float lanes = ave \* /);
    expect(text).toMatch(/float cross = step\(zc, 1\.0\);/);
    expect(text).toMatch(/col \+= panel\(q, fi, turn, [^;]*\) \* seen/);
    expect(text).toMatch(/vanish = vec2\(wide \? \(u_clear\.z \+ 0\.38 \* strip\) \/ u_resolution\.x : u_vanish\.x, u_vanish\.y\)/);
  });

  it("closes the avenue in: towers stand on every block of both sides, taller than the camera, with the camera nearer the right wall", () => {
    const text = source();
    expect(text).toMatch(/float there = \(step\(1\.5, cell\.x\) \+ step\(cell\.x, -0\.5\)\) \* step\(0\.5, mod\(cell\.y, 4\.0\)\);/);
    const tower = text.match(/there \* \((\d+\.\d+) \+ (\d+\.\d+) \* h\), (\d+\.\d+) \+ (\d+\.\d+) \* fract/);
    const camera = text.match(/vec3 ro = vec3\((\d+\.\d+) \+ (\d+\.\d+) \* sin\(ang\), (\d+\.\d+) \+ (\d+\.\d+) \* sin/);
    if (!tower || !camera) throw new Error("The tower and camera lines are in the shader");
    const [lowest, , half, spread] = tower.slice(1).map(Number) as [number, number, number, number];
    const [x, sway, y, bob] = camera.slice(1).map(Number) as [number, number, number, number];
    expect(lowest).toBeGreaterThanOrEqual(2 * (y + bob));
    expect(half + spread).toBeLessThan(0.5);
    expect(half).toBeGreaterThanOrEqual(0.35);
    const right = 2.5 - (half + spread);
    const left = -0.5 + half + spread;
    expect(x + sway).toBeLessThan(right - 0.3);
    expect(x - sway).toBeGreaterThan(left + 0.3);
    expect(right - x).toBeLessThan(x - left);
  });

  it("shows no words: no label is sampled or drawn, no name plates, and the panes hold bars and lamps", () => {
    const text = source();
    expect(text).not.toMatch(/label|plate|name|digit/);
    expect(text.match(/texture2D\(/g)).toHaveLength(1);
    expect(text.match(/glyph\(/g)).toHaveLength(2);
    expect(text).toMatch(/vec2 q = \(P\.xy - at\) \/ vec2\(0\.7, 0\.45\) \+ 0\.5;/);
    expect(Object.keys(ATLAS).filter((key) => key.startsWith("label"))).toEqual([]);
  });

  it("stays calm behind text: glyphs fade by their height on screen however oblique the face, near faces are dim and nearly opaque, and faces dim behind the sidebar and the transcript column", () => {
    const text = source();
    expect(text).toMatch(/float fine = 1\.0 - 0\.95 \* smoothstep\(7\.0, 16\.0, 900\.0 \/ \(u_fov \* t \* cols\)\);/);
    expect(text).toMatch(/ink = glyph\([^;]*\* fine;/);
    expect(text).toMatch(/float near = 0\.22 \+ 0\.78 \* smoothstep\(0\.8, 5\.0, t\);/);
    expect(text).toMatch(/alpha = clamp\(0\.8 \+ 0\.1 \* near /);
    expect(text).toMatch(/float text = max\(smoothstep\(0\.2 \* u_resolution\.x \+ edge, 0\.2 \* u_resolution\.x, gl_FragCoord\.x\), smoothstep\(u_clear\.x - edge, u_clear\.x, gl_FragCoord\.x\) \* smoothstep\(u_clear\.z \+ edge, u_clear\.z, gl_FragCoord\.x\)\);/);
    expect(text).toMatch(/float calm = \(1\.0 - 0\.5 \* text\) \* /);
    expect(text).toMatch(/return vec4\(glow \* fog \* calm \+ /);
    expect(text).toMatch(/float mark = step\(abs\(cell\.x - 2\.0\), 0\.5\)/);
    expect(uniform("u_fog")).toBeGreaterThanOrEqual(0.1);
  });

  it("shows workers as packets on the lanes, an amber tower for needs-you, and finished and error pulses rising up the faces", () => {
    const text = source();
    expect(text).toMatch(/col \+= u_workerColor \* [^;]*beam \* \(step\(0\.0, back\)/);
    expect(text).toMatch(/float alarm = u_needsYou \* mark;/);
    expect(text).toMatch(/glow \+= u_needsYouColor \* alarm \* beat \* near/);
    expect(text).toMatch(/wave = exp\(-abs\(v - r\.z \* 2\.4\) \* 3\.0\)/);
    expect(text).toMatch(/\(r\.w > 1\.5 \? u_errorColor : u_finishedColor\) \* wave/);
  });

  it("reads glyphs from the atlas when the driver has drawn it, and makes block glyphs when it has not", () => {
    const text = source();
    expect(uniform("u_atlas")).toBe(0);
    expect(text).not.toMatch(/uniform sampler2D u_layer/);
    expect(text).toMatch(/if \(u_atlas > 0\.5\) \{\s*ink = texture2D\(u_layer, /);
    expect(text).toContain(`mod(id, ${ATLAS.columns}.0) + f.x) / ${ATLAS.columns}.0`);
    expect(text).toContain(`* ${ATLAS.cellHeight / ATLAS.size})).r`);
    expect(text).toContain(`* ${ATLAS.columns * ATLAS.rows}.0);`);
  });
});

describe("Data City's glyph atlas", () => {
  it("fills its grid with hex-heavy glyphs and no words, each inside its own cell", () => {
    expect(GLYPH_ROWS).toHaveLength(ATLAS.rows);
    for (const row of GLYPH_ROWS) expect(row).toHaveLength(ATLAS.columns);
    expect(ATLAS.rows * ATLAS.cellHeight).toBeLessThanOrEqual(ATLAS.size);
    expect(ATLAS.columns * ATLAS.cellWidth).toBe(ATLAS.size);
    expect(GLYPH_ROWS[0]).toBe("0123456789ABCDEF");
    const hex = GLYPH_ROWS.join("").split("").filter((glyph) => /[0-9A-F]/.test(glyph)).length;
    expect(hex / (ATLAS.columns * ATLAS.rows)).toBeGreaterThan(0.5);
    const marks = atlasMarks();
    expect(marks.length).toBe(GLYPH_ROWS.join("").replace(/ /g, "").length);
    for (const mark of marks) {
      expect(mark.x).toBeGreaterThan(0);
      expect(mark.x).toBeLessThan(ATLAS.size);
      expect(mark.y).toBeLessThan(ATLAS.rows * ATLAS.cellHeight);
      expect(mark.text).toHaveLength(1);
    }
  });

  it("paints white glyphs on black in the system monospace face", () => {
    const { context, calls } = fakeCanvas();
    paintAtlas(context);
    expect(calls[0]).toMatchObject({ kind: "rect", text: `${ATLAS.size}x${ATLAS.size}`, x: 0, y: 0, fill: "#000000" });
    const texts = calls.filter((call) => call.kind === "text");
    expect(texts).toHaveLength(atlasMarks().length);
    for (const call of texts) {
      expect(call.fill).toBe("#ffffff");
      expect(call.font.endsWith(ATLAS_FACE)).toBe(true);
    }
    expect(ATLAS_FACE).toBe(DATA_CITY.type.mono);
    expect(texts[0]).toMatchObject({ text: "0", x: ATLAS.cellWidth / 2, y: ATLAS.cellHeight / 2 });
    for (const call of texts) expect(call.text).toHaveLength(1);
  });
});

describe("Data City's driver", () => {
  it("draws the atlas once and publishes it as the scene's layer with u_atlas on", () => {
    const { canvas, calls } = fakeCanvas();
    const published: { uniforms: LiveUniforms; layer?: SceneLayer }[] = [];
    const stop = dataCityDriver({ createCanvas: () => canvas })((uniforms, layer) => published.push({ uniforms, layer }));
    expect(published).toHaveLength(1);
    expect(published[0]!.uniforms).toEqual({ u_atlas: 1 });
    expect(published[0]!.layer).toEqual({ source: canvas, version: 1 });
    expect(canvas.width).toBe(ATLAS.size);
    expect(canvas.height).toBe(ATLAS.size);
    expect(calls.filter((call) => call.kind === "text").length).toBeGreaterThan(100);
    if (DATA_CITY.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    for (const name of Object.keys(published[0]!.uniforms)) expect(Object.keys(DATA_CITY.scene.uniforms)).toContain(name);
    stop();
    expect(published).toHaveLength(1);
  });

  it("leaves the shader on its own block glyphs where no canvas can be made", () => {
    const published: { uniforms: LiveUniforms; layer?: SceneLayer }[] = [];
    dataCityDriver({ createCanvas: () => null })((uniforms, layer) => published.push({ uniforms, layer }));
    dataCityDriver({ createCanvas: () => ({ width: 0, height: 0, getContext: () => null }) })((uniforms, layer) => published.push({ uniforms, layer }));
    expect(published).toEqual([{ uniforms: { u_atlas: 0 }, layer: undefined }, { uniforms: { u_atlas: 0 }, layer: undefined }]);
  });
});
