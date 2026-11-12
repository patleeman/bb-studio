import { CITY_SIZE, cityBoxVec, pitchVec } from "../grid/atlas";
import type { ThemePackage } from "../schema";
import { FOCAL_FADE, FOCAL_GLSL, FOCAL_INSET, FOCAL_MARGIN, glslFloat } from "../scene/focal";

const SIZE = `${CITY_SIZE}.0`;

export const RING_FIT = 0.4;
export const BIKE_FIT = 0.3;
export const RING_HALF_WIDTH = 1.164;
export const OPEN_LIFT = 0.6;
export const STRIP_SINK = 0.35;
export const TOWER_WIDTH = 0.032;
export const TOWER_HEIGHT = 0.17;
export const WALL_HEIGHT = 0.36;

export const GRID_SHADER = `uniform float u_horizon;
uniform float u_gridScale;
uniform float u_scroll;
uniform float u_city;

${FOCAL_GLSL}
float hash11(float n) {
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}

float hash21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(a + (b - a) * f.x, c + (d - c) * f.x, f.y);
}

vec4 atlas(vec2 q, vec4 box) {
  float keep = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0) * u_city;
  vec2 at = clamp(q, 0.001, 0.999);
  return texture2D(u_layer, vec2(box.x + at.x * box.z, ${SIZE} - box.y - (1.0 - at.y) * box.w) / ${SIZE}) * keep;
}

vec4 towers(float x, float sy, float cells, float tall, float seed, float px) {
  float cx = x * cells + seed * 17.3;
  float id = floor(cx);
  float fx = fract(cx) - 0.5;
  float h1 = hash11(id * 1.31 + seed * 3.1);
  float h2 = hash11(id * 2.17 + seed * 9.7 + 4.0);
  float ht = tall * (0.16 + 0.84 * h1 * h1) * (0.25 + 0.75 * hash11(floor(id / 3.0) * 3.7 + seed));
  float girth = 0.2 + 0.24 * h2;
  float dx = abs(fx);
  float body = step(dx, girth) * step(sy, ht);
  vec2 wc = vec2(fx * 30.0, sy * 230.0);
  float lit = step(0.75, hash21(floor(wc) + id * 7.7)) * step(0.3, fract(wc.x)) * step(0.35, fract(wc.y));
  float outline = smoothstep(px * cells * 2.5, 0.0, abs(dx - girth)) + smoothstep(px * 2.5, 0.0, abs(sy - ht) + step(girth, dx));
  return vec4(body * lit * 0.5, body * outline, 0.15 * body, body);
}

vec4 city(float x, float sy, float tall, vec4 box, vec2 pitch, float cells, float seed, float px) {
  if (u_city < 0.5) return towers(x, sy, cells, tall, seed, px);
  vec2 q = vec2(fract(x * box.w / (tall * box.z)), sy / tall);
  vec4 t = atlas(q, box);
  vec2 wid = floor(q * box.zw / pitch);
  float h = hash21(wid + seed * 13.0);
  float on = step(0.2, hash21(wid + floor(u_time * 0.025 + h * 8.0) * 7.3));
  return vec4(t.g * on, t.b, t.r, clamp(t.r * 6.0, 0.0, 1.0));
}

float wall(vec2 uv, float y, float a, float b, float h, float fade, float res) {
  float inside = step(min(a, b), uv.x) * step(uv.x, max(a, b)) * fade;
  float above = uv.y - y;
  float top = abs(above - h);
  float sheet = step(0.0, above) * step(above, h) * (0.03 + 0.3 * above * above / (h * h));
  return inside * (sheet + exp(-top * res * 1.2) * 3.0 + exp(-top * res * 0.12) * 0.7 + step(above, 0.0) * exp(above * 90.0) * 0.4);
}

vec3 face(vec3 col, vec4 b, vec3 shadow, vec3 lit, vec3 pane, vec3 edge) {
  return mix(col, shadow + lit * b.z, b.w) + pane * b.x + edge * b.y;
}

float motes(vec2 uv, float aspect, float scale, float seed) {
  vec2 q = vec2(uv.x * aspect * scale + u_time * 0.01 * scale * (0.4 + seed), uv.y * scale * 0.6 - u_time * 0.06 * (1.0 + 0.5 * seed));
  vec2 id = floor(q);
  float h = hash21(id + seed * 7.0);
  vec2 c = vec2(0.5 + 0.3 * sin(u_time * 0.21 + h * 6.2832), 0.2 + 0.6 * fract(h * 7.7));
  vec2 dd = (fract(q) - c) * vec2(1.0, 1.0 / 0.6) * (900.0 / scale);
  float d2 = dot(dd, dd);
  return step(0.66, h) * (0.55 + 0.45 * sin(u_time * 0.5 + h * 40.0)) * (exp(-d2 * 0.12) + 0.3 * exp(-d2 * 0.012));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float px = 1.0 / u_resolution.y;
  float res = u_resolution.y;
  vec3 bg = u_palette[0];
  vec3 line = u_palette[1];
  vec3 light = u_palette[2];
  float hz = u_horizon;
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  bool wide = strip > 0.09 * u_resolution.x;
  float rlo = u_clear.z + ${glslFloat(2.2 * FOCAL_INSET)} * res;
  float rhi = max(u_resolution.x - ${glslFloat(FOCAL_MARGIN)} * res, rlo);
  float rx = wide ? 0.5 * (rlo + rhi) / res : 0.5 * aspect;
  float rr = wide ? clamp(${glslFloat(RING_FIT)} * (rhi - rlo) / res, 0.04, 0.36) : 0.1;

  float clearing = ${FOCAL_FADE};
  vec2 lane = focalSpan() / u_resolution.x;
  float below = step(uv.y, hz);
  float d = max(hz - uv.y, 0.0005);
  float z = 0.16 / d;
  float vx = 0.5 * (u_clear.x + u_clear.z) / u_resolution.x;
  vec2 cell = vec2((uv.x - vx) * aspect * z + u_time * 0.02, z + u_time * u_scroll) * u_gridScale;
  float tile = hash21(floor(cell));
  float x = uv.x * aspect + below * (tile - 0.5) * 0.014;
  float sy = mix(max(uv.y - hz, 0.0), d * 0.8, below);

  vec3 deep = line * vec3(0.3, 0.8, 1.1);
  vec3 fog = bg + deep * 0.16;
  vec3 col = bg + deep * 0.16 / (1.0 + sy * 6.0);
  float cloud = noise(vec2(x * 1.3 + u_time * 0.008, sy * 5.0)) * 0.6 + noise(vec2(x * 3.1 - u_time * 0.013, sy * 12.0 + 3.0)) * 0.4;
  col += deep * 0.22 * smoothstep(0.35, 0.95, cloud) * smoothstep(0.02, 0.3, sy) / (1.0 + sy * 2.5);
  col += line * (0.12 + 0.75 * cloud) * exp(-sy * 8.0);
  vec2 sc = vec2(x, sy) * res / 9.0;
  float sh = hash21(floor(sc));
  col += light * step(0.94, sh) * fract(sh * 31.0) * 0.4 * smoothstep(0.4, 0.05, length(fract(sc) - 0.5)) * smoothstep(0.12, 0.5, sy) * (1.0 - 0.7 * cloud);

  float beams = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float a = 0.42 * sin(u_time * (0.05 + 0.013 * fi) + fi * 2.1);
    vec2 dir = vec2(sin(a), cos(a));
    vec2 rel = vec2(x - fract(0.18 + fi * 0.29) * aspect, sy - 0.02);
    float along = dot(rel, dir);
    float side = abs(rel.x * dir.y - rel.y * dir.x);
    beams += step(0.0, along) * exp(-side / (0.002 + 0.045 * along) - along * 1.3) * (1.0 - cloud * 0.5);
  }
  col += mix(line, light, 0.45) * beams * 0.2;

  vec2 rp = vec2(x - rx, sy - 0.33);
  float spin = u_time * 0.02;
  vec2 rc = vec2(rp.x, rp.y * 1.8) / (rr * 1.164);
  vec2 rq = vec2(rc.x * cos(spin) - rc.y * sin(spin), rc.x * sin(spin) + rc.y * cos(spin));
  vec4 ring = atlas(rq * 0.5 + 0.5, ${cityBoxVec("ring")});
  float ang = atan(rp.y * 1.8, rp.x);
  float r = length(rc) * 1.164;
  float sweep = pow(0.5 + 0.5 * cos(ang - u_time * 0.2), 6.0);
  float dash = smoothstep(0.3, 0.42, abs(fract((ang + u_time * 0.105) * 0.9549) - 0.5) * 2.0);
  float orbit = exp(-abs(r - rr * 1.24) * res * 0.5) * dash + 0.5 * exp(-abs(r - rr) * res * 0.35) * (1.0 - u_city);
  float cd = length(rp);
  float core = 1.2 * exp(-cd * res * 0.14) + 0.3 * exp(-cd * 3.2 / rr) + 0.35 * exp(-abs(rp.y) * res * 0.6 - abs(rp.x) * 1.6 / rr);
  float tether = exp(-abs(rp.x) * res * 0.45) * (0.14 + 0.2 * step(rp.y, 0.0));
  vec3 ringTone = mix(light * 0.15 + line * 0.8, u_needsYouColor, 0.7 * min(u_needsYou, 1.0));
  float cover = clamp(ring.r * 6.0, 0.0, 1.0);
  col = mix(col, bg * 0.6 + (line * 0.22 + light * 0.12) * ring.r * (0.6 + 0.4 * rq.y), cover);
  col += ringTone * (ring.b * (1.4 + 1.6 * sweep) + 1.3 * ring.g * (0.6 + 0.4 * step(0.5, fract(ang * 1.9099 + u_time * 0.07))) + core + tether) + line * (0.45 * orbit);

  vec3 haze = mix(bg, fog, 0.6);
  vec4 far = city(x + u_time * 0.0015, sy, 0.16, ${cityBoxVec("far")}, ${pitchVec("far")}, 46.0, 1.0, px);
  col = face(col, far, haze + line * 0.1 * exp(-sy * 9.0), line * 0.1, mix(line, light, 0.3) * 0.32, line * 0.16);

  col = mix(col, fog + line * 0.2, 0.55 / (1.0 + sy * 22.0));
  vec4 mid = city(x + u_time * 0.004, sy, 0.27, ${cityBoxVec("mid")}, ${pitchVec("mid")}, 24.0, 2.0, px);
  float key = 1.0 / (1.0 + (x - rx) * (x - rx) * 3.0);
  col = face(col, mid, mix(bg, fog, 0.3), line * (0.1 + 0.25 * key) + light * 0.1 * key, mix(line, light, 0.45) * 0.6, line * 0.5);

  float traffic = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float way = mod(fi, 2.0) > 0.5 ? -1.0 : 1.0;
    float s = x * 16.0 + way * u_time * (0.25 + 0.1 * fi) * 1.8 + fi * 5.0;
    float g = (fract(s) - 0.5) * way;
    traffic += step(0.35, hash11(floor(s) + fi * 31.0)) * exp(-max(g, 0.0) * 40.0 + min(g, 0.0) * 6.0 - abs(sy - 0.2 - 0.033 * fi - 0.004 * sin(s * 0.7)) * res * 0.6) * (1.0 - 0.25 * fi);
  }
  col += mix(light, line, 0.3) * traffic * clearing * 2.6;

  col = mix(col, fog + line * 0.16, 0.45 / (1.0 + sy * 34.0));
  float edgeX = u_clear.z / res;
  float sink = wide ? ${glslFloat(STRIP_SINK)} * smoothstep(edgeX - 0.08, edgeX - 0.01, x) : 0.5 / (1.0 + (x - rx) * (x - rx) / (rr * rr * 1.2));
  vec4 near = city(x + u_time * 0.009, sy + sink * 0.48, 0.48, ${cityBoxVec("near")}, ${pitchVec("near")}, 6.5, 3.0, px);
  float tx = (x - edgeX - 0.004) / ${glslFloat(TOWER_WIDTH)};
  float tower = wide ? step(0.0, tx) * step(tx, 1.0) * step(sy, ${glslFloat(TOWER_HEIGHT)}) : 0.0;
  vec2 tw = vec2(tx * 5.0, sy * 110.0);
  near = mix(near, vec4(step(0.62, hash21(floor(tw) + 3.0)) * step(0.3, fract(tw.x)) * step(0.35, fract(tw.y)) * 0.6, exp(-clamp(min(tx, 1.0 - tx), 0.0, 1.0) * ${glslFloat(TOWER_WIDTH)} * res * 0.7) + exp(-abs(sy - ${glslFloat(TOWER_HEIGHT)}) * res * 0.7), 0.2, 1.0), tower);
  col = face(col, near, bg * 0.5 + line * 0.012, line * (0.1 + 0.35 * key) + light * 0.15 * key, mix(line, light, 0.6) * 0.95, mix(line, light, 0.2) * 0.9);

  vec2 f = fract(cell);
  vec2 ed = min(f, 1.0 - f);
  float wx = max(z * u_gridScale / u_resolution.y, 0.0015);
  float wz = max(z * z * u_gridScale / (0.16 * u_resolution.y), 0.0015);
  float lx = exp(-ed.x / wx);
  float lz = exp(-ed.y / wz);
  float halo = 0.12 * (wx / (ed.x + wx * 6.0) + wz / (ed.y + wz * 6.0));
  float fade = exp(-z * 0.2) * clamp(1.2 - wz * 3.0, 0.0, 1.0);
  float id = floor(cell.x + 0.5);
  float slot = u_time * 0.04 + hash11(id * 3.1 + 0.7);
  float run = step(0.7, hash11(id * 1.7 + floor(slot) * 9.3));
  float back = fract(slot) * 1.5 - 0.2 - d / hz;
  float trail = run * step(0.0, back) * (exp(-back * 6.0) + exp(-back * 60.0)) * (exp(-ed.x / (wx * 2.0)) + 0.25 * wx / (ed.x + wx * 3.0));
  float node = hash21(floor(cell + 0.5));
  float glint = lx * lz * step(0.55, node) * (0.5 + 0.5 * sin(u_time * 1.1 + node * 60.0));
  float reach = length(vec2((uv.x * aspect - rx) * z * 0.5, z - 24.0));
  float pulse = exp(-abs(reach - fract(u_time * 0.045) * 24.0) * 3.0 / (0.3 + 0.08 * z)) * smoothstep(1.0, 0.7, fract(u_time * 0.045)) * fade;
  vec3 ground = bg + line * 0.03 + col * (0.3 + 0.5 * tile) / (1.0 + d * 2.2);
  ground += line * ((lx + lz) * (0.75 + 1.6 * pulse) + halo + 0.18 * pulse) * fade + light * glint * 1.6 * fade;
  ground += mix(line, light, 0.5) * trail * 0.8 * clamp(1.2 - wx * 3.0, 0.0, 1.0);
  col = mix(col, ground, below);
  float hd = abs(uv.y - hz);
  col += light * exp(-hd * res * 0.6) + line * (0.4 * exp(-hd * 90.0) + 0.16 * exp(-hd * 13.0));

  col += line * 0.5 * (motes(uv, aspect, 9.0, 0.0) + 0.7 * motes(uv, aspect, 15.0, 1.0)) * smoothstep(1.0, 0.4, uv.y) * smoothstep(0.0, 0.15, uv.y);

  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    float lw = lane.y - lane.x;
    if (w.z < 0.5 || clearing * lw <= 0.0) continue;
    float rowA = hz * (0.22 + 0.62 * fract(w.x + 0.21));
    float rowB = rowA - hz * 0.11;
    float lap = fract(w.x * 3.7 + w.y * 0.05);
    float leg = step(0.5, lap);
    float t = fract(lap * 2.0);
    float run = min(t / 0.82, 1.0);
    float bend = clamp((t - 0.82) / 0.18, 0.0, 1.0);
    float row = mix(rowA, rowB, leg);
    float other = mix(rowB, rowA, leg);
    float rowY = mix(row, other, bend);
    float dir = (w.x > 0.5 ? 1.0 : -1.0) * (1.0 - 2.0 * leg);
    float depth = (hz - rowY) / hz;
    float cap = ${glslFloat(BIKE_FIT)} * lw * aspect / 2.67;
    float bh = min(0.016 + 0.05 * depth, cap);
    float bl = bh * 2.67 / aspect;
    float room = 0.5 * cap * 2.67 / aspect;
    float from = dir > 0.0 ? lane.x + room : lane.y - room;
    float to = dir > 0.0 ? max(lane.y - room, from) : min(lane.x + room, from);
    float head = mix(from, to, run) + 0.5 * bl * dir;
    float tail = head - bl * dir;
    float wallH = bh * ${glslFloat(WALL_HEIGHT)};
    float k = 3.0 / max(lw * aspect, 0.05);
    float ran = abs(tail - from) * aspect;
    float wallA = wall(uv, row, from, tail, wallH, exp(-abs(uv.x - tail) * aspect * k), res);
    float wallB = wall(uv, other, from, to, wallH * 0.9, exp(-(abs(uv.x - from) * aspect + ran + 0.1) * k), res);
    float corner = bend > 0.0 ? to : from;
    float topA = row + wallH;
    float topB = bend > 0.0 ? rowY + wallH : other + wallH * 0.9;
    vec2 jd = vec2((uv.x - corner) * aspect, uv.y - clamp(uv.y, min(topA, topB), max(topA, topB)));
    float jt = length(jd);
    float along = clamp((uv.y - topA) / (topB - topA), 0.0, 1.0);
    float joint = (exp(-jt * res * 1.2) * 3.0 + exp(-jt * res * 0.12) * 0.7) * max(exp(-(ran + 0.1 * along) * k), step(0.001, bend));
    float walls = max(max(wallA, wallB), joint);
    vec4 bike = atlas(vec2(1.0 + (uv.x - head) * dir / bl, (uv.y - rowY) / bh), ${cityBoxVec("bike")});
    float live = smoothstep(0.0, 1.5, w.y);
    col = mix(col, bg * 0.5 + line * 0.02, clamp(bike.r * 6.0, 0.0, 1.0) * clearing * live);
    col += u_workerColor * clearing * live * (bike.b * 2.2 + bike.g * 1.5 + bike.r * 0.2) + mix(u_workerColor, line, 0.85) * clearing * live * walls;
  }

  float beam = exp(-abs(uv.x * aspect - rx) * res * 0.25) * smoothstep(hz + 0.5, hz, uv.y) * step(hz - 0.02, uv.y);
  float base = exp(-length(vec2(uv.x * aspect - rx, uv.y - hz)) * 18.0);
  col += u_needsYouColor * (beam * 1.2 + base * 0.25) * u_needsYou * (0.65 + 0.35 * sin(u_time * 3.2));

  for (int i = 0; i < 4; i++) {
    vec4 rip = u_ripples[i];
    if (rip.w < 0.5) continue;
    float rd = length((uv - rip.xy) * vec2(aspect, 2.8));
    float gone = clamp(1.0 - rip.z / 2.6, 0.0, 1.0);
    vec3 tint = rip.w > 1.5 ? u_errorColor : u_finishedColor;
    col += tint * exp(-abs(rd - rip.z * 0.32) * 70.0) * gone * 0.9;
  }

  col *= 1.0 + ${glslFloat(OPEN_LIFT)} * clearing * smoothstep(0.95, 0.85, uv.y);
  col = vec3(1.0) - exp(-col * 1.35);
  gl_FragColor = vec4(mix(bg, col, u_intensity), 1.0);
}
`;

