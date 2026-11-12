import { ATLAS_SCALE as S, ATLAS_SIZE, TILES, WORLD, type GardenSpec, type Tile } from "./atlas";

export type GardenContext = Pick<
  CanvasRenderingContext2D,
  | "fillStyle" | "strokeStyle" | "lineWidth" | "lineCap" | "lineJoin" | "globalCompositeOperation"
  | "save" | "restore" | "translate" | "scale" | "beginPath" | "closePath" | "rect" | "clip" | "moveTo" | "lineTo" | "quadraticCurveTo"
  | "ellipse" | "arc" | "fill" | "stroke" | "fillRect" | "clearRect" | "createLinearGradient" | "createRadialGradient"
>;

type Color = readonly [number, number, number];
type Point = readonly [number, number];
type Joint = readonly [number, number, number];
interface Tones { deep: Color; dark: Color; mid: Color; light: Color; glint: Color }
type Mark = (x: number, y: number, size: number, color: Color, alpha: number) => void;

const TAU = Math.PI * 2;
const SNOW: Color = [244, 247, 252];
const SNOW_SHADE: Color = [190, 204, 228];
const MIST: Color = [226, 232, 236];
const INK: Color = [22, 24, 38];
const SUNLIT: Color = [255, 244, 212];

const rgba = (color: Color, alpha = 1) => `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${Math.round(alpha * 1000) / 1000})`;
const blend = (a: Color, b: Color, t: number): Color => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lift = (color: Color, by: number): Color => (by >= 0 ? blend(color, SUNLIT, by) : blend(color, INK, -by));
const tonesOf = (mid: Color, warm: Color = SUNLIT): Tones => ({ deep: lift(mid, -0.62), dark: lift(mid, -0.34), mid, light: blend(mid, warm, 0.34), glint: blend(mid, warm, 0.62) });
const blendTones = (a: Tones, b: Tones, t: number): Tones => ({ deep: blend(a.deep, b.deep, t), dark: blend(a.dark, b.dark, t), mid: blend(a.mid, b.mid, t), light: blend(a.light, b.light, t), glint: blend(a.glint, b.glint, t) });

function seasonal(spec: GardenSpec) {
  const total = Math.max(0.001, spec.spring + spec.summer + spec.autumn + spec.winter);
  return (spring: Color, summer: Color, autumn: Color, winter: Color): Color => [0, 1, 2].map((at) => (spring[at]! * spec.spring + summer[at]! * spec.summer + autumn[at]! * spec.autumn + winter[at]! * spec.winter) / total) as unknown as Color;
}

function wave(seed: number): (x: number) => number {
  const at = (n: number) => { const s = Math.sin((n + seed) * 127.1) * 43758.5453; return s - Math.floor(s); };
  return (x) => { const i = Math.floor(x); const f = x - i; return at(i) + (at(i + 1) - at(i)) * f * f * (3 - 2 * f); };
}

function kit(ctx: GardenContext, seed: number) {
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const span = (from: number, to: number) => from + (to - from) * rand();
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;
  const spot = (): Point => { const r = Math.sqrt(rand()); const a = rand() * TAU; return [Math.cos(a) * r, Math.sin(a) * r]; };
  const dab = (x: number, y: number, rx: number, ry: number, turn: number, color: Color, alpha = 1) => {
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.2, rx), Math.max(0.2, ry), turn, 0, TAU);
    ctx.fill();
  };
  const soft = (x: number, y: number, rx: number, ry: number, color: Color, alpha: number) => {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, rgba(color, alpha));
    glow.addColorStop(0.5, rgba(color, alpha * 0.6));
    glow.addColorStop(1, rgba(color, 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Math.max(0.5, rx), Math.max(0.5, ry));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  };
  const lens = (x: number, y: number, length: number, width: number, turn: number, color: Color, alpha = 1) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 0.45 * length * c + width * s, y + 0.45 * length * s - width * c, x + length * c, y + length * s);
    ctx.quadraticCurveTo(x + 0.45 * length * c - width * s, y + 0.45 * length * s + width * c, x, y);
    ctx.fill();
  };
  const palmate = (x: number, y: number, radius: number, turn: number, color: Color, alpha = 1) => {
    for (let lobe = -3; lobe <= 3; lobe += 1) lens(x, y, radius * (1 - 0.13 * Math.abs(lobe)), radius * 0.2, turn + lobe * 0.5, color, alpha);
  };
  const shape = (points: readonly Point[], color: Color | CanvasGradient, alpha = 1) => {
    ctx.fillStyle = typeof color === "object" && "addColorStop" in color ? color : rgba(color as Color, alpha);
    ctx.beginPath();
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  const limb = (joints: readonly Joint[], color: Color, alpha = 1, shift: Point = [0, 0], thin = 1) => {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let at = 1; at < joints.length; at += 1) {
      const a = joints[at - 1]!, b = joints[at]!;
      ctx.lineWidth = Math.max(0.6, (a[2] + b[2]) * 0.5 * thin);
      ctx.beginPath();
      ctx.moveTo(a[0] + shift[0], a[1] + shift[1]);
      ctx.lineTo(b[0] + shift[0], b[1] + shift[1]);
      ctx.stroke();
    }
  };
  const curve = (from: Point, bend: Point, to: Point, width: number, color: Color, alpha = 1) => {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineCap = "round";
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.quadraticCurveTo(bend[0], bend[1], to[0], to[1]);
    ctx.stroke();
  };
  return { ctx, rand, span, pick, spot, dab, soft, lens, palmate, shape, limb, curve };
}

type Kit = ReturnType<typeof kit>;

function inTile(ctx: GardenContext, tile: Tile, paint: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(tile.x, tile.y, tile.width, tile.height);
  ctx.clip();
  ctx.translate(tile.x, tile.y);
  paint();
  ctx.restore();
}

