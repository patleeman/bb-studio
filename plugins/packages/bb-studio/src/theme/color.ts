export interface Rgb { r: number; g: number; b: number }
export interface Oklab { l: number; a: number; b: number }
export interface Oklch { l: number; c: number; h: number }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
  const value = parseInt(match[1]!, 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

export function rgbToHex(color: Rgb): string {
  const part = (value: number) => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const fromLinear = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

export function luminance(color: Rgb): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbToOklab(color: Rgb): Oklab {
  const r = toLinear(color.r), g = toLinear(color.g), b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(lab: Oklab): Rgb {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return {
    r: clamp01(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  };
}

const ACHROMATIC = 0.0004;

export function rgbToOklch(color: Rgb): Oklch {
  const lab = rgbToOklab(color);
  const c = Math.hypot(lab.a, lab.b);
  const h = c < ACHROMATIC ? 0 : ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
  return { l: lab.l, c, h };
}

export function oklchToRgb(lch: Oklch): Rgb {
  const rad = (lch.h * Math.PI) / 180;
  return oklabToRgb({ l: lch.l, a: lch.c * Math.cos(rad), b: lch.c * Math.sin(rad) });
}

export function mixOklab(a: Rgb, b: Rgb, shareOfA: number): Rgb {
  const t = clamp01(shareOfA);
  const x = rgbToOklab(a), y = rgbToOklab(b);
  return oklabToRgb({ l: x.l * t + y.l * (1 - t), a: x.a * t + y.a * (1 - t), b: x.b * t + y.b * (1 - t) });
}

export function mixOklch(a: Rgb, b: Rgb, shareOfA: number): Rgb {
  const t = clamp01(shareOfA);
  const x = rgbToOklch(a), y = rgbToOklch(b);
  const xHue = x.c < ACHROMATIC ? y.h : x.h;
  const yHue = y.c < ACHROMATIC ? x.h : y.h;
  let delta = xHue - yHue;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return oklchToRgb({ l: x.l * t + y.l * (1 - t), c: x.c * t + y.c * (1 - t), h: (yHue + delta * t + 360) % 360 });
}

export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const a = clamp01(alpha);
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a) };
}

export function mixRgb(a: Rgb, b: Rgb, shareOfA: number): Rgb {
  return over(a, shareOfA, b);
}

export function worstContrast(color: Rgb, backgrounds: readonly Rgb[]): number {
  return Math.min(...backgrounds.map((background) => contrast(color, background)));
}

export function readableShare(color: Rgb, toward: Rgb, backgrounds: readonly Rgb[], min: number): number {
  if (worstContrast(color, backgrounds) >= min) return 1;
  for (let share = 0.98; share > 0; share -= 0.02) {
    if (worstContrast(mixOklch(color, toward, share), backgrounds) >= min) return Math.round(share * 100) / 100;
  }
  return 0;
}

export function oklchCss(color: Rgb): string {
  const { l, c, h } = rgbToOklch(color);
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  return `oklch(${round(l, 4)} ${round(c, 4)} ${c < ACHROMATIC ? "none" : round(h, 2)})`;
}

export function pct(share: number): string {
  return `${Math.round(clamp01(share) * 1000) / 10}%`;
}
