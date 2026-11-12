import { LURE, REEF_BOXES, REEF_SIZE, seeded, tileFbm, type ReefBox } from "./atlas";

export type ReefContext = Pick<
  CanvasRenderingContext2D,
  | "fillStyle" | "strokeStyle" | "lineWidth" | "lineCap" | "lineJoin" | "globalAlpha" | "globalCompositeOperation"
  | "save" | "restore" | "beginPath" | "closePath" | "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "ellipse" | "arc" | "rect"
  | "clip" | "fill" | "stroke" | "clearRect" | "fillRect" | "translate" | "rotate" | "scale"
  | "createLinearGradient" | "createRadialGradient" | "createImageData" | "putImageData"
>;

type Random = () => number;
type Point = readonly [number, number];

const TAU = Math.PI * 2;
const ABYSS = "#04121a";

const HUES = {
  rose: ["#c9788f", "#3a1f33"],
  ember: ["#c98a5c", "#3a2420"],
  violet: ["#8d78c4", "#221d42"],
  moss: ["#9fb060", "#1e2c20"],
  lagoon: ["#58b8b0", "#0f2f36"],
  bone: ["#cdbf9f", "#2e2f33"],
} as const;
type Hue = keyof typeof HUES;
const HUE_NAMES = Object.keys(HUES) as Hue[];

export function blend(a: string, b: string, t: number, alpha = 1): string {
  const from = parseInt(a.slice(1), 16), to = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * t);
  return `rgba(${channel(16)},${channel(8)},${channel(0)},${alpha})`;
}

function between(random: Random, low: number, high: number): number {
  return low + (high - low) * random();
}

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length]!;
}

function smooth(context: ReefContext, points: readonly Point[], closed: boolean): void {
  const count = points.length;
  context.beginPath();
  if (!closed) {
    context.moveTo(points[0]![0], points[0]![1]);
    for (let index = 1; index < count - 1; index += 1) {
      const here = points[index]!, next = points[index + 1]!;
      const last = index === count - 2;
      context.quadraticCurveTo(here[0], here[1], last ? next[0] : (here[0] + next[0]) / 2, last ? next[1] : (here[1] + next[1]) / 2);
    }
    return;
  }
  for (let index = 0; index <= count; index += 1) {
    const here = points[index % count]!, next = points[(index + 1) % count]!;
    const midX = (here[0] + next[0]) / 2, midY = (here[1] + next[1]) / 2;
    if (index === 0) context.moveTo(midX, midY);
    else context.quadraticCurveTo(here[0], here[1], midX, midY);
  }
  context.closePath();
}

function blobPoints(random: Random, x: number, y: number, radiusX: number, radiusY: number, rough: number, count: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * TAU;
    const reach = 1 - rough + random() * rough * 2;
    return [x + Math.cos(angle) * radiusX * reach, y + Math.sin(angle) * radiusY * reach] as const;
  });
}

function vertical(context: ReefContext, top: number, bottom: number, light: string, dark: string, middle = 0.5): CanvasGradient {
  const gradient = context.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, light);
  gradient.addColorStop(middle, blend(light, dark, 0.62));
  gradient.addColorStop(1, dark);
  return gradient;
}

function speckle(context: ReefContext, random: Random, x: number, y: number, width: number, height: number, count: number, light: string, dark: string): void {
  for (let index = 0; index < count; index += 1) {
    const size = between(random, 0.6, 2.4);
    context.fillStyle = random() < 0.5 ? blend(light, light, 0, between(random, 0.1, 0.35)) : blend(dark, dark, 0, between(random, 0.15, 0.45));
    context.beginPath();
    context.ellipse(x + random() * width, y + random() * height, size, size * between(random, 0.5, 1), 0, 0, TAU);
    context.fill();
  }
}

function rock(context: ReefContext, random: Random, x: number, base: number, width: number, height: number): void {
  const light = "#5b8794", mid = "#1f404c", dark = "#06151c";
  const points = blobPoints(random, x, base - height * 0.42, width / 2, height * 0.62, 0.2, 11);
  context.save();
  smooth(context, points, true);
  context.fillStyle = vertical(context, base - height, base + height * 0.1, light, dark, 0.42);
  context.fill();
  context.clip();
  const glow = context.createRadialGradient(x - width * 0.12, base - height * 0.95, 2, x - width * 0.12, base - height * 0.9, width * 0.6);
  glow.addColorStop(0, "rgba(170,222,226,0.5)");
  glow.addColorStop(1, "rgba(170,222,226,0)");
  context.fillStyle = glow;
  context.fillRect(x - width, base - height * 1.2, width * 2, height * 1.4);
  context.lineCap = "round";
  for (let index = 0; index < 9; index += 1) {
    const startX = x + between(random, -0.5, 0.5) * width, startY = base - random() * height;
    const length = between(random, 0.12, 0.4) * width, tilt = between(random, -0.5, 0.9);
    context.beginPath();
    context.moveTo(startX, startY);
    context.quadraticCurveTo(startX + length * 0.5, startY + length * tilt * 0.7, startX + length, startY + length * tilt);
    context.lineWidth = between(random, 1.5, 4);
    context.strokeStyle = blend(dark, dark, 0, 0.55);
    context.stroke();
    context.beginPath();
    context.moveTo(startX, startY - 2.5);
    context.quadraticCurveTo(startX + length * 0.5, startY + length * tilt * 0.7 - 2.5, startX + length, startY + length * tilt - 2.5);
    context.lineWidth = 1.2;
    context.strokeStyle = "rgba(160,214,220,0.28)";
    context.stroke();
  }
  speckle(context, random, x - width / 2, base - height, width, height, Math.round(width * 0.5), light, dark);
  for (let index = 0; index < 5; index += 1) {
    const hue = HUES[pick(random, HUE_NAMES)];
    const patch = blobPoints(random, x + between(random, -0.4, 0.4) * width, base - between(random, 0.1, 0.8) * height, between(random, 8, 26), between(random, 5, 14), 0.3, 7);
    smooth(context, patch, true);
    context.fillStyle = blend(hue[0], mid, 0.45, 0.4);
    context.fill();
  }
  context.restore();
}

