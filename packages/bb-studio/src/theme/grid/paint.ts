import { seeded } from "../deep-sea/atlas";
import { CITY_BOXES, CITY_SIZE, WINDOW_PITCH, type CityBox } from "./atlas";

export type CityContext = Pick<
  CanvasRenderingContext2D,
  | "fillStyle" | "strokeStyle" | "lineWidth" | "lineCap" | "lineJoin" | "globalCompositeOperation"
  | "save" | "restore" | "beginPath" | "closePath" | "moveTo" | "lineTo" | "arc" | "rect"
  | "clip" | "fill" | "stroke" | "fillRect" | "translate" | "rotate"
  | "createLinearGradient" | "createRadialGradient"
>;

type Random = () => number;
type Layer = keyof typeof WINDOW_PITCH;

const TAU = Math.PI * 2;

interface Tier { left: number; right: number; top: number }
interface Building { tiers: Tier[]; crown: "flat" | "spire" | "slant" | "dome" | "pyramid"; mast: number; seams: number; lit: number; pane: number; bands: boolean }

const red = (value: number) => `rgb(${Math.round(value)},0,0)`;
const green = (value: number) => `rgb(0,${Math.round(value)},0)`;
const blue = (value: number) => `rgb(0,0,${Math.round(value)})`;

function between(random: Random, low: number, high: number): number {
  return low + (high - low) * random();
}

function glowLine(context: CityContext, points: readonly (readonly [number, number])[], strength: number, width: number): void {
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "square";
  context.lineJoin = "miter";
  for (const [spread, share] of [[7, 0.1], [4, 0.18], [2, 0.3], [1, 1]] as const) {
    context.beginPath();
    context.moveTo(points[0]![0], points[0]![1]);
    for (const [x, y] of points.slice(1)) context.lineTo(x, y);
    context.lineWidth = width * spread;
    context.strokeStyle = blue(strength * share);
    context.stroke();
  }
  context.restore();
}

export const SLANT_WIDTH = 90;

function crownPoints(tier: Tier, crown: Building["crown"], rise: number): [number, number][] {
  const { left, right, top } = tier;
  const middle = (left + right) / 2;
  if (crown === "spire") return [[left, top], [middle - (right - left) * 0.12, top - rise * 0.5], [middle, top - rise * 1.6], [middle + (right - left) * 0.12, top - rise * 0.5], [right, top]];
  if (crown === "slant") return right - left > SLANT_WIDTH ? [[left, top], [right, top]] : [[left, top], [left, top - rise], [right, top]];
  if (crown === "pyramid") return [[left, top], [middle, top - rise], [right, top]];
  if (crown === "dome") return Array.from({ length: 13 }, (_, step) => {
    const angle = Math.PI + (step / 12) * Math.PI;
    return [middle + Math.cos(angle) * (right - left) / 2, top + Math.sin(angle) * rise * 0.8] as [number, number];
  });
  return [[left, top], [right, top]];
}

function outline(building: Building): [number, number][] {
  const tiers = building.tiers;
  const rise = Math.min(60, (tiers.at(-1)!.right - tiers.at(-1)!.left) * 0.7);
  const leftSide: [number, number][] = [];
  const rightSide: [number, number][] = [];
  tiers.forEach((tier, index) => {
    const below = index === 0 ? null : tiers[index - 1]!;
    if (below) { leftSide.push([below.left, below.top], [tier.left, below.top]); rightSide.unshift([tier.right, below.top], [below.right, below.top]); }
  });
  const top = tiers.at(-1)!;
  return [[tiers[0]!.left, Infinity], ...leftSide, ...crownPoints(top, building.crown, rise), ...rightSide, [tiers[0]!.right, Infinity]];
}

function makeBuilding(random: Random, x: number, base: number, width: number, height: number): Building {
  const steps = random() < 0.55 ? 1 + Math.floor(random() * 3) : 0;
  const tiers: Tier[] = [{ left: x - width / 2, right: x + width / 2, top: base - height * (steps ? between(random, 0.45, 0.7) : 1) }];
  for (let step = 0; step < steps; step += 1) {
    const below = tiers.at(-1)!;
    const inset = (below.right - below.left) * between(random, 0.1, 0.22);
    const shift = between(random, -0.5, 0.5) * inset;
    const remaining = below.top - (base - height);
    tiers.push({ left: below.left + inset + shift, right: below.right - inset + shift, top: below.top - remaining * (step === steps - 1 ? 1 : between(random, 0.4, 0.6)) });
  }
  const crowns: Building["crown"][] = ["flat", "flat", "spire", "slant", "dome", "pyramid"];
  return {
    tiers,
    crown: crowns[Math.floor(random() * crowns.length)]!,
    mast: random() < 0.45 ? between(random, 0.08, 0.3) * height : 0,
    seams: random() < 0.5 ? 1 + Math.floor(random() * 3) : 0,
    lit: between(random, 0.12, 0.55),
    pane: between(random, 0.35, 0.7),
    bands: random() < 0.22,
  };
}

