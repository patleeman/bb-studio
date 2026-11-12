import { hexToRgb, luminance, type Rgb } from "./color";
import { contrastReport, openAreaMeasure, resolveLook, type ContrastLine, type LookSettings } from "./look";
import { isBuiltinTheme } from "./registry";
import { DEFAULT_CLEAR, ENGINE_UNIFORMS } from "./scene/contract";
import { emptyRipples, emptyWorkers, SceneRenderer } from "./scene/renderer";
import { glassSurfaceFor, MODES, parseThemePackage, themeModes, type ShaderScene, type ThemePackage } from "./schema";

export interface CheckLine { id: string; pass: boolean; reason: string }
export interface CheckReport { pass: boolean; results: CheckLine[]; theme: ThemePackage | null }

export interface CheckOptions {
  createContext?: (width: number, height: number) => WebGLRenderingContext | null;
  now?: () => number;
  frames?: number;
  budgetMs?: number;
  measured?: readonly CheckLine[] | null;
}

export const MEASURED_CHECKS = ["frame-time", "backdrop"] as const;

export const FRAME_SIZE = { width: 640, height: 400 } as const;
export const FRAME_BUDGET_MS = 6;
export const STATIC_BUDGET = 1500;
export const BACKDROP_WINDOW_WIDTH = 1600;

function lowest(lines: readonly ContrastLine[]): ContrastLine {
  return lines.reduce((low, line) => (line.ratio / line.min < low.ratio / low.min ? line : low));
}

export function contrastChecks(theme: ThemePackage): CheckLine[] {
  const results: CheckLine[] = [];
  const cases: LookSettings[] = [
    { intensity: theme.defaults.intensity, glass: theme.defaults.glass, motion: theme.defaults.motion },
    { intensity: 1, glass: 0, motion: theme.defaults.motion },
  ];
  for (const mode of themeModes(theme)) {
    const lines = cases.flatMap((settings) => contrastReport(theme, resolveLook(theme, settings, mode)));
    const surfaces = [...new Set(lines.map((line) => line.surface))];
    for (const surface of surfaces) {
      const own = lines.filter((line) => line.surface === surface);
      const failed = [...new Map(own.filter((line) => !line.pass).sort((a, b) => b.ratio - a.ratio).map((line) => [line.role, line])).values()];
      const low = lowest(own);
      results.push({
        id: `contrast:${mode}:${surface}`,
        pass: !failed.length,
        reason: failed.length
          ? `${mode} ${surface}: ${failed.map((line) => `${line.role} ${line.ratio} (min ${line.min})`).join(", ")}`
          : `${mode} ${surface}: lowest ${low.role} ${low.ratio} (min ${low.min})`,
      });
    }
    if (theme.glass) {
      const open = openAreaMeasure(theme, resolveLook(theme, cases[0]!, mode));
      results.push({
        id: `contrast:${mode}:main`,
        pass: true,
        reason: `${mode} main: open area at ${Math.round(open.alpha * 100)}% tint, text ${open.text} and muted text ${open.mutedText} over the brightest backdrop; text sits on the cards`,
      });
    }
  }
  return results;
}

const WEIGHTS: Record<string, number> = {
  sin: 4, cos: 4, tan: 4, asin: 4, acos: 4, atan: 4, pow: 4, exp: 4, exp2: 4, log: 4, log2: 4,
  sqrt: 2, inversesqrt: 2, length: 2, distance: 2, normalize: 2, reflect: 2, refract: 3,
  texture2D: 8, textureCube: 8,
  abs: 1, sign: 1, floor: 1, ceil: 1, fract: 1, mod: 1, min: 1, max: 1, clamp: 1, mix: 1, step: 1, smoothstep: 1, dot: 1, cross: 1,
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === "{") depth += 1;
    else if (text[at] === "}") { depth -= 1; if (depth === 0) return at; }
  }
  return text.length - 1;
}

function loopCount(header: string): number {
  const bound = /[<>]=?\s*(\d+(?:\.\d+)?)/.exec(header);
  const start = /=\s*(\d+)/.exec(header);
  if (!bound) return 64;
  return Math.max(1, Math.abs(Number(bound[1]) - (start ? Number(start[1]) : 0)));
}

