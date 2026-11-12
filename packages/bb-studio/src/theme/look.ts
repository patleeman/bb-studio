import { contrast, hexToRgb, luminance, mixOklab, mixOklch, over, readableShare, worstContrast, type Rgb } from "./color";
import { glassSurfaceFor, SURFACES, TEXT_SURFACES, variantFor, type Mode, type Surface, type ThemePackage } from "./schema";

export interface LookSettings { intensity: number; glass: number; motion: number }

export const TEXT_MIN = 4.5;
export const UI_MIN = 3;
export const INK_TARGET = 7;

export const HALO_SURFACES: readonly Surface[] = ["sidebar", "transcript"];
export const HALO_LAYERS = [{ blur: 2, alpha: 0.9 }, { blur: 2, alpha: 0.9 }, { blur: 8, alpha: 0.55 }] as const;
export const HALO_STROKE_PX = 1;

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function haloCoverage(layers: readonly { blur: number; alpha: number }[] = HALO_LAYERS, stroke = HALO_STROKE_PX): number {
  let clear = 1;
  for (const layer of layers) {
    const sigma = layer.blur / 2;
    const share = sigma > 0 ? normalCdf(stroke / sigma) - 0.5 : 1;
    clear *= 1 - layer.alpha * share;
  }
  return Math.round((1 - clear) * 1000) / 1000;
}

export const HALO = haloCoverage();

const WALLPAPER: readonly Rgb[] = [hexToRgb("#000000"), hexToRgb("#ffffff")];
const START = { muted: 0.72, subtle: 0.64, readback: 0.68 } as const;
const SELECTION_START = 0.32;

export interface ResolvedLook {
  themeId: string;
  mode: Mode;
  fixedMode: boolean;
  canvas: Rgb;
  ink: Rgb;
  sidebar: Rgb;
  accent: Rgb;
  accentInk: Rgb;
  selection: Rgb;
  error: Rgb;
  warning: Rgb;
  success: Rgb;
  worker: Rgb;
  needsYou: Rgb;
  finished: Rgb;
  ripple: Rgb;
  palette: [Rgb, Rgb, Rgb, Rgb];
  scene: Rgb;
  alpha: Record<Surface, number>;
  blur: Record<Surface, number>;
  glassy: boolean;
  halo: number;
  saturate: number;
  edge: Rgb | null;
  shares: { muted: number; subtle: number; readback: number; errorText: number; warningText: number; successText: number; accentText: number; selection: number };
  fonts: { heading: string; body: string; mono: string; transcript?: string; headingWeight?: number };
  radius: number;
  intensity: number;
  motion: number;
  rate: number;
  crossfadeMs: number;
  still: boolean;
}

export interface ContrastLine { surface: Surface | "accent"; role: string; ratio: number; min: number; pass: boolean }
export interface OpenAreaMeasure { mutedText: number; text: number; alpha: number }

function tintOf(surface: Surface, colors: { canvas: Rgb; sidebar: Rgb }): Rgb {
  return surface === "sidebar" ? colors.sidebar : colors.canvas;
}

export function backdropRange(theme: ThemePackage, surface: Surface, intensity: number, mode?: Mode): readonly Rgb[] {
  if (surface === "hud") return WALLPAPER;
  if (theme.scene.kind !== "shader") return [];
  const range = (mode && theme.scene.backdrop.modes?.[mode]) ?? theme.scene.backdrop;
  const dark = hexToRgb(range.dark);
  return [dark, over(hexToRgb(range.light), Math.min(1, Math.max(0, intensity)), dark)];
}

export const SCENE_TONE_SHARE = 0.2;

export function sceneTone(backdrop: readonly Rgb[], canvas: Rgb, mode: Mode): Rgb {
  const [dark, light] = backdrop;
  if (!dark || !light) return canvas;
  return mode === "light" ? over(dark, SCENE_TONE_SHARE, light) : over(light, SCENE_TONE_SHARE, dark);
}