function drawBuilding(context: CityContext, random: Random, building: Building, base: number, layer: Layer, glow: number): void {
  const shape = outline(building).map(([x, y]) => [x, Number.isFinite(y) ? y : base + 2] as [number, number]);
  const path = () => {
    context.beginPath();
    context.moveTo(shape[0]![0], shape[0]![1]);
    for (const [x, y] of shape.slice(1)) context.lineTo(x, y);
    context.closePath();
  };
  const left = building.tiers[0]!.left, right = building.tiers[0]!.right;
  const peak = Math.min(...shape.map(([, y]) => y));
  context.save();
  context.globalCompositeOperation = "source-over";
  path();
  const face = context.createLinearGradient(left, 0, right, 0);
  face.addColorStop(0, red(58));
  face.addColorStop(0.62, red(96));
  face.addColorStop(1, red(150));
  context.fillStyle = face;
  context.fill();
  context.clip();
  const shade = context.createLinearGradient(0, peak, 0, base);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.32)");
  context.fillStyle = shade;
  context.fillRect(left - 80, peak - 10, right - left + 160, base - peak + 20);
  const pitch = WINDOW_PITCH[layer];
  const mullions = Math.max(2, Math.round((right - left) / (pitch.x * 3)));
  for (let line = 1; line < mullions; line += 1) {
    context.fillStyle = "rgba(0,0,0,0.18)";
    context.fillRect(left + ((right - left) * line) / mullions, peak, 1, base - peak);
  }
  const floorOf = (index: number) => (index === 0 ? base : building.tiers[index - 1]!.top);
  building.tiers.forEach((tier, index) => {
    context.fillStyle = red(225);
    context.fillRect(tier.right - Math.max(1.5, pitch.x * 0.3), tier.top, Math.max(1.5, pitch.x * 0.3), floorOf(index) - tier.top);
    context.fillStyle = red(190);
    context.fillRect(tier.left, tier.top, tier.right - tier.left, Math.max(1, pitch.y * 0.15));
  });
  context.globalCompositeOperation = "lighter";
  building.tiers.forEach((tier, index) => {
    const top = tier.top + pitch.y, bottom = floorOf(index) - (index === 0 ? pitch.y : 0);
    for (let row = Math.ceil(top / pitch.y); row * pitch.y < bottom; row += 1) {
      const band = building.bands && row % 3 === 0;
      for (let column = Math.ceil((tier.left + pitch.x) / pitch.x); (column + 1) * pitch.x < tier.right - pitch.x * 0.5; column += 1) {
        if (!band && random() > building.lit) continue;
        context.fillStyle = green(band ? 140 : between(random, 90, 255));
        const width = band ? pitch.x : Math.max(1, pitch.x * building.pane);
        context.fillRect(column * pitch.x + (pitch.x - width) / 2, row * pitch.y + pitch.y * 0.25, width, Math.max(1, pitch.y * 0.45));
      }
    }
  });
  context.restore();
  const crownTop = building.tiers.at(-1)!;
  glowLine(context, crownPoints(crownTop, building.crown, Math.min(60, (crownTop.right - crownTop.left) * 0.7)), 210 * glow, Math.max(0.8, pitch.x * 0.16));
  building.tiers.slice(0, -1).forEach((tier) => glowLine(context, [[tier.left, tier.top], [tier.right, tier.top]], 150 * glow, Math.max(0.7, pitch.x * 0.12)));
  for (let seam = 0; seam < building.seams; seam += 1) {
    const tier = building.tiers[Math.min(seam, building.tiers.length - 1)]!;
    const at = tier.left + (tier.right - tier.left) * (seam + 1) / (building.seams + 1);
    glowLine(context, [[at, base], [at, tier.top + pitch.y]], 120 * glow, Math.max(0.6, pitch.x * 0.1));
  }
  if (building.mast) {
    const middle = (crownTop.left + crownTop.right) / 2;
    const foot = Math.min(...crownPoints(crownTop, building.crown, Math.min(60, (crownTop.right - crownTop.left) * 0.7)).map(([, y]) => y));
    context.save();
    context.globalCompositeOperation = "lighter";
    context.fillStyle = red(110);
    context.fillRect(middle - Math.max(1, pitch.x * 0.12), foot - building.mast, Math.max(2, pitch.x * 0.24), building.mast);
    context.restore();
    glowLine(context, [[middle, foot - building.mast], [middle, foot - building.mast + 1]], 255 * glow, Math.max(1.4, pitch.x * 0.3));
  }
}

