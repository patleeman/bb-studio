// BB's theme as Visual Chat uses it: the host's theme tokens (the CSS
// variables BB gives plugin UI, the ones Tailwind's bg-background,
// text-foreground, border-border … read), resolved to plain colors, fonts and
// a radius. Boards take their base palette from it (looks.ts): the ground,
// text, rules and card surfaces are BB's, in light and dark and in any
// palette, and a style only adds its accent, type and rules on top.
// Pure: no DOM here (ui/bb-theme.ts reads the live page), so the server and
// the tests can use it too.

export type Mode = "light" | "dark";

/** The colors Visual Chat reads, by BB CSS variable. */
export const BB_COLOR_VARS = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  border: "--border",
  destructive: "--destructive",
  success: "--success",
  warning: "--warning",
} as const;
export type BbColor = keyof typeof BB_COLOR_VARS;

export interface BbTheme {
  mode: Mode;
  /** Each as #rrggbb. */
  colors: Record<BbColor, string>;
  fonts: { sans: string; serif: string; mono: string };
  /** BB's --radius, in px. */
  radius: number;
}

// ---------------------------------------------------------------------------
// Color math: sRGB, OKLab/OKLCH, WCAG contrast.

/** sRGB channels, 0..1. */
export type Rgb = [number, number, number];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to sRGB, unclamped (a channel outside 0..1 is out of gamut). */
export function oklabToRgb([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export interface Lch { l: number; c: number; h: number }

export function rgbToOklch(rgb: Rgb): Lch {
  const [l, a, b] = rgbToOklab(rgb);
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const lchToLab = ({ l, c, h }: Lch): [number, number, number] => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

/** OKLCH to sRGB, mapped into gamut by lowering chroma (hue and lightness stay). */
export function oklchToRgb(lch: Lch): Rgb {
  const l = clamp01(lch.l);
  let rgb = oklabToRgb(lchToLab({ ...lch, l }));
  if (inGamut(rgb)) return rgb.map(clamp01) as Rgb;
  let lo = 0;
  let hi = lch.c;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const next = oklabToRgb(lchToLab({ l, c: mid, h: lch.h }));
    if (inGamut(next)) { lo = mid; rgb = next; } else hi = mid;
  }
  return oklabToRgb(lchToLab({ l, c: lo, h: lch.h })).map(clamp01) as Rgb;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** a over b at `share` (0..1) of a, mixed in OKLab. */
export function mix(a: Rgb, b: Rgb, share: number): Rgb {
  const [x, y] = [rgbToOklab(a), rgbToOklab(b)];
  return oklabToRgb([0, 1, 2].map((i) => x[i]! * share + y[i]! * (1 - share)) as [number, number, number]).map(clamp01) as Rgb;
}

const num = (token: string, percentScale = 1): number => {
  const value = Number.parseFloat(token);
  return token.trim().endsWith("%") ? (value / 100) * percentScale : value;
};

/**
 * A CSS color as sRGB, or null when it isn't one this reads: hex, rgb()/rgba(),
 * color(srgb …), oklch(), oklab(). Alpha is dropped (BB's theme tokens are
 * opaque). The page resolves anything else (color-mix, named colors) before it
 * gets here (ui/bb-theme.ts).
 */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.split("").map((c) => c + c).join("") : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
  }
  const fn = /^([a-z]+)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const parts = fn[2]!.split("/")[0]!.trim().split(/[\s,]+/).filter(Boolean);
  const ok = (rgb: Rgb) => (rgb.every((v) => Number.isFinite(v)) ? (rgb.map(clamp01) as Rgb) : null);
  switch (fn[1]) {
    case "rgb":
    case "rgba":
      if (parts.length < 3) return null;
      return ok(parts.slice(0, 3).map((p) => num(p, 255) / 255) as Rgb);
    case "color":
      if (parts[0] !== "srgb" || parts.length < 4) return null;
      return ok(parts.slice(1, 4).map((p) => num(p)) as Rgb);
    case "oklch": {
      if (parts.length < 3) return null;
      const [l, c, h] = [num(parts[0]!), num(parts[1]!, 0.4), parts[2] === "none" ? 0 : Number.parseFloat(parts[2]!)];
      return ok(oklchToRgb({ l, c: Number.isFinite(c) ? c : 0, h: Number.isFinite(h) ? h : 0 }));
    }
    case "oklab": {
      if (parts.length < 3) return null;
      return ok(oklabToRgb([num(parts[0]!), num(parts[1]!, 0.4), num(parts[2]!, 0.4)]).map(clamp01) as Rgb);
    }
    default:
      return null;
  }
}

/** A hex color as sRGB (the theme stores hex; anything unreadable is mid gray). */
export const rgb = (hex: string): Rgb => parseColor(hex) ?? [0.5, 0.5, 0.5];

/**
 * A color of this hue that reads on `ground` at `min` contrast or better:
 * starting from lightness `l` and chroma `c`, it steps away from the ground
 * (darker on a light ground, lighter on a dark one) until it does.
 */
export function fitHue(h: number, c: number, l: number, ground: Rgb, min: number): Rgb {
  const darker = luminance(ground) > 0.18;
  let best = oklchToRgb({ l, c, h });
  for (let step = 0; step < 80; step++) {
    const lightness = l + (darker ? -0.01 : 0.01) * step;
    if (lightness < 0 || lightness > 1) break;
    best = oklchToRgb({ l: lightness, c, h });
    if (contrast(best, ground) >= min) return best;
  }
  return best;
}

/** The same color, moved away from the ground only as far as it takes to read at `min`. */
export function fitColor(color: Rgb, ground: Rgb, min: number): Rgb {
  if (contrast(color, ground) >= min) return color;
  const { l, c, h } = rgbToOklch(color);
  return fitHue(h, c, l, ground, min);
}

// ---------------------------------------------------------------------------
// BB's default palette, for when the page can't be read (and the tests).

const DEFAULTS: Record<Mode, Record<BbColor, string>> = {
  light: {
    background: "oklch(1 0 0)", foreground: "oklch(0.3211 0 0)", card: "oklch(1 0 0)", cardForeground: "oklch(0.3211 0 0)",
    popover: "oklch(1 0 0)", popoverForeground: "oklch(0.3211 0 0)", primary: "oklch(0.27 0 0)", primaryForeground: "oklch(1 0 0)",
    muted: "oklch(0.925 0 0)", mutedForeground: "oklch(0.44 0 0)", accent: "oklch(0.946 0 0)", border: "oklch(0.905 0 0)",
    destructive: "oklch(0.45 0.19 25.86)", success: "oklch(0.7 0.15 155)", warning: "oklch(0.7 0.16 50)",
  },
  dark: {
    background: "oklch(0.195 0 0)", foreground: "oklch(0.81 0 0)", card: "oklch(0.195 0 0)", cardForeground: "oklch(0.81 0 0)",
    popover: "oklch(0.195 0 0)", popoverForeground: "oklch(0.81 0 0)", primary: "oklch(0.82 0 0)", primaryForeground: "oklch(0.2178 0 0)",
    muted: "oklch(0.293 0 0)", mutedForeground: "oklch(0.78 0 0)", accent: "oklch(0.27 0 0)", border: "oklch(0.316 0 0)",
    destructive: "oklch(0.56 0.19 22.17)", success: "oklch(0.74 0.15 155)", warning: "oklch(0.75 0.16 50)",
  },
};
export const BB_SANS = `"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
export const BB_SERIF = `Georgia, serif`;
export const BB_MONO = `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;

/** BB's default theme for a mode. */
export function defaultBbTheme(mode: Mode): BbTheme {
  const colors = Object.fromEntries(Object.entries(DEFAULTS[mode]).map(([key, value]) => [key, toHex(rgb(value))])) as Record<BbColor, string>;
  return { mode, colors, fonts: { sans: BB_SANS, serif: BB_SERIF, mono: BB_MONO }, radius: 8 };
}

/**
 * A theme from raw values (resolved CSS colors, font stacks, a radius in px),
 * each missing or unreadable one taking BB's default for the mode.
 */
export function bbTheme(mode: Mode, raw: { colors?: Partial<Record<BbColor, string>>; fonts?: Partial<BbTheme["fonts"]>; radius?: number | null }): BbTheme {
  const base = defaultBbTheme(mode);
  const colors = { ...base.colors };
  for (const key of Object.keys(BB_COLOR_VARS) as BbColor[]) {
    const read = raw.colors?.[key];
    const parsed = read ? parseColor(read) : null;
    if (parsed) colors[key] = toHex(parsed);
  }
  const font = (value: string | undefined, fallback: string) => (value && value.trim() ? value.trim() : fallback);
  const radius = typeof raw.radius === "number" && Number.isFinite(raw.radius) && raw.radius >= 0 ? Math.min(32, raw.radius) : base.radius;
  return { mode, colors, fonts: { sans: font(raw.fonts?.sans, base.fonts.sans), serif: font(raw.fonts?.serif, base.fonts.serif), mono: font(raw.fonts?.mono, base.fonts.mono) }, radius };
}

/** Two themes paint the same. */
export const sameTheme = (a: BbTheme, b: BbTheme) => JSON.stringify(a) === JSON.stringify(b);