function brainCoral(context: ReefContext, random: Random, x: number, base: number, radius: number, hue: Hue): void {
  const [light, dark] = HUES[hue];
  context.save();
  context.beginPath();
  context.ellipse(x, base, radius, radius * 0.82, 0, Math.PI, TAU);
  context.closePath();
  const body = context.createRadialGradient(x - radius * 0.25, base - radius * 0.7, radius * 0.05, x, base - radius * 0.2, radius * 1.15);
  body.addColorStop(0, blend(light, "#e8fbff", 0.25));
  body.addColorStop(0.45, blend(light, dark, 0.45));
  body.addColorStop(1, blend(dark, ABYSS, 0.5));
  context.fillStyle = body;
  context.fill();
  context.clip();
  context.lineCap = "round";
  for (let ring = 0; ring < 9; ring += 1) {
    const reach = radius * (0.14 + ring * 0.105);
    let angle = Math.PI + between(random, 0, 0.3);
    while (angle < TAU) {
      const sweep = between(random, 0.25, 0.7);
      const wobble = between(random, -0.05, 0.05) * radius;
      const points: Point[] = [];
      for (let step = 0; step <= 4; step += 1) {
        const at = angle + (sweep * step) / 4;
        const out = reach + (step % 2 ? wobble : -wobble);
        points.push([x + Math.cos(at) * out, base + Math.sin(at) * out * 0.82]);
      }
      smooth(context, points, false);
      context.lineWidth = Math.max(1.6, radius * 0.045);
      context.strokeStyle = blend(dark, ABYSS, 0.4, 0.62);
      context.stroke();
      smooth(context, points.map(([px, py]) => [px - 1, py - Math.max(1.6, radius * 0.04)] as const), false);
      context.lineWidth = 1;
      context.strokeStyle = blend(light, "#f2ffff", 0.5, 0.3);
      context.stroke();
      angle += sweep + between(random, 0.08, 0.2);
    }
  }
  context.restore();
}

function branch(context: ReefContext, random: Random, x: number, y: number, angle: number, length: number, width: number, depth: number, light: string, dark: string): void {
  const bend = between(random, -0.25, 0.25);
  const endX = x + Math.cos(angle + bend) * length, endY = y + Math.sin(angle + bend) * length;
  const midX = x + Math.cos(angle) * length * 0.5, midY = y + Math.sin(angle) * length * 0.5;
  const tone = Math.max(0, 1 - depth / 5);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x, y);
  context.quadraticCurveTo(midX, midY, endX, endY);
  context.lineWidth = width;
  context.strokeStyle = blend(dark, light, tone * 0.55);
  context.stroke();
  context.beginPath();
  context.moveTo(x - width * 0.18, y - width * 0.2);
  context.quadraticCurveTo(midX - width * 0.18, midY - width * 0.2, endX - width * 0.12, endY - width * 0.16);
  context.lineWidth = Math.max(0.8, width * 0.4);
  context.strokeStyle = blend(light, "#f4ffff", 0.2 + 0.3 * tone, 0.75);
  context.stroke();
  if (depth <= 0 || width < 1.2) {
    context.fillStyle = blend(light, "#ffffff", 0.55, 0.9);
    context.beginPath();
    context.arc(endX, endY, Math.max(1.2, width * 0.6), 0, TAU);
    context.fill();
    return;
  }
  const forks = random() < 0.35 ? 3 : 2;
  for (let fork = 0; fork < forks; fork += 1) {
    const spread = (fork - (forks - 1) / 2) * between(random, 0.5, 0.85);
    branch(context, random, endX, endY, angle + spread + bend * 0.5, length * between(random, 0.62, 0.8), width * 0.7, depth - 1, light, dark);
  }
}

function branchCoral(context: ReefContext, random: Random, x: number, base: number, height: number, hue: Hue): void {
  const [light, dark] = HUES[hue];
  const trunks = 2 + Math.floor(random() * 2);
  for (let trunk = 0; trunk < trunks; trunk += 1) {
    branch(context, random, x + (trunk - (trunks - 1) / 2) * height * 0.12, base, -Math.PI / 2 + (trunk - (trunks - 1) / 2) * 0.45, height * 0.36, Math.max(3, height * 0.07), 4, light, dark);
  }
}