function along(joints: readonly Joint[], steps: number): Joint[] {
  const out: Joint[] = [];
  for (let at = 1; at < joints.length; at += 1) {
    const a = joints[at - 1]!, b = joints[at]!;
    for (let step = 0; step < steps; step += 1) { const t = step / steps; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  }
  out.push(joints[joints.length - 1]!);
  return out;
}

function mass(k: Kit, x: number, y: number, rx: number, ry: number, tones: Tones, size: number, density: number, mark: Mark, edge: Mark = mark): void {
  const count = Math.max(6, Math.round((density * rx * ry) / (size * size)));
  for (let at = 0; at < count * 0.6; at += 1) {
    const [dx, dy] = k.spot();
    mark(x + dx * rx * 0.92, y + dy * ry * 0.92, size * k.span(1, 1.6), blend(tones.deep, tones.dark, k.rand()), 0.96);
  }
  for (let at = 0; at < count; at += 1) {
    const [dx, dy] = k.spot();
    const lit = -(dx * 0.5 + dy * 0.85) + k.span(-0.3, 0.3);
    if (lit < -0.45) continue;
    const color = lit > 0.5 ? blend(tones.light, tones.glint, k.rand() * 0.6) : lit > 0.05 ? blend(tones.mid, tones.light, k.rand() * 0.6) : blend(tones.dark, tones.mid, k.rand());
    mark(x + dx * rx, y + dy * ry, size * k.span(0.8, 1.25), color, 0.95);
  }
  for (let at = 0; at < count * 0.3; at += 1) {
    const turn = k.rand() * TAU;
    const reach = k.span(0.9, 1.2);
    const dx = Math.cos(turn), dy = Math.sin(turn);
    const lit = -(dx * 0.5 + dy * 0.85) + k.span(-0.3, 0.3);
    edge(x + dx * rx * reach, y + dy * ry * reach, size * k.span(0.9, 1.4), lit > 0.4 ? tones.light : lit > -0.2 ? tones.mid : tones.dark, 0.95);
  }
  for (let at = 0; at < count * 0.08; at += 1) {
    const [dx, dy] = k.spot();
    if (dx * 0.5 + dy * 0.85 > -0.25) continue;
    mark(x + dx * rx, y + dy * ry, size * 0.7, tones.glint, 0.9);
  }
}

function snowOn(k: Kit, x: number, y: number, rx: number, ry: number, amount: number, size: number): void {
  const count = Math.round((amount * rx * ry * 1.4) / (size * size));
  for (let at = 0; at < count; at += 1) {
    const [dx, dy] = k.spot();
    if (dy > 0.15 + 0.3 * k.rand()) continue;
    k.dab(x + dx * rx, y + dy * ry, size * k.span(1, 2.2), size * k.span(0.6, 1), 0, dy > -0.2 ? SNOW_SHADE : SNOW, 0.95);
  }
}

function crowns(k: Kit, ridge: (x: number) => number, bottom: number, count: number, size: number, haze: number, colors: readonly Color[], width: number, snow: number): void {
  const trees: { x: number; y: number; r: number; color: Color }[] = [];
  const patch = wave(size * 13);
  for (let at = 0; at < count; at += 1) {
    const x = k.rand() * width;
    const top = ridge(x);
    const depth = Math.pow(k.rand(), 1.3);
    const y = top + 2 + (bottom - top) * depth;
    const slot = Math.floor(Math.min(0.999, Math.max(0, patch(x / (size * 14)) * 0.6 + patch(y / (size * 5) + 31) * 0.3 + k.rand() * 0.22 - 0.06)) * colors.length);
    trees.push({ x, y, r: size * k.span(0.7, 1.3) * (0.8 + 0.5 * depth), color: colors[slot]! });
  }
  trees.sort((a, b) => a.y - b.y);
  for (const tree of trees) {
    const base = blend(blend(tree.color, lift(tree.color, k.span(-0.2, 0.15)), 0.6), MIST, haze);
    const crisp = Math.min(1, size / 7);
    k.dab(tree.x + tree.r * 0.3, tree.y + tree.r * 0.4, tree.r, tree.r * 0.8, 0, blend(lift(base, -0.42 * crisp), MIST, haze * 0.5), 0.9);
    k.dab(tree.x, tree.y, tree.r, tree.r * 0.82, 0, base, 0.95);
    for (let at = 0; at < 3; at += 1) k.dab(tree.x - tree.r * k.span(0, 0.5), tree.y - tree.r * k.span(0.1, 0.5), tree.r * k.span(0.25, 0.5), tree.r * k.span(0.2, 0.36), -0.4, blend(lift(base, k.span(0.2, 0.4) * crisp), MIST, haze * 0.4), 0.8);
    if (snow > 0 && k.rand() < snow) k.dab(tree.x - tree.r * 0.1, tree.y - tree.r * 0.45, tree.r * 0.7, tree.r * 0.3, 0, blend(SNOW, MIST, haze * 0.5), 0.9);
  }
}

function paintPagoda(k: Kit, cx: number, base: number, spec: GardenSpec): void {
  const { ctx } = k;
  const rise = 37;
  const wood: Color = [132, 66, 48];
  const slate: Color = [70, 78, 92];
  k.dab(cx, base + 2, 54, 7, 0, [70, 80, 74], 0.7);
  for (let tier = 0; tier < 5; tier += 1) {
    const foot = base - tier * rise;
    const half = 24 * (1 - 0.1 * tier);
    const body = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
    body.addColorStop(0, rgba(lift(wood, 0.22)));
    body.addColorStop(0.45, rgba(wood));
    body.addColorStop(1, rgba(lift(wood, -0.45)));
    ctx.fillStyle = body;
    ctx.fillRect(cx - half, foot - 24, half * 2, 24);
    ctx.fillStyle = rgba([238, 226, 200], 0.85);
    for (let bay = -1; bay <= 1; bay += 1) ctx.fillRect(cx + bay * half * 0.6 - half * 0.2, foot - 17, half * 0.4, 11);
    ctx.fillStyle = rgba(lift(wood, -0.55), 0.9);
    for (let post = -2; post <= 2; post += 1) ctx.fillRect(cx + post * half * 0.5 - 0.8, foot - 24, 1.6, 24);
    ctx.fillRect(cx - half, foot - 5, half * 2, 1.6);
    ctx.fillStyle = rgba([30, 22, 30], 0.72);
    ctx.fillRect(cx - half, foot - 24, half * 2, 7);
    const eave = foot - 24;
    const reach = half * 2.15;
    const roof: Point[] = [[cx - reach - 5, eave - 6], [cx - reach * 0.62, eave - 1], [cx, eave + 1], [cx + reach * 0.62, eave - 1], [cx + reach + 5, eave - 6], [cx + reach * 0.5, eave - 8], [cx + half * 0.72, eave - 13], [cx - half * 0.72, eave - 13], [cx - reach * 0.5, eave - 8]];
    k.shape(roof.map(([x, y]) => [x, y + 3] as const), [26, 24, 34], 0.85);
    k.shape(roof, slate);
    k.shape([[cx - reach - 5, eave - 6], [cx - reach * 0.5, eave - 8], [cx - half * 0.72, eave - 13], [cx, eave - 13], [cx, eave - 9.5], [cx - reach * 0.55, eave - 4.5]], lift(slate, 0.34), 0.9);
    k.shape([[cx + reach + 5, eave - 6], [cx + reach * 0.62, eave - 1], [cx + half, eave + 0.5], [cx + half, eave - 4], [cx + reach * 0.55, eave - 5]], lift(slate, -0.4), 0.8);
    if (spec.snow > 0) k.shape([[cx - reach - 3, eave - 7], [cx - reach * 0.5, eave - 9], [cx - half * 0.72, eave - 14], [cx + half * 0.72, eave - 14], [cx + reach * 0.5, eave - 9], [cx + reach + 3, eave - 7], [cx + reach * 0.5, eave - 6], [cx, eave - 8], [cx - reach * 0.5, eave - 6]], SNOW, 0.5 + 0.5 * spec.snow);
  }
  const top = base - 4 * rise - 37;
  k.shape([[cx - 13, top + 2], [cx, top - 14], [cx + 13, top + 2]], slate);
  k.shape([[cx - 13, top + 2], [cx, top - 14], [cx, top + 2]], lift(slate, 0.3), 0.9);
  k.limb([[cx, top - 12, 2.4], [cx, top - 46, 1.2]], [60, 52, 44]);
  for (let ring = 0; ring < 5; ring += 1) k.dab(cx, top - 18 - ring * 5, 4.4 - ring * 0.5, 1.3, 0, [124, 106, 70]);
  k.dab(cx - 0.6, top - 47, 1.8, 2.6, 0, [196, 168, 96]);
}

function paintDist(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 11);
  const season = seasonal(spec);
  const { width, height } = TILES.dist;
  const Y = (wy: number) => height - (wy - WORLD.distBase) * S;
  const far = wave(3), mid = wave(9), near = wave(20), fine = wave(41);
  const farRidge = (x: number) => Y(0.598 + 0.075 * far(x / 300) + 0.02 * fine(x / 64));
  const midRidge = (x: number) => Y(0.552 + 0.055 * mid(x / 210) + 0.014 * fine(x / 38 + 7));
  const nearRidge = (x: number) => Y(0.492 + 0.04 * near(x / 170) + 0.012 * fine(x / 30 + 19));
  const green = season([104, 148, 92], [60, 110, 70], [112, 118, 62], [118, 116, 100]);
  const accents: Color[] = [
    ...(spec.spring > 0.3 ? [[240, 196, 210] as const, [250, 222, 230] as const] : []),
    ...(spec.autumn > 0.3 ? [[198, 82, 40] as const, [226, 150, 48] as const, [168, 48, 36] as const, [214, 176, 70] as const] : []),
    ...(spec.winter > 0.3 ? [[128, 112, 96] as const, [150, 146, 138] as const] : []),
  ];
  const palette: Color[] = [lift(green, -0.3), green, ...accents.slice(0, 2), blend(green, [36, 80, 66], 0.5), lift(green, 0.1), ...accents.slice(2), lift(green, -0.16), green];
  const range = (ridge: (x: number) => number, top: Color, low: Color) => {
    const fill = ctx.createLinearGradient(0, Y(0.7), 0, height);
    fill.addColorStop(0, rgba(top));
    fill.addColorStop(1, rgba(low));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 6) ctx.lineTo(x, ridge(x));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  };
  const veil = (wy: number, alpha: number, count: number) => {
    for (let at = 0; at < count; at += 1) k.soft(k.rand() * width, Y(wy) + k.span(-8, 8), k.span(150, 340), k.span(8, 18), MIST, alpha * k.span(0.5, 1));
  };
  const farTone = blend(green, [138, 162, 190], 0.66), midTone = blend(green, [104, 138, 150], 0.36), nearTone = blend(green, [70, 104, 96], 0.2);
  const unified = (tone: Color, by: number) => palette.map((each) => blend(each, tone, by));
  range(farRidge, farTone, blend(MIST, [176, 194, 210], 0.4));
  crowns(k, farRidge, Y(0.5), 6000, 2.8, 0.08, unified(farTone, 0.74), width, spec.snow * 0.6);
  for (let at = 0; at < 60; at += 1) {
    const x = k.rand() * width;
    k.soft(x - 30, farRidge(x) + 26, k.span(50, 120), k.span(16, 30), SUNLIT, 0.14);
  }
  veil(0.575, 0.42, 22);
  range(midRidge, midTone, blend(MIST, green, 0.4));
  crowns(k, midRidge, Y(0.47), 4200, 4.4, 0.04, unified(midTone, 0.5), width, spec.snow * 0.7);
  paintPagoda(k, WORLD.anchor * S + WORLD.pagoda * S, Y(0.5), spec);
  const cx = (WORLD.anchor + WORLD.pagoda) * S;
  k.soft(cx, Y(0.6), 90, 110, MIST, 0.22);
  for (let at = 0; at < 9; at += 1) k.soft(cx + k.span(-90, 90), Y(0.508) + k.span(-6, 6), k.span(60, 120), k.span(9, 16), MIST, 0.5);
  veil(0.515, 0.36, 18);
  range(nearRidge, nearTone, blend(MIST, green, 0.6));
  crowns(k, nearRidge, Y(0.445), 2600, 7, 0, unified(nearTone, 0.26), width, spec.snow * 0.8);
  veil(0.452, 0.4, 20);
}

