import type { Palette, Rgb } from "./forms";

export const DEFAULT_PALETTE: Palette = [[255, 79, 216], [123, 47, 247], [79, 240, 255]];
export const DEFAULT_PALETTE_LIGHT: Palette = [[124, 58, 237], [49, 46, 129], [219, 39, 119]];
export const CHECK_PALETTE = DEFAULT_PALETTE;

export function hexToTriple(hex: string): Rgb {
  const value = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "808080", 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function tripleToHex(color: Rgb): string {
  return `#${color.map((part) => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, "0")).join("")}`;
}

export function paletteHex(palette: Palette): [string, string, string] {
  return [tripleToHex(palette[0]), tripleToHex(palette[1]), tripleToHex(palette[2])];
}

function luminance(color: Rgb): number {
  const lin = (part: number) => { const v = part / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(color[0]) + 0.7152 * lin(color[1]) + 0.0722 * lin(color[2]);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl(color: Rgb): [number, number, number] {
  const r = color[0] / 255, g = color[1] / 255, b = color[2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function paletteFromColor(main: Rgb, light = false): Palette {
  const [h, s, l] = toHsl(main);
  const sat = Math.max(s, 0.25);
  return light
    ? [main, fromHsl(h - 28, sat, clamp(l * 0.6, 0.14, 0.4)), fromHsl(h + 36, sat, clamp(l * 0.9, 0.25, 0.5))]
    : [main, fromHsl(h - 42, sat, clamp(l * 0.78, 0.36, 0.6)), fromHsl(h + 48, Math.min(1, sat * 1.05), clamp(l * 1.25, 0.62, 0.8))];
}

export function isLightGround(ground: string): boolean {
  return luminance(hexToTriple(ground)) > 0.4;
}

export function paletteFromTheme(themePalette: readonly string[]): Palette {
  const ground = hexToTriple(themePalette[0] ?? "#000000"), light = luminance(ground) > 0.4;
  const usable = [...new Set(themePalette.slice(1).map((hex) => hex.toLowerCase()))].map(hexToTriple).filter((color) => contrast(color, ground) >= 2 && toHsl(color)[1] >= 0.12);
  const main = usable[0];
  if (!main) return light ? DEFAULT_PALETTE_LIGHT : DEFAULT_PALETTE;
  const derived = paletteFromColor(main, light);
  const second = usable[1];
  if (!second) return derived;
  return [main, derived[1], second];
}