function tubeSponge(context: ReefContext, random: Random, x: number, base: number, scale: number, hue: Hue): void {
  const [light, dark] = HUES[hue];
  const tubes = 3 + Math.floor(random() * 3);
  const order = Array.from({ length: tubes }, (_, index) => index).sort(() => random() - 0.5);
  for (const index of order) {
    const lean = (index - (tubes - 1) / 2) * 0.14 + between(random, -0.05, 0.05);
    const width = between(random, 16, 30) * scale, height = between(random, 60, 150) * scale;
    context.save();
    context.translate(x + (index - (tubes - 1) / 2) * 20 * scale, base);
    context.rotate(lean);
    const side = context.createLinearGradient(-width / 2, 0, width / 2, 0);
    side.addColorStop(0, blend(light, dark, 0.35));
    side.addColorStop(0.3, blend(light, "#f0ffff", 0.18));
    side.addColorStop(1, blend(dark, ABYSS, 0.35));
    context.beginPath();
    context.moveTo(-width * 0.34, 0);
    context.bezierCurveTo(-width * 0.5, -height * 0.4, -width * 0.56, -height * 0.8, -width * 0.5, -height);
    context.lineTo(width * 0.5, -height);
    context.bezierCurveTo(width * 0.56, -height * 0.8, width * 0.5, -height * 0.4, width * 0.34, 0);
    context.closePath();
    context.fillStyle = side;
    context.fill();
    context.save();
    context.clip();
    const fade = context.createLinearGradient(0, -height, 0, 0);
    fade.addColorStop(0, "rgba(4,18,26,0)");
    fade.addColorStop(1, "rgba(4,18,26,0.6)");
    context.fillStyle = fade;
    context.fillRect(-width, -height, width * 2, height);
    for (let ridge = 0; ridge < 5; ridge += 1) {
      const at = -width * 0.4 + (ridge / 4) * width * 0.8;
      context.beginPath();
      context.moveTo(at * 0.7, 0);
      context.quadraticCurveTo(at * 1.1, -height * 0.5, at, -height);
      context.lineWidth = 1;
      context.strokeStyle = blend(dark, ABYSS, 0.3, 0.35);
      context.stroke();
    }
    context.restore();
    context.beginPath();
    context.ellipse(0, -height, width * 0.5, width * 0.2, 0, 0, TAU);
    context.fillStyle = blend(dark, ABYSS, 0.7);
    context.fill();
    context.lineWidth = Math.max(1.4, width * 0.09);
    context.strokeStyle = blend(light, "#f4ffff", 0.4);
    context.beginPath();
    context.ellipse(0, -height, width * 0.5, width * 0.2, 0, Math.PI * 0.95, TAU * 1.02);
    context.stroke();
    context.restore();
  }
}

function fanRib(context: ReefContext, random: Random, x: number, y: number, angle: number, length: number, depth: number, color: string): void {
  const endX = x + Math.cos(angle) * length, endY = y + Math.sin(angle) * length;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(endX, endY);
  context.lineWidth = 0.7 + depth * 0.55;
  context.strokeStyle = color;
  context.stroke();
  if (depth <= 0) return;
  const forks = depth > 2 ? 3 : 2;
  for (let fork = 0; fork < forks; fork += 1) {
    fanRib(context, random, endX, endY, angle + (fork - (forks - 1) / 2) * between(random, 0.22, 0.4), length * between(random, 0.68, 0.86), depth - 1, color);
  }
}