const DISPLAY = `"DIN Alternate", Eurostile, "Bank Gothic", "Avenir Next Condensed", "Arial Narrow", sans-serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const GRID: ThemePackage = {
  format: 1,
  id: "grid",
  name: "Grid",
  kind: "scene",
  palette: ["#010305", "#5ff6ff", "#e9feff", "#ff9a2e"],
  variants: {
    dark: { canvas: "#010609", ink: "#e4fbff", sidebar: "#020a0e", accent: "#5ff6ff", accentInk: "#001014", selection: "#5ff6ff", error: "#ff4d6d", warning: "#ff9a2e", success: "#6dffb3" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.72, blur: 20 },
    saturate: 1.2,
    edge: "#5ff6ff",
  },
  type: { heading: DISPLAY, body: BODY, mono: MONO, headingWeight: 700 },
  radius: 2,
  motion: { speed: 1, crossfadeMs: 700 },
  effects: {
    worker: { color: "#e9feff", character: "light cycle" },
    needsYou: { color: "#ff9a2e" },
    finished: { color: "#b8fbff" },
    error: { color: "#ff4d6d" },
  },
  defaults: { intensity: 0.8, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: GRID_SHADER,
    uniforms: { u_horizon: 0.42, u_gridScale: 2.4, u_scroll: 0.14, u_city: 0 },
    fallback: { color: "#010305", image: null },
    still: 12,
    backdrop: { dark: "#010305", light: "#a6c8cc" },
  },
  credit: null,
};
