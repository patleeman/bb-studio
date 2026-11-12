import type { ThemePackage } from "../schema";

export const AURORA_FJORD_SHADER = `uniform float u_horizon;

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

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash11(i);
  return a + (hash11(i + 1.0) - a) * f;
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

float fold(vec2 g) {
  float bend = noise(g * vec2(0.55, 0.8) + vec2(u_time * 0.016, 0.0));
  return g.y * 0.72 + 0.16 * g.x + 1.9 * bend + 0.3 * sin(g.x * 2.1 + u_time * 0.07 + 1.3 * g.y);
}

vec3 aurora(vec2 dir) {
  vec3 sum = vec3(0.0);
  float a = fold(dir);
  float fa = floor(a) + smoothstep(0.42, 0.58, fract(a));
  float low = 1.0;
  float jitter = hash21(gl_FragCoord.xy) - 0.5;
  for (int i = 1; i <= 13; i++) {
    float f = (float(i) + (i < 13 ? jitter : 0.0)) / 13.0;
    float high = 1.0 + f * (0.25 + 0.75 * f);
    float b = fold(dir * high);
    float fb = floor(b) + smoothstep(0.42, 0.58, fract(b));
    float id = floor(0.5 * (a + b));
    float span = b - a;
    float at = clamp((id + 0.5 - a) / (abs(span) < 0.001 ? 0.001 : span), 0.0, 1.0);
    float fs = (float(i) - 1.0 + at) / 13.0;
    float life = hash11(id * 7.3 + 1.7);
    vec2 g = dir * mix(low, high, at);
    float along = g.x * 13.0 + id * 31.0;
    float rays = noise1(along + u_time * 0.09) * 0.6 + noise1(along * 3.3 - u_time * 0.13) * 0.4;
    vec3 tint = mix(mix(u_palette[1], vec3(0.1, 0.8, 0.85), smoothstep(0.08, 0.4, fs)), u_palette[2] * 1.25, smoothstep(0.28, 0.8, fs));
    sum += tint * abs(fb - fa) / max(abs(span), 0.1) * (1.0 - fs) * (1.0 - 0.45 * fs) * mix(0.4, 0.14 + 0.86 * rays * rays, smoothstep(0.02, 0.16, abs(span))) * (0.5 + 0.5 * life) / (1.0 + 0.045 * g.y * g.y);
    a = b;
    fa = fb;
    low = high;
  }
  return sum;
}

float ridge(float x) {
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    sum += amp * (1.0 - abs(2.0 * noise1(x) - 1.0));
    x = x * 2.17 + 7.3;
    amp *= 0.48;
  }
  return sum;
}

float lowRidge(float x) {
  return 0.55 * (1.0 - abs(2.0 * noise1(x) - 1.0)) + 0.264 * (1.0 - abs(2.0 * noise1(x * 2.17 + 7.3) - 1.0));
}

vec4 peak(vec2 q, float x, float base, float height, float massif, float px, vec3 lit, vec3 shade, vec3 rock) {
  float r = ridge(x);
  float top = base + height * (massif + r * r + 0.07 * (noise1(x * 19.0) - 0.5) + 0.03 * (noise1(x * 53.0) - 0.5));
  float drop = (top - q.y) / height;
  float xs = x + drop * 0.22;
  float tex = noise(vec2(xs * 60.0, drop * 5.0)) * 0.6 + noise(vec2(xs * 170.0, drop * 30.0)) * 0.4;
  xs += 0.035 * (tex - 0.5);
  float light = clamp(0.5 + 9.0 * (lowRidge(xs + 0.012) - lowRidge(xs - 0.012)), 0.0, 1.0);
  float fill = (top - q.y) / max(top - base, 0.001);
  float bare = smoothstep(0.5, 0.78, tex + 0.3 * (1.0 - light) + 0.75 * smoothstep(0.4, 1.0, fill) - 0.12);
  vec3 col = mix(shade, lit, light * (0.55 + 0.45 * tex));
  col = mix(col, rock, bare);
  return vec4(col, smoothstep(px, -px, q.y - top));
}

float stars(vec2 c, float cell, float keep) {
  float h = hash21(floor(c));
  float b = fract(h * 57.3);
  float d = length(fract(c) - 0.5 - 0.7 * (vec2(fract(h * 17.3), fract(h * 91.7)) - 0.5)) * cell;
  return step(keep, h) * b * b * b * smoothstep(0.8 + 1.1 * b, 0.25, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float px = 1.0 / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float hz = u_horizon;
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  bool wide = strip > 0.09 * u_resolution.x;
  float focus = (wide ? (u_clear.z + 0.5 * strip) / u_resolution.x : 0.86) * aspect;
  float sway = sin(u_time * 0.11);

  float boost = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    if (r.w > 0.5 && r.w < 1.5) boost += sin(3.1416 * clamp(r.z / 2.6, 0.0, 1.0));
  }

  float below = step(uv.y, hz);
  float dw = max(hz - uv.y, 0.0);
  float zw = 0.05 / (dw + 0.006);
  vec2 wq = vec2((p.x - 0.5 * aspect) * zw, zw);
  float swell = noise(wq * vec2(2.6, 9.0) + vec2(u_time * 0.03, u_time * 0.09)) - 0.5;
  float chop = noise(wq * vec2(11.0, 46.0) - vec2(0.0, u_time * 0.16)) - 0.5;
  float wave = (swell + 0.45 * chop) * (0.002 + 0.035 * dw);
  vec2 q = vec2(p.x + below * chop * 0.012 * dw, mix(uv.y, hz + dw * 1.04 + wave, below));
  float sy = max(q.y - hz, 0.0) / (1.0 - hz);

  vec3 glow = mix(u_palette[1], vec3(0.15, 0.8, 0.8), 0.35) * (1.0 + 0.5 * boost);
  vec3 col = mix(vec3(0.026, 0.06, 0.1), vec3(0.005, 0.009, 0.028), smoothstep(0.0, 0.85, sy));

  vec2 sc = q * u_resolution.y;
  float twinkle = 0.75 + 0.25 * sin(u_time * 1.3 + 40.0 * hash21(floor(sc / 28.0 + 31.0)));
  float star = 0.9 * stars(sc / 5.0, 5.0, 0.8) + 1.7 * stars(sc / 28.0 + 31.0, 28.0, 0.55) * twinkle;
  col += vec3(0.82, 0.9, 1.0) * star * smoothstep(0.0, 0.25, sy) * (1.0 - 0.6 * below);

  float turn = u_time / 43.0;
  float fall = fract(turn) / 0.05;
  if (fall < 1.0) {
    float n = floor(turn);
    vec2 dir = vec2(0.916, -0.401);
    vec2 rel = q - vec2(aspect * (0.15 + 0.6 * hash21(vec2(n, 1.0))), 0.8 + 0.15 * hash21(vec2(2.0, n))) - dir * fall * 0.3;
    float trail = dot(rel, dir);
    col += vec3(0.9, 0.95, 1.0) * sin(3.1416 * fall) * 0.9 * step(trail, 0.0) * exp(trail * 14.0) * exp(-abs(dot(rel, vec2(dir.y, -dir.x))) / px * 0.9);
  }

  vec3 rd = normalize(vec3((q.x - 0.5 * aspect) * 0.95, sy * 0.86 + 0.012, 1.0));
  float active = 0.8 + 0.75 * noise(vec2(q.x * 0.8 - u_time * 0.012, sy * 1.3 + u_time * 0.007));
  vec3 au = (aurora(rd.xz / (rd.y + 0.05)) * 0.9 + u_palette[1] * 0.06 * active) * active * (0.3 + 0.7 * smoothstep(0.0, 0.2, sy)) * (1.0 + 0.7 * boost);
  float top = max(au.r, max(au.g, au.b));
  float edge = 0.05 * u_resolution.x;
  float cover = max(smoothstep(0.2 * u_resolution.x + edge, 0.2 * u_resolution.x, gl_FragCoord.x), smoothstep(u_clear.x - edge, u_clear.x, gl_FragCoord.x) * smoothstep(u_clear.z + edge, u_clear.z, gl_FragCoord.x));
  cover = max(cover, smoothstep(0.9, 0.95, uv.y));
  au *= mix(0.9, 0.7, cover) * (1.0 - exp(-top * 1.1)) / max(top, 0.0001);
  au = max(mix(vec3(dot(au, vec3(0.3, 0.5, 0.2))), au, 1.2), 0.0);
  au += u_finishedColor * dot(au, vec3(0.3)) * boost * 0.4;
  col += au;

  vec3 haze = vec3(0.03, 0.065, 0.1) + glow * 0.035;
  vec3 snowLit = vec3(0.2, 0.27, 0.36) + glow * 0.2;
  vec3 snowShade = vec3(0.05, 0.075, 0.12) + glow * 0.03;
  vec3 rock = vec3(0.01, 0.016, 0.028);

  float x0 = q.x + sway * 0.0015;
  float top0 = hz + 0.02 + 0.1 * ridge(x0 * 3.4 + 11.0);
  float v0 = (q.y - hz) / (top0 - hz);
  vec3 far = mix(haze * 1.5, mix(snowShade, snowLit, 0.45), smoothstep(0.3, 0.95, v0) * 0.55);
  col = mix(col, far, smoothstep(px, -px, q.y - top0));

  float x1 = q.x + sway * 0.004;
  float e1 = (x1 - 0.36 * aspect) / 0.42;
  vec4 mid = peak(q, x1 * 2.6 + 3.0, hz + 0.012, 0.19 * (0.6 + 0.5 / (1.0 + e1 * e1)), 0.12, px, snowLit, snowShade, rock);
  col = mix(col, mix(mid.rgb, haze * 1.2, 0.5), mid.a);

  float mist = noise(vec2(q.x * 3.0 + u_time * 0.02, q.y * 40.0));
  col = mix(col, haze * 1.5 + glow * 0.03, smoothstep(0.1, 0.0, q.y - hz) * (0.2 + 0.5 * mist));

  float x2 = q.x + sway * 0.009;
  float e2 = (x2 - focus + 0.04) / 0.3;
  float e3 = (x2 - 0.13 * aspect) / 0.26;
  float bulk = 0.95 / (1.0 + e2 * e2) + 0.7 / (1.0 + e3 * e3);
  vec4 near = peak(q, x2 * 1.8 + 40.0, hz + 0.004, 0.38 * (0.2 + bulk), 0.3 * bulk, px, snowLit * 1.2, snowShade, rock);
  col = mix(col, mix(near.rgb, haze, 0.06), near.a);
  col = mix(col, haze * 1.3, smoothstep(0.035, 0.0, q.y - hz) * 0.5);

  vec3 deep = vec3(0.006, 0.014, 0.026);
  vec3 water = deep + col * (0.5 + 0.42 / (1.0 + dw * 26.0)) + au * 0.14 + glow * 0.02 * (chop + 0.5) * dw;
  col = mix(col, water, below);
  col += haze * 0.5 * exp(-abs(uv.y - hz) * 260.0);

  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5) continue;
    float depth = fract(w.x * 5.3 + 0.2);
    float size = 0.45 + 1.1 * depth;
    float way = w.x > 0.5 ? 1.0 : -1.0;
    float lane = (u_cards[1].x - u_cards[0].z) / u_resolution.y;
    float clearing = openFade(gl_FragCoord.xy) * step(0.1, lane);
    vec2 lp = vec2(u_cards[0].z / u_resolution.y + lane * mix(-0.04, 1.04, fract(w.x * 3.7 + w.y * 0.012 * way * size)), hz - 0.022 - 0.13 * depth + 0.0015 * size * sin(w.y * 1.1 + w.x * 9.0));
    vec2 d = (p - lp) / size;
    col = mix(col, rock, clearing * step(abs(d.x), 0.014 - 1.2 * max(-d.y, 0.0)) * step(-0.006, d.y) * step(d.y, 0.001));
    float ld = length(d - vec2(0.002, 0.007));
    col += u_workerColor * clearing * (1.4 * smoothstep(0.0035, 0.001, ld) + exp(-ld * 60.0) * 0.3 + 0.5 * step(0.006, -d.y) * exp(-abs(d.x - 0.002 + wave * 0.6) * 300.0 + (d.y + 0.006) * 30.0));
  }

  float sx = p.x + sway * 0.016;
  float es = (sx - focus - 0.07) / 0.2;
  float shoreTop = hz - 0.34 + 0.32 / (1.0 + es * es * es * es) + 0.018 * noise1(sx * 13.0) + 0.006 * noise1(sx * 47.0);
  float shore = smoothstep(px, -px, uv.y - shoreTop);
  float sdrop = shoreTop - uv.y;
  float grit = noise(vec2(sx * 26.0, uv.y * 70.0));
  vec3 bank = mix(snowShade * 1.6, snowLit, (0.35 + 0.65 * grit) / (1.0 + 9.0 * sdrop));
  bank = mix(bank, rock * (1.0 + grit), smoothstep(0.7, 0.86, noise(vec2(sx * 90.0, uv.y * 140.0)) + 0.8 * es * es * step(es, 0.0) - 0.45));

  vec2 hq = (p - vec2(focus + sway * 0.016, hz - 0.016)) / 0.03;
  float pulse = 0.65 + 0.35 * sin(u_time * 2.4);
  float lamp = u_needsYou * (0.7 + 0.8 * pulse);
  vec3 warm = mix(vec3(1.0, 0.7, 0.36), u_needsYouColor, min(u_needsYou, 1.0)) * lamp;
  vec2 wn = hq - vec2(0.32, 0.5);
  float wd = length(wn * vec2(1.0, 1.2));
  bank += warm * snowLit * 2.2 * exp(-wd * 1.1) * step(hq.y, 0.3);
  col = mix(col, bank, shore);

  col += warm * (0.3 * exp(-wd * 2.4) + 0.08 * exp(-wd * 0.7));

  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    if (r.w < 1.5) continue;
    float e = length(vec2((uv.x - r.x) * aspect, (uv.y - r.y) / 0.3));
    col += u_errorColor * smoothstep(0.006, 0.0, abs(e - 0.01 - r.z * 0.05)) * clamp(1.0 - r.z / 2.6, 0.0, 1.0) * 0.8;
  }

  gl_FragColor = vec4(mix(u_palette[0], col, u_intensity), 1.0);
}
`;