export function paintSkyline(context: CityContext, box: CityBox, layer: Layer, seed: number, options: { count: number; width: [number, number]; height: [number, number]; glow: number }): void {
  const random = seeded(seed);
  context.save();
  context.translate(box.x, box.y);
  context.beginPath();
  context.rect(0, 0, box.width, box.height);
  context.clip();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#000000";
  context.fillRect(0, 0, box.width, box.height);
  const base = box.height;
  const spots = Array.from({ length: options.count }, (_, index) => ({ x: ((index + random()) / options.count) * box.width, tall: random() }));
  spots.sort((a, b) => b.tall - a.tall);
  for (const spot of spots) {
    const width = between(random, options.width[0], options.width[1]);
    const height = box.height * (options.height[0] + (options.height[1] - options.height[0]) * spot.tall * spot.tall);
    const building = makeBuilding(random, spot.x, base, width, height);
    const windows = Math.floor(random() * 1e9);
    for (const shift of [0, box.width, -box.width]) {
      if (spot.x + shift + width < -box.width * 0.05 || spot.x + shift - width > box.width * 1.05) continue;
      const moved: Building = { ...building, tiers: building.tiers.map((tier) => ({ ...tier, left: tier.left + shift, right: tier.right + shift })) };
      drawBuilding(context, seeded(windows), moved, base, layer, options.glow);
    }
  }
  context.restore();
}

export function paintRing(context: CityContext, box: CityBox): void {
  const random = seeded(91);
  const scale = box.width / 768;
  context.save();
  context.translate(box.x + box.width / 2, box.y + box.height / 2);
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#000000";
  context.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
  const r = (value: number) => value * scale;
  const segments = 24;
  for (let segment = 0; segment < segments; segment += 1) {
    const start = (segment / segments) * TAU + 0.025, end = ((segment + 1) / segments) * TAU - 0.025;
    context.beginPath();
    context.arc(0, 0, r(330), start, end);
    context.arc(0, 0, r(282), end, start, true);
    context.closePath();
    const panel = context.createRadialGradient(0, 0, r(282), 0, 0, r(330));
    panel.addColorStop(0, red(70));
    panel.addColorStop(0.5, red(120 + 50 * random()));
    panel.addColorStop(1, red(175));
    context.fillStyle = panel;
    context.fill();
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let pane = 0; pane < 6; pane += 1) {
      const at = start + ((end - start) * (pane + 0.5)) / 6;
      if (random() < 0.3) continue;
      context.save();
      context.rotate(at);
      context.fillStyle = green(between(random, 120, 255));
      context.fillRect(r(300), -r(3), r(14), r(6));
      context.restore();
    }
    context.restore();
  }
  context.beginPath();
  context.arc(0, 0, r(214), 0, TAU);
  context.arc(0, 0, r(200), 0, TAU, true);
  context.fillStyle = red(105);
  context.fill();
  for (let spoke = 0; spoke < 6; spoke += 1) {
    context.save();
    context.rotate((spoke / 6) * TAU + 0.26);
    context.fillStyle = red(88);
    context.fillRect(r(58), -r(7), r(226), r(14));
    context.fillStyle = red(150);
    context.fillRect(r(58), -r(7), r(226), r(3));
    context.restore();
  }
  context.beginPath();
  context.arc(0, 0, r(62), 0, TAU);
  const hub = context.createRadialGradient(r(14), -r(14), r(4), 0, 0, r(62));
  hub.addColorStop(0, red(190));
  hub.addColorStop(1, red(64));
  context.fillStyle = hub;
  context.fill();
  for (let ring = 1; ring <= 3; ring += 1) {
    context.beginPath();
    context.arc(0, 0, r(15 * ring + 6), 0, TAU);
    context.lineWidth = r(2);
    context.strokeStyle = "rgba(0,0,0,0.35)";
    context.stroke();
  }
  const circle = (radius: number, from = 0, to = TAU) => Array.from({ length: 97 }, (_, step) => {
    const angle = from + ((to - from) * step) / 96;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as [number, number];
  });
  glowLine(context, circle(r(331)), 230, r(2.2));
  glowLine(context, circle(r(281)), 150, r(1.4));
  glowLine(context, circle(r(207)), 170, r(1.6));
  glowLine(context, circle(r(62)), 210, r(1.8));
  glowLine(context, circle(r(26)), 255, r(2.4));
  for (let spoke = 0; spoke < 6; spoke += 1) {
    const angle = (spoke / 6) * TAU + 0.26;
    glowLine(context, [[Math.cos(angle) * r(64), Math.sin(angle) * r(64)], [Math.cos(angle) * r(280), Math.sin(angle) * r(280)]], 80, r(1));
  }
  for (let mark = 0; mark < 72; mark += 1) {
    const angle = (mark / 72) * TAU;
    const long = mark % 6 === 0 ? 18 : 8;
    glowLine(context, [[Math.cos(angle) * r(344), Math.sin(angle) * r(344)], [Math.cos(angle) * r(344 + long), Math.sin(angle) * r(344 + long)]], mark % 6 === 0 ? 170 : 90, r(1.2));
  }
  context.save();
  context.globalCompositeOperation = "lighter";
  const core = context.createRadialGradient(0, 0, 0, 0, 0, r(40));
  core.addColorStop(0, green(255));
  core.addColorStop(1, green(0));
  context.fillStyle = core;
  context.fillRect(-r(40), -r(40), r(80), r(80));
  context.restore();
  context.restore();
}