function paintWall(k: Kit, width: number, Y: (wy: number) => number, spec: GardenSpec): void {
  const { ctx } = k;
  const top = Y(0.494), foot = Y(0.428);
  const plaster = ctx.createLinearGradient(0, top, 0, foot);
  plaster.addColorStop(0, rgba([150, 138, 116]));
  plaster.addColorStop(0.22, rgba([226, 214, 186]));
  plaster.addColorStop(1, rgba([206, 194, 168]));
  ctx.fillStyle = plaster;
  ctx.fillRect(0, top, width, foot - top);
  for (let at = 0; at < 520; at += 1) k.dab(k.rand() * width, k.span(top + 4, foot), k.span(1, 3.4), k.span(4, 13), 0, k.rand() < 0.5 ? [246, 238, 216] : [170, 158, 134], 0.16);
  for (let x = 0; x < width; x += 118) { ctx.fillStyle = rgba([112, 92, 66], 0.55); ctx.fillRect(x + 20, top, 5, foot - top); }
  ctx.fillStyle = rgba([112, 108, 100]);
  ctx.fillRect(0, foot - 5, width, 8);
  for (let x = 0; x < width; x += k.span(14, 30)) k.dab(x, foot - 1, k.span(7, 13), 4, 0, k.rand() < 0.5 ? [140, 136, 126] : [92, 90, 86], 0.9);
  const crest = Y(0.515);
  ctx.fillStyle = rgba([66, 70, 82]);
  ctx.fillRect(0, crest, width, top - crest + 2);
  for (let x = 0; x < width; x += 7) {
    ctx.fillStyle = rgba([132, 138, 152], 0.9);
    ctx.fillRect(x, crest + 2, 2.2, top - crest - 2);
    ctx.fillStyle = rgba([36, 38, 48], 0.8);
    ctx.fillRect(x + 4.4, crest + 2, 1.8, top - crest - 2);
    k.dab(x + 3.4, top + 1, 2.7, 2.7, 0, [50, 52, 62]);
    k.dab(x + 2.8, top + 0.4, 1.2, 1.2, 0, [150, 154, 166], 0.9);
  }
  ctx.fillStyle = rgba([156, 162, 174]);
  ctx.fillRect(0, crest - 1, width, 3);
  ctx.fillStyle = rgba([24, 22, 30], 0.42);
  ctx.fillRect(0, top + 3, width, 4);
  if (spec.snow > 0) for (let x = 0; x < width; x += 9) k.dab(x + k.span(-3, 3), crest + k.span(0, 3), k.span(8, 15), k.span(3, 5.5) * spec.snow, 0, k.rand() < 0.3 ? SNOW_SHADE : SNOW, 0.96);
}

function paintPine(k: Kit, x: number, foot: number, spec: GardenSpec): void {
  const trunk: Joint[] = [[x, foot, 15], [x - 9, foot - 46, 12], [x + 6, foot - 96, 10], [x - 5, foot - 146, 7.5], [x + 4, foot - 186, 5], [x, foot - 214, 3]];
  const bark: Color = [92, 62, 48];
  const needles: Tones = { deep: [30, 58, 48], dark: [36, 70, 50], mid: [52, 96, 56], light: [104, 142, 74], glint: [160, 184, 108] };
  const tuft: Mark = (px, py, size, color, alpha) => { for (let at = 0; at < 3; at += 1) k.lens(px, py + size * 0.4, size * k.span(1.3, 2), size * 0.26, -Math.PI / 2 + k.span(-1, 1), color, alpha); };
  const boughs: readonly (readonly [number, number, number])[] = [[36, -1, 96], [72, 1, 104], [104, -1, 82], [132, 1, 78], [158, -1, 58], [180, 1, 48], [200, -1, 34], [214, 0.2, 26]];
  const pads: { x: number; y: number; rx: number }[] = [];
  const spine = along(trunk, 8);
  k.limb(trunk, lift(bark, -0.5), 1, [3, 1]);
  for (const [up, side, reach] of boughs) {
    const root = spine.reduce((best, each) => (Math.abs(each[1] - (foot - up)) < Math.abs(best[1] - (foot - up)) ? each : best));
    const tip: Point = [root[0] + side * reach, root[1] - 12 - reach * 0.08];
    k.curve([root[0], root[1]], [root[0] + side * reach * 0.5, root[1] + 8], tip, Math.max(2, root[2] * 0.5), lift(bark, -0.3));
    pads.push({ x: tip[0], y: tip[1] - 6, rx: reach * 0.62 });
    if (reach > 60) pads.push({ x: root[0] + side * reach * 0.42, y: root[1] - 16, rx: reach * 0.4 });
  }
  k.limb(trunk, bark);
  k.limb(trunk, lift(bark, 0.36), 0.9, [-2.2, 0], 0.3);
  for (let at = 0; at < 70; at += 1) { const joint = k.pick(spine); k.dab(joint[0] + k.span(-0.5, 0.5) * joint[2], joint[1], 1.2, k.span(2, 5), 0, lift(bark, k.rand() < 0.5 ? -0.5 : 0.3), 0.7); }
  pads.sort((a, b) => a.y - b.y);
  for (const pad of pads) {
    k.soft(pad.x + 6, pad.y + pad.rx * 0.36, pad.rx * 1.1, pad.rx * 0.26, [24, 44, 42], 0.36);
    mass(k, pad.x, pad.y, pad.rx, pad.rx * 0.34, needles, 4.6, 2.3, tuft);
    if (spec.snow > 0) snowOn(k, pad.x, pad.y - pad.rx * 0.14, pad.rx * 0.9, pad.rx * 0.24, spec.snow, 4);
  }
}

function paintMid(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 23);
  const season = seasonal(spec);
  const { width, height } = TILES.mid;
  const Y = (wy: number) => height - (wy - WORLD.midBase) * S;
  const round: Mark = (x, y, size, color, alpha) => k.dab(x, y, size, size * 0.72, k.rand() * TAU, color, alpha);
  const leafy = 1 - spec.winter;
  const backGreen = blend(season([78, 128, 70], [40, 88, 54], [88, 100, 46], [92, 96, 84]), MIST, 0.1);
  const turning: Color[] = spec.autumn > 0.3 ? [[190, 70, 36], [222, 152, 50], [226, 186, 72]] : spec.spring > 0.3 ? [[244, 198, 214], [250, 226, 234]] : [];
  for (let x = -40; x < width + 40; x += k.span(70, 150)) {
    const r = k.span(40, 72);
    const y = Y(0.535) - k.span(0, 26);
    const hue = turning.length && k.rand() < 0.4 ? lift(k.pick(turning), -0.1) : blend(backGreen, lift(backGreen, k.span(-0.3, 0.1)), 0.7);
    if (leafy > 0.3) mass(k, x, y, r, r * 0.62, tonesOf(hue), 3.6, 1.8 * leafy, round);
    else {
      for (let twig = 0; twig < 16; twig += 1) k.curve([x, y + r * 0.6], [x + k.span(-0.5, 0.5) * r, y], [x + k.span(-1, 1) * r, y - k.span(0.1, 0.7) * r], 1.4, [96, 84, 78], 0.7);
      if (spec.snow > 0) snowOn(k, x, y - r * 0.1, r * 0.8, r * 0.4, spec.snow * 0.5, 4);
    }
  }
  for (let at = 0; at < 26; at += 1) k.soft(k.rand() * width, Y(0.522) + k.span(-4, 12), k.span(120, 260), k.span(8, 15), MIST, 0.3);
  paintWall(k, width, Y, spec);
  paintPine(k, (WORLD.anchor + WORLD.pine) * S, Y(0.428), spec);
  const shrub = season([62, 126, 54], [40, 98, 50], [78, 108, 44], [70, 96, 62]);
  const burning: Color = [186, 44, 34];
  const rows: readonly (readonly [number, number, number, number])[] = [[0.434, 56, 104, -0.14], [0.42, 36, 70, 0.04]];
  for (const [wy, least, most, tint] of rows) {
    for (let x = -30; x < width + 60; x += k.span(0.9, 1.7) * least) {
      if (k.rand() < 0.34) { x += k.span(40, 150); continue; }
      const rx = k.span(least, most);
      const ry = Math.min(least * 0.62, rx * k.span(0.36, 0.5));
      const y = Y(wy) + ry * 0.2;
      const red = spec.autumn > 0.4 && k.rand() < 0.26;
      const hue = red ? blend(burning, [226, 120, 40], k.rand() * 0.5) : lift(blend(shrub, lift(shrub, k.span(-0.25, 0.2)), 0.8), tint);
      k.soft(x + rx * 0.2, y + ry * 0.8, rx * 1.15, ry * 0.5, [26, 44, 34], 0.5);
      mass(k, x, y, rx, ry, tonesOf(hue, red ? [255, 196, 96] : [226, 240, 150]), 4.4, 2.1, round);
      if (spec.spring > 0.3 && k.rand() < 0.7) {
        const bloom = k.pick<Color>([[236, 96, 140], [248, 150, 180], [250, 236, 240], [214, 70, 110]]);
        for (let at = 0; at < rx * ry * 0.05 * spec.spring; at += 1) { const [dx, dy] = k.spot(); k.dab(x + dx * rx, y + dy * ry * 0.9 - ry * 0.1, k.span(2, 3.6), k.span(1.6, 2.8), k.rand() * 3, dx * 0.5 + dy * 0.85 < 0 ? lift(bloom, 0.2) : lift(bloom, -0.2), 0.95); }
      }
      if (spec.snow > 0) snowOn(k, x, y - ry * 0.3, rx * 0.86, ry * 0.6, spec.snow, 4.6);
    }
  }
}