const DISPLAY = `Optima, "Gill Sans", "Avenir Next", -apple-system, system-ui, sans-serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const AURORA_FJORD: ThemePackage = {
  format: 1,
  id: "aurora-fjord",
  name: "Aurora Fjord",
  kind: "scene",
  palette: ["#050914", "#4dffa6", "#9b7bff", "#ffb060"],
  variants: {
    dark: { canvas: "#070c16", ink: "#eef3f4", sidebar: "#080d18", accent: "#5fe8a5", accentInk: "#04140c", selection: "#5fe8a5", error: "#ff6b6b", warning: "#ffb060", success: "#7ce6a0" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.74, blur: 22 },
    saturate: 1.2,
    edge: null,
  },
  type: { heading: DISPLAY, body: BODY, mono: MONO, headingWeight: 700 },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 900 },
  effects: {
    worker: { color: "#ffc878", character: "fishing boat with a lantern" },
    needsYou: { color: "#ffb060" },
    finished: { color: "#9dffd0" },
    error: { color: "#ff6b6b" },
  },
  defaults: { intensity: 0.8, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: AURORA_FJORD_SHADER,
    uniforms: { u_horizon: 0.3 },
    fallback: { color: "#050914", image: null },
    still: 140,
    backdrop: { dark: "#03060d", light: "#70d0b0" },
  },
  credit: null,
};