export function chosenAlpha(theme: ThemePackage, surface: Surface, glass: number, mode?: Mode): number {
  const own = glassSurfaceFor(theme, surface, mode);
  if (!own) return 1;
  const base = own.opacity;
  const scale = theme.defaults.glass > 0 ? glass / theme.defaults.glass : 1;
  return Math.min(1, Math.max(0, base * scale));
}

export function surfaceBackgrounds(tint: Rgb, alpha: number, backdrop: readonly Rgb[], halo = 0, haloColor: Rgb = tint): Rgb[] {
  if (!backdrop.length || alpha >= 1) return [tint];
  return backdrop.map((color) => over(haloColor, halo, over(tint, alpha, color)));
}

export function surfaceHalo(theme: ThemePackage, surface: Surface): number {
  return theme.glass && HALO_SURFACES.includes(surface) ? HALO : 0;
}

export function bareTextMin(ink: Rgb, tint: Rgb): number {
  if (luminance(ink) >= luminance(tint)) return UI_MIN;
  return Math.min(TEXT_MIN, Math.floor((contrast(ink, tint) - 0.05) * 100) / 100);
}

export function minReadableAlpha(ink: Rgb, tint: Rgb, backdrop: readonly Rgb[], halo = 0, haloColor: Rgb = tint): number {
  if (!backdrop.length) return 0;
  const target = Math.min(INK_TARGET, contrast(ink, tint) - 0.05);
  for (let step = 0; step <= 100; step += 1) {
    const alpha = step / 100;
    const haloed = worstContrast(ink, surfaceBackgrounds(tint, alpha, backdrop, halo, haloColor)) >= target;
    const bare = halo <= 0 || worstContrast(ink, surfaceBackgrounds(tint, alpha, backdrop)) >= bareTextMin(ink, tint);
    if (haloed && bare) return alpha;
  }
  return 1;
}

function rise(base: Rgb, other: Rgb, start: number, backgrounds: readonly Rgb[], min: number, bare: readonly Rgb[] = []): number {
  for (let share = start; share < 1; share += 0.01) {
    const color = mixOklch(base, other, share);
    if (worstContrast(color, backgrounds) >= min && (!bare.length || worstContrast(color, bare) >= UI_MIN)) return Math.round(share * 100) / 100;
  }
  return 1;
}

function bestInk(fill: Rgb, choices: readonly Rgb[]): Rgb {
  return choices.reduce((best, each) => (contrast(each, fill) > contrast(best, fill) ? each : best));
}

function selectionShare(ink: Rgb, selection: Rgb, backgrounds: readonly Rgb[]): number {
  for (let share = SELECTION_START; share > 0.04; share -= 0.02) {
    if (worstContrast(ink, backgrounds.map((background) => over(selection, share, background))) >= TEXT_MIN) return Math.round(share * 100) / 100;
  }
  return 0.04;
}

