import { boxVec, LURE, REEF_BOXES, REEF_SIZE } from "../deep-sea/atlas";
import type { ThemePackage } from "../schema";
import { FOCAL_FADE, FOCAL_GLSL, glslFloat } from "../scene/focal";

const SIZE = `${REEF_SIZE}.0`;
const NOISE = REEF_BOXES.noise;
const NOISE_AT = `vec2(${NOISE.x}.5, ${REEF_SIZE - NOISE.y - NOISE.height}.5)`;
const NOISE_SPAN = `${NOISE.width - 1}.0`;
export const WHALE_FIT = 0.95;
export const JELLY_FIT = 0.17;
export const OPEN_LIFT = 0.55;

const LURE_AT = `vec2(${(LURE.x / REEF_BOXES.angler.width).toFixed(4)}, ${(1 - LURE.y / REEF_BOXES.angler.height).toFixed(4)})`;

export const DEEP_SEA_SHADER = `uniform float u_reef;
uniform float u_rays;
uniform float u_snow;

${FOCAL_GLSL}
float hash21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float tri(float x) {
  return abs(fract(x) - 0.5) * 2.0;
}

vec3 grain(vec2 q) {
  if (u_reef < 0.5) return vec3(0.4 + 0.18 * sin(6.2832 * (q.x + 0.35 * sin(6.2832 * q.y))), 0.5 + 0.2 * sin(6.2832 * (q.y * 2.0 - q.x)), 0.06);
  return texture2D(u_layer, (${NOISE_AT} + fract(q) * ${NOISE_SPAN}) / ${SIZE}).rgb;
}

vec4 sprite(vec2 q, vec4 box) {
  float keep = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0) * u_reef;
  vec2 at = clamp(q, 0.004, 0.996);
  return texture2D(u_layer, vec2(box.x + at.x * box.z, ${SIZE} - box.y - (1.0 - at.y) * box.w) / ${SIZE}) * keep;
}

vec4 reef(vec2 st, vec4 box) {
  return sprite(vec2(1.0 - abs(1.0 - mod(st.x, 2.0)), st.y), box);
}

float snow(vec2 p, float scale, float seed, float soft) {
  vec2 q = vec2(p.x * scale + 0.4 * sin(u_time * 0.12 + seed * 2.0), (p.y + u_time * 0.0035 * (1.0 + seed)) * scale);
  float h = hash21(floor(q) + seed * 19.0);
  vec2 c = vec2(0.5 + 0.3 * sin(u_time * 0.23 + h * 6.2832), 0.25 + 0.5 * fract(h * 7.7));
  vec2 dd = (fract(q) - c) * (u_resolution.y / scale) / soft;
  float d2 = dot(dd, dd);
  return step(0.45, h) * (0.55 + 0.45 * sin(u_time * 0.4 + h * 40.0)) / (1.0 + d2 * d2 * 0.08);
}

float school(vec2 rel, vec2 head, vec2 reach, float scale, float seed) {
  vec2 cell = rel * scale;
  cell.x += fract(floor(cell.y) * 0.618);
  float h = hash21(floor(cell) + seed);
  vec2 f = fract(cell) - 0.5 - (vec2(h, fract(h * 7.3)) - 0.5) * 0.6;
  f.y += 0.05 * sin(u_time * 1.1 + h * 40.0);
  vec2 b = vec2(dot(f, head), f.x * head.y - f.y * head.x);
  float len = 0.17 + 0.07 * fract(h * 3.1);
  float body = smoothstep(1.0, 0.6, length(vec2(b.x / len, b.y / (len * 0.3))));
  float fin = step(-1.7 * len, b.x) * step(b.x, -0.75 * len) * smoothstep(0.02, 0.0, abs(b.y) + 0.5 * (b.x + 0.75 * len));
  return (body + fin) * step(0.28, h) * smoothstep(1.0, 0.55, length(rel / reach));
}

vec4 jelly(vec2 q, float beat, float lean, float px, float seed) {
  float w = 1.0 - 0.2 * beat;
  float hgt = 0.82 + 0.18 * beat;
  float yy = max(q.y, 0.0) / hgt;
  float ex = q.x / (w * (1.0 + min(q.y, 0.0) * 1.5 * beat));
  float e = length(vec2(ex, yy));
  float lip = -0.16 - 0.05 * tri(ex * 3.5 + 0.5);
  float inside = smoothstep(1.0, 1.0 - 3.0 * px, e) * smoothstep(lip - px, lip + px, q.y);
  float s = clamp(ex / sqrt(max(1.0 - yy * yy, 0.03)), -1.0, 1.0);
  float phi = s * (1.0 + 0.45 * s * s);
  float canal = smoothstep(0.2, 0.03, tri(phi * 2.76 + 0.5));
  float rim = smoothstep(0.55, 1.0, e);
  float veil = (0.12 + 0.62 * rim * rim * rim + 0.2 * canal * (1.0 - 0.6 * yy) + 0.1 * smoothstep(0.2, 1.0, yy + 0.5 * ex)) * inside;
  vec2 g = vec2(q.x / (0.46 * w), (q.y - 0.3 * hgt) / 0.13);
  float loop = smoothstep(0.45, 0.0, abs(length(g) - 1.0)) * (0.35 + 0.65 * smoothstep(0.3, 0.9, tri(g.x * 1.5 + 0.25))) * step(0.0, g.y + 0.35) * inside;
  float core = smoothstep(0.75, 0.0, length(vec2(q.x / w, (q.y - 0.3 * hgt) / (0.62 * hgt)))) * inside;
  float beads = smoothstep(0.07, 0.0, abs(q.y - lip - 0.035)) * smoothstep(0.55, 0.1, tri(ex * 7.0)) * step(abs(ex), 0.98);
  float drop = max(lip - q.y, 0.0);
  float under = step(q.y, lip);
  float wave = sin(q.y * 5.5 + u_time * 1.4 + seed * 40.0 + q.x * 3.0);
  float xa = q.x + lean * drop * drop + 0.07 * wave * drop;
  float ca = xa * 4.6 / w;
  float frill = 0.5 + 0.3 * tri(q.y * 4.0 + floor(ca) * 0.37);
  float arms = smoothstep(frill, frill - 0.3, tri(ca)) * step(abs(xa), 0.43 * w) * smoothstep(1.9, 0.2, drop) * under;
  float xt = q.x + 2.2 * lean * drop * drop + 0.1 * sin(q.y * 3.7 - u_time * 1.1 + seed * 9.0 + q.x * 6.0) * drop;
  float ct = xt * 5.5 / w;
  float reach = 1.5 + 2.0 * fract(floor(ct) * 0.618 + seed);
  float thin = 11.0 * px / w;
  float tent = smoothstep(thin * 1.6, thin * 0.4, tri(ct)) * step(abs(xt), 0.96 * w) * clamp(1.0 - drop / reach, 0.0, 1.0) * under;
  return vec4(veil + 0.22 * loop, core * 0.55 + beads + 0.3 * loop, 0.55 * arms + 0.5 * tent, inside);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float res = u_resolution.y;
  float aspect = u_resolution.x / res;
  float px = 1.0 / res;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  float focus = (strip > 0.09 * u_resolution.x ? (u_clear.z + 0.5 * strip) / u_resolution.x : 0.86) * aspect;
  float clearing = ${FOCAL_FADE};
  float o0 = u_open.x / res;
  float ow = (u_open.z - u_open.x) / res;
  vec2 span = focalSpan() / res;
  float f0 = span.x;
  float fw = span.y - span.x;
  float sway = sin(u_time * 0.11);
  vec3 deep = u_palette[0];
  vec3 teal = u_palette[1];
  vec3 pale = u_palette[2];

  vec2 sun = vec2(focus + 0.04, 1.3);
  vec2 dl = p - sun;
  float far = length(dl);
  vec2 toSun = -dl / far;
  float fall = dl.x / -dl.y;
  vec3 g1 = grain(vec2(fall * 0.55 + u_time * 0.004, 0.2 + u_time * 0.0017));
  vec3 g2 = grain(vec2(fall * 1.7 - u_time * 0.007, 0.63));
  vec3 g3 = grain(vec2(fall * 4.6 + u_time * 0.011, 0.37));
  float shaft = smoothstep(0.36, 0.7, g1.r) * (0.3 + 0.9 * g2.g) + 0.5 * smoothstep(0.5, 0.78, g3.g) * g1.r;
  float cone = 1.0 / (1.0 + fall * fall * 2.4);
  float rays = u_rays * shaft * cone * exp(-far * 1.1) * 2.4;

  vec3 water = mix(deep * 0.4, deep + teal * 0.26, exp(-(1.0 - uv.y) * 2.6));
  water += teal * 0.4 * cone * exp(-far * 1.7);
  vec3 col = water;

  float ys = 0.76;
  float sz = 0.1 / max(uv.y - ys, 0.002);
  vec2 sp = vec2((p.x - focus - 0.04) * sz * 5.5, sz);
  vec3 r1 = grain(sp * vec2(0.55, 1.4) + vec2(u_time * 0.011, u_time * 0.02));
  vec3 r2 = grain(sp * vec2(1.3, 3.1) + vec2(0.4 - u_time * 0.017, u_time * 0.013));
  float chop = r1.g + 0.5 * r2.g - 0.75;
  float web = r1.b * 0.7 + r2.b * 0.6;
  float rw = length(sp) + chop * 0.22;
  float win = smoothstep(0.68, 0.52, rw);
  float seen = smoothstep(ys, ys + 0.1, uv.y);
  vec3 daylight = mix(teal * 0.75 + pale * 0.2, pale, smoothstep(0.55, 0.05, rw)) * (0.5 + 0.55 * web + 0.5 * chop);
  vec3 mirror = deep * 0.6 + teal * (0.05 + 0.34 * web * web + 0.12 * chop);
  col = mix(col, mix(mirror, daylight, win), seen * (0.5 + 0.5 * win));
  col += pale * 0.3 * smoothstep(0.1, 0.0, abs(rw - 0.62)) * seen;

  float turn = u_time / 96.0;
  float lap = fract(turn);
  float kind = step(0.5, fract(floor(turn) * 0.5));
  float go = lap / 0.62;
  float away = smoothstep(0.3, 1.0, go);
  vec2 size = mix(vec2(0.22, 0.092), vec2(0.17, 0.106), kind);
  size *= min(1.0, ${glslFloat(WHALE_FIT)} * fw / size.x) * (1.0 - 0.3 * away);
  vec2 wq = (p - vec2(mix(o0 + ow + 0.02, f0, go), 0.66 - 0.06 * away + 0.02 * sin(u_time * 0.13))) / size;
  wq.y += 0.5 + mix(0.07 * wq.x * sin(wq.x * 2.6 - u_time * 0.5), 0.5 * (wq.x - 0.5) * (wq.x - 0.5) * sin(u_time * 0.55), kind);
  vec4 big = sprite(wq, mix(${boxVec("whale")}, ${boxVec("manta")}, kind)) * step(lap, 0.62) * clearing * step(u_open.x + 1.0, u_open.z) * smoothstep(1.0, 0.75, go);
  col = col * (1.0 - 0.8 * big.a) + mix(big.rgb * (1.0 + 1.4 * rays), water * big.a, 0.2 + 0.45 * away) * 0.85;

  col += teal * rays * 0.5;
  col += pale * u_snow * snow(p + vec2(sway * 0.003, 0.0), 26.0, 0.0, 0.8) * (0.1 + 0.9 * rays);

  float bedx = p.x - focus;
  vec2 cq = vec2(bedx * 1.1 + uv.y * 0.7, uv.y * 3.2);
  float caustic = 3.0 * min(grain(cq + vec2(u_time * 0.013, u_time * 0.007)).b, grain(cq * 1.31 + vec2(0.5 - u_time * 0.011, u_time * 0.009)).b);
  float pool = exp(-bedx * bedx * 26.0) * smoothstep(0.55, 0.08, uv.y);
  float lamp = 0.3 + 0.7 * exp(-far * 0.7) + 0.5 * pool;
  vec3 lurePoint = vec3(focus + 0.02, 0.4 + 0.012 * sin(u_time * 0.5), 0.0);
  float ld = length(p - lurePoint.xy);
  float glowBeat = 0.62 + 0.38 * sin(u_time * 2.2);
  vec3 warm = u_needsYouColor * u_needsYou * glowBeat;

  vec4 fr = reef(vec2(0.3 + (bedx + sway * 0.004) / 3.3, (uv.y - 0.12) / 0.516), ${boxVec("far")});
  col = col * (1.0 - fr.a) + mix(fr.rgb * lamp * (0.6 + 1.8 * rays + 0.5 * caustic), water * fr.a, 0.58);

  float fh = (uv.y - 0.13) / 1.03;
  float fkx = bedx + sway * 0.006 + fh * fh * 0.05 * sin(u_time * 0.29 + bedx * 2.0);
  vec4 fk = reef(vec2(0.2 + fkx / 3.0, fh), ${boxVec("kelp")});
  col = col * (1.0 - fk.a) + mix(fk.rgb * lamp * (0.5 + 1.6 * rays), water * fk.a, 0.6);

  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float a = u_time * (0.13 - 0.03 * fi) + 2.4 * fi;
    vec2 c = vec2(f0 + fw * (0.5 + (0.2 + 0.08 * fi) * sin(a)), 0.56 + 0.2 * fi + 0.05 * sin(2.0 * a));
    vec2 head = normalize(vec2(fw * 0.24 * cos(a), 0.1 * cos(2.0 * a) + 0.004));
    float fish = school(p - c, head, vec2(min(0.1 + 0.03 * fi, 0.5 * fw), 0.07), 22.0 - 5.0 * fi, 17.0 * fi) * clearing * step(u_open.x + 1.0, u_open.z);
    col = mix(col, pale * (0.8 + 0.5 * abs(head.y) + 1.2 * rays), fish * (0.85 - 0.25 * fi));
  }

  col += pale * u_snow * snow(p + vec2(sway * 0.008, 0.0), 14.0, 1.0, 1.25) * (0.12 + 1.1 * rays);

  vec2 ns = vec2(0.86 + (bedx + sway * 0.012) / 1.9, uv.y / 0.475);
  vec4 nr = reef(ns, ${boxVec("near")});
  float nrim = nr.a * (1.0 - reef(ns + toSun * vec2(0.004, 0.016), ${boxVec("near")}).a);
  vec3 nlit = nr.rgb * (lamp * (0.42 + 1.9 * rays + (0.55 + 1.2 * pool) * caustic) + warm * 1.6 / (1.0 + ld * ld * 30.0)) + pale * nrim * lamp * (0.2 + 1.6 * rays);
  col = col * (1.0 - nr.a) + mix(nlit, water * nr.a, 0.1);

  float kh = uv.y / 0.653;
  float kx = bedx + sway * 0.016 + kh * kh * (0.024 * sin(u_time * 0.33 + bedx * 3.0) + 0.008 * sin(u_time * 0.71 + kh * 7.0 + bedx * 9.0));
  vec2 ks = vec2(0.5 + kx / 1.9, kh);
  vec4 nk = reef(ks, ${boxVec("kelp")});
  float krim = nk.a * (1.0 - reef(ks + toSun * vec2(0.003, 0.009), ${boxVec("kelp")}).a);
  col = col * (1.0 - nk.a) + nk.rgb * (lamp * (0.3 + 1.5 * rays) + warm / (1.0 + ld * ld * 30.0)) + pale * krim * lamp * (0.16 + 1.5 * rays);

  vec4 an = sprite((p - lurePoint.xy) / 0.3 + ${LURE_AT}, ${boxVec("angler")});
  float orb = ld * res;
  col += warm * clearing * (1.25 * an.r + 1.6 / (1.0 + orb * orb * orb * orb * 0.0009)) + warm * (0.5 / (1.0 + ld * ld * 420.0) + 0.16 / (1.0 + ld * ld * 22.0));

  col += teal * rays * 0.35 + pale * rays * rays * 0.12;
  col *= 0.74 + 0.26 * smoothstep(0.0, 0.42, uv.y);

  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5 || clearing * fw <= 0.0) continue;
    float body = min(0.036 + 0.014 * fract(w.x * 7.3), fw * ${glslFloat(JELLY_FIT)});
    float room = max(fw - 2.2 * body, 0.0);
    float drift = w.y * 0.04 + w.x * 6.2832;
    float rise = fract(w.x + 0.21 + w.y * 0.006);
    float phase = w.y * 1.3 + w.x * 40.0;
    float beat = 0.5 + 0.5 * sin(phase);
    vec2 c = vec2(f0 + 1.1 * body + room * (0.5 + 0.5 * sin(drift)), mix(0.22, 0.9, rise) + 0.3 * body * sin(phase - 1.2));
    float lean = cos(drift);
    vec2 q = (p - c) / body;
    q = vec2(q.x - 0.16 * lean * q.y, q.y + 0.16 * lean * q.x);
    vec4 j = jelly(q, beat, 0.06 * lean, px / body, w.x);
    float live = smoothstep(0.0, 0.06, rise) * smoothstep(1.0, 0.92, rise);
    float halo = (0.1 + 0.16 * beat) / (1.0 + dot(q, q) * dot(q, q) * 0.4);
    col = mix(col, col * 0.6, j.w * 0.35 * clearing * live);
    col += u_workerColor * clearing * live * (j.x * (0.75 + 1.2 * rays) + j.z + halo) + mix(u_workerColor, pale, 0.7) * clearing * live * j.y * (0.45 + 0.75 * beat);
  }

  col += pale * u_snow * snow(p + vec2(sway * 0.02, 0.0), 6.0, 2.0, 2.6) * (0.06 + 0.5 * rays);

  float spark = grain(p * 2.3 + vec2(0.0, u_time * 0.01)).b + 0.25 * grain(p * 5.1).g;
  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    if (r.w < 0.5) continue;
    float rd = length((uv - r.xy) * vec2(aspect, 1.0));
    float gone = clamp(1.0 - r.z / 2.6, 0.0, 1.0);
    float front = r.z * 0.3;
    float band = exp(-abs(rd - front) * 26.0);
    float wake = step(rd, front) * exp(-(front - rd) * 9.0);
    if (r.w > 1.5) col += u_errorColor * gone * (band * 0.8 + 0.22 * (0.6 + 0.4 * sin(u_time * 6.0)) * exp(-rd * 2.0));
    else col += u_finishedColor * gone * (band * 0.3 + (band + wake) * spark * 1.5);
  }

  col *= 1.0 + ${glslFloat(OPEN_LIFT)} * clearing * smoothstep(0.94, 0.82, uv.y);
  col = vec3(1.0) - exp(-col * 1.3);
  gl_FragColor = vec4(mix(deep, col, u_intensity), 1.0);
}
`;