export function staticCost(source: string): number {
  const text = stripComments(source);
  const bodies = new Map<string, string>();
  const definition = /\b(?:void|float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g;
  for (let found = definition.exec(text); found; found = definition.exec(text)) {
    const open = found.index + found[0].length - 1;
    const close = matchBrace(text, open);
    bodies.set(found[1]!, text.slice(open + 1, close));
    definition.lastIndex = close;
  }
  const memo = new Map<string, number>();
  const cost = (name: string, seen: Set<string>): number => {
    if (memo.has(name)) return memo.get(name)!;
    if (seen.has(name)) return 0;
    const body = bodies.get(name) ?? "";
    const total = bodyCost(body, new Set([...seen, name]));
    memo.set(name, total);
    return total;
  };
  const bodyCost = (body: string, seen: Set<string>): number => {
    let total = 0;
    let at = 0;
    const loop = /\bfor\s*\(([^)]*)\)\s*\{/g;
    for (let found = loop.exec(body); found; found = loop.exec(body)) {
      total += callCost(body.slice(at, found.index), seen);
      const open = found.index + found[0].length - 1;
      const close = matchBrace(body, open);
      total += loopCount(found[1]!) * bodyCost(body.slice(open + 1, close), seen);
      at = close + 1;
      loop.lastIndex = at;
    }
    return total + callCost(body.slice(at), seen);
  };
  const callCost = (chunk: string, seen: Set<string>): number => {
    let total = 0;
    const call = /\b([A-Za-z_]\w*)\s*\(/g;
    for (let found = call.exec(chunk); found; found = call.exec(chunk)) {
      const name = found[1]!;
      if (WEIGHTS[name] !== undefined) total += WEIGHTS[name]!;
      else if (bodies.has(name)) total += cost(name, seen);
    }
    return total;
  };
  return cost("main", new Set());
}

export function shaderShapeChecks(scene: ShaderScene): string[] {
  const text = stripComments(scene.source);
  const problems: string[] = [];
  if (!/\bvoid\s+main\s*\(\s*\)/.test(text)) problems.push("It has no void main().");
  if (!/\bgl_FragColor\b/.test(text)) problems.push("It never writes gl_FragColor.");
  if (/#\s*extension\b/.test(text)) problems.push("It asks for a GLSL extension.");
  if (/\bwhile\s*\(/.test(text)) problems.push("It has a while loop.");
  for (const name of ENGINE_UNIFORMS) if (new RegExp(`uniform\\s+\\w+\\s+${name}\\b`).test(text)) problems.push(`It declares ${name}, which the engine declares.`);
  for (const name of Object.keys(scene.uniforms)) {
    if ((ENGINE_UNIFORMS as readonly string[]).includes(name)) problems.push(`${name} is the engine's.`);
    else if (!new RegExp(`uniform\\s+\\w+\\s+${name}\\b`).test(text)) problems.push(`${name} has a value but no declaration.`);
  }
  return problems;
}

const LINEAR = Array.from({ length: 256 }, (_, value) => luminance({ r: value / 255, g: value / 255, b: value / 255 }));

function boxPass(source: Float32Array, target: Float32Array, width: number, height: number, radius: number, horizontal: boolean): void {
  const [lines, length, step, stride] = horizontal ? [height, width, 1, width] : [width, height, width, 1];
  const span = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const base = line * stride;
    const at = (index: number) => source[base + Math.min(length - 1, Math.max(0, index)) * step]!;
    let sum = 0;
    for (let index = -radius; index <= radius; index += 1) sum += at(index);
    for (let index = 0; index < length; index += 1) {
      target[base + index * step] = sum / span;
      sum += at(index + radius + 1) - at(index - radius);
    }
  }
}

export interface Region { left: number; top: number; right: number; bottom: number }

export const TEXT_REGIONS: readonly Region[] = [
  { left: 0, top: 0, right: 320 / 1600, bottom: 1 },
  { left: 320 / 1600, top: 0, right: 1, bottom: 48 / 1000 },
  { left: DEFAULT_CLEAR.left, top: DEFAULT_CLEAR.top, right: DEFAULT_CLEAR.right, bottom: 1 },
];

export function blurredPeak(pixels: Uint8Array, width: number, height: number, sigma: number, regions: readonly Region[] = [{ left: 0, top: 0, right: 1, bottom: 1 }]): number {
  const values = new Float32Array(width * height);
  for (let at = 0; at < values.length; at += 1) values[at] = 0.2126 * LINEAR[pixels[at * 4]!]! + 0.7152 * LINEAR[pixels[at * 4 + 1]!]! + 0.0722 * LINEAR[pixels[at * 4 + 2]!]!;
  const radius = Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2);
  if (radius > 0) {
    const spare = new Float32Array(values.length);
    for (let pass = 0; pass < 3; pass += 1) {
      boxPass(values, spare, width, height, radius, true);
      boxPass(spare, values, width, height, radius, false);
    }
  }
  let peak = 0;
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.left * width)), x1 = Math.min(width, Math.ceil(region.right * width));
    const y0 = Math.max(0, Math.floor((1 - region.bottom) * height)), y1 = Math.min(height, Math.ceil((1 - region.top) * height));
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (values[y * width + x]! > peak) peak = values[y * width + x]!;
  }
  return peak;
}

function backdropLine(theme: ThemePackage, scene: ShaderScene, pixels: Uint8Array): CheckLine {
  if (!theme.glass) return { id: "backdrop", pass: true, reason: "Opaque surfaces over the scene" };
  const blur = Math.min(...[undefined, ...MODES].flatMap((mode) => (["sidebar", "transcript", "composer"] as const).map((surface) => glassSurfaceFor(theme, surface, mode)!.blur)));
  const declared = luminance(hexToRgb(scene.backdrop.light));
  const measured = Math.round(blurredPeak(pixels, FRAME_SIZE.width, FRAME_SIZE.height, (blur * FRAME_SIZE.width) / BACKDROP_WINDOW_WIDTH, TEXT_REGIONS) * 1000) / 1000;
  return { id: "backdrop", pass: measured <= declared + 0.02, reason: `Brightest blurred backdrop behind text ${measured} (declared ${Math.round(declared * 1000) / 1000})` };
}