function seaFan(context: ReefContext, random: Random, x: number, base: number, radius: number, hue: Hue): void {
  const [light, dark] = HUES[hue];
  context.save();
  context.lineCap = "round";
  const veil = context.createRadialGradient(x, base, radius * 0.1, x, base - radius * 0.5, radius * 1.05);
  veil.addColorStop(0, blend(light, dark, 0.5, 0.34));
  veil.addColorStop(1, blend(light, dark, 0.3, 0));
  context.fillStyle = veil;
  context.beginPath();
  context.moveTo(x, base);
  context.arc(x, base, radius * 1.02, -Math.PI * 0.88, -Math.PI * 0.12);
  context.closePath();
  context.fill();
  for (let rib = 0; rib < 7; rib += 1) {
    const angle = -Math.PI * 0.86 + (rib / 6) * Math.PI * 0.72;
    fanRib(context, random, x, base - radius * 0.08, angle, radius * 0.27, 4, blend(dark, light, 0.5 + 0.08 * rib, 0.9));
  }
  for (let arc = 1; arc <= 5; arc += 1) {
    context.beginPath();
    context.arc(x, base, (radius * arc) / 5.4, -Math.PI * 0.86, -Math.PI * 0.14);
    context.lineWidth = 0.8;
    context.strokeStyle = blend(light, "#ffffff", 0.3, 0.22);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(x, base);
  context.lineTo(x, base - radius * 0.1);
  context.lineWidth = 4;
  context.strokeStyle = blend(dark, light, 0.3);
  context.stroke();
  context.restore();
}

function plateCoral(context: ReefContext, random: Random, x: number, base: number, width: number, hue: Hue): void {
  const [light, dark] = HUES[hue];
  const plates = 2 + Math.floor(random() * 2);
  context.fillStyle = blend(dark, ABYSS, 0.3);
  context.beginPath();
  context.moveTo(x - width * 0.07, base);
  context.lineTo(x - width * 0.04, base - width * 0.16 * plates);
  context.lineTo(x + width * 0.05, base - width * 0.16 * plates);
  context.lineTo(x + width * 0.08, base);
  context.closePath();
  context.fill();
  for (let plate = 0; plate < plates; plate += 1) {
    const reach = width * (0.5 - plate * 0.09), y = base - width * (0.14 + plate * 0.15);
    const shift = between(random, -0.08, 0.08) * width;
    context.beginPath();
    context.ellipse(x + shift, y + reach * 0.09, reach * 0.96, reach * 0.2, 0, 0, TAU);
    context.fillStyle = blend(dark, ABYSS, 0.55);
    context.fill();
    const top = context.createLinearGradient(x - reach, y - reach * 0.2, x + reach, y + reach * 0.2);
    top.addColorStop(0, blend(light, "#f2ffff", 0.3));
    top.addColorStop(0.6, blend(light, dark, 0.4));
    top.addColorStop(1, blend(dark, ABYSS, 0.2));
    context.beginPath();
    context.ellipse(x + shift, y, reach, reach * 0.19, 0, 0, TAU);
    context.fillStyle = top;
    context.fill();
    context.lineWidth = 1.2;
    context.strokeStyle = blend(light, "#ffffff", 0.5, 0.6);
    context.beginPath();
    context.ellipse(x + shift, y, reach, reach * 0.19, 0, Math.PI, TAU);
    context.stroke();
    for (let ring = 1; ring <= 3; ring += 1) {
      context.beginPath();
      context.ellipse(x + shift, y, (reach * ring) / 4, (reach * 0.19 * ring) / 4, 0, 0, TAU);
      context.lineWidth = 0.8;
      context.strokeStyle = blend(dark, ABYSS, 0.2, 0.35);
      context.stroke();
    }
  }
}

function anemone(context: ReefContext, random: Random, x: number, base: number, radius: number, hue: Hue): void {
  const [light, dark] = HUES[hue];
  const column = context.createLinearGradient(x - radius * 0.4, 0, x + radius * 0.4, 0);
  column.addColorStop(0, blend(light, dark, 0.4));
  column.addColorStop(1, blend(dark, ABYSS, 0.4));
  context.fillStyle = column;
  context.beginPath();
  context.moveTo(x - radius * 0.42, base);
  context.quadraticCurveTo(x - radius * 0.3, base - radius * 0.5, x - radius * 0.4, base - radius * 0.62);
  context.lineTo(x + radius * 0.4, base - radius * 0.62);
  context.quadraticCurveTo(x + radius * 0.3, base - radius * 0.5, x + radius * 0.42, base);
  context.closePath();
  context.fill();
  context.lineCap = "round";
  const count = 22;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < count; index += 1) {
      const spread = (index / (count - 1) - 0.5) * 2;
      const rootX = x + spread * radius * 0.36, rootY = base - radius * 0.6;
      const tipX = x + spread * radius * between(random, 0.85, 1.25), tipY = rootY - radius * between(random, 0.45, 1.0) * (1 - 0.45 * Math.abs(spread));
      context.beginPath();
      context.moveTo(rootX, rootY);
      context.quadraticCurveTo(rootX + spread * radius * 0.2, tipY - radius * 0.1, tipX, tipY);
      context.lineWidth = Math.max(1.6, radius * (pass ? 0.05 : 0.11));
      context.strokeStyle = pass ? blend(light, "#f6ffff", 0.35, 0.8) : blend(dark, light, 0.35);
      context.stroke();
      if (pass) {
        context.fillStyle = blend(light, "#ffffff", 0.7);
        context.beginPath();
        context.arc(tipX, tipY, Math.max(1.4, radius * 0.06), 0, TAU);
        context.fill();
      }
    }
  }
}

function grass(context: ReefContext, random: Random, x: number, base: number, height: number, blades: number): void {
  context.lineCap = "round";
  for (let blade = 0; blade < blades; blade += 1) {
    const lean = between(random, -0.5, 0.5), tall = height * between(random, 0.5, 1);
    const rootX = x + between(random, -0.3, 0.3) * height * 0.4;
    const stroke = context.createLinearGradient(0, base, 0, base - tall);
    stroke.addColorStop(0, "#0c2a28");
    stroke.addColorStop(1, blend("#2f7f66", "#b9f2d2", random() * 0.35));
    context.beginPath();
    context.moveTo(rootX, base);
    context.quadraticCurveTo(rootX + lean * tall * 0.2, base - tall * 0.6, rootX + lean * tall * 0.7, base - tall);
    context.lineWidth = between(random, 1.4, 3);
    context.strokeStyle = stroke;
    context.stroke();
  }
}

function starfish(context: ReefContext, random: Random, x: number, y: number, radius: number, hue: Hue): void {
  const [light, dark] = HUES[hue];
  const turn = random() * TAU;
  const points: Point[] = [];
  for (let index = 0; index < 10; index += 1) {
    const reach = index % 2 ? radius * 0.36 : radius;
    const angle = turn + (index / 10) * TAU;
    points.push([x + Math.cos(angle) * reach, y + Math.sin(angle) * reach * 0.62]);
  }
  smooth(context, points, true);
  const body = context.createRadialGradient(x - radius * 0.2, y - radius * 0.3, 1, x, y, radius);
  body.addColorStop(0, blend(light, "#fff4e8", 0.3));
  body.addColorStop(1, blend(light, dark, 0.6));
  context.fillStyle = body;
  context.fill();
}