function paintGround(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 37);
  const season = seasonal(spec);
  const { width, height } = TILES.ground;
  const Y = (wy: number) => height - (wy - WORLD.groundBase) * S;
  const depth = (y: number) => 0.14 + 0.86 * Math.pow(Math.max(0, (y - Y(0.43)) / (height - Y(0.43))), 1.15);
  const brim = wave(5);
  const moss = season([84, 138, 54], [58, 116, 46], [90, 122, 46], [112, 116, 66]);
  const top = (x: number) => Y(0.43) + 5 * brim(x / 46) + 3 * brim(x / 11 + 9);
  const fill = ctx.createLinearGradient(0, Y(0.43), 0, height);
  fill.addColorStop(0, rgba(blend(lift(moss, 0.16), MIST, 0.16)));
  fill.addColorStop(0.35, rgba(lift(moss, 0.06)));
  fill.addColorStop(1, rgba(lift(moss, -0.2)));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 4) ctx.lineTo(x, top(x));
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  const cushions: { x: number; y: number; rx: number }[] = [];
  for (let at = 0; at < 60; at += 1) { const y = Y(0.42) + k.rand() * (height - Y(0.42)); k.soft(k.rand() * width, y, k.span(120, 320) * depth(y), k.span(30, 70) * depth(y), lift(moss, k.rand() < 0.5 ? -0.36 : 0.2), 0.5); }
  for (let at = 0; at < 1100; at += 1) {
    const y = Y(0.428) + Math.pow(k.rand(), 1.7) * (height - Y(0.428));
    cushions.push({ x: k.rand() * width, y, rx: k.span(34, 120) * depth(y) });
  }
  cushions.sort((a, b) => a.y - b.y);
  for (const { x, y, rx } of cushions) {
    const ry = rx * k.span(0.2, 0.3);
    const hue = blend(moss, lift(moss, k.span(-0.2, 0.24)), 0.9);
    const far = 1 - depth(y);
    k.soft(x + rx * 0.16, y + ry * 0.72, rx * 1.04, ry * 0.66, blend(lift(hue, -0.62), MIST, far * 0.3), 0.6);
    k.dab(x, y, rx, ry, 0, blend(hue, MIST, far * 0.25), 0.62);
    k.soft(x - rx * 0.24, y - ry * 0.34, rx * 0.74, ry * 0.62, blend(lift(hue, 0.36), MIST, far * 0.2), k.span(0.2, 0.62));
    const flecks = Math.round(rx * 0.5);
    for (let at = 0; at < flecks; at += 1) {
      const [dx, dy] = k.spot();
      const size = Math.max(0.7, rx * 0.035) * k.span(0.7, 1.5);
      k.dab(x + dx * rx, y + dy * ry, size, size * 0.6, 0, dx * 0.5 + dy * 0.85 < k.span(-0.3, 0.3) ? lift(hue, 0.5) : lift(hue, -0.4), 0.5);
    }
  }
  for (let x = 0; x < width; x += k.span(3, 9)) {
    const foot = top(x) + 3;
    k.curve([x, foot], [x + k.span(-2, 2), foot - 5], [x + k.span(-4, 4), foot - k.span(5, 11)], 1.1, lift(moss, k.span(-0.3, 0.3)), 0.9);
  }
  const litter = spec.autumn > 0 ? spec.autumn : spec.spring > 0 ? spec.spring * 0.7 : 0;
  const fallen: Color[] = spec.autumn >= spec.spring ? [[186, 40, 28], [226, 104, 36], [236, 170, 60], [150, 30, 30]] : [[250, 214, 226], [246, 190, 208], [255, 238, 242]];
  for (let at = 0; at < 1500 * litter; at += 1) {
    const y = Y(0.42) + Math.pow(k.rand(), 1.5) * (height - Y(0.42));
    const size = 1.2 + 5.2 * depth(y);
    const x = k.rand() * width;
    k.dab(x + size * 0.3, y + size * 0.26, size, size * 0.4, 0, lift(moss, -0.6), 0.4);
    k.dab(x, y, size, size * 0.42, k.span(-0.5, 0.5), k.pick(fallen), 0.95);
  }
  const edge = (x: number) => Y(0.142) + 7 * Math.sin(x / 74) + 9 * brim(x / 130 + 30);
  const gravel: Color = [208, 202, 188];
  const bed = ctx.createLinearGradient(0, Y(0.16), 0, height);
  bed.addColorStop(0, rgba(lift(gravel, -0.08)));
  bed.addColorStop(1, rgba(lift(gravel, 0.16)));
  ctx.fillStyle = bed;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 6) ctx.lineTo(x, edge(x));
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  for (let at = 0; at < 5200; at += 1) {
    const x = k.rand() * width;
    const y = edge(x) + k.rand() * (height - edge(x));
    k.dab(x, y, k.span(0.6, 1.7), k.span(0.5, 1.1), 0, k.rand() < 0.5 ? [238, 234, 222] : [150, 144, 132], 0.5);
  }
  for (let row = 0; row < 9; row += 1) {
    const drop = 6 + row * (5 + row * 0.9);
    for (const [shift, color, alpha] of [[0, [128, 122, 110], 0.5], [1.5, [246, 243, 234], 0.7]] as const) {
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = 1 + row * 0.12;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) { const y = edge(x) + drop + shift + 1.5 * Math.sin(x / 31 + row); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    }
  }
  for (let x = 0; x < width; x += k.span(5, 13)) {
    const y = edge(x);
    k.soft(x, y + 4, k.span(8, 16), 5, [40, 44, 34], 0.5);
    k.dab(x, y - 1, k.span(6, 14), k.span(3, 5), 0, lift(moss, k.span(-0.35, 0.1)), 0.96);
    k.dab(x - 2, y - 2.6, k.span(3, 7), 1.6, 0, lift(moss, 0.36), 0.8);
  }
  if (spec.snow > 0) {
    const cover = ctx.createLinearGradient(0, Y(0.43), 0, height);
    cover.addColorStop(0, rgba(blend(SNOW, SNOW_SHADE, 0.5), spec.snow * 0.86));
    cover.addColorStop(1, rgba(SNOW, spec.snow * 0.8));
    ctx.fillStyle = cover;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 4) ctx.lineTo(x, top(x) + 2);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
    for (let at = 0; at < 260; at += 1) { const y = Y(0.43) + Math.pow(k.rand(), 1.4) * (height - Y(0.43)); const rx = k.span(20, 90) * depth(y); k.soft(k.rand() * width, y, rx, rx * 0.2, lift(moss, -0.2), 0.5 * (1.2 - spec.snow)); }
    for (let at = 0; at < 1100 * spec.snow; at += 1) {
      const y = Y(0.43) + Math.pow(k.rand(), 1.5) * (height - Y(0.43));
      const rx = k.span(30, 130) * depth(y);
      const x = k.rand() * width;
      k.soft(x + rx * 0.1, y + rx * 0.09, rx, rx * 0.26, SNOW_SHADE, 0.7 * Math.min(1, spec.snow * 2.4));
      k.soft(x - rx * 0.1, y - rx * 0.04, rx * 0.9, rx * 0.22, SNOW, 0.95 * Math.min(1, spec.snow * 2.4));
    }
  }
}

function pondPath(ctx: GardenContext, scale: number): void {
  const cx = (WORLD.mapleLeft + WORLD.pond) * S, cy = TILES.pond.height - (WORLD.pondY - WORLD.groundBase) * S;
  ctx.beginPath();
  for (let step = 0; step <= 96; step += 1) {
    const [x, y] = pondRim((step / 96) * TAU, 1);
    if (step) ctx.lineTo((cx + x) * scale, (cy + y) * scale); else ctx.moveTo((cx + x) * scale, (cy + y) * scale);
  }
  ctx.closePath();
}

function pondRim(turn: number, reach: number): Point {
  const r = reach * (0.94 + 0.1 * Math.sin(2 * turn + 1) + 0.06 * Math.sin(3 * turn + 2.2) + 0.035 * Math.sin(7 * turn + 0.6));
  return [Math.cos(turn) * r * WORLD.pondRadius[0] * S, Math.sin(turn) * r * WORLD.pondRadius[1] * S];
}

function paintRock(k: Kit, x: number, y: number, size: number, snow: number, mossy: Color | null): void {
  const stone: Color = blend([150, 148, 142], [118, 112, 104], k.rand());
  const n = 7;
  const rim: Point[] = [];
  for (let at = 0; at < n; at += 1) { const turn = (at / n) * TAU + k.span(-0.2, 0.2); rim.push([x + Math.cos(turn) * size * k.span(0.8, 1.1), y - size * 0.45 + Math.sin(turn) * size * 0.55 * k.span(0.8, 1.1)]); }
  k.soft(x + size * 0.3, y + size * 0.08, size * 1.3, size * 0.3, [14, 20, 22], 0.6);
  k.shape(rim, lift(stone, -0.4));
  const peak: Point = [x - size * 0.15, y - size * 0.7];
  k.shape([rim[3]!, rim[4]!, rim[5]!, rim[6]!, peak], lift(stone, 0.3));
  k.shape([rim[4]!, rim[5]!, peak], lift(stone, 0.55), 0.9);
  k.shape([rim[6]!, rim[0]!, rim[1]!, peak], stone);
  for (let at = 0; at < size * 1.4; at += 1) { const [dx, dy] = k.spot(); k.dab(x + dx * size * 0.8, y - size * 0.45 + dy * size * 0.45, 0.9, 0.7, 0, k.rand() < 0.5 ? lift(stone, 0.5) : lift(stone, -0.5), 0.5); }
  k.dab(peak[0] - size * 0.2, peak[1] + size * 0.14, size * 0.16, size * 0.05, -0.3, [255, 255, 250], 0.7);
  if (mossy) for (let at = 0; at < size * 0.9; at += 1) k.dab(x + k.span(-1, 1) * size, y + k.span(-0.16, 0.04) * size, k.span(1.4, 3.2), k.span(1, 2), 0, lift(mossy, k.span(-0.3, 0.3)), 0.95);
  if (snow > 0) k.shape([rim[3]!, [rim[4]![0], rim[4]![1] - 2], [rim[5]![0], rim[5]![1] - 3], rim[6]!, [peak[0], peak[1] + size * 0.22]], SNOW, 0.6 + 0.4 * snow);
}

