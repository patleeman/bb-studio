import type { ThemePackage } from "../schema";

export const MIAMI_SHADER = `uniform float u_horizon;
uniform float u_sunX;
uniform float u_gridSpeed;

float hash21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

vec3 skyColor(float h) {
  vec3 c = mix(vec3(1.0, 0.31, 0.545), vec3(0.541, 0.11, 0.525), smoothstep(0.0, 0.28, h));
  c = mix(c, vec3(0.173, 0.059, 0.369), smoothstep(0.28, 0.62, h));
  return mix(c, vec3(0.047, 0.02, 0.133), smoothstep(0.62, 1.0, h));
}

float peak(float x, float c, float w, float h) {
  return h * max(0.0, 1.0 - abs(x - c) / w);
}

float ridge(float x) {
  float h = max(peak(x, 0.255, 0.05, 0.045), peak(x, 0.3, 0.035, 0.03));
  h = max(h, peak(x, 0.358, 0.07, 0.093));
  h = max(h, peak(x, 0.458, 0.058, 0.058));
  h = max(h, peak(x, 0.77, 0.055, 0.051));
  h = max(h, peak(x, 0.81, 0.035, 0.03));
  h = max(h, peak(x, 0.87, 0.07, 0.109));
  return max(h, peak(x, 0.965, 0.05, 0.071));
}

float palm(vec2 p, vec2 base, float h, float lean, float k, float px, float phase) {
  float sway = sin(u_time * 0.26 + phase) + 0.4 * sin(u_time * 0.61 + phase * 2.3);
  lean += sway * 0.011 * k;
  vec2 q = p - base;
  float t = clamp(q.y / h, 0.0, 1.0);
  float w = (0.011 - 0.005 * t) * k;
  float trunk = smoothstep(w + px, w - px, abs(q.x - lean * t * t)) * step(0.0, q.y) * step(q.y, h);
  vec2 c = q - vec2(lean, h);
  if (dot(c, c) > 0.04 * k * k) return trunk;
  c += sway * 0.035 * vec2(-c.y, c.x);
  float leaf = smoothstep(0.009 * k + px, 0.009 * k - px, length(c + vec2(0.0, 0.005 * k)));
  vec2 dir = vec2(0.939, -0.343);
  mat2 turn = mat2(0.913, 0.408, -0.408, 0.913);
  for (int i = 0; i < 10; i++) {
    float len = (0.13 + 0.035 * fract(float(i) * 0.618)) * k;
    vec2 up = dir.x > 0.0 ? vec2(-dir.y, dir.x) : vec2(dir.y, -dir.x);
    float u = dot(c, dir) / len;
    float uc = clamp(u, 0.0, 1.0);
    float v = dot(c, up) - len * (0.55 * uc - 1.3 * uc * uc) * (0.3 + 0.7 * up.y);
    float serr = 0.55 + 0.45 * abs(fract(uc * 9.0) * 2.0 - 1.0);
    float width = (0.017 * (1.0 - uc * uc) * smoothstep(0.0, 0.08, uc) * serr + 0.0015) * k;
    float inside = step(0.0, u) * step(u, 1.0);
    leaf = max(leaf, inside * smoothstep(width + px, width - px, abs(v)));
    dir = turn * dir;
  }
  return max(trunk, leaf);
}

vec3 glider(vec2 p, vec2 g, float size, float glow, vec3 col) {
  vec2 l = (p - g) / (0.0011 * size);
  float inside = step(-18.0, l.x) * step(l.x, 30.0) * step(abs(l.y), (30.0 - l.x) * 0.27) * step(-10.0 - abs(l.y) * 0.62, l.x);
  float shade = l.y > 0.0 ? 1.0 - l.y / 16.0 : 0.0;
  vec3 chrome = l.y > 0.0 ? mix(vec3(0.725, 0.776, 1.0), vec3(1.0), shade) : mix(vec3(0.416, 0.247, 0.659), vec3(1.0, 0.816, 0.949), -l.y / 13.0);
  float edge = abs(abs(l.y) - (30.0 - l.x) * 0.27);
  float rim = step(-18.0, l.x) * step(l.x, 30.0) * exp(-edge * 0.6);
  float trailP = step(l.x, -14.0) * step(-210.0, l.x) * step(abs(l.y - 3.0), 1.5) * (1.0 + (l.x + 14.0) / 196.0);
  float trailC = step(l.x, -14.0) * step(-170.0, l.x) * step(abs(l.y + 2.0), 1.0) * (1.0 + (l.x + 14.0) / 156.0);
  col += (u_palette[1] * trailP + u_palette[2] * trailC) * (0.45 + 0.45 * glow);
  col = mix(col, chrome, inside * (0.7 + 0.3 * glow));
  col += u_workerColor * glow * (rim * 0.8 + 0.25 * exp(-length(l) * 0.05));
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float px = 1.0 / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec3 bg = u_palette[0];
  vec3 pink = u_palette[1];
  vec3 cyan = u_palette[2];
  vec3 sunMid = u_palette[3];
  float hz = u_horizon;
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  float sunX = strip > 0.09 * u_resolution.x ? (u_clear.z + 0.5 * strip) / u_resolution.x : u_sunX;
  float R = clamp(0.34 * strip / u_resolution.y, 0.07, 0.198);
  vec3 col;

  if (uv.y >= hz) {
    float h = (uv.y - hz) / (1.0 - hz);
    col = skyColor(h);
    vec2 sc = gl_FragCoord.xy / (u_resolution.y * 0.008);
    float s = hash21(floor(sc));
    float twinkle = 0.55 + 0.45 * sin(u_time * 1.3 + s * 40.0);
    float dotS = smoothstep(0.22, 0.05, length(fract(sc) - 0.5));
    col += vec3(1.0, 0.94, 1.0) * step(0.975, s) * dotS * twinkle * smoothstep(0.3, 0.6, h);
    vec2 sq = vec2((uv.x - sunX) * aspect, uv.y - hz);
    float d = length(sq);
    col += vec3(1.0, 0.59, 0.47) * 0.6 * exp(-d * 3.2) + vec3(1.0, 0.36, 0.55) * 0.35 * exp(-max(d - R, 0.0) * 14.0);
    float pulse = 0.65 + 0.35 * sin(u_time * 3.0);
    col += u_needsYouColor * u_needsYou * pulse * (0.55 * exp(-max(d - R, 0.0) * 9.0) + 0.25 * exp(-d * 2.5));
    float t = sq.y / R;
    vec3 sun = mix(vec3(1.0, 0.165, 0.541), sunMid, smoothstep(0.0, 0.55, t));
    sun = mix(sun, vec3(1.0, 0.949, 0.478), smoothstep(0.55, 1.0, t));
    float band = 0.6 - t;
    float stripe = fract(band * 8.5 + u_time * 0.06);
    float gap = band > 0.0 ? step(stripe, 0.12 + band * 0.75) : 0.0;
    float disc = smoothstep(R + px, R - px, d) * (1.0 - gap);
    col = mix(col, sun, disc);
    float m = ridge(uv.x) * smoothstep(R * 0.9, R * 1.7, abs(uv.x - sunX) * aspect);
    float my = uv.y - hz;
    if (my < m) {
      float f = my / max(m, 0.001);
      col = mix(vec3(0.071, 0.024, 0.165), vec3(0.227, 0.059, 0.384), f);
      float wire = max(smoothstep(0.08, 0.0, abs(fract(uv.x * aspect * 70.0 + my * 30.0) - 0.5) - 0.42), smoothstep(0.08, 0.0, abs(fract(uv.x * aspect * 70.0 - my * 30.0) - 0.5) - 0.42));
      col += cyan * 0.28 * wire * (1.0 - f * 0.5);
    }
    col += pink * (exp(-abs(my - m) / px * 0.6) * 0.9 + exp(-abs(my - m) / px * 0.1) * 0.25) * step(0.002, m);
  } else {
    float d = max(hz - uv.y, 0.0005);
    float depth = d / hz;
    col = mix(vec3(0.165, 0.043, 0.29), vec3(0.043, 0.086, 0.251), smoothstep(0.0, 0.3, depth));
    col = mix(col, vec3(0.012, 0.071, 0.11), smoothstep(0.3, 1.0, depth));
    float z = 0.211 / d;
    float wx = (uv.x - sunX) * aspect * z * 12.6;
    float ex = abs(fract(wx) - 0.5) * 2.0;
    float pxX = z * 12.6 * px * 2.0 * (1.0 + abs(uv.x - sunX) * aspect / d);
    float zc = z + u_time * u_gridSpeed;
    float ez = abs(fract(zc) - 0.5) * 2.0;
    float pxZ = 0.211 / (d * d) * px * 2.0;
    float lx = 1.0 - ex;
    float lz = 1.0 - ez;
    float fadeX = clamp(1.6 - pxX * 5.0, 0.0, 1.0);
    float fadeZ = clamp(1.6 - pxZ * 5.0, 0.0, 1.0);
    float lines = smoothstep(pxX * 1.4, 0.0, lx) * fadeX + smoothstep(pxZ * 1.4, 0.0, lz) * fadeZ;
    float halo = smoothstep(pxX * 6.0, 0.0, lx) * fadeX + smoothstep(pxZ * 6.0, 0.0, lz) * fadeZ;
    col += cyan * (lines * 0.85 + halo * 0.16 + (2.0 - fadeX - fadeZ) * 0.12);
    float row = smoothstep(0.14, 0.0, abs(fract(zc * 0.25) - 0.5));
    col += mix(cyan, pink, 0.4) * 0.09 * row * smoothstep(0.03, 0.2, depth);
    col = mix(col, vec3(0.235, 0.047, 0.353), smoothstep(0.08, 0.0, hz - uv.y) * 0.9);
    for (int i = 0; i < 4; i++) {
      vec4 r = u_ripples[i];
      if (r.w < 0.5) continue;
      float e = length(vec2((uv.x - r.x) * aspect, (uv.y - r.y) / 0.26));
      float fadeR = clamp(1.0 - r.z / 2.6, 0.0, 1.0);
      vec3 rc = r.w > 1.5 ? u_errorColor : u_finishedColor;
      col += rc * smoothstep(0.006, 0.0, abs(e - 0.022 - r.z * 0.065)) * fadeR;
    }
  }
  col += pink * exp(-abs(uv.y - hz) / px * 0.45) + pink * 0.3 * exp(-abs(uv.y - hz) * 60.0);

  float left = u_clear.x / u_resolution.x;
  float tree = palm(p, vec2((left - 0.165) * aspect, -0.022), 0.678, 0.078, 1.3, px, 0.0);
  tree = max(tree, palm(p, vec2((left - 0.05) * aspect, -0.033), 0.489, -0.027, 0.92, px, 2.1));
  tree = max(tree, palm(p, vec2((left - 0.26) * aspect, -0.033), 0.456, 0.031, 0.86, px, 4.4));
  col = mix(col, vec3(0.039, 0.004, 0.094), tree);

  float clearing = openFade(gl_FragCoord.xy);
  float o0 = u_open.x / u_resolution.y;
  float ow = (u_open.z - u_open.x) / u_resolution.y;
  if (clearing * ow > 0.0) {
    float fit = mix(0.5, 1.0, smoothstep(0.12, 0.36, ow));
    float lo = o0 + 0.1 + 0.02 * fit;
    float reach = max(0.5 * (o0 + ow - 0.045 * fit - lo), 0.0);
    for (int i = 0; i < 8; i++) {
      vec4 w = u_workers[i];
      if (w.z < 0.5) continue;
      float turn = w.y * 0.21 + w.x * 6.2832;
      vec2 g = vec2(lo + reach * (1.0 + sin(turn)), 0.66 + 0.2 * fract(w.x * 3.3 + 0.12) + 0.014 * fit * sin(2.0 * turn));
      if (abs(p.x - g.x) < 0.26 * fit && abs(p.y - g.y) < 0.03) col = mix(col, glider(p, g, fit, 1.0, col), clearing);
    }
    float pass = u_time / 64.0 + 0.36;
    float along = fract(pass) / 0.62;
    vec2 far = vec2(o0 + mix(-0.05, ow + 0.15, along), 0.8 + 0.1 * hash21(vec2(floor(pass), 7.0)) + 0.008 * sin(u_time * 0.4));
    if (along < 1.0 && abs(p.x - far.x) < 0.17 * fit && abs(p.y - far.y) < 0.02) col = mix(col, glider(p, far, 0.6 * fit, 0.0, col), clearing);
  }

  col *= 1.0 - 0.1 * step(mod(gl_FragCoord.y, 3.0), 1.0);
  col += vec3(1.0) * 0.035 * smoothstep(0.06, 0.0, abs(fract(1.0 - uv.y + u_time * 0.11) - 0.5));
  gl_FragColor = vec4(mix(bg, col, u_intensity), 1.0);
}
`;