export function resolveLook(theme: ThemePackage, settings: LookSettings, appMode: Mode, reducedMotion = false): ResolvedLook {
  const { mode, colors } = variantFor(theme, appMode);
  const rgb = {
    canvas: hexToRgb(colors.canvas), ink: hexToRgb(colors.ink), sidebar: hexToRgb(colors.sidebar), accent: hexToRgb(colors.accent), accentInk: hexToRgb(colors.accentInk),
    selection: hexToRgb(colors.selection), error: hexToRgb(colors.error), warning: hexToRgb(colors.warning), success: hexToRgb(colors.success),
  };
  const alpha = {} as Record<Surface, number>;
  const blur = {} as Record<Surface, number>;
  const backgrounds: Rgb[] = [];
  const bareBackgrounds: Rgb[] = [];
  for (const surface of SURFACES) {
    const tint = tintOf(surface, rgb);
    const backdrop = backdropRange(theme, surface, settings.intensity, mode);
    const halo = surfaceHalo(theme, surface);
    const floor = surface === "main" ? 0 : minReadableAlpha(rgb.ink, tint, backdrop, halo, rgb.canvas);
    alpha[surface] = Math.max(chosenAlpha(theme, surface, settings.glass, mode), floor);
    blur[surface] = glassSurfaceFor(theme, surface, mode)?.blur ?? 0;
    if (surface !== "main") backgrounds.push(...surfaceBackgrounds(tint, alpha[surface], backdrop, halo, rgb.canvas));
    if (surface !== "main" && halo > 0 && bareTextMin(rgb.ink, tint) > UI_MIN) bareBackgrounds.push(...surfaceBackgrounds(tint, alpha[surface], backdrop));
  }
  const mainBackgrounds = backgrounds.slice();
  const accentInk = contrast(rgb.accentInk, rgb.accent) >= TEXT_MIN ? rgb.accentInk : bestInk(rgb.accent, [rgb.accentInk, rgb.canvas, rgb.ink, hexToRgb("#000000"), hexToRgb("#ffffff")]);
  const speed = theme.motion.speed;
  const still = reducedMotion || speed === 0 || settings.motion === 0;
  return {
    themeId: theme.id,
    mode,
    fixedMode: !(theme.variants.light && theme.variants.dark),
    ...rgb,
    accentInk,
    worker: hexToRgb(theme.effects.worker.color),
    needsYou: hexToRgb(theme.effects.needsYou.color),
    finished: hexToRgb(theme.effects.finished.color),
    ripple: hexToRgb(theme.effects.error.color),
    palette: theme.palette.map(hexToRgb) as [Rgb, Rgb, Rgb, Rgb],
    scene: sceneTone(backdropRange(theme, "transcript", settings.intensity, mode), rgb.canvas, mode),
    alpha,
    blur,
    glassy: !!theme.glass,
    halo: theme.glass ? HALO : 0,
    saturate: theme.glass?.saturate ?? 1,
    edge: theme.glass?.edge ? hexToRgb(theme.glass.edge) : null,
    shares: {
      muted: rise(rgb.ink, rgb.canvas, START.muted, mainBackgrounds, TEXT_MIN, bareBackgrounds),
      subtle: rise(rgb.ink, rgb.canvas, START.subtle, mainBackgrounds, TEXT_MIN, bareBackgrounds),
      readback: rise(rgb.ink, rgb.canvas, START.readback, mainBackgrounds, TEXT_MIN, bareBackgrounds),
      errorText: readableShare(rgb.error, rgb.ink, mainBackgrounds, TEXT_MIN),
      warningText: readableShare(rgb.warning, rgb.ink, mainBackgrounds, TEXT_MIN),
      successText: readableShare(rgb.success, rgb.ink, mainBackgrounds, UI_MIN),
      accentText: readableShare(rgb.accent, rgb.ink, mainBackgrounds, UI_MIN),
      selection: selectionShare(rgb.ink, rgb.selection, mainBackgrounds),
    },
    fonts: { ...theme.type },
    radius: theme.radius,
    intensity: settings.intensity,
    motion: settings.motion,
    rate: still ? 0 : speed * (settings.motion / Math.max(theme.defaults.motion, 0.05)),
    crossfadeMs: reducedMotion ? 0 : theme.motion.crossfadeMs,
    still,
  };
}