function paintPond(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 53);
  const season = seasonal(spec);
  const { height } = TILES.pond;
  const Y = (wy: number) => height - (wy - WORLD.groundBase) * S;
  const cx = (WORLD.mapleLeft + WORLD.pond) * S, cy = Y(WORLD.pondY);
  const depth = (y: number) => 0.2 + 0.8 * Math.max(0, (y - Y(0.43)) / (height - Y(0.43)));
  const moss = season([98, 150, 62], [72, 132, 54], [108, 136, 54], [118, 122, 70]);
  const trunkX = (WORLD.mapleLeft + WORLD.trunk) * S;
  const litter = Math.max(spec.autumn, spec.spring * 0.8);
  const fallen: Color[] = spec.autumn >= spec.spring ? [[186, 40, 28], [226, 104, 36], [236, 170, 60], [150, 30, 30], [206, 60, 30]] : [[250, 214, 226], [246, 190, 208], [255, 238, 242]];
  for (let at = 0; at < 2600 * litter; at += 1) {
    const [dx, dy] = k.spot();
    const x = trunkX - 120 + dx * 520, y = Y(0.3) + dy * 120;
    const size = 1.2 + 5 * depth(y);
    k.dab(x + size * 0.3, y + size * 0.26, size, size * 0.4, 0, lift(moss, -0.6), 0.4);
    k.dab(x, y, size, size * 0.42, k.span(-0.5, 0.5), k.pick(fallen), 0.95);
  }
  ctx.lineJoin = "round";
  for (const [grow, color, alpha] of [[26, lift(moss, -0.16), 0.55], [15, [122, 104, 74], 0.9], [7, [104, 88, 66], 0.95]] as const) {
    pondPath(ctx, 1);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = grow;
    ctx.stroke();
  }
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  pondPath(ctx, 1);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
  for (let step = 0; step < 150; step += 1) {
    const turn = (step / 150) * TAU + k.span(-0.02, 0.02);
    const [x, y] = pondRim(turn, 1.012);
    if (Math.sin(turn) > 0.1) k.dab(cx + x, cy + y, k.span(5, 12), k.span(1.6, 3), 0, [70, 60, 48], 0.8);
    else k.dab(cx + x, cy + y + 3, k.span(5, 11), k.span(1.5, 2.6), 0, [226, 220, 196], 0.24);
  }
  const reeds = season([86, 140, 56], [58, 122, 52], [170, 150, 70], [176, 160, 110]);
  const tufts: { turn: number; rock: boolean; reach: number }[] = [];
  for (let at = 0; at < 13; at += 1) tufts.push({ turn: at * 0.483 + k.span(-0.1, 0.1), rock: at % 3 !== 1, reach: k.span(1, 1.06) });
  for (let at = 0; at < 22; at += 1) tufts.push({ turn: k.rand() * TAU, rock: false, reach: k.span(0.99, 1.07) });
  const placed = tufts.map((each) => { const [x, y] = pondRim(each.turn, each.reach); return { ...each, x: cx + x, y: cy + y }; }).sort((a, b) => a.y - b.y);
  for (const each of placed) {
    const scale = depth(each.y);
    if (each.rock) paintRock(k, each.x, each.y + 4 * scale, k.span(16, 40) * scale, spec.snow, spec.winter > 0.6 ? null : moss);
    else {
      const blades = Math.round(k.span(9, 18));
      for (let at = 0; at < blades; at += 1) {
        const lean = k.span(-1, 1);
        const tall = k.span(20, 54) * scale;
        const hue = lift(reeds, k.span(-0.36, 0.34));
        k.curve([each.x + lean * 5 * scale, each.y + 2], [each.x + lean * 9 * scale, each.y - tall * 0.6], [each.x + lean * tall * 0.62, each.y - tall], 1 + 1.4 * scale, hue, 0.95);
      }
      if (spec.summer + spec.spring > 0.5 && k.rand() < 0.5) for (let at = 0; at < 3; at += 1) k.dab(each.x + k.span(-8, 8) * scale, each.y - k.span(22, 42) * scale, 3.4 * scale + 1, 2.6 * scale + 1, k.rand(), k.pick<Color>([[112, 82, 190], [150, 110, 214], [244, 240, 250]]), 0.95);
    }
  }
  const pads = (1 - spec.winter) * (spec.summer + 0.6 * spec.spring + 0.3 * spec.autumn);
  for (let group = 0; group < 4; group += 1) {
    const [gx, gy] = pondRim(1.1 + group * 1.5, 0.62);
    for (let at = 0; at < 9 * pads; at += 1) {
      const x = cx + gx + k.span(-70, 70), y = cy + gy + k.span(-16, 16);
      const rx = k.span(9, 19) * depth(y) + 3;
      const notch = k.rand() * TAU;
      const green = lift(season([98, 160, 70], [70, 140, 64], [130, 136, 60], [120, 120, 80]), k.span(-0.2, 0.2));
      k.dab(x + 2.5, y + 2.5, rx, rx * 0.36, 0, [8, 20, 22], 0.4);
      ctx.fillStyle = rgba(green);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.ellipse(x, y, rx, rx * 0.36, 0, notch, notch + TAU - 0.5);
      ctx.closePath();
      ctx.fill();
      k.dab(x - rx * 0.24, y - rx * 0.09, rx * 0.5, rx * 0.13, 0, lift(green, 0.4), 0.7);
      if (spec.summer > 0.5 && k.rand() < 0.2) for (let petal = 0; petal < 7; petal += 1) k.lens(x, y - 1, rx * 0.62, rx * 0.16, -Math.PI / 2 + (petal - 3) * 0.42, petal % 2 ? [250, 200, 220] : [255, 236, 242], 0.96);
    }
  }
  for (let at = 0; at < 90 * litter; at += 1) {
    const [dx, dy] = k.spot();
    const [px, py] = pondRim(Math.atan2(dy, dx), Math.hypot(dx, dy) * 0.92);
    const x = cx + px, y = cy + py;
    const size = 2.4 + 4.4 * depth(y);
    k.dab(x + 1.6, y + 1.6, size, size * 0.4, 0, [8, 20, 22], 0.36);
    if (spec.autumn >= spec.spring) k.palmate(x, y, size * 1.3, k.rand() * TAU, k.pick(fallen), 0.95);
    else k.dab(x, y, size * 0.8, size * 0.36, k.rand() * 3, k.pick(fallen), 0.95);
  }
  k.soft(trunkX + 26, Y(0.416), 120, 15, [8, 16, 18], 0.62);
  k.soft((WORLD.mapleLeft + WORLD.lantern) * S + 16, Y(0.416), 52, 8, [8, 16, 18], 0.6);
}

function paintMask(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 61);
  const { width, height } = TILES.mask;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  pondPath(ctx, 0.5);
  ctx.fillStyle = "rgb(255,0,0)";
  ctx.fill();
  const shadow: Color = [0, 255, 0];
  const trunkX = (WORLD.mapleLeft + WORLD.trunk) * S * 0.5;
  const leafy = 1 - spec.winter;
  const reach = 1 + 0.7 * spec.low;
  for (let at = 0; at < 14; at += 1) k.soft(trunkX + 30 + 40 * spec.low + k.span(-120, 120) * reach, 30 + k.span(0, 50), 90, 22, shadow, 0.5 * leafy);
  for (let at = 0; at < 420 * (0.25 + 0.75 * leafy); at += 1) {
    const [dx, dy] = k.spot();
    const x = trunkX - 60 + 70 * spec.low + dx * 250 * reach, y = 62 + dy * 56;
    const r = k.span(7, 26) * (0.4 + y / height);
    k.soft(x, y, r * 1.9, r * 0.6, shadow, k.span(0.4, 0.9) * (0.35 + 0.65 * leafy));
  }
  const lanternX = (WORLD.mapleLeft + WORLD.lantern) * S * 0.5;
  for (let at = 0; at < 12; at += 1) k.soft(lanternX + 8 + at * 5 * reach, 13 + at * 1.6, 9, 3.4, shadow, 0.6);
  for (let at = 0; at < 14; at += 1) k.soft(trunkX + 6 + at * 9 * reach, 13 + at * 2.4, 13, 4.4, shadow, 0.6);
  ctx.restore();
}

function mapleTones(spec: GardenSpec): Tones {
  const spring: Tones = { deep: [52, 80, 30], dark: [86, 124, 40], mid: [134, 172, 54], light: [186, 210, 82], glint: [234, 240, 150] };
  const summer: Tones = { deep: [26, 60, 36], dark: [36, 82, 40], mid: [56, 114, 44], light: [108, 158, 60], glint: [182, 208, 104] };
  const autumn: Tones = { deep: [112, 22, 24], dark: [156, 28, 22], mid: [206, 46, 24], light: [240, 102, 28], glint: [255, 190, 70] };
  const total = Math.max(0.001, spec.spring + spec.summer + spec.autumn);
  return blendTones(blendTones(summer, spring, spec.spring / Math.max(0.001, spec.spring + spec.summer)), autumn, spec.autumn / total);
}

