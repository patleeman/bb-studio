import { ATLAS } from "../data-city/atlas";
import type { ThemePackage } from "../schema";

const GLYPH_COLUMNS = `${ATLAS.columns}.0`;
const GLYPH_COUNT = `${ATLAS.columns * ATLAS.rows}.0`;
const GLYPH_V = String(ATLAS.cellHeight / ATLAS.size);

export const DATA_CITY_SHADER = `uniform float u_period;
uniform float u_blocks;
uniform float u_atlas;
uniform float u_fov;
uniform vec2 u_vanish;
uniform float u_fog;

float hash21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float glyph(float id, vec2 f, float lod) {
  if (lod > 0.98) return 0.34;
  float ink = 0.0;
  if (u_atlas > 0.5) {
    ink = texture2D(u_layer, vec2((mod(id, ${GLYPH_COLUMNS}) + f.x) / ${GLYPH_COLUMNS}, 1.0 - (floor(id / ${GLYPH_COLUMNS}) + 1.0 - f.y) * ${GLYPH_V})).r;
  } else {
    vec2 b = floor(f * vec2(5.0, 7.0));
    ink = step(abs(b.x - 2.0), 1.5) * step(abs(b.y - 3.0), 2.5) * step(0.42, hash21(b + id * 7.13));
  }
  return mix(ink, 0.34, lod);
}

vec3 tower(vec2 cell) {
  float h = hash21(vec2(cell.x, mod(cell.y, u_blocks)));
  float there = (step(1.5, cell.x) + step(cell.x, -0.5)) * step(0.5, mod(cell.y, 4.0));
  return vec3(h, there * (3.6 + 5.0 * h), 0.36 + 0.11 * fract(h * 7.3));
}

vec4 face(vec4 hit, vec3 ro, vec3 rd, float turn, float px, float calm) {
  float t = hit.x;
  vec2 cell = hit.yz;
  vec3 tw = tower(cell);
  float h = tw.x;
  float h2 = fract(h * 91.7);
  float mark = step(abs(cell.x - 2.0), 0.5) * step(abs(mod(cell.y, 8.0) - 2.0), 0.5);
  vec3 P = ro + rd * t;
  float wpx = px * t * 1.4;
  float fog = exp(-t * u_fog);
  float near = 0.22 + 0.78 * smoothstep(0.8, 5.0, t);
  float far = smoothstep(5.0, 13.0, t);
  float flicker = 1.0 - 0.5 * far * step(0.62, hash21(vec2(h * 77.0, floor(turn * 144.0))));
  float alarm = u_needsYou * mark;
  float beat = 0.7 + 0.3 * sin(351.85838 * turn);
  vec3 body = mix(mix(vec3(0.14, 0.4, 1.0), u_palette[1], fract(h * 3.7)), u_needsYouColor, alarm);
  vec3 glow = vec3(0.0);
  float alpha = 0.0;
  float v = P.y;
  float ink = 0.0;
  float outline = 0.0;
  float along = hit.w > 0.5 ? P.x - cell.x : P.z - cell.y;
  float facing = hit.w > 0.5 ? abs(rd.z) : abs(rd.x);
  float width = 2.0 * tw.z;
  float u = along - 0.5 + tw.z;
  if (hit.w < 0.5 && rd.x > 0.0) u = width - u;
  float cols = floor(40.0 + 16.0 * h2);
  float rows = cols * 0.6667;
  float gx = u * cols;
  float col = floor(gx);
  float ch = hash21(vec2(col + hit.w * 40.0, h * 100.0 + 3.0));
  float rate = floor(1.0 + 3.0 * fract(ch * 5.7));
  float gy = v * rows + rate * 32.0 * turn;
  float rid = mod(floor(gy), 32.0);
  float cellh = hash21(vec2(col * 1.7 + rid * 13.1, h * 57.0 + hit.w));
  float tick = floor(turn * 96.0);
  float gid = floor(fract(cellh * 17.0 + step(0.8, fract(cellh * 3.3)) * tick * 0.137) * ${GLYPH_COUNT});
  float run = hash21(vec2(col, floor(rid / 4.0) + h * 31.0));
  float lit = step(0.28, run) * (0.3 + 0.7 * fract(run * 9.1));
  float size = facing / (px * t * cols);
  float lod = 1.0 - smoothstep(2.5, 6.0, size);
  float fine = 1.0 - 0.95 * smoothstep(7.0, 16.0, 900.0 / (u_fov * t * cols));
  float accent = step(0.93, ch);
  ink = glyph(gid, vec2(fract(gx), fract(gy)), lod) * lit * (1.0 + 0.7 * accent) * fine;
  vec3 tint = mix(mix(mix(body, u_palette[2], accent), u_palette[3], step(0.975, ch)), u_needsYouColor, alarm);
  outline = exp(-min(u, width - u) * facing / wpx) + exp(-(tw.y - v) / wpx) + 0.25 * exp(-abs(fract(v * 2.0) - 0.5) / (wpx * 2.0)) * step(0.5, fract(h * 23.0));
  float shade = (hit.w > 0.5 ? 0.62 : 1.0) * flicker * near;
  glow = (tint * (ink * 1.25 + 0.07 + 0.1 * accent) + body * (0.035 + outline * 0.5)) * shade;
  alpha = clamp(0.8 + 0.1 * near + 0.3 * ink + outline, 0.0, 0.94);
  glow += u_needsYouColor * alarm * beat * near * (0.22 + ink * 1.4 + outline);
  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    if (r.w < 0.5) continue;
    float wave = exp(-abs(v - r.z * 2.4) * 3.0) * clamp(1.0 - r.z / 2.6, 0.0, 1.0);
    glow += (r.w > 1.5 ? u_errorColor : u_finishedColor) * wave * (0.4 + ink * 2.2 + outline);
  }
  return vec4(glow * fog * calm + vec3(0.014, 0.046, 0.115) * (1.0 - fog) * alpha, alpha);
}

vec3 street(vec3 P, vec3 ro, float t, float turn, float px) {
  float wx = px * t * 1.3;
  float wz = wx * t / ro.y;
  float thin = clamp(1.3 - wz * 12.0, 0.0, 1.0);
  float ave = step(abs(P.x - 1.0), 1.0);
  float lane = abs(fract(P.x * 3.0 + 0.5) - 0.5) / 3.0;
  float dash = 0.55 + 0.45 * step(0.5, fract(P.z * 1.5 + step(0.5, fract(P.x * 1.5)) * 0.5));
  float lanes = ave * (exp(-lane / wx) + 0.2 * wx / (lane + wx * 4.0)) * dash;
  float zc = mod(P.z, 4.0);
  float cross = step(zc, 1.0);
  float bar = abs(fract(zc * 5.0 + 0.5) - 0.5) / 5.0;
  float bars = cross * (exp(-bar / wz) + 0.2 * wz / (bar + wz * 4.0)) * thin;
  vec2 edge = abs(fract(P.xz + 0.5) - 0.5);
  float kerb = (exp(-edge.x / wx) + exp(-edge.y / wz) * thin) * (1.0 - ave) * (1.0 - cross);
  vec3 col = u_palette[1] * lanes * 0.85 + mix(vec3(0.14, 0.4, 1.0), vec3(1.0, 0.22, 0.82), 0.45) * bars * 0.8 + vec3(0.1, 0.3, 0.9) * kerb * 0.3;
  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5) continue;
    float rel = mod(w.x * 31.0 + w.y * 1.5, 11.0);
    float back = ro.z + 0.5 + rel - P.z;
    float across = abs(P.x - (floor(w.x * 5.0) + 1.0) / 3.0);
    float beam = exp(-across / (wx * 3.0 + 0.012)) + 0.5 * wx / (across + wx * 3.0);
    col += u_workerColor * openFade(gl_FragCoord.xy) * smoothstep(0.0, 1.0, rel) * smoothstep(11.0, 8.0, rel) * beam * (step(0.0, back) * exp(-max(back, 0.0) * 0.9) * 1.5 + exp(-abs(back) * 5.0) * 2.5);
  }
  return col * exp(-t * u_fog);
}

vec3 skyline(vec3 rd, float turn) {
  vec2 a = rd.xy / rd.z;
  float cx = a.x * 38.0;
  float id = floor(cx);
  float h = hash21(vec2(id, 5.0));
  float body = step(0.15, fract(cx)) * step(a.y, 0.03 + 0.26 * h * h) * step(0.0, a.y);
  float d = hash21(floor(vec2(cx * 9.0, a.y * 420.0)) + id);
  float on = step(0.55, fract(d + step(0.7, fract(d * 7.7)) * floor(turn * 96.0) * 0.173));
  vec3 haze = vec3(0.014, 0.046, 0.115) * (1.1 + 2.4 * exp(-abs(a.y) * 5.0));
  return haze + mix(vec3(0.14, 0.4, 1.0), u_palette[1], h) * body * (0.04 + 0.17 * on);
}

vec3 panel(vec2 q, float id, float turn, float edge) {
  vec2 inset = min(q, 1.0 - q) * vec2(0.7, 0.45);
  float frame = exp(-min(inset.x, inset.y) / edge);
  float level = 0.24 + 0.5 * hash21(vec2(floor(q.x * 14.0) + id * 9.0, floor(turn * 24.0)));
  float bars = step(abs(q.x - 0.5), 0.43) * step(0.35, fract(q.x * 14.0)) * step(0.24, q.y) * step(q.y, level);
  float lamp = step(abs(q.x - 0.5), 0.43) * step(abs(q.y - 0.86), 0.04) * step(0.35, fract(q.x * 14.0)) * step(0.5, hash21(vec2(floor(q.x * 14.0) + id, floor(turn * 48.0))));
  float meter = step(abs(q.y - 0.12), 0.03) * step(0.07, q.x) * step(q.x, 0.07 + 0.86 * fract(turn * 3.0 + id * 0.37)) * step(0.3, fract(q.x * 28.0));
  float scan = 0.75 + 0.25 * step(0.5, fract(q.y * 28.0));
  return mix(u_palette[1], u_palette[3], step(0.5, id)) * (0.07 * scan + bars * 0.45 + meter * 0.5) + vec3(1.0, 0.22, 0.82) * (frame * 0.55 + lamp * 0.45) + vec3(0.02, 0.05, 0.12);
}

void main() {
  float turn = fract(u_time / u_period);
  float ang = 6.2831853 * turn;
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  bool wide = strip > 0.09 * u_resolution.x;
  vec2 vanish = vec2(wide ? (u_clear.z + 0.38 * strip) / u_resolution.x : u_vanish.x, u_vanish.y);
  vec2 sp = (gl_FragCoord.xy - vanish * u_resolution) / u_resolution.y;
  float bank = 0.035 * sin(ang + 0.6);
  sp += bank * vec2(-sp.y, sp.x);
  float px = u_fov / u_resolution.y;
  vec3 ro = vec3(1.42 + 0.12 * sin(ang), 1.6 + 0.12 * sin(2.0 * ang + 1.0), turn * u_blocks);
  vec3 rd = normalize(vec3(u_fov * sp.x + 0.045 * cos(ang), u_fov * sp.y + 0.02 * sin(2.0 * ang), 1.0));

  vec2 way = sign(rd.xz + 1e-5);
  vec2 inv = 1.0 / (abs(rd.xz) + 1e-5) * way;
  vec2 cell = floor(ro.xz);
  vec2 next = (cell + 0.5 + 0.5 * way - ro.xz) * inv;
  float ground = rd.y < 0.0 ? -ro.y / rd.y : 1e4;
  vec4 hitA = vec4(0.0);
  vec4 hitB = vec4(0.0);
  float hits = 0.0;
  float reach = 0.0;
  for (int i = 0; i < 24; i++) {
    vec3 tw = tower(cell);
    vec2 a = (cell + 0.5 - tw.z * way - ro.xz) * inv;
    vec2 b = (cell + 0.5 + tw.z * way - ro.xz) * inv;
    float tn = max(a.x, a.y);
    float tf = min(b.x, b.y);
    if (tn < tf && tn > 0.0 && tw.y > 0.0) {
      float enter = ro.y + rd.y * tn;
      if (enter < tw.y && enter > 0.0) {
        vec4 rec = vec4(tn, cell, step(a.x, a.y));
        if (hits < 0.5) hitA = rec; else hitB = rec;
        hits += 1.0;
        if (hits > 1.5) break;
      }
    }
    if (next.x < next.y) { reach = next.x; next.x += abs(inv.x); cell.x += way.x; }
    else { reach = next.y; next.y += abs(inv.y); cell.y += way.y; }
    if (reach > ground) break;
  }

  float edge = 0.05 * u_resolution.x;
  float text = max(smoothstep(0.2 * u_resolution.x + edge, 0.2 * u_resolution.x, gl_FragCoord.x), smoothstep(u_clear.x - edge, u_clear.x, gl_FragCoord.x) * smoothstep(u_clear.z + edge, u_clear.z, gl_FragCoord.x));
  float calm = (1.0 - 0.5 * text) * (0.55 + 0.45 * smoothstep(0.0, u_clear.z, gl_FragCoord.x));
  vec3 col = vec3(0.0);
  float cover = 0.0;
  float coverA = 0.0;
  float coverB = 0.0;
  if (hits > 0.5) {
    vec4 f = face(hitA, ro, rd, turn, px, calm);
    col += f.rgb;
    cover = f.a;
    coverA = f.a;
  }
  if (hits > 1.5) {
    vec4 f = face(hitB, ro, rd, turn, px, calm);
    col += (1.0 - cover) * f.rgb;
    coverB = f.a;
    cover += (1.0 - cover) * f.a;
  }
  vec3 back = rd.y < 0.0 ? vec3(0.012, 0.04, 0.1) * (1.0 - exp(-ground * u_fog)) + street(ro + rd * ground, ro, ground, turn, px) : skyline(rd, turn) * (0.45 + 0.55 * calm);
  col += (1.0 - cover) * back;

  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float rel = mod(4.5 + 8.0 * fi - ro.z, u_blocks);
    float tp = rel / rd.z;
    vec3 P = ro + rd * tp;
    vec2 at = vec2(1.3 - 0.6 * fi + 0.2 * sin(ang * (1.0 + fi) + 2.0 * fi), 2.5 + 0.5 * fi + 0.14 * sin(ang * 2.0 + 1.7 * fi));
    vec2 q = (P.xy - at) / vec2(0.7, 0.45) + 0.5;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
    float seen = smoothstep(3.6, 7.0, rel) * smoothstep(u_blocks, u_blocks - 5.0, rel) * exp(-tp * u_fog);
    if (hits > 0.5 && hitA.x < tp) seen *= 1.0 - coverA;
    if (hits > 1.5 && hitB.x < tp) seen *= 1.0 - coverB;
    col += panel(q, fi, turn, px * tp * 1.5) * seen * 0.75 * calm;
  }

  col += vec3(0.1, 0.3, 0.9) * 0.32 * exp(-length(sp * vec2(1.0, 2.2)) * 3.2) + u_palette[1] * 0.16 * exp(-length(sp) * 12.0);
  col = vec3(1.0) - exp(-col * 1.35);
  gl_FragColor = vec4(mix(u_palette[0], col, u_intensity), 1.0);
}
`;

