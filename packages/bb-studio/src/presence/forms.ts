export const BUILTIN_FORMS = ["orb", "tesseract", "knot", "swarm", "mobius", "poly", "attractor", "klein"] as const;
export type BuiltinForm = (typeof BUILTIN_FORMS)[number];
export const FORM_NAMES: Record<BuiltinForm, string> = {
  orb: "Orb",
  tesseract: "Tesseract",
  knot: "Torus knot",
  swarm: "Particle swarm",
  mobius: "Möbius ribbon",
  poly: "Polyhedron",
  attractor: "Lorenz attractor",
  klein: "Klein bottle",
};
export const PRESENCE_STATES = ["idle", "thinking", "working", "needs"] as const;
export type PresenceStateName = (typeof PRESENCE_STATES)[number];
export const STATE_NAMES: Record<PresenceStateName, string> = { idle: "Idle", thinking: "Thinking", working: "Working", needs: "Needs you" };
export const STATE_SPEED: Record<PresenceStateName, number> = { idle: 0.45, thinking: 1.7, working: 1, needs: 0.7 };

export type Rgb = readonly [number, number, number];
export type Palette = readonly [Rgb, Rgb, Rgb];
export type Tier = "tiny" | "small" | "full";

export type PresenceContext = Pick<CanvasRenderingContext2D,
  "setTransform" | "clearRect" | "translate" | "rotate" | "save" | "restore" | "beginPath" | "closePath" | "moveTo" | "lineTo" | "arc" | "fill" | "stroke" | "fillRect"
  | "quadraticCurveTo" | "createRadialGradient" | "createLinearGradient" | "fillStyle" | "strokeStyle" | "lineWidth" | "lineCap" | "lineJoin" | "globalCompositeOperation">;

export interface PresenceFrame {
  form: BuiltinForm;
  size: number;
  dpr: number;
  clock: number;
  formTime: number;
  state: PresenceStateName;
  workers: number;
  palette: Palette;
  light: boolean;
}

interface Style { P: Palette; lw: number; tier: Tier; light: boolean; comp: GlobalCompositeOperation }
type Point = [number, number, number, number];
type Vec3 = [number, number, number];
type FormDraw = (c: PresenceContext, t: number, R: number, S: Style) => void;