function paintLantern(k: Kit, cx: number, foot: number, spec: GardenSpec): void {
  const { ctx } = k;
  const stone: Color = [150, 146, 136];
  const block = (y0: number, y1: number, half0: number, half1: number) => {
    const face = ctx.createLinearGradient(cx - Math.max(half0, half1), 0, cx + Math.max(half0, half1), 0);
    face.addColorStop(0, rgba(lift(stone, 0.38)));
    face.addColorStop(0.42, rgba(stone));
    face.addColorStop(0.62, rgba(lift(stone, -0.3)));
    face.addColorStop(1, rgba(lift(stone, -0.58)));
    k.shape([[cx - half0, y0], [cx + half0, y0], [cx + half1, y1], [cx - half1, y1]], face);
  };
  k.soft(cx + 14, foot + 3, 46, 7, [10, 16, 18], 0.6);
  block(foot - 10, foot + 2, 27, 30);
  block(foot - 18, foot - 10, 20, 22);
  block(foot - 68, foot - 18, 9.5, 12);
  block(foot - 80, foot - 68, 24, 14);
  block(foot - 114, foot - 80, 17, 17);
  ctx.fillStyle = rgba([20, 16, 18], 0.6);
  ctx.fillRect(cx - 17, foot - 114, 34, 6);
  ctx.fillStyle = rgba([34, 30, 28]);
  ctx.fillRect(cx - 8.5, foot - 107, 17, 22);
  const roof: Point[] = [[cx - 44, foot - 112], [cx - 30, foot - 119], [cx - 12, foot - 134], [cx - 6, foot - 140], [cx + 6, foot - 140], [cx + 12, foot - 134], [cx + 30, foot - 119], [cx + 44, foot - 112], [cx + 40, foot - 108], [cx - 40, foot - 108]];
  k.shape(roof, lift(stone, -0.3));
  k.shape([[cx - 44, foot - 112], [cx - 30, foot - 119], [cx - 12, foot - 134], [cx - 6, foot - 140], [cx, foot - 140], [cx - 2, foot - 122], [cx - 8, foot - 111]], lift(stone, 0.36));
  k.shape([[cx - 40, foot - 108], [cx + 40, foot - 108], [cx + 36, foot - 105], [cx - 36, foot - 105]], lift(stone, -0.66));
  k.dab(cx, foot - 146, 6.4, 7.4, 0, lift(stone, -0.12));
  k.dab(cx - 2, foot - 148, 2.8, 3.6, 0, lift(stone, 0.42), 0.9);
  for (let at = 0; at < 420; at += 1) k.dab(cx + k.span(-9, 9), foot - k.span(0, 112), k.span(0.6, 1.5), k.span(0.5, 1.2), 0, k.rand() < 0.5 ? lift(stone, 0.5) : lift(stone, -0.55), 0.3);
  if (spec.winter < 0.7) {
    const moss: Color = [84, 124, 52];
    for (let at = 0; at < 70; at += 1) k.dab(cx + k.span(-28, 28), foot - k.span(-2, 9), k.span(1.6, 4), k.span(1, 2.4), 0, lift(moss, k.span(-0.3, 0.3)), 0.92);
    for (let at = 0; at < 34; at += 1) { const side = k.span(-1, 1); k.dab(cx + side * 34, foot - 113 - (1 - Math.abs(side)) * 18, k.span(1.6, 4), k.span(1, 2), 0, lift(moss, k.span(-0.2, 0.36)), 0.9); }
  }
  if (spec.snow > 0) {
    k.shape([[cx - 43, foot - 113], [cx - 30, foot - 121], [cx - 12, foot - 137], [cx - 5, foot - 143], [cx + 5, foot - 143], [cx + 12, foot - 137], [cx + 30, foot - 121], [cx + 43, foot - 113], [cx + 20, foot - 118], [cx, foot - 128], [cx - 20, foot - 118]], SNOW, 0.6 + 0.4 * spec.snow);
    k.dab(cx, foot - 151, 6, 4, 0, SNOW);
    k.dab(cx, foot - 81, 23, 3, 0, SNOW, 0.9);
  }
}

function paintMaple(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 71);
  const { height } = TILES.maple;
  const Y = (wy: number) => height - (wy - WORLD.mapleBase) * S;
  const foot = Y(0.42);
  const tx = (WORLD.mapleLeft + WORLD.trunk) * S;
  const bark: Color = [92, 64, 52];
  const leafy = 1 - spec.winter;
  const tones = mapleTones(spec);
  const trunk: Joint[] = [[tx, foot + 4, 36], [tx - 5, foot - 58, 27], [tx - 19, foot - 118, 23], [tx - 30, foot - 170, 21]];
  const fork: Point = [tx - 30, foot - 170];
  const limbs: Joint[][] = [
    [[fork[0], fork[1], 17], [tx - 92, foot - 210, 14], [tx - 192, foot - 244, 11], [tx - 312, foot - 254, 9], [tx - 432, foot - 240, 6.5], [tx - 532, foot - 214, 4]],
    [[fork[0], fork[1], 18], [tx - 62, foot - 240, 15], [tx - 132, foot - 320, 12], [tx - 212, foot - 386, 9], [tx - 292, foot - 430, 6], [tx - 352, foot - 462, 4]],
    [[fork[0] + 4, fork[1], 17], [tx - 2, foot - 260, 14], [tx + 8, foot - 340, 11], [tx + 28, foot - 410, 8], [tx + 48, foot - 470, 5]],
    [[tx - 22, foot - 150, 14], [tx + 48, foot - 210, 12], [tx + 128, foot - 250, 10], [tx + 218, foot - 275, 8], [tx + 300, foot - 290, 6]],
    [[tx - 132, foot - 320, 9], [tx - 212, foot - 310, 7], [tx - 292, foot - 320, 5.5], [tx - 382, foot - 330, 4]],
    [[tx + 8, foot - 340, 9], [tx + 88, foot - 380, 7], [tx + 168, foot - 420, 5.5], [tx + 248, foot - 450, 4]],
    [[tx - 192, foot - 244, 7], [tx - 252, foot - 290, 5.5], [tx - 332, foot - 300, 4], [tx - 412, foot - 290, 3]],
  ];
  for (const root of [[-44, 16, -16], [40, 14, 12], [-8, 22, 0], [-70, 8, -30], [66, 6, 28]] as const) k.curve([tx + root[2], foot - 16], [tx + root[0] * 0.5, foot + 2], [tx + root[0], foot + root[1]], 11, lift(bark, -0.2));
  const wood = (thin: number, color: Color, shift: Point, alpha = 1) => { k.limb(trunk, color, alpha, shift, thin); for (const each of limbs) k.limb(each, color, alpha, shift, thin); };
  const leaf: Mark = (x, y, size, color, alpha) => k.lens(x - size * 0.8, y, size * 2, size * 0.62, k.span(-0.9, 0.9) + (k.rand() < 0.5 ? 0 : Math.PI), color, alpha);
  const star: Mark = (x, y, size, color, alpha) => k.palmate(x, y, size * 1.5, k.rand() * TAU, color, alpha);
  const pad = (x: number, y: number, rx: number, shade: number, density: number) => {
    const own = blendTones(tones, tonesOf(lift(tones.mid, k.span(-0.2, 0.16)), tones.glint), 0.35);
    const set: Tones = shade ? { deep: lift(own.deep, -shade), dark: lift(own.dark, -shade), mid: lift(own.mid, -shade), light: lift(own.light, -shade * 0.8), glint: lift(own.glint, -shade * 0.6) } : own;
    k.soft(x + rx * 0.1, y + rx * 0.34, rx * 1.05, rx * 0.34, lift(tones.deep, -0.2), 0.4 * leafy);
    mass(k, x, y, rx, rx * k.span(0.4, 0.54), set, 6.2, density * leafy, leaf, star);
  };
  wood(1, lift(bark, -0.45), [3, 2]);
  if (leafy > 0.05) {
    for (let at = 0; at < 30; at += 1) pad(tx + k.span(-420, 310), foot - k.span(300, 500), k.span(70, 112), 0.2, 1.5);
    for (let at = 0; at < 9; at += 1) pad(tx + k.span(-520, -200), foot - k.span(250, 330), k.span(50, 80), 0.16, 1.4);
  }
  wood(1, bark, [0, 0]);
  wood(0.3, lift(bark, 0.34), [-2.4, -1], 0.9);
  const spine = along(trunk, 10);
  for (let at = 0; at < 150; at += 1) { const joint = k.pick(spine); k.dab(joint[0] + k.span(-0.46, 0.46) * joint[2], joint[1] + k.span(-4, 4), k.span(0.9, 2), k.span(3, 9), k.span(-0.1, 0.1), lift(bark, k.rand() < 0.45 ? 0.36 : -0.5), 0.7); }
  if (spec.winter < 0.7) for (let at = 0; at < 80; at += 1) { const joint = k.pick(spine.slice(0, 14)); k.dab(joint[0] + k.span(0, 0.5) * joint[2], joint[1] + k.span(-6, 6), k.span(1.4, 3.6), k.span(1, 2.6), 0, lift([80, 122, 54], k.span(-0.3, 0.3)), 0.9); }
  const twigs = spec.winter > 0.05;
  const pads: { x: number; y: number; rx: number; front: boolean }[] = [];
  for (const each of limbs) {
    const path = along(each, 6);
    path.forEach((joint, index) => {
      const t = index / path.length;
      if (t < 0.24) return;
      if (twigs && index % 2 === 0) {
        for (let side = -1; side <= 1; side += 2) {
          const length = k.span(30, 80) * (1.2 - t * 0.5);
          const tip: Point = [joint[0] + side * length * k.span(0.3, 0.9), joint[1] - length * k.span(0.3, 0.9)];
          const heading = Math.atan2(tip[1] - joint[1], tip[0] - joint[0]);
          k.limb([[joint[0], joint[1], 2.4], [(joint[0] + tip[0]) / 2 + k.span(-4, 4), (joint[1] + tip[1]) / 2 + k.span(-4, 4), 1.8], [tip[0], tip[1], 1]], lift(bark, -0.1), spec.winter);
          for (let fine = 0; fine < 7; fine += 1) {
            const t = k.span(0.25, 1);
            const from: Point = [joint[0] + (tip[0] - joint[0]) * t, joint[1] + (tip[1] - joint[1]) * t];
            const turn = heading + (k.rand() < 0.5 ? -1 : 1) * k.span(0.3, 0.8);
            const reach = length * k.span(0.2, 0.45);
            const end: Point = [from[0] + Math.cos(turn) * reach, from[1] + Math.sin(turn) * reach];
            const fork = turn + k.span(-0.6, 0.6);
            k.limb([[from[0], from[1], 1.3], [end[0], end[1], 0.8], [end[0] + Math.cos(fork) * reach * 0.5, end[1] + Math.sin(fork) * reach * 0.5, 0.6]], lift(bark, 0.1), spec.winter * 0.9);
          }
          if (spec.snow > 0) k.limb([[joint[0], joint[1] - 2, 1.6], [tip[0], tip[1] - 2, 1]], SNOW, spec.snow * 0.8);
        }
      }
      if (index % 2) return;
      const rx = k.span(44, 76) * (1.1 - 0.45 * t);
      pads.push({ x: joint[0] + k.span(-26, 26), y: joint[1] - rx * k.span(0.1, 0.5), rx, front: false });
      if (t > 0.5) pads.push({ x: joint[0] + k.span(-50, 50), y: joint[1] + k.span(-6, 22), rx: k.span(24, 40), front: true });
    });
  }
  if (spec.snow > 0 && spec.winter > 0.3) { for (const each of limbs) k.limb(each, SNOW, spec.snow, [-1, -3.4], 0.42); k.limb(trunk.slice(1), SNOW, spec.snow * 0.8, [-7, -2], 0.16); }
  if (leafy > 0.05) {
    pads.sort((a, b) => Number(a.front) - Number(b.front) || a.y - b.y);
    for (const each of pads) pad(each.x, each.y, each.rx, each.front ? -0.06 : 0.08, each.front ? 2 : 1.8);
    for (let at = 0; at < 150 * leafy; at += 1) {
      const from = k.pick(pads);
      const x = from.x + k.span(-1.5, 1.5) * from.rx, y = from.y + k.span(0.2, 1.3) * from.rx * 0.6;
      k.palmate(x, y, k.span(6, 11), k.rand() * TAU, k.pick([tones.mid, tones.light, tones.dark, tones.glint]), 0.95);
    }
    const rim = spec.low;
    for (let at = 0; at < 420 * rim * leafy; at += 1) {
      const from = k.pick(pads);
      const turn = k.span(2.3, 4.6);
      k.palmate(from.x + Math.cos(turn) * from.rx, from.y + Math.sin(turn) * from.rx * 0.46, k.span(5, 9), k.rand() * TAU, blend(tones.glint, [255, 226, 150], 0.5), 0.9);
    }
  }
  paintLantern(k, (WORLD.mapleLeft + WORLD.lantern) * S, foot, spec);
  const grass: Color = [84, 132, 54];
  for (const [gx, spread] of [[(WORLD.mapleLeft + WORLD.lantern) * S, 34], [tx, 54]] as const) {
    for (let at = 0; at < 34; at += 1) { const x = gx + k.span(-1, 1) * spread; k.curve([x, foot + k.span(2, 12)], [x + k.span(-3, 3), foot - 4], [x + k.span(-8, 8), foot - k.span(4, 16)], 1.5, lift(grass, k.span(-0.36, 0.34)), 0.95 * (1 - 0.6 * spec.snow)); }
  }
}