export function paintBike(context: CityContext, box: CityBox): void {
  const scale = box.width / 512;
  context.save();
  context.translate(box.x, box.y);
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#000000";
  context.fillRect(0, 0, box.width, box.height);
  const s = (value: number) => value * scale;
  const wheel = (x: number) => {
    context.beginPath();
    context.arc(s(x), s(126), s(56), 0, TAU);
    const disc = context.createRadialGradient(s(x + 14), s(108), s(6), s(x), s(126), s(56));
    disc.addColorStop(0, red(150));
    disc.addColorStop(1, red(60));
    context.fillStyle = disc;
    context.fill();
  };
  wheel(118);
  wheel(398);
  const body: [number, number][] = [[64, 118], [70, 86], [108, 64], [190, 60], [250, 70], [300, 48], [352, 36], [404, 46], [452, 74], [470, 106], [454, 126], [396, 108], [330, 112], [190, 116], [128, 124]];
  context.beginPath();
  context.moveTo(s(body[0]![0]), s(body[0]![1]));
  for (const [x, y] of body.slice(1)) context.lineTo(s(x), s(y));
  context.closePath();
  const shell = context.createLinearGradient(0, s(36), 0, s(126));
  shell.addColorStop(0, red(200));
  shell.addColorStop(0.35, red(120));
  shell.addColorStop(1, red(64));
  context.fillStyle = shell;
  context.fill();
  context.beginPath();
  context.moveTo(s(262), s(64));
  context.lineTo(s(300), s(30));
  context.lineTo(s(346), s(22));
  context.lineTo(s(372), s(36));
  context.lineTo(s(330), s(50));
  context.closePath();
  context.fillStyle = red(92);
  context.fill();
  const ring = (x: number, radius: number, strength: number, width: number) => glowLine(context, Array.from({ length: 49 }, (_, step) => [s(x) + Math.cos((step / 48) * TAU) * s(radius), s(126) + Math.sin((step / 48) * TAU) * s(radius)] as [number, number]), strength, s(width));
  ring(118, 54, 255, 2.6);
  ring(398, 54, 255, 2.6);
  ring(118, 30, 130, 1.4);
  ring(398, 30, 130, 1.4);
  glowLine(context, [[s(76), s(110)], [s(130), s(98)], [s(330), s(98)], [s(450), s(104)]], 230, s(2));
  glowLine(context, [[s(108), s(66)], [s(190), s(62)], [s(250), s(72)], [s(300), s(50)], [s(352), s(38)], [s(404), s(48)], [s(452), s(76)]], 170, s(1.4));
  context.save();
  context.globalCompositeOperation = "lighter";
  const lamp = context.createRadialGradient(s(466), s(100), 0, s(466), s(100), s(26));
  lamp.addColorStop(0, green(255));
  lamp.addColorStop(1, green(0));
  context.fillStyle = lamp;
  context.fillRect(s(436), s(70), s(60), s(60));
  context.restore();
  context.restore();
}

export function paintCity(context: CityContext): void {
  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#000000";
  context.fillRect(0, 0, CITY_SIZE, CITY_SIZE);
  context.restore();
  paintSkyline(context, CITY_BOXES.far, "far", 5, { count: 70, width: [22, 70], height: [0.25, 0.92], glow: 0.55 });
  paintSkyline(context, CITY_BOXES.mid, "mid", 17, { count: 34, width: [48, 130], height: [0.22, 0.9], glow: 0.8 });
  paintSkyline(context, CITY_BOXES.near, "near", 29, { count: 13, width: [110, 260], height: [0.3, 0.88], glow: 1 });
  paintRing(context, CITY_BOXES.ring);
  paintBike(context, CITY_BOXES.bike);
}