export function contrastReport(theme: ThemePackage, look: ResolvedLook): ContrastLine[] {
  const lines: ContrastLine[] = [];
  const add = (surface: ContrastLine["surface"], role: string, color: Rgb, backgrounds: readonly Rgb[], min: number) => {
    const ratio = Math.round(worstContrast(color, backgrounds) * 100) / 100;
    lines.push({ surface, role, ratio, min, pass: ratio >= min });
  };
  for (const surface of TEXT_SURFACES) {
    const backdrop = backdropRange(theme, surface, look.intensity, look.mode);
    const halo = surfaceHalo(theme, surface);
    const backgrounds = surfaceBackgrounds(tintOf(surface, look), look.alpha[surface], backdrop, halo, look.canvas);
    add(surface, "text", look.ink, backgrounds, TEXT_MIN);
    const bare = surfaceBackgrounds(tintOf(surface, look), look.alpha[surface], backdrop);
    const bareMin = bareTextMin(look.ink, tintOf(surface, look));
    if (halo > 0) add(surface, "text without its halo", look.ink, bare, bareMin);
    if (halo > 0 && bareMin > UI_MIN) add(surface, "muted text without its halo", mixOklch(look.ink, look.canvas, look.shares.muted), bare, UI_MIN);
    add(surface, "muted text", mixOklch(look.ink, look.canvas, look.shares.muted), backgrounds, TEXT_MIN);
    add(surface, "subtle text", mixOklch(look.ink, look.canvas, look.shares.subtle), backgrounds, TEXT_MIN);
    add(surface, "error text", mixOklch(look.error, look.ink, look.shares.errorText), backgrounds, TEXT_MIN);
    add(surface, "warning text", mixOklch(look.warning, look.ink, look.shares.warningText), backgrounds, TEXT_MIN);
    add(surface, "success", mixOklch(look.success, look.ink, look.shares.successText), backgrounds, UI_MIN);
    add(surface, "accent", mixOklch(look.accent, look.ink, look.shares.accentText), backgrounds, UI_MIN);
    add(surface, "selected text", look.ink, backgrounds.map((background) => over(look.selection, look.shares.selection, background)), TEXT_MIN);
  }
  add("accent", "text on accent", look.accentInk, [look.accent], TEXT_MIN);
  return lines;
}

export function openAreaMeasure(theme: ThemePackage, look: ResolvedLook): OpenAreaMeasure {
  const backgrounds = surfaceBackgrounds(look.canvas, look.alpha.main, backdropRange(theme, "main", look.intensity, look.mode));
  const round = (ratio: number) => Math.round(ratio * 100) / 100;
  return {
    mutedText: round(worstContrast(mixOklch(look.ink, look.canvas, look.shares.muted), backgrounds)),
    text: round(worstContrast(look.ink, backgrounds)),
    alpha: Math.round(look.alpha.main * 100) / 100,
  };
}

export function mixLooks(from: ResolvedLook, to: ResolvedLook, t: number): ResolvedLook {
  if (t >= 1) return to;
  if (t <= 0) return from;
  const color = (key: "canvas" | "ink" | "sidebar" | "accent" | "accentInk" | "selection" | "error" | "warning" | "success" | "worker" | "needsYou" | "finished" | "ripple") => mixOklab(to[key], from[key], t);
  const number = (a: number, b: number) => a + (b - a) * t;
  const late = t >= 0.5;
  const record = <K extends string>(a: Record<K, number>, b: Record<K, number>) => Object.fromEntries(Object.keys(b).map((key) => [key, number(a[key as K], b[key as K])])) as Record<K, number>;
  return {
    ...(late ? to : from),
    canvas: color("canvas"), ink: color("ink"), sidebar: color("sidebar"), accent: color("accent"), accentInk: color("accentInk"), selection: color("selection"),
    error: color("error"), warning: color("warning"), success: color("success"), worker: color("worker"), needsYou: color("needsYou"), finished: color("finished"), ripple: color("ripple"),
    palette: to.palette.map((each, index) => mixOklab(each, from.palette[index]!, t)) as [Rgb, Rgb, Rgb, Rgb],
    alpha: record(from.alpha, to.alpha),
    blur: record(from.blur, to.blur),
    glassy: from.glassy || to.glassy,
    halo: number(from.halo, to.halo),
    saturate: number(from.saturate, to.saturate),
    shares: record(from.shares, to.shares),
    radius: number(from.radius, to.radius),
    intensity: number(from.intensity, to.intensity),
  };
}