function paintBamboo(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 83);
  const { width, height } = TILES.bamboo;
  const culm: Color = [118, 158, 66];
  const leafTones: Tones = { deep: [26, 60, 30], dark: [48, 94, 40], mid: [86, 136, 52], light: [142, 180, 74], glint: [204, 222, 124] };
  const cane = (x: number, girth: number, haze: number, lean: number) => {
    const hue = blend(lift(culm, k.span(-0.14, 0.14)), MIST, haze);
    const at = (y: number) => x + lean * Math.pow(Math.max(0, (height - y) / height), 1.6) * 60;
    const nodes: Point[] = [];
    let y = height + 4;
    while (y > -20) {
      const next = y - k.span(38, 54) * (0.8 + girth / 26);
      const x0 = at(y), x1 = at(next);
      const face = ctx.createLinearGradient(x0 - girth / 2, 0, x0 + girth / 2, 0);
      face.addColorStop(0, rgba(lift(hue, -0.2)));
      face.addColorStop(0.26, rgba(blend(lift(hue, 0.5), MIST, haze)));
      face.addColorStop(0.5, rgba(hue));
      face.addColorStop(1, rgba(blend(lift(hue, -0.62), MIST, haze)));
      k.shape([[x0 - girth / 2, y], [x0 + girth / 2, y], [x1 + girth / 2, next], [x1 - girth / 2, next]], face);
      ctx.fillStyle = rgba(blend(lift(hue, -0.7), MIST, haze), 0.9);
      ctx.fillRect(x1 - girth / 2 - 0.6, next - 1, girth + 1.2, 2);
      ctx.fillStyle = rgba(blend(lift(hue, 0.6), MIST, haze), 0.8);
      ctx.fillRect(x1 - girth / 2 - 0.6, next + 1, girth + 1.2, 1.4);
      nodes.push([x1, next]);
      y = next;
    }
    return nodes;
  };
  const spray = (x: number, y: number, side: number, scale: number, haze: number) => {
    const reach = k.span(26, 60) * scale;
    const tip: Point = [x + side * reach, y - reach * k.span(0.1, 0.5)];
    k.curve([x, y], [x + side * reach * 0.5, y - reach * 0.4], tip, 1.3, blend([92, 128, 56], MIST, haze));
    const count = Math.round(k.span(5, 9));
    for (let at = 0; at < count; at += 1) {
      const t = k.span(0.35, 1);
      const px = x + (tip[0] - x) * t, py = y + (tip[1] - y) * t - 4 * scale;
      const droop = Math.PI / 2 - side * k.span(0.1, 1.15);
      const tone = k.pick([leafTones.dark, leafTones.mid, leafTones.mid, leafTones.light, leafTones.glint]);
      k.lens(px + 1.6, py + 1.6, k.span(20, 34) * scale, k.span(2.6, 4) * scale, droop, blend(leafTones.deep, MIST, haze), 0.8);
      k.lens(px, py, k.span(20, 34) * scale, k.span(2.6, 4) * scale, droop, blend(tone, MIST, haze), 0.96);
      if (spec.snow > 0 && k.rand() < spec.snow * 0.5) k.dab(px + Math.cos(droop) * 8, py + Math.sin(droop) * 8 - 1.4, 5 * scale, 1.8, droop, SNOW, 0.9);
    }
  };
  const groves: readonly (readonly [number, number, number, number])[] = [[7, 6.5, 0.42, 0.7], [5, 10, 0.2, 0.86], [5, 14.5, 0, 1]];
  for (const [count, girth, haze, scale] of groves) {
    for (let at = 0; at < count; at += 1) {
      const x = 14 + ((at + k.span(0.1, 0.9)) / count) * (width * 0.5) * (0.6 + 0.4 * scale);
      const nodes = cane(x, girth * k.span(0.82, 1.18), haze, k.span(-0.5, 1));
      for (const [nx, ny] of nodes) {
        const high = 1 - ny / height;
        if (k.rand() < 0.12 + 0.75 * high * high) spray(nx, ny, k.rand() < 0.42 ? -1 : 1, scale * k.span(0.8, 1.15), haze);
        if (high > 0.55 && k.rand() < 0.55) spray(nx, ny, k.rand() < 0.5 ? -1 : 1, scale * k.span(0.8, 1.2), haze);
      }
    }
  }
}

function paintShoji(ctx: GardenContext): void {
  const k = kit(ctx, 97);
  const { height } = TILES.shoji;
  const wood: Color = [116, 84, 54];
  const paper = ctx.createLinearGradient(24, 0, 80, 0);
  paper.addColorStop(0, rgba([226, 218, 198]));
  paper.addColorStop(1, rgba([246, 241, 226]));
  ctx.fillStyle = paper;
  ctx.fillRect(22, 0, 60, height);
  for (let at = 0; at < 1400; at += 1) k.curve([k.span(24, 80), k.rand() * height], [k.span(24, 80), k.rand() * height], [k.span(24, 80), k.rand() * height], 0.5, k.rand() < 0.5 ? [255, 252, 240] : [190, 178, 150], 0.05);
  for (let at = 0; at < 110; at += 1) { const y = k.rand() * height; k.soft(k.span(40, 86), y, k.span(8, 24), k.span(14, 44), [94, 116, 84], 0.12); }
  for (let at = 0; at < 60; at += 1) k.lens(k.span(30, 80), k.rand() * height, k.span(26, 48), k.span(3, 5.5), k.span(0.6, 2.4), [86, 108, 80], 0.1);
  const grain = (x0: number, x1: number, tone: Color) => {
    const face = ctx.createLinearGradient(x0, 0, x1, 0);
    face.addColorStop(0, rgba(lift(tone, 0.16)));
    face.addColorStop(0.6, rgba(tone));
    face.addColorStop(1, rgba(lift(tone, -0.4)));
    ctx.fillStyle = face;
    ctx.fillRect(x0, 0, x1 - x0, height);
    for (let at = 0; at < (x1 - x0) * 5; at += 1) { const x = k.span(x0, x1); const y = k.rand() * height; k.curve([x, y], [x + k.span(-1.4, 1.4), y + 30], [x + k.span(-1, 1), y + k.span(40, 120)], 0.7, lift(tone, k.rand() < 0.5 ? 0.3 : -0.45), 0.34); }
  };
  for (let bar = 0; bar <= 9; bar += 1) {
    const y = height - (bar + 0.5) * (height / 9);
    const shade = ctx.createLinearGradient(0, y + 4, 0, y + 20);
    shade.addColorStop(0, rgba([70, 58, 48], 0.4));
    shade.addColorStop(1, rgba([70, 58, 48], 0));
    ctx.fillStyle = shade;
    ctx.fillRect(22, y + 4, 60, 16);
    ctx.fillStyle = rgba(lift(wood, 0.1));
    ctx.fillRect(22, y - 4, 60, 8);
    ctx.fillStyle = rgba(lift(wood, 0.42), 0.9);
    ctx.fillRect(22, y - 4, 60, 1.6);
    ctx.fillStyle = rgba(lift(wood, -0.5), 0.9);
    ctx.fillRect(22, y + 2.6, 60, 1.4);
  }
  ctx.fillStyle = rgba([70, 58, 48], 0.22);
  ctx.fillRect(54, 0, 5, height);
  ctx.fillStyle = rgba(lift(wood, 0.06));
  ctx.fillRect(50.4, 0, 3.4, height);
  const cast = ctx.createLinearGradient(24, 0, 40, 0);
  cast.addColorStop(0, rgba([70, 58, 48], 0.42));
  cast.addColorStop(1, rgba([70, 58, 48], 0));
  ctx.fillStyle = cast;
  ctx.fillRect(24, 0, 16, height);
  grain(0, 24, lift(wood, -0.1));
  grain(79, 90, wood);
}