function dune(x: number, width: number, low: number, high: number, phase: number): number {
  const u = (x / width) * TAU;
  const wave = 0.5 + 0.28 * Math.sin(u * 2 + phase) + 0.14 * Math.sin(u * 5 + phase * 2.3) + 0.08 * Math.sin(u * 11 + phase * 0.7);
  return low + (high - low) * wave;
}

function sand(context: ReefContext, random: Random, width: number, height: number, low: number, high: number, phase: number): (x: number) => number {
  const top = (x: number) => height - dune(x, width, low, high, phase);
  context.beginPath();
  context.moveTo(0, height);
  for (let x = 0; x <= width; x += 8) context.lineTo(x, top(x));
  context.lineTo(width, height);
  context.closePath();
  context.fillStyle = vertical(context, height - high, height, "#4d7c85", "#061820", 0.35);
  context.fill();
  context.save();
  context.clip();
  for (let row = 0; row < 16; row += 1) {
    const drop = 6 + row * row * 0.75 + row * 5;
    const points: Point[] = [];
    const offset = random() * 60;
    for (let x = -40; x <= width + 40; x += 36) points.push([x + offset, top(x) + drop + Math.sin(x * 0.045 + row * 1.7) * (2.5 + row * 0.5)]);
    smooth(context, points, false);
    context.lineWidth = 1.2 + row * 0.22;
    context.strokeStyle = `rgba(150,208,214,${0.22 - row * 0.008})`;
    context.stroke();
    smooth(context, points.map(([px, py]) => [px, py + 2.6 + row * 0.3] as const), false);
    context.lineWidth = 1.6 + row * 0.3;
    context.strokeStyle = `rgba(2,14,20,${0.4 - row * 0.012})`;
    context.stroke();
  }
  speckle(context, random, 0, height - high, width, high, Math.round(width * 0.45), "#a8dade", "#03121a");
  for (let pebble = 0; pebble < width / 34; pebble += 1) {
    const x = random() * width, y = top(x) + between(random, 6, low * 0.9), size = between(random, 2.5, 8);
    const stone = context.createLinearGradient(0, y - size, 0, y + size);
    stone.addColorStop(0, "#7aa6ad");
    stone.addColorStop(1, "#0a1f28");
    context.fillStyle = stone;
    context.beginPath();
    context.ellipse(x, y, size * 1.4, size * 0.8, 0, 0, TAU);
    context.fill();
  }
  context.restore();
  return top;
}

type Grower = (context: ReefContext, random: Random, x: number, base: number, scale: number) => void;

const GROWERS: readonly Grower[] = [
  (context, random, x, base, scale) => brainCoral(context, random, x, base + 6, between(random, 34, 62) * scale, pick(random, ["rose", "bone", "moss", "ember"] as const)),
  (context, random, x, base, scale) => branchCoral(context, random, x, base + 4, between(random, 110, 190) * scale, pick(random, ["rose", "ember", "violet", "bone"] as const)),
  (context, random, x, base, scale) => tubeSponge(context, random, x, base + 6, scale, pick(random, ["violet", "ember", "lagoon", "moss"] as const)),
  (context, random, x, base, scale) => seaFan(context, random, x, base + 4, between(random, 100, 170) * scale, pick(random, ["violet", "rose", "ember"] as const)),
  (context, random, x, base, scale) => plateCoral(context, random, x, base + 4, between(random, 80, 140) * scale, pick(random, ["lagoon", "bone", "moss"] as const)),
  (context, random, x, base, scale) => anemone(context, random, x, base + 4, between(random, 26, 44) * scale, pick(random, ["rose", "lagoon", "violet"] as const)),
];

export function paintReef(context: ReefContext, box: ReefBox, seed: number, scale: number, crowd: number): void {
  const random = seeded(seed);
  context.save();
  context.translate(box.x, box.y);
  context.beginPath();
  context.rect(0, 0, box.width, box.height);
  context.clip();
  const backTop = sand(context, random, box.width, box.height, 96 * scale, 178 * scale, seed);
  const spots = Math.round(crowd * 1.4);
  for (let spot = 0; spot < spots; spot += 1) {
    const x = ((spot + random() * 0.7) / spots) * box.width;
    rock(context, random, x, backTop(x) + 22 * scale, between(random, 110, 260) * scale, between(random, 60, 170) * scale);
  }
  for (let spot = 0; spot < crowd; spot += 1) {
    const x = ((spot + 0.15 + random() * 0.7) / crowd) * box.width;
    pick(random, GROWERS)(context, random, x, backTop(x) + 10 * scale, scale * between(random, 0.75, 1.15));
    if (random() < 0.6) grass(context, random, x + between(random, -70, 70) * scale, backTop(x) + 14 * scale, between(random, 40, 90) * scale, 7);
  }
  const frontTop = sand(context, random, box.width, box.height, 34 * scale, 92 * scale, seed * 1.9 + 2);
  for (let spot = 0; spot < crowd * 0.7; spot += 1) {
    const x = random() * box.width;
    if (random() < 0.5) rock(context, random, x, frontTop(x) + 16 * scale, between(random, 50, 130) * scale, between(random, 26, 70) * scale);
    else pick(random, GROWERS)(context, random, x, frontTop(x) + 8 * scale, scale * between(random, 0.5, 0.8));
    if (random() < 0.5) starfish(context, random, random() * box.width, box.height - between(random, 8, 26) * scale, between(random, 9, 15) * scale, pick(random, ["ember", "rose", "violet"] as const));
  }
  context.restore();
}