const DISPLAY = `"Avenir Next", "SF Pro Display", -apple-system, system-ui, sans-serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const DEEP_SEA: ThemePackage = {
  format: 1,
  id: "deep-sea",
  name: "Deep Sea",
  kind: "scene",
  palette: ["#02101a", "#1fb7c9", "#bff6ff", "#ff9ec7"],
  variants: {
    dark: { canvas: "#04131d", ink: "#e6f7fb", sidebar: "#061923", accent: "#3cc8d8", accentInk: "#021014", selection: "#3cc8d8", error: "#ff6b7d", warning: "#ffbf5e", success: "#63e6b0" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.72, blur: 22 },
    saturate: 1.2,
    edge: "#3cc8d8",
  },
  type: { heading: DISPLAY, body: BODY, mono: MONO, headingWeight: 500 },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 900 },
  effects: {
    worker: { color: "#ff9ec7", character: "translucent jellyfish" },
    needsYou: { color: "#ffbf5e" },
    finished: { color: "#7fe9f5" },
    error: { color: "#ff6b7d" },
  },
  defaults: { intensity: 0.85, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: DEEP_SEA_SHADER,
    uniforms: { u_reef: 0, u_rays: 1, u_snow: 1 },
    fallback: { color: "#02101a", image: null },
    still: 14,
    backdrop: { dark: "#02101a", light: "#8fc4cc" },
  },
  credit: null,
};