function paintDeck(ctx: GardenContext): void {
  const k = kit(ctx, 101);
  const { width, height } = TILES.deck;
  const board = width / 8;
  for (let at = 0; at < 8; at += 1) {
    const tone = blend([146, 108, 70], [196, 156, 108], k.rand());
    const x0 = at * board;
    const face = ctx.createLinearGradient(x0, 0, x0 + board, 0);
    face.addColorStop(0, rgba(lift(tone, 0.12)));
    face.addColorStop(0.5, rgba(tone));
    face.addColorStop(1, rgba(lift(tone, -0.14)));
    ctx.fillStyle = face;
    ctx.fillRect(x0, 0, board, height);
    for (let line = 0; line < 46; line += 1) {
      const x = x0 + k.span(3, board - 2);
      const bow = k.span(-5, 5);
      k.curve([x, -4], [x + bow, height * k.span(0.3, 0.7)], [x + k.span(-2, 2), height + 4], k.span(0.5, 1.5), lift(tone, k.rand() < 0.6 ? -0.36 : 0.3), 0.36);
    }
    if (k.rand() < 0.6) {
      const kx = x0 + k.span(14, board - 14), ky = k.span(20, height - 20);
      for (let ring = 4; ring >= 1; ring -= 1) { ctx.strokeStyle = rgba(lift(tone, -0.5), 0.5); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.ellipse(kx, ky, ring * 2.2, ring * 3.6, 0, 0, TAU); ctx.stroke(); }
      k.dab(kx, ky, 1.8, 2.6, 0, lift(tone, -0.66));
    }
    ctx.fillStyle = rgba([36, 24, 18]);
    ctx.fillRect(x0, 0, 2.6, height);
    ctx.fillStyle = rgba(lift(tone, 0.5), 0.7);
    ctx.fillRect(x0 + 2.6, 0, 1.4, height);
  }
}

function paintClouds(ctx: GardenContext): void {
  const k = kit(ctx, 113);
  const { width } = TILES.clouds;
  const shade: Color = [168, 182, 208];
  const body: Color = [232, 236, 244];
  const lit: Color = [255, 252, 244];
  const wrap = (x: number, draw: (x: number) => void) => { draw(x); draw(x - width); draw(x + width); };
  for (let at = 0; at < 26; at += 1) {
    const y = k.span(14, 90);
    wrap(k.rand() * width, (x) => k.soft(x, y, k.span(90, 220), k.span(7, 16), lit, k.span(0.1, 0.26)));
  }
  const banks: readonly (readonly [number, number, number])[] = [[120, 186, 150], [392, 150, 118], [640, 204, 172], [884, 132, 104], [760, 84, 70], [262, 76, 58]];
  for (const [bx, by, reach] of banks) {
    const puffs: { x: number; y: number; r: number }[] = [];
    for (let at = 0; at < reach * 0.42; at += 1) {
      const side = k.span(-1, 1);
      const r = k.span(0.14, 0.34) * reach * (1 - 0.5 * Math.abs(side));
      puffs.push({ x: bx + side * reach, y: by - k.rand() * r * 1.5 * (1 - side * side), r });
    }
    puffs.sort((a, b) => a.y - b.y);
    wrap(0, (shift) => { for (let at = 0; at < 8; at += 1) k.soft(bx + shift + k.span(-1, 1) * reach, by + 8, reach * 0.5, 13, shade, 0.5); });
    for (const puff of puffs) {
      wrap(puff.x, (x) => {
        k.soft(x + puff.r * 0.2, puff.y + puff.r * 0.28, puff.r * 1.2, puff.r, shade, 0.74);
        k.soft(x, puff.y, puff.r * 1.1, puff.r * 0.9, body, 0.8);
        k.soft(x - puff.r * 0.26, puff.y - puff.r * 0.3, puff.r * 0.74, puff.r * 0.56, lit, 0.95);
        if (k.rand() < 0.4) k.dab(x - puff.r * 0.3, puff.y - puff.r * 0.36, puff.r * 0.4, puff.r * 0.26, -0.3, lit, 0.5);
      });
    }
  }
}

function paintSprites(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 127);
  const autumn = spec.autumn >= spec.spring;
  const hues: readonly Color[] = autumn ? [[198, 40, 26], [236, 130, 34]] : [[250, 196, 214], [255, 230, 238]];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const cx = column * 64 + 32, cy = row * 64 + 32;
      const copies = row ? 14 : 1;
      for (let copy = 0; copy < copies; copy += 1) {
        const [jx, jy] = row ? k.spot() : [0, 0];
        const x = cx + jx * 6, y = cy + jy * 6;
        const alpha = row ? 0.13 : 1;
        if (column >= 2) { k.soft(x, y, column === 2 ? 15 : 10, column === 2 ? 15 : 10, SNOW, alpha); if (!row) k.dab(x, y, column === 2 ? 5 : 3.4, column === 2 ? 5 : 3.4, 0, SNOW, 0.9); continue; }
        const hue = hues[column]!;
        if (autumn) {
          k.palmate(x, y + 5, 21, -Math.PI / 2, hue, alpha);
          if (!row) { k.palmate(x - 1.5, y + 4, 13, -Math.PI / 2, lift(hue, 0.3), 0.8); k.limb([[x, y + 5, 1.6], [x + 2, y + 19, 1]], lift(hue, -0.4)); }
        } else {
          k.dab(x, y, 15, 9.5, 0.5, hue, alpha);
          if (!row) { k.dab(x - 3, y - 2.4, 8, 4, 0.5, lift(hue, 0.5), 0.8); k.dab(x + 11, y + 6.6, 3.4, 2, 0.5, [236, 150, 176], 0.8); }
        }
      }
    }
  }
}

function paintStone(ctx: GardenContext, spec: GardenSpec): void {
  const k = kit(ctx, 131);
  const stone: Color = [152, 150, 142];
  const rim = (dy: number, grow: number): Point[] => {
    const out: Point[] = [];
    const bump = wave(7);
    for (let at = 0; at < 28; at += 1) { const turn = (at / 28) * TAU; const r = 0.9 + 0.14 * bump(at * 0.9); out.push([96 + Math.cos(turn) * 80 * r * grow, 34 + dy + Math.sin(turn) * 22 * r * grow]); }
    return out;
  };
  k.soft(104, 50, 92, 22, [8, 18, 16], 0.7);
  k.shape(rim(10, 1), lift(stone, -0.56));
  k.shape(rim(0, 1), stone);
  k.shape(rim(-2, 0.82).map(([x, y]) => [x - 8, y - 1] as const), lift(stone, 0.22), 0.8);
  k.shape([[40, 26], [84, 16], [112, 22], [70, 34]], lift(stone, 0.46), 0.6);
  k.shape([[110, 38], [150, 30], [162, 40], [128, 50]], lift(stone, -0.24), 0.5);
  for (let at = 0; at < 260; at += 1) { const [dx, dy] = k.spot(); k.dab(96 + dx * 74, 34 + dy * 20, k.span(0.6, 1.6), k.span(0.5, 1.1), 0, k.rand() < 0.5 ? lift(stone, 0.5) : lift(stone, -0.5), 0.4); }
  if (spec.winter < 0.7) for (let at = 0; at < 120; at += 1) { const turn = k.span(0.1, Math.PI - 0.1); k.dab(96 + Math.cos(turn) * 82 * k.span(0.92, 1.06), 40 + Math.sin(turn) * 24 * k.span(0.9, 1.1), k.span(2, 5), k.span(1.4, 3), 0, lift([86, 130, 54], k.span(-0.3, 0.3)), 0.95); }
  if (spec.snow > 0) k.shape(rim(-3, 0.9), SNOW, 0.4 + 0.6 * spec.snow);
}

export function paintGarden(ctx: GardenContext, spec: GardenSpec): void {
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  inTile(ctx, TILES.dist, () => paintDist(ctx, spec));
  inTile(ctx, TILES.mid, () => paintMid(ctx, spec));
  inTile(ctx, TILES.ground, () => paintGround(ctx, spec));
  inTile(ctx, TILES.maple, () => paintMaple(ctx, spec));
  inTile(ctx, TILES.bamboo, () => paintBamboo(ctx, spec));
  inTile(ctx, TILES.pond, () => paintPond(ctx, spec));
  inTile(ctx, TILES.mask, () => paintMask(ctx, spec));
  inTile(ctx, TILES.clouds, () => paintClouds(ctx));
  inTile(ctx, TILES.deck, () => paintDeck(ctx));
  inTile(ctx, TILES.shoji, () => paintShoji(ctx));
  inTile(ctx, TILES.sprites, () => paintSprites(ctx, spec));
  inTile(ctx, TILES.stone, () => paintStone(ctx, spec));
  ctx.fillStyle = "#fff";
  ctx.fillRect(TILES.marker.x, TILES.marker.y, TILES.marker.width, TILES.marker.height);
}