function kelpBlade(context: ReefContext, random: Random, x: number, y: number, angle: number, length: number, curl: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.globalAlpha = between(random, 0.72, 1);
  const width = length * between(random, 0.07, 0.11);
  const bend = (at: number) => curl * length * at * at;
  const fill = context.createLinearGradient(0, -width, 0, width);
  fill.addColorStop(0, "#d9bf6a");
  fill.addColorStop(0.4, "#8d8a3c");
  fill.addColorStop(1, "#2a3519");
  const ruffle = between(random, 13, 21), phase = random() * TAU;
  const steps = 10;
  context.beginPath();
  context.moveTo(10, 0);
  for (let step = 1; step <= steps; step += 1) {
    const at = step / steps;
    const edge = Math.sin(Math.min(at * 1.25, 1) * Math.PI * 0.5) * (1 - at * at) * width * (1 + 0.22 * Math.sin(at * ruffle + phase));
    context.quadraticCurveTo(10 + length * (at - 0.5 / steps), -edge * 1.15 + bend(at - 0.5 / steps), 10 + length * at, (step === steps ? 0 : -edge) + bend(at));
  }
  for (let step = steps - 1; step >= 0; step -= 1) {
    const at = step / steps;
    const edge = Math.sin(Math.min(at * 1.25, 1) * Math.PI * 0.5) * (1 - at * at) * width * (1 + 0.22 * Math.cos(at * ruffle * 1.1 + phase));
    context.quadraticCurveTo(10 + length * (at + 0.5 / steps), edge * 1.15 + bend(at + 0.5 / steps), 10 + length * at, edge + bend(at));
  }
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.save();
  context.clip();
  for (let fold = 0; fold < 14; fold += 1) {
    const at = 14 + (length * (fold + 0.5)) / 14.5;
    context.beginPath();
    const sag = bend((at - 10) / length);
    context.moveTo(at, -width * 1.2 + sag);
    context.quadraticCurveTo(at + length * 0.03, sag, at - length * 0.01, width * 1.2 + sag);
    context.lineWidth = between(random, 1.2, 2.6);
    context.strokeStyle = fold % 2 ? "rgba(255,236,160,0.22)" : "rgba(20,30,14,0.3)";
    context.stroke();
  }
  context.restore();
  context.beginPath();
  context.moveTo(10, 0);
  context.quadraticCurveTo(length * 0.5, -width * 0.1 + bend(0.5) * 0.5, 10 + length * 0.96, bend(0.96));
  context.lineWidth = 1.2;
  context.strokeStyle = "rgba(250,230,150,0.45)";
  context.stroke();
  const bulb = context.createRadialGradient(3, -2, 0.5, 5, 0, 8);
  bulb.addColorStop(0, "#f4e3a0");
  bulb.addColorStop(0.5, "#a89040");
  bulb.addColorStop(1, "#3a3a18");
  context.fillStyle = bulb;
  context.beginPath();
  context.ellipse(5, 0, 8, 5, 0, 0, TAU);
  context.fill();
  context.restore();
}

export function paintKelp(context: ReefContext, box: ReefBox, seed: number): void {
  const random = seeded(seed);
  context.save();
  context.translate(box.x, box.y);
  context.beginPath();
  context.rect(0, 0, box.width, box.height);
  context.clip();
  const stalks = 10;
  for (let stalk = 0; stalk < stalks; stalk += 1) {
    const x = ((stalk + 0.2 + random() * 0.6) / stalks) * box.width;
    const tall = box.height * between(random, 0.5, 0.97);
    const drift = between(random, -0.6, 0.6), phase = random() * TAU, wave = between(random, 12, 26);
    const spine = (at: number): Point => [x + drift * tall * 0.12 * at + Math.sin(at * 4 + phase) * wave * at, box.height - tall * at];
    const points = Array.from({ length: 15 }, (_, index) => spine(index / 14));
    context.lineCap = "round";
    for (const strand of [-3, 3]) {
      smooth(context, points.map(([px, py], index) => [px + strand * (1 - index / 14), py] as const), false);
      context.lineWidth = 3.4;
      context.strokeStyle = "#3b3a1a";
      context.stroke();
    }
    smooth(context, points.map(([px, py]) => [px - 1.4, py] as const), false);
    context.lineWidth = 1.3;
    context.strokeStyle = "rgba(236,214,140,0.5)";
    context.stroke();
    let side = random() < 0.5 ? 1 : -1;
    for (let at = between(random, 0.04, 0.1); at < 0.96; at += between(random, 14, 46) / tall) {
      const [bx, by] = spine(at);
      side = random() < 0.7 ? -side : side;
      const lean = between(random, 0.3, 0.85);
      const angle = -Math.PI / 2 + side * lean;
      kelpBlade(context, random, bx, by, angle, between(random, 60, 170) * (1 - 0.35 * at), side * between(random, 0.05, 0.25));
    }
    kelpBlade(context, random, spine(1)[0], spine(1)[1], -Math.PI / 2 + between(random, -0.25, 0.25), between(random, 80, 130), between(random, -0.15, 0.15));
  }
  context.restore();
}