const DISPLAY = `Jost, Futura, "Avenir Next", "Century Gothic", "Trebuchet MS", sans-serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const MIAMI: ThemePackage = {
  format: 1,
  id: "miami-1985",
  name: "Miami 1985",
  kind: "scene",
  palette: ["#0e0626", "#ff4fd8", "#4ff0ff", "#ffab45"],
  variants: {
    dark: { canvas: "#120830", ink: "#f6efff", sidebar: "#160936", accent: "#ff4fd8", accentInk: "#1a0630", selection: "#4ff0ff", error: "#ff5c7a", warning: "#ffab45", success: "#5dffc0" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.74, blur: 24 },
    saturate: 1.4,
    edge: "#ff4fd8",
  },
  type: { heading: DISPLAY, body: BODY, mono: MONO, headingWeight: 500 },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 800 },
  effects: {
    worker: { color: "#4ff0ff", character: "chrome glider" },
    needsYou: { color: "#ff7ab8" },
    finished: { color: "#8cfaff" },
    error: { color: "#ff5c7a" },
  },
  defaults: { intensity: 0.75, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: MIAMI_SHADER,
    uniforms: { u_horizon: 0.556, u_sunX: 0.617, u_gridSpeed: 0.2 },
    fallback: { color: "#1a0838", image: null },
    still: 8,
    backdrop: { dark: "#0a0117", light: "#ff8fe0" },
  },
  credit: null,
};