const TAU = Math.PI * 2;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
export const AMBER: Palette = [[255, 171, 61], [255, 90, 31], [255, 227, 166]];
export const AMBER_LIGHT: Palette = [[224, 122, 0], [176, 72, 0], [240, 160, 40]];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (x: number) => { const v = cl(x); return v * v * (3 - 2 * v); };
const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${cl(a).toFixed(3)})`;
const dn = (z: number) => cl(0.5 - z * 0.5);

export function tierOf(size: number): Tier {
  return size < 30 ? "tiny" : size < 70 ? "small" : "full";
}

function rot(x: number, y: number, z: number, ax: number, ay: number): Vec3 {
  let c = Math.cos(ax), s = Math.sin(ax), t = y * c - z * s;
  z = y * s + z * c; y = t;
  c = Math.cos(ay); s = Math.sin(ay); t = x * c + z * s;
  z = -x * s + z * c; x = t;
  return [x, y, z];
}

function pj(p: Vec3, R: number, f = 3.5): Point {
  const k = f / (f + p[2]);
  return [p[0] * R * k, p[1] * R * k, p[2], k];
}

function ramp(S: Style, v: number): Rgb {
  const P = S.P;
  if (S.light) return v < 0.5 ? mix(mix(P[2], WHITE, 0.25), P[0], v * 2) : mix(P[0], mix(P[1], BLACK, 0.35), (v - 0.5) * 2);
  return v < 0.5 ? mix(P[1], P[0], v * 2) : mix(P[0], mix(P[2], WHITE, 0.3), (v - 0.5) * 2);
}

function bucket(n: number) {
  const B: number[][] = [];
  for (let i = 0; i < n; i++) B.push([]);
  return {
    seg(v: number, x1: number, y1: number, x2: number, y2: number) { B[Math.round(cl(v) * (n - 1))]!.push(x1, y1, x2, y2); },
    draw(c: PresenceContext, S: Style, lw: number) {
      const glow = S.tier === "full" && !S.light;
      const floor = S.tier === "full" ? 0.1 : 0.3;
      c.lineCap = "round";
      for (let i = 0; i < n; i++) {
        const a = B[i]!;
        if (!a.length) continue;
        const v = i / (n - 1), col = ramp(S, v);
        c.beginPath();
        for (let j = 0; j < a.length; j += 4) { c.moveTo(a[j]!, a[j + 1]!); c.lineTo(a[j + 2]!, a[j + 3]!); }
        if (glow) { c.strokeStyle = rgba(col, 0.04 + 0.16 * v); c.lineWidth = lw * 3.6; c.stroke(); }
        c.strokeStyle = rgba(col, floor + (1 - floor) * v);
        c.lineWidth = S.tier === "full" ? lw * (0.55 + 0.6 * v) : lw * (0.8 + 0.3 * v);
        c.stroke();
      }
    },
  };
}

function dot(c: PresenceContext, S: Style, x: number, y: number, r: number, col: Rgb, a: number): void {
  if (r <= 0 || a <= 0) return;
  if (!S.light) {
    if (S.tier === "full") { c.fillStyle = rgba(col, a * 0.12); c.beginPath(); c.arc(x, y, r * 3.2, 0, TAU); c.fill(); }
    c.fillStyle = rgba(col, a * 0.3); c.beginPath(); c.arc(x, y, r * 1.7, 0, TAU); c.fill();
  }
  c.fillStyle = rgba(S.light ? mix(col, BLACK, 0.2) : mix(col, WHITE, 0.65), a);
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

function seeded(seed: number): () => number {
  let sd = seed;
  return () => (sd = (sd * 16807) % 2147483647) / 2147483647;
}

const orb: FormDraw = (c, t, R, S) => {
  const P = S.P;
  let g = c.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.05, 0, 0, R);
  if (S.light) { g.addColorStop(0, rgba(WHITE, 0.95)); g.addColorStop(0.6, rgba(mix(P[0], WHITE, 0.72), 0.7)); g.addColorStop(1, rgba(mix(P[0], WHITE, 0.45), 0.55)); }
  else { g.addColorStop(0, rgba(mix(P[2], WHITE, 0.4), 0.32)); g.addColorStop(0.6, rgba(P[1], 0.16)); g.addColorStop(1, rgba(P[1], 0)); }
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
  const steps = S.tier === "tiny" ? 28 : 72;
  for (let k = 0; k < 3; k++) {
    const col = P[k]!;
    c.save();
    c.rotate(t * (0.3 + 0.17 * k) * (k % 2 ? -1 : 1) + k * 2.1);
    c.beginPath();
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * TAU;
      const r = R * (0.6 + 0.12 * Math.sin(2 * th + t * (1.3 + 0.4 * k) + k) + 0.08 * Math.sin(3 * th - t * (1.9 - 0.3 * k) + 2 * k) + (S.tier === "tiny" ? 0 : 0.04 * Math.sin(5 * th + t * 2.3)));
      const x = Math.cos(th) * r, y = Math.sin(th) * r * (0.78 + 0.18 * Math.sin(t * 0.9 + k * 1.7));
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
    g = c.createRadialGradient(0, 0, R * 0.05, 0, 0, R * 0.85);
    g.addColorStop(0, rgba(col, 0.04)); g.addColorStop(0.7, rgba(col, S.light ? 0.16 : 0.3)); g.addColorStop(1, rgba(col, 0.08));
    c.fillStyle = g; c.fill();
    c.strokeStyle = S.light ? rgba(mix(col, BLACK, 0.12), 0.95) : rgba(mix(col, WHITE, 0.35), S.tier === "full" ? 0.55 : 0.8); c.lineWidth = S.lw * (S.light ? 1.15 : 0.9); c.stroke();
    c.restore();
  }
  g = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
  if (S.light) { g.addColorStop(0, rgba(WHITE, 0.9)); g.addColorStop(0.4, rgba(WHITE, 0.35)); g.addColorStop(1, rgba(WHITE, 0)); }
  else { g.addColorStop(0, rgba(WHITE, 0.6)); g.addColorStop(0.35, rgba(P[2], 0.3)); g.addColorStop(1, rgba(P[2], 0)); }
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.5, 0, TAU); c.fill();
  c.strokeStyle = S.light ? rgba(mix(P[0], BLACK, 0.2), 0.8) : rgba(mix(P[0], WHITE, 0.5), S.tier === "full" ? 0.25 : 0.5); c.lineWidth = S.lw;
  c.beginPath(); c.arc(0, 0, R * 0.98, 0, TAU); c.stroke();
  if (S.light) return;
  g = c.createRadialGradient(-R * 0.35, -R * 0.45, 0, -R * 0.35, -R * 0.45, R * 0.32);
  g.addColorStop(0, rgba(WHITE, 0.3)); g.addColorStop(1, rgba(WHITE, 0));
  c.fillStyle = g; c.beginPath(); c.arc(-R * 0.35, -R * 0.45, R * 0.32, 0, TAU); c.fill();
};

const TV: [number, number, number, number][] = [];
const TE: [number, number][] = [];
for (let i = 0; i < 16; i++) TV.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) { const j = i ^ (1 << b); if (j > i) TE.push([i, j]); }

export function tesseractVertex(v: readonly [number, number, number, number], t: number): [number, number, number, number] {
  const a = t * 0.6, b = t * 0.23, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  let [x, y, , w] = v;
  const z = v[2];
  let u = x * ca - w * sa; w = x * sa + w * ca; x = u;
  u = y * cb - w * sb; w = y * sb + w * cb; y = u;
  return [x, y, z, w];
}

const tesseract: FormDraw = (c, t, R, S) => {
  const ax = 0.55 + 0.25 * Math.sin(t * 0.13), ay = t * 0.17 + 0.6;
  const Q = TV.map((v) => {
    const [x, y, z, w] = tesseractVertex(v, t);
    const k = 1.25 / (2.6 - w);
    const p = pj(rot(x * k, y * k, z * k, ax, ay), R * (S.tier === "full" ? 0.8 : 0.69));
    return [p[0], p[1], p[2], p[3], cl((w + 1.6) / 3.2)] as const;
  });
  const bk = bucket(8);
  for (const [i, j] of TE) {
    const p = Q[i]!, q = Q[j]!;
    bk.seg(0.1 + 0.45 * dn((p[2] + q[2]) / 2.2) + 0.45 * (p[4] + q[4]) / 2, p[0], p[1], q[0], q[1]);
  }
  bk.draw(c, S, S.lw * 1.15);
  if (S.tier === "tiny") return;
  for (const p of Q) dot(c, S, p[0], p[1], S.lw * (S.tier === "full" ? 0.7 + 1.2 * p[3] * p[4] : 0.75), ramp(S, 0.45 + 0.55 * p[4]), 0.35 + 0.65 * dn(p[2] / 1.1));
};

const knot: FormDraw = (c, t, R, S) => {
  const N = S.tier === "full" ? 260 : S.tier === "small" ? 96 : 60, bk = bucket(8), ax = 0.5 * Math.sin(t * 0.21), ay = 0.5 * Math.sin(t * 0.17 + 1), spin = t * 0.3, cs = Math.cos(spin), sn = Math.sin(spin);
  let pv: Point | null = null;
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * TAU, r = (2 + Math.cos(3 * u)) / 3.1;
    const kx = r * Math.cos(2 * u), ky = r * Math.sin(2 * u);
    const p = pj(rot(kx * cs - ky * sn, kx * sn + ky * cs, -Math.sin(3 * u) / 3.1, ax, ay), R * (S.tier === "full" ? 1.12 : 1.08));
    if (pv) {
      const f = Math.pow(0.5 + 0.5 * Math.sin(u * 4 - t * 2.6), 4);
      bk.seg(S.tier === "full" ? 0.08 + 0.52 * dn(p[2]) + 0.4 * f : 0.2 + 0.6 * dn(p[2] * 1.6) + 0.2 * f, pv[0], pv[1], p[0], p[1]);
    }
    pv = p;
  }
  bk.draw(c, S, S.lw * (S.tier === "full" ? 1.7 : S.tier === "small" ? 1.5 : 1.35));
};

const SWARM = (() => {
  const rn = seeded(11), out: { r: number; inc: number; node: number; phase: number; speed: number; lead: boolean }[] = [];
  for (let i = 0; i < 260; i++) {
    const r = 0.22 + 0.78 * Math.pow(rn(), 0.7);
    out.push({ r, inc: (rn() - 0.5) * 2.4, node: rn() * TAU, phase: rn() * TAU, speed: (0.5 + 0.5 * rn()) / Math.pow(r, 0.8), lead: i % 11 === 0 });
  }
  return out;
})();

const swarm: FormDraw = (c, t, R, S) => {
  const n = S.tier === "full" ? 260 : S.tier === "small" ? 64 : 34;
  const ax = 0.5 + 0.3 * Math.sin(t * 0.17), ay = t * 0.21;
  const squeeze = 0.22 * Math.sin(t * 0.6), sway = t * 0.35;
  const cs = Math.cos(sway), sn = Math.sin(sway);
  const drawn: { x: number; y: number; d: number; k: number; lead: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const q = SWARM[i]!, a = q.phase + t * q.speed * 0.9;
    let x = q.r * Math.cos(a), y = q.r * Math.sin(a) * Math.cos(q.inc), z = q.r * Math.sin(a) * Math.sin(q.inc);
    const cnode = Math.cos(q.node), snode = Math.sin(q.node);
    const xr = x * cnode - y * snode; y = x * snode + y * cnode; x = xr;
    const along = x * cs + y * sn, stretch = 1 + squeeze * along;
    x = x * stretch + 0.1 * Math.sin(z * 3 + t * 0.9); y = y * (1 - squeeze * 0.5) + 0.1 * Math.sin(x * 2.6 + t * 0.7); z *= 1 - squeeze * 0.5;
    const p = pj(rot(x, y, z, ax, ay), R * 0.98);
    drawn.push({ x: p[0], y: p[1], d: dn(p[2] / 0.9), k: p[3], lead: q.lead });
  }
  const base = S.tier === "full" ? S.lw * 1.25 : S.tier === "small" ? 0.95 : 0.9;
  for (const p of drawn) {
    if (p.lead) continue;
    c.fillStyle = rgba(ramp(S, 0.2 + 0.75 * p.d), S.tier === "full" ? 0.35 + 0.65 * p.d : 0.55 + 0.45 * p.d);
    c.beginPath(); c.arc(p.x, p.y, base * (0.7 + 0.7 * p.d) * p.k, 0, TAU); c.fill();
  }
  for (const p of drawn) if (p.lead) dot(c, S, p.x, p.y, base * (S.tier === "full" ? 1 + 0.8 * p.d : 0.95) * p.k, ramp(S, 0.55 + 0.45 * p.d), 0.6 + 0.4 * p.d);
  if (S.tier !== "full" || S.light) return;
  const g = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.6);
  g.addColorStop(0, rgba(S.P[2], 0.22)); g.addColorStop(1, rgba(S.P[2], 0));
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.6, 0, TAU); c.fill();
};

const mobius: FormDraw = (c, t, R, S) => {
  const N = S.tier === "full" ? 84 : S.tier === "small" ? 44 : 30;
  const ax = 1.02 + 0.2 * Math.sin(t * 0.19), ay = 0.45 * Math.sin(t * 0.23), spin = t * 0.3, sweep = (t * 1.3) % TAU;
  const width = S.tier === "full" ? 0.36 : 0.42;
  const at = (u: number, v: number): Vec3 => {
    const w = width * v, r = (1 + w * Math.cos(u / 2)) * 0.8;
    return rot(r * Math.cos(u + spin), r * Math.sin(u + spin), w * Math.sin(u / 2) * 0.8, ax, ay);
  };
  const RR = S.tier === "full" ? R : R * 0.94;
  const quads: { z: number; a: Point; b: Point; d: Point; e: Point; shade: number; glow: number }[] = [];
  for (let i = 0; i < N; i++) {
    const u0 = (i / N) * TAU, u1 = ((i + 1) / N) * TAU;
    const a3 = at(u0, -1), b3 = at(u0, 1), d3 = at(u1, 1), e3 = at(u1, -1);
    const ux = e3[0] - a3[0], uy = e3[1] - a3[1], uz = e3[2] - a3[2], vx = b3[0] - a3[0], vy = b3[1] - a3[1], vz = b3[2] - a3[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const facing = Math.abs(nz) / (Math.hypot(nx, ny, nz) || 1);
    let d = Math.abs(u0 - sweep); d = Math.min(d, TAU - d);
    quads.push({ z: (a3[2] + b3[2] + d3[2] + e3[2]) / 4, a: pj(a3, RR), b: pj(b3, RR), d: pj(d3, RR), e: pj(e3, RR), shade: facing, glow: Math.exp(-d * d * 2.2) });
  }
  quads.sort((p, q) => q.z - p.z);
  c.globalCompositeOperation = "source-over";
  c.lineJoin = "round"; c.lineCap = "round";
  for (const q of quads) {
    const near = dn(q.z / 0.9), v = cl(0.08 + 0.62 * q.shade * q.shade + 0.2 * near + 0.4 * q.glow);
    const fill = ramp(S, v);
    c.beginPath(); c.moveTo(q.a[0], q.a[1]); c.lineTo(q.b[0], q.b[1]); c.lineTo(q.d[0], q.d[1]); c.lineTo(q.e[0], q.e[1]); c.closePath();
    c.fillStyle = rgba(fill, 0.94); c.fill();
    c.strokeStyle = rgba(fill, 0.94); c.lineWidth = 0.6; c.stroke();
    const edge = ramp(S, cl(0.55 + 0.45 * near + 0.3 * q.glow));
    c.strokeStyle = rgba(edge, 0.5 + 0.5 * near); c.lineWidth = S.tier === "full" ? S.lw * 1.2 : 0.9;
    c.beginPath(); c.moveTo(q.a[0], q.a[1]); c.lineTo(q.e[0], q.e[1]); c.moveTo(q.b[0], q.b[1]); c.lineTo(q.d[0], q.d[1]); c.stroke();
  }
  c.globalCompositeOperation = S.comp;
  if (S.tier === "tiny") return;
  const head = pj(at(sweep, 0), RR);
  dot(c, S, head[0], head[1], S.lw * 1.5, S.P[2], 0.95);
};

const PHI = (1 + Math.sqrt(5)) / 2;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function edgesOf(V: readonly Vec3[]): [number, number][] {
  let m = Infinity;
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) m = Math.min(m, dist(V[i]!, V[j]!));
  const out: [number, number][] = [];
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) if (dist(V[i]!, V[j]!) < m * 1.01) out.push([i, j]);
  return out;
}

interface Solid { V: Vec3[]; E: [number, number][]; radius: number }
function solid(V: Vec3[]): Solid {
  return { V, E: edgesOf(V), radius: Math.hypot(...V[0]!) };
}

const ICO: Vec3[] = [], DOD: Vec3[] = [], CUBE: Vec3[] = [];
for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
  ICO.push([0, a, b * PHI], [a, b * PHI, 0], [a * PHI, 0, b]);
  DOD.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI]);
}
for (let i = 0; i < 8; i++) CUBE.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
DOD.push(...CUBE);
const OCT: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export const POLY_SOLIDS: readonly Solid[] = [solid(ICO), solid(DOD), solid(CUBE), solid(OCT)];
const POLY_SCALE: readonly (readonly [number, number])[] = [[1, 1], [1, 1], [1, 1], [2, PHI * PHI]];
export const POLY_HOLD = 0.6;

export interface PolyPart { solid: number; alpha: number; scale: number }

export function polyParts(phase: number): PolyPart[] {
  const count = POLY_SOLIDS.length, whole = Math.floor(phase), i = ((whole % count) + count) % count, j = (i + 1) % count;
  const f = cl((phase - whole - POLY_HOLD) / (1 - POLY_HOLD));
  const from = POLY_SOLIDS[i]!, to = POLY_SOLIDS[j]!;
  const fromScale = i === count - 1 ? POLY_SCALE[i]![0] + (POLY_SCALE[i]![1] - POLY_SCALE[i]![0]) * ss(f) : POLY_SCALE[i]![0];
  const toScale = POLY_SCALE[j]![0];
  const e = ss(f), unit = 1 / ((from.radius * fromScale) * (1 - e) + (to.radius * toScale) * e);
  if (f <= 0) return [{ solid: i, alpha: 1, scale: unit * fromScale }];
  return [
    { solid: i, alpha: 1 - ss((f - 0.3) / 0.7), scale: unit * fromScale },
    { solid: j, alpha: ss(f / 0.7), scale: unit * toScale },
  ];
}

const poly: FormDraw = (c, t, R, S) => {
  const ax = 0.5 + 0.2 * Math.sin(t * 0.23), ay = t * 0.4;
  for (const part of polyParts(t * 0.3)) {
    if (part.alpha <= 0.01) continue;
    const shape = POLY_SOLIDS[part.solid]!, bk = bucket(8);
    const Q = shape.V.map((v) => pj(rot(v[0] * part.scale, v[1] * part.scale, v[2] * part.scale, ax, ay), R * (S.tier === "full" ? 0.96 : 0.78)));
    for (const [i, j] of shape.E) {
      const a = Q[i]!, b = Q[j]!;
      bk.seg((0.14 + 0.8 * dn((a[2] + b[2]) / 1.6)) * part.alpha, a[0], a[1], b[0], b[1]);
    }
    bk.draw(c, S, S.lw * (S.tier === "full" ? 1.2 : 1.1) * (0.5 + 0.5 * part.alpha));
    if (S.tier === "tiny") continue;
    for (const p of Q) dot(c, S, p[0], p[1], S.lw * 1.05 * p[3], ramp(S, 0.5 + 0.5 * dn(p[2])), 0.5 * part.alpha * (0.35 + 0.65 * dn(p[2])));
  }
};

const LORENZ_STEPS = 9000;
const LORENZ = (() => {
  const out = new Float32Array(LORENZ_STEPS * 3);
  let x = 1, y = 1, z = 20;
  const h = 0.004;
  for (let i = -800; i < LORENZ_STEPS; i++) {
    const dx = 10 * (y - x), dy = x * (28 - z) - y, dz = x * y - (8 / 3) * z;
    x += h * dx; y += h * dy; z += h * dz;
    if (i >= 0) { out[i * 3] = x / 21; out[i * 3 + 1] = -(z - 25) / 21; out[i * 3 + 2] = y / 21; }
  }
  return out;
})();

const attractor: FormDraw = (c, t, R, S) => {
  const L = S.tier === "full" ? 3200 : S.tier === "small" ? 1300 : 620, stride = S.tier === "full" ? 1 : S.tier === "small" ? 3 : 5;
  const span = LORENZ_STEPS - 3200 - 1, travelled = t * 420, lap = travelled % span, start = Math.floor(lap) + 3200 - L;
  const fade = Math.min(1, lap / 240, (span - lap) / 240);
  const ax = 0.18 + 0.1 * Math.sin(t * 0.2), ay = 0.75 * Math.sin(t * 0.22), bk = bucket(9);
  let pv: Point | null = null;
  for (let i = 0; i <= L; i += stride) {
    const k = (start + i) * 3;
    const p = pj(rot(LORENZ[k]!, LORENZ[k + 1]!, LORENZ[k + 2]!, ax, ay), R * (S.tier === "full" ? 1.05 : 0.79));
    if (pv) {
      const a = i / L;
      bk.seg((S.tier === "full" ? 0.08 + 0.5 * a + 0.35 * a * a * dn(p[2]) : 0.25 + 0.75 * a) * fade, pv[0], pv[1], p[0], p[1]);
    }
    pv = p;
  }
  bk.draw(c, S, S.lw * (S.tier === "full" ? 0.85 : S.tier === "small" ? 0.9 : 1));
  if (pv) dot(c, S, pv[0], pv[1], S.lw * (S.tier === "tiny" ? 1.1 : 1.5), S.P[2], fade);
};

const KLEIN = (() => {
  const NU = 48, NV = 32, G: Vec3[][] = [];
  for (let i = 0; i <= NU; i++) {
    const u = (i / NU) * Math.PI, row: Vec3[] = [], cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * TAU, cv = Math.cos(v), sv = Math.sin(v);
      row.push([
        (-2 / 15) * cu * (3 * cv - 30 * su + 90 * cu ** 4 * su - 60 * cu ** 6 * su + 5 * cu * cv * su),
        (-1 / 15) * su * (3 * cv - 3 * cu * cu * cv - 48 * cu ** 4 * cv + 48 * cu ** 6 * cv - 60 * su + 5 * cu * cv * su - 5 * cu ** 3 * cv * su - 80 * cu ** 5 * cv * su + 80 * cu ** 7 * cv * su),
        (2 / 15) * (3 + 5 * cu * su) * sv,
      ]);
    }
    G.push(row);
  }
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const row of G) for (const p of row) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k]!, p[k]!); mx[k] = Math.max(mx[k]!, p[k]!); }
  const ct = mn.map((v, k) => (v + mx[k]!) / 2), sc = 2 / Math.max(...mx.map((v, k) => v - mn[k]!));
  return G.map((row) => row.map((p): Vec3 => [(p[0] - ct[0]!) * sc, (p[1] - ct[1]!) * sc, (p[2] - ct[2]!) * sc]));
})();

export const KLEIN_GLYPH = { body: [-0.16, 0.36, 0.6], mouth: [-0.16, 0.96, 0.2], top: [-0.16, -0.24], rise: -0.66, over: 0.8, enter: [0.4, 0.5] } as const;

const kleinGlyph: FormDraw = (c, t, R, S) => {
  const K = KLEIN_GLYPH, turn = Math.cos(t * 0.32), side = (turn < 0 ? -1 : 1) * (0.55 + 0.45 * Math.abs(turn)), rock = 0.16 * Math.sin(t * 0.19);
  const near = ramp(S, 0.9), far = ramp(S, 0.35), lw = S.lw * 1.35;
  const X = (x: number) => x * R * side, Y = (y: number) => (y - 0.08) * R;
  c.save();
  c.rotate(rock);
  c.lineCap = "round"; c.lineJoin = "round";
  c.strokeStyle = rgba(far, 0.85); c.lineWidth = lw * 0.8;
  c.beginPath(); c.moveTo(X(K.enter[0]), Y(K.enter[1]));
  c.quadraticCurveTo(X(0.1), Y(0.55), X(K.mouth[0]), Y(K.mouth[1] - 0.06)); c.stroke();
  c.strokeStyle = rgba(near, 1); c.lineWidth = lw;
  c.beginPath(); c.arc(X(K.body[0]), Y(K.body[1]), K.body[2] * R * Math.abs(side) * 0.5 + K.body[2] * R * 0.5, 0, TAU); c.stroke();
  c.beginPath(); c.moveTo(X(K.top[0]), Y(K.top[1]));
  c.lineTo(X(K.top[0]), Y(K.rise + 0.3));
  c.quadraticCurveTo(X(K.top[0]), Y(K.rise - 0.22), X((K.top[0] + K.over) / 2), Y(K.rise - 0.22));
  c.quadraticCurveTo(X(K.over), Y(K.rise - 0.22), X(K.over), Y(K.rise + 0.3));
  c.quadraticCurveTo(X(K.over), Y(K.enter[1] - 0.1), X(K.enter[0]), Y(K.enter[1])); c.stroke();
  c.fillStyle = rgba(ramp(S, 1), 1); c.beginPath(); c.arc(X(K.enter[0]), Y(K.enter[1]), lw * 0.85, 0, TAU); c.fill();
  c.restore();
};

const klein: FormDraw = (c, t, R, S) => {
  if (S.tier === "tiny") { kleinGlyph(c, t, R, S); return; }
  const ax = 0.35 * Math.sin(t * 0.19), ay = t * 0.32, bk = bucket(8);
  const su = S.tier === "full" ? 2 : S.tier === "small" ? 6 : 12, sv = S.tier === "full" ? 2 : S.tier === "small" ? 8 : 16, sp = S.tier === "full" ? 1 : 2;
  const Q = KLEIN.map((row) => row.map((p) => pj(rot(p[1], -p[0], p[2], ax, ay), R * (S.tier === "full" ? 1.12 : 1.06))));
  const depth = (a: Point, b: Point) => (S.tier === "full" ? 0.06 + 0.8 * dn((a[2] + b[2]) / 2) : 0.25 + 0.75 * dn((a[2] + b[2]) / 1.2));
  for (let i = 0; i < Q.length; i += su) for (let j = sp; j < Q[i]!.length; j += sp) { const a = Q[i]![j - sp]!, b = Q[i]![j]!; bk.seg(depth(a, b), a[0], a[1], b[0], b[1]); }
  for (let j = 0; j < Q[0]!.length - 1; j += sv) for (let i = sp; i < Q.length; i += sp) { const a = Q[i - sp]![j]!, b = Q[i]![j]!; bk.seg(depth(a, b), a[0], a[1], b[0], b[1]); }
  bk.draw(c, S, S.lw * (S.tier === "full" ? 0.75 : S.tier === "small" ? 0.8 : 0.85));
};

const FORMS: Record<BuiltinForm, FormDraw> = { orb, tesseract, knot, swarm, mobius, poly, attractor, klein };

export function isBuiltinForm(value: unknown): value is BuiltinForm {
  return typeof value === "string" && (BUILTIN_FORMS as readonly string[]).includes(value);
}

export function satelliteCount(workers: number, tier: Tier): number {
  return Math.max(1, Math.min(Math.round(workers) || 1, tier === "tiny" ? 3 : tier === "small" ? 4 : 6));
}

export function drawPresence(c: PresenceContext, frame: PresenceFrame): void {
  const s = frame.size, T = frame.clock, st = frame.state, needs = st === "needs", tier = tierOf(s), full = tier === "full";
  const P = needs ? (frame.light ? AMBER_LIGHT : AMBER) : frame.palette;
  const comp: GlobalCompositeOperation = frame.light ? "source-over" : "lighter";
  const pulse = Math.pow(0.5 + 0.5 * Math.sin(T * 3.4), 3);
  c.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, s, s);
  c.translate(s / 2, s / 2);
  c.globalCompositeOperation = comp;
  const room = st === "working" ? (full ? 0.9 : 0.8) : needs ? (full ? 1 : 0.84) : 1;
  const beat = st === "idle" ? 1 + 0.04 * Math.sin(T * 1.5) : st === "thinking" ? 1 + 0.035 * Math.sin(T * 7) : needs ? 1 + 0.06 * pulse : 1;
  const R = s * (full ? 0.34 : 0.4) * room * beat;
  const lw = full ? Math.max(0.8, s / 150) : tier === "small" ? 1 : 1.05;
  const S: Style = { P, lw, tier, light: frame.light, comp };
  FORMS[frame.form](c, frame.formTime, R, S);
  c.globalCompositeOperation = comp;

  if (st === "thinking") {
    c.globalCompositeOperation = "source-atop";
    const x = (((T * 0.9) % 1.5) - 0.75) * s * 1.5;
    const band = c.createLinearGradient(x - s * 0.22, -s * 0.12, x + s * 0.22, s * 0.12);
    const tint = frame.light ? mix(P[0], BLACK, 0.55) : WHITE;
    band.addColorStop(0, rgba(tint, 0)); band.addColorStop(0.5, rgba(tint, frame.light ? 0.9 : 0.75)); band.addColorStop(1, rgba(tint, 0));
    c.fillStyle = band; c.fillRect(-s / 2, -s / 2, s, s);
    c.globalCompositeOperation = comp;
    const flicker = 0.5 + 0.5 * Math.sin(T * 9);
    const glow = c.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
    glow.addColorStop(0, rgba(frame.light ? P[0] : mix(P[2], WHITE, 0.5), (frame.light ? 0.12 : 0.3) + (frame.light ? 0.14 : 0.25) * flicker)); glow.addColorStop(0.55, rgba(P[0], 0.1 + 0.1 * flicker)); glow.addColorStop(1, rgba(P[0], 0));
    if (frame.light) c.globalCompositeOperation = "destination-over";
    c.fillStyle = glow; c.beginPath(); c.arc(0, 0, R * 1.1, 0, TAU); c.fill();
    c.globalCompositeOperation = comp;
  }

  c.globalCompositeOperation = "destination-over";
  const haloStrength = needs ? (frame.light ? 0.3 : 0.5) + 0.35 * pulse : st === "thinking" ? (frame.light ? 0.5 : 0.34) : frame.light ? 0.12 : 0.2;
  const halo = c.createRadialGradient(0, 0, R * 0.2, 0, 0, s * 0.5);
  halo.addColorStop(0, rgba(P[0], haloStrength * 0.5)); halo.addColorStop(0.6, rgba(P[1], haloStrength * 0.16)); halo.addColorStop(1, rgba(P[1], 0));
  c.fillStyle = halo; c.fillRect(-s / 2, -s / 2, s, s);
  c.globalCompositeOperation = comp;

  if (st === "working") {
    const n = satelliteCount(frame.workers, tier);
    for (let k = 0; k < n; k++) {
      const tilt = full ? 0.35 + (k * TAU) / (n * 2) : 0, rx = s * (full ? 0.43 : 0.41), ry = full ? rx * (0.3 + 0.12 * k) : rx, speed = full ? 1.4 + 0.35 * k : 2.2;
      const tail = full ? 7 : 5, gap = full ? 0.08 : 0.2, size = full ? lw * 1.6 : tier === "small" ? 1.9 : 1.6;
      for (let j = tail; j >= 0; j--) {
        const a = T * speed + (k * TAU) / n - j * gap, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        const x = ex * Math.cos(tilt) - ey * Math.sin(tilt), y = ex * Math.sin(tilt) + ey * Math.cos(tilt), depth = full ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a)) : 1;
        if (j) { c.fillStyle = rgba(frame.light ? mix(P[0], BLACK, 0.25) : P[2], (1 - j / (tail + 1)) * (frame.light ? 0.75 : 0.45) * depth); c.beginPath(); c.arc(x, y, size * (1 - j * 0.12), 0, TAU); c.fill(); }
        else if (frame.light) {
          c.fillStyle = rgba(WHITE, 0.95 * depth); c.beginPath(); c.arc(x, y, size + 0.9, 0, TAU); c.fill();
          c.fillStyle = rgba(mix(P[0], BLACK, 0.35), depth); c.beginPath(); c.arc(x, y, size * 1.08, 0, TAU); c.fill();
        } else dot(c, S, x, y, size, P[2], depth);
      }
    }
  }

  if (needs) {
    const reach = full ? 0.42 : Math.max(0.12, (s * 0.485) / R - 1);
    for (let k = 0; k < 2; k++) {
      const ph = (T * 0.55 + k * 0.5) % 1;
      c.strokeStyle = rgba(P[0], (1 - ph) * (full ? 0.7 : 0.95)); c.lineWidth = Math.max(full ? 0 : 1.1, lw * 1.3 * (1 - ph * 0.5));
      c.beginPath(); c.arc(0, 0, R * (1 + ph * reach), 0, TAU); c.stroke();
    }
  }
}