function wash(context: ReefContext, box: ReefBox, color: string): void {
  context.save();
  context.globalCompositeOperation = "source-atop";
  context.fillStyle = color;
  context.fillRect(box.x, box.y, box.width, box.height);
  context.restore();
}

export function paintWhale(context: ReefContext, box: ReefBox): void {
  context.save();
  context.translate(box.x, box.y);
  context.scale(box.width / 768, box.height / 320);
  const body: Point[] = [[40, 172], [110, 128], [230, 100], [380, 92], [480, 100], [580, 124], [668, 150], [700, 146], [668, 166], [590, 176], [480, 204], [330, 226], [180, 222], [80, 200]];
  const skin = context.createLinearGradient(0, 86, 0, 232);
  skin.addColorStop(0, "#6f9daa");
  skin.addColorStop(0.3, "#2c5564");
  skin.addColorStop(1, "#091f2a");
  context.fillStyle = skin;
  smooth(context, body, true);
  context.fill();
  smooth(context, [[676, 154], [722, 96], [752, 82], [738, 128], [728, 156], [744, 190], [756, 232], [716, 212], [676, 162]], true);
  context.fill();
  context.fillStyle = "#0b2531";
  smooth(context, [[236, 204], [280, 250], [352, 300], [372, 296], [330, 240], [286, 200]], true);
  context.fill();
  context.fillStyle = "#2c5564";
  smooth(context, [[484, 99], [506, 82], [524, 100]], true);
  context.fill();
  context.save();
  smooth(context, body, true);
  context.clip();
  context.lineCap = "round";
  for (let groove = 0; groove < 9; groove += 1) {
    context.beginPath();
    context.moveTo(62, 186 + groove * 3);
    context.quadraticCurveTo(190, 210 + groove * 4.4, 330 - groove * 6, 214 + groove * 2.2);
    context.lineWidth = 1.1;
    context.strokeStyle = "rgba(150,200,210,0.26)";
    context.stroke();
  }
  const random = seeded(77);
  for (let dapple = 0; dapple < 26; dapple += 1) {
    const x = between(random, 90, 640), y = between(random, 92, 130) + Math.abs(x - 380) * 0.08;
    const shine = context.createRadialGradient(x, y, 1, x, y, between(random, 14, 34));
    shine.addColorStop(0, "rgba(190,236,240,0.3)");
    shine.addColorStop(1, "rgba(190,236,240,0)");
    context.fillStyle = shine;
    context.fillRect(x - 40, y - 40, 80, 80);
  }
  context.restore();
  context.fillStyle = "#020c12";
  context.beginPath();
  context.ellipse(118, 166, 3.4, 2.6, 0, 0, TAU);
  context.fill();
  context.beginPath();
  context.moveTo(44, 176);
  context.quadraticCurveTo(100, 184, 150, 176);
  context.lineWidth = 1.4;
  context.strokeStyle = "rgba(2,12,18,0.7)";
  context.stroke();
  context.restore();
}

export function paintManta(context: ReefContext, box: ReefBox): void {
  context.save();
  context.translate(box.x, box.y);
  context.scale(box.width / 512, box.height / 320);
  const wings: Point[] = [[14, 70], [90, 92], [176, 124], [222, 134], [232, 172], [244, 142], [268, 142], [280, 172], [290, 134], [336, 124], [422, 92], [498, 70], [440, 150], [340, 198], [256, 214], [172, 198], [72, 150]];
  const skin = context.createRadialGradient(256, 150, 10, 256, 150, 250);
  skin.addColorStop(0, "#5f8f9c");
  skin.addColorStop(0.4, "#2a5362");
  skin.addColorStop(1, "#08202b");
  context.fillStyle = skin;
  smooth(context, wings, true);
  context.fill();
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(256, 206);
  context.quadraticCurveTo(262, 260, 306, 312);
  context.lineWidth = 3;
  context.strokeStyle = "#143746";
  context.stroke();
  for (let side = -1; side <= 1; side += 2) {
    for (let slit = 0; slit < 5; slit += 1) {
      context.beginPath();
      context.moveTo(256 + side * (20 + slit * 3), 160 + slit * 8);
      context.lineTo(256 + side * (44 - slit * 2), 163 + slit * 8);
      context.lineWidth = 1.5;
      context.strokeStyle = "rgba(4,20,28,0.7)";
      context.stroke();
    }
  }
  const belly = context.createRadialGradient(256, 170, 4, 256, 170, 70);
  belly.addColorStop(0, "rgba(190,230,236,0.34)");
  belly.addColorStop(1, "rgba(190,230,236,0)");
  context.fillStyle = belly;
  context.save();
  smooth(context, wings, true);
  context.clip();
  context.fillRect(150, 100, 220, 140);
  context.restore();
  context.restore();
}

