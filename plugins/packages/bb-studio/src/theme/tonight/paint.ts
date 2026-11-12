import type { PlanetDot, SkyPicture } from "./compose";

export interface SkyGradient { addColorStop(offset: number, color: string): void }
export interface SkyContext {
  fillStyle: string | SkyGradient | object;
  strokeStyle: string | object;
  lineWidth: number;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
  clearRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SkyGradient;
}

const TAU = Math.PI * 2;
const LABEL_FONT = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const STAR_TINTS: readonly (readonly [number, number, number, number])[] = [
  [-0.4, 176, 196, 255],
  [0, 210, 222, 255],
  [0.35, 250, 249, 255],
  [0.7, 255, 243, 228],
  [1.1, 255, 219, 180],
  [1.6, 255, 192, 140],
  [2.2, 255, 170, 120],
];
const PLANET_TINTS: Record<PlanetDot["id"], readonly [number, number, number]> = {
  moon: [240, 240, 235],
  mercury: [214, 208, 200],
  venus: [255, 250, 232],
  mars: [255, 170, 120],
  jupiter: [255, 238, 210],
  saturn: [246, 226, 178],
};

export function starTint(color: number): readonly [number, number, number] {
  const first = STAR_TINTS[0]!;
  if (color <= first[0]) return [first[1], first[2], first[3]];
  for (let at = 1; at < STAR_TINTS.length; at += 1) {
    const a = STAR_TINTS[at - 1]!, b = STAR_TINTS[at]!;
    if (color > b[0]) continue;
    const t = (color - a[0]) / (b[0] - a[0]);
    return [Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), Math.round(a[3] + (b[3] - a[3]) * t)];
  }
  const last = STAR_TINTS[STAR_TINTS.length - 1]!;
  return [last[1], last[2], last[3]];
}

export function starRadius(magnitude: number): number {
  return Math.max(0.7, 3.2 - 0.5 * magnitude);
}

export function starAlpha(magnitude: number): number {
  return Math.min(1, Math.max(0.5, 1.5 - 0.18 * magnitude));
}

const rgba = (tint: readonly [number, number, number], alpha: number) => `rgba(${tint[0]},${tint[1]},${tint[2]},${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`;

function toward(tint: readonly [number, number, number], white: number): readonly [number, number, number] {
  return [Math.round(tint[0] + (255 - tint[0]) * white), Math.round(tint[1] + (255 - tint[1]) * white), Math.round(tint[2] + (255 - tint[2]) * white)];
}

function dot(ctx: SkyContext, x: number, y: number, radius: number, tint: readonly [number, number, number], alpha: number, glow: number, unit: number): void {
  if (glow > 0) {
    const reach = radius * 7;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, reach);
    gradient.addColorStop(0, rgba(tint, glow * alpha));
    gradient.addColorStop(0.35, rgba(tint, glow * alpha * 0.3));
    gradient.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, reach, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = rgba(tint, alpha);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5 * unit, radius), 0, TAU);
  ctx.fill();
}

export const LINE_GAP = 5;
const LINE_TINT = [150, 178, 238] as const;
const NAME_TINT = [168, 190, 238] as const;
const EVENT_TINT = [238, 228, 204] as const;

export function paintSky(ctx: SkyContext, width: number, height: number, ratio: number, picture: SkyPicture): void {
  const px = (x: number) => x * height;
  const py = (y: number) => height - y * height;
  ctx.clearRect(0, 0, width, height);

  const ink = picture.ink;
  const lineTint = toward(LINE_TINT, ink.white);
  ctx.lineWidth = ratio * ink.lineWidth;
  ctx.lineCap = "round";
  const gap = LINE_GAP * ratio;
  for (const segment of picture.segments) {
    const x0 = px(segment.x0), y0 = py(segment.y0), x1 = px(segment.x1), y1 = py(segment.y1);
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length <= gap * 2.4) continue;
    const ux = ((x1 - x0) / length) * gap, uy = ((y1 - y0) / length) * gap;
    ctx.strokeStyle = rgba(lineTint, ink.line * segment.dim);
    ctx.beginPath();
    ctx.moveTo(x0 + ux, y0 + uy);
    ctx.lineTo(x1 - ux, y1 - uy);
    ctx.stroke();
  }

  for (const star of picture.stars) {
    const seen = Math.min(1, ink.faintest - star.magnitude);
    if (seen <= 0) continue;
    const tint = toward(starTint(star.color), ink.white);
    const glow = star.magnitude < 4.2 ? (0.12 + 0.36 * Math.min(1, (4.2 - star.magnitude) / 4)) * ink.glow : 0;
    dot(ctx, px(star.x), py(star.y), starRadius(star.magnitude) * ratio, tint, starAlpha(star.magnitude) * star.dim * ink.star * seen, glow, ratio);
  }

  for (const planet of picture.planets) {
    dot(ctx, px(planet.x), py(planet.y), (starRadius(planet.magnitude) + 0.35) * ratio, toward(PLANET_TINTS[planet.id], ink.white), planet.dim * (0.5 + 0.5 * ink.star), 0.34 * ink.glow, ratio);
  }

  ctx.textBaseline = "middle";
  for (const label of picture.labels) {
    if (label.kind === "constellation") {
      ctx.font = `500 ${10 * ratio}px ${LABEL_FONT}`;
      ctx.textAlign = "center";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${1.6 * ratio}px`;
      ctx.fillStyle = rgba(toward(NAME_TINT, ink.white), ink.label);
      ctx.fillText(label.text.toUpperCase(), px(label.x), py(label.y));
      continue;
    }
    ctx.font = `500 ${10 * ratio}px ${LABEL_FONT}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${0.3 * ratio}px`;
    ctx.fillStyle = rgba(toward(EVENT_TINT, ink.white), ink.label + 0.1);
    if (label.kind === "planet") {
      ctx.textAlign = "left";
      ctx.fillText(label.text, px(label.x) + 9 * ratio, py(label.y) + 9 * ratio);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(label.text, px(label.x), py(label.y));
    }
  }
}