function declaredBackdrop(scene: ShaderScene, builtin: boolean): CheckLine {
  return { id: "backdrop", pass: true, reason: `Declared ${scene.backdrop.dark}–${scene.backdrop.light}; ${builtin ? "built-in scene" : "measured only where WebGL exists"}` };
}

function frameInput(theme: ThemePackage, scene: ShaderScene, width: number, height: number, time: number, intensity: number) {
  const variant = theme.variants.dark ?? theme.variants.light!;
  return {
    time, width, height, intensity, motion: theme.defaults.motion,
    palette: theme.palette.map(hexToRgb) as [Rgb, Rgb, Rgb, Rgb],
    workers: emptyWorkers(), ripples: emptyRipples(), needsYou: 0,
    workerColor: hexToRgb(theme.effects.worker.color), needsYouColor: hexToRgb(theme.effects.needsYou.color),
    finishedColor: hexToRgb(theme.effects.finished.color), errorColor: hexToRgb(variant.error ?? scene.fallback.color),
  };
}

function measuredChecks(theme: ThemePackage, scene: ShaderScene, options: CheckOptions): CheckLine[] {
  const now = options.now ?? (() => (typeof performance === "undefined" ? Date.now() : performance.now()));
  const frames = options.frames ?? 30;
  const budget = options.budgetMs ?? FRAME_BUDGET_MS;
  const gl = options.createContext!(FRAME_SIZE.width, FRAME_SIZE.height);
  if (!gl) return [];
  const compiled = SceneRenderer.create(gl, scene);
  if (!compiled.ok) return [{ id: "frame-time", pass: false, reason: `The shader didn't compile: ${compiled.error}` }];
  const renderer = compiled.renderer;
  try {
    const probe = new Uint8Array(4);
    const settle = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
    renderer.draw(frameInput(theme, scene, FRAME_SIZE.width, FRAME_SIZE.height, 0, 1));
    settle();
    const start = now();
    for (let frame = 0; frame < frames; frame += 1) {
      renderer.draw(frameInput(theme, scene, FRAME_SIZE.width, FRAME_SIZE.height, frame / 60, 1));
      settle();
    }
    const average = Math.round(((now() - start) / frames) * 100) / 100;
    const results: CheckLine[] = [{ id: "frame-time", pass: average <= budget, reason: `${frames} frames at ${FRAME_SIZE.width}×${FRAME_SIZE.height}: ${average} ms each (budget ${budget} ms)` }];
    if (isBuiltinTheme(theme.id)) return results;
    renderer.draw(frameInput(theme, scene, FRAME_SIZE.width, FRAME_SIZE.height, scene.still, 1));
    const pixels = new Uint8Array(FRAME_SIZE.width * FRAME_SIZE.height * 4);
    gl.readPixels(0, 0, FRAME_SIZE.width, FRAME_SIZE.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    results.push(backdropLine(theme, scene, pixels));
    return results;
  } finally {
    renderer.dispose();
  }
}

export function checkTheme(input: unknown, options: CheckOptions = {}): CheckReport {
  const parsed = parseThemePackage(input);
  if (!parsed.ok) return { pass: false, theme: null, results: [{ id: "schema", pass: false, reason: parsed.errors.join("; ") }] };
  const theme = parsed.theme;
  const results: CheckLine[] = [{ id: "schema", pass: true, reason: "Valid theme package" }];
  results.push(...contrastChecks(theme));
  if (theme.scene.kind === "none") {
    results.push({ id: "frame-time", pass: true, reason: "No scene" });
    results.push({ id: "reduced-motion", pass: true, reason: "No scene; nothing moves" });
  } else {
    const scene = theme.scene;
    const problems = shaderShapeChecks(scene);
    if (problems.length) results.push({ id: "shader", pass: false, reason: problems.join(" ") });
    const builtin = isBuiltinTheme(theme.id);
    const measured = problems.length ? [] : options.measured?.length ? [...options.measured] : options.createContext ? measuredChecks(theme, scene, options) : [];
    if (measured.length) results.push(...measured.filter((line) => !(builtin && line.id === "backdrop")));
    else {
      const cost = staticCost(scene.source);
      results.push({ id: "frame-time", pass: cost <= STATIC_BUDGET, reason: `Static estimate, no WebGL here: ${cost} weighted calls per pixel (budget ${STATIC_BUDGET})` });
    }
    if (!results.some((line) => line.id === "backdrop")) results.push(declaredBackdrop(scene, builtin));
    results.push({ id: "reduced-motion", pass: true, reason: `Still frame at ${scene.still} s over ${scene.fallback.color}${scene.fallback.image ? " and an image" : ""}` });
  }
  return { pass: results.every((line) => line.pass), results, theme };
}