export function paintAngler(context: ReefContext, box: ReefBox): void {
  const random = seeded(31);
  context.save();
  context.translate(box.x, box.y);
  context.scale(box.width / 448, box.height / 448);
  const glow = (strong: number, reach: number) => {
    const gradient = context.createRadialGradient(LURE.x, LURE.y, 4, LURE.x, LURE.y, reach);
    gradient.addColorStop(0, `rgba(255,255,255,${strong})`);
    gradient.addColorStop(0.45, `rgba(255,255,255,${strong * 0.34})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    return gradient;
  };
  const body: Point[] = [[384, 226], [336, 176], [262, 146], [176, 150], [104, 196], [62, 262], [58, 300], [124, 372], [236, 400], [330, 380], [396, 332], [300, 312], [252, 284], [304, 250]];
  context.lineJoin = "round";
  context.lineCap = "round";
  smooth(context, body, true);
  context.fillStyle = glow(0.26, 330);
  context.fill();
  context.save();
  smooth(context, body, true);
  context.clip();
  for (let bump = 0; bump < 170; bump += 1) {
    const x = between(random, 60, 390), y = between(random, 150, 400), size = between(random, 1.2, 3.6);
    context.fillStyle = glow(between(random, 0.12, 0.4), 300);
    context.beginPath();
    context.arc(x, y, size, 0, TAU);
    context.fill();
  }
  context.restore();
  smooth(context, body, true);
  context.lineWidth = 3.2;
  context.strokeStyle = glow(1, 360);
  context.stroke();
  smooth(context, [[64, 268], [22, 226], [10, 246], [30, 276], [12, 316], [28, 330], [66, 292]], true);
  context.fillStyle = glow(0.3, 420);
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = glow(1, 440);
  context.stroke();
  for (let ray = 0; ray < 6; ray += 1) {
    context.beginPath();
    context.moveTo(196 + ray * 16, 150 - ray);
    context.lineTo(176 + ray * 15, 112 + ray * 3);
    context.moveTo(150 + ray * 20, 392);
    context.lineTo(138 + ray * 19, 424 - ray * 2);
    context.lineWidth = 1.8;
    context.strokeStyle = glow(0.9, 340);
    context.stroke();
  }
  smooth(context, [[168, 300], [120, 330], [112, 356], [150, 348], [182, 322]], true);
  context.fillStyle = glow(0.4, 330);
  context.fill();
  context.lineWidth = 1.6;
  context.strokeStyle = glow(0.9, 330);
  context.stroke();
  const jaw = (from: Point, bend: Point, to: Point, into: number) => {
    const teeth = 10;
    for (let tooth = 0; tooth < teeth; tooth += 1) {
      const at = (tooth + 0.6) / (teeth + 0.4);
      const x = (1 - at) * (1 - at) * from[0] + 2 * at * (1 - at) * bend[0] + at * at * to[0];
      const y = (1 - at) * (1 - at) * from[1] + 2 * at * (1 - at) * bend[1] + at * at * to[1];
      const long = (tooth % 2 ? 20 : 36) * (0.55 + 0.6 * at);
      context.beginPath();
      context.moveTo(x - 4, y);
      context.quadraticCurveTo(x - 2, y + into * long * 0.6, x - 6, y + into * long);
      context.quadraticCurveTo(x + 2, y + into * long * 0.5, x + 4, y);
      context.closePath();
      context.fillStyle = glow(1, 380);
      context.fill();
    }
  };
  jaw([252, 284], [304, 250], [384, 226], 1);
  jaw([252, 284], [300, 312], [396, 332], -1);
  context.fillStyle = glow(1, 300);
  context.beginPath();
  context.arc(270, 206, 12, 0, TAU);
  context.fill();
  context.fillStyle = "rgba(0,0,0,0.92)";
  context.beginPath();
  context.arc(273, 205, 6.5, 0, TAU);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.95)";
  context.beginPath();
  context.arc(276, 202, 2, 0, TAU);
  context.fill();
  context.beginPath();
  context.moveTo(280, 156);
  context.bezierCurveTo(270, 96, 300, 62, LURE.x - 4, LURE.y - 4);
  context.lineWidth = 2.4;
  context.strokeStyle = glow(1, 300);
  context.stroke();
  context.restore();
}

export function paintNoise(context: ReefContext, box: ReefBox): void {
  const image = context.createImageData(box.width, box.height);
  const shafts = tileFbm(3, 4, 11), chop = tileFbm(6, 3, 23), webA = tileFbm(5, 2, 37), webB = tileFbm(7, 2, 53);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const u = x / box.width, v = y / box.height;
      const ridgeA = 1 - Math.abs(2 * webA(u, v) - 1), ridgeB = 1 - Math.abs(2 * webB(u + 0.31, v + 0.17) - 1);
      const web = Math.min(1, ridgeA ** 7 * 0.9 + ridgeB ** 9 * 0.6);
      const at = (y * box.width + x) * 4;
      image.data[at] = Math.round(255 * shafts(u, v));
      image.data[at + 1] = Math.round(255 * chop(u, v));
      image.data[at + 2] = Math.round(255 * web);
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, box.x, box.y);
}

export function paintDeepSea(context: ReefContext): void {
  context.clearRect(0, 0, REEF_SIZE, REEF_SIZE);
  paintReef(context, REEF_BOXES.near, 7, 1, 13);
  paintKelp(context, REEF_BOXES.kelp, 19);
  paintReef(context, REEF_BOXES.far, 43, 0.62, 16);
  wash(context, REEF_BOXES.far, "rgba(10,44,58,0.3)");
  paintWhale(context, REEF_BOXES.whale);
  paintManta(context, REEF_BOXES.manta);
  paintAngler(context, REEF_BOXES.angler);
  paintNoise(context, REEF_BOXES.noise);
}