const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;

export const DATA_CITY: ThemePackage = {
  format: 1,
  id: "data-city",
  name: "Data City",
  kind: "scene",
  palette: ["#01030a", "#3fd8ff", "#a6ff3d", "#ffb422"],
  variants: {
    dark: { canvas: "#030712", ink: "#e6f6ff", sidebar: "#040917", accent: "#3fd8ff", accentInk: "#00121a", selection: "#3fd8ff", error: "#ff4d5e", warning: "#ffb422", success: "#a6ff3d" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.72, blur: 20 },
    saturate: 1.2,
    edge: "#3fd8ff",
  },
  type: { heading: MONO, body: BODY, mono: MONO, headingWeight: 600 },
  radius: 3,
  motion: { speed: 1, crossfadeMs: 700 },
  effects: {
    worker: { color: "#a6ff3d", character: "data packet on a light lane" },
    needsYou: { color: "#ffb422" },
    finished: { color: "#b8f4ff" },
    error: { color: "#ff4d5e" },
  },
  defaults: { intensity: 0.8, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: DATA_CITY_SHADER,
    uniforms: { u_period: 56, u_blocks: 16, u_atlas: 0, u_fov: 0.72, u_vanish: [0.86, 0.5], u_fog: 0.11 },
    fallback: { color: "#01030a", image: null },
    still: 14,
    backdrop: { dark: "#01030a", light: "#9fb2cc" },
  },
  credit: null,
};
