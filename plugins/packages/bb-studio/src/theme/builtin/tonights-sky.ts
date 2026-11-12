import type { ThemePackage } from "../schema";

export const TONIGHTS_SKY_SHADER = `uniform vec4 u_view;
uniform float u_center;
uniform vec3 u_galPole;
uniform vec3 u_galCenter;
uniform vec4 u_moon;
uniform vec4 u_moonLit;
uniform float u_meteors;
uniform vec3 u_radiant;
uniform vec3 u_sun;
uniform vec3 u_light;

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
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float faint(vec2 at, float lat, float cells, float keep) {
  float row = floor(lat * cells);
  vec2 q = vec2(at.x * cells * cos((row + 0.5) / cells), lat * cells);
  vec2 id = vec2(floor(q.x), row + cells);
  float h = hash21(id);
  vec2 c = fract(q) - 0.5 - 0.6 * (vec2(hash21(id + 7.3), hash21(id + 3.1)) - 0.5);
  return step(keep, h) * smoothstep(0.1, 0.0, length(c)) * (0.2 + 0.8 * fract(h * 17.0));
}

float streak(vec2 rel, vec2 dir, float tail, float width) {
  float along = dot(rel, dir);
  float across = abs(dot(rel, vec2(dir.y, -dir.x)));
  return step(along, 0.0) * exp(along / tail) * exp(-across / width) + 0.6 * exp(-length(rel) / width * 0.5);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float px = 1.0 / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  bool wide = strip > 0.09 * u_resolution.x;
  float focus = (wide ? (u_clear.z + 0.5 * strip) / u_resolution.x : 0.8) * aspect;
  float behindText = step(gl_FragCoord.x, u_clear.z);

  vec2 pl = (p - vec2(u_center, u_view.y)) / u_view.x;
  float r2 = dot(pl, pl);
  vec3 d = vec3(4.0 * pl, 4.0 - r2) / (4.0 + r2);
  float sinAlt = d.y * u_view.w + d.z * u_view.z;
  float az = atan(d.x, d.z * u_view.w - d.y * u_view.z);
  float h = clamp(sinAlt, 0.0, 1.0);

  float day = u_light.x;
  float glow = u_light.y;
  float lit = u_light.z;
  float dark = 1.0 - lit;
  float mu = dot(d, u_sun);
  float sunward = 0.5 + 0.5 * mu;
  float sunSin = u_sun.y * u_view.w + u_sun.z * u_view.z;
  float deep = smoothstep(0.0, -0.07, sunSin);

  vec2 mq = (p - u_moon.xy) / u_moon.z;
  float md = length(mq);
  float moonLit = 0.5 * (1.0 + u_moonLit.z);
  float moonlight = u_moon.w * (0.12 + 0.88 * moonLit) * (1.0 - 0.85 * u_moonLit.w) * dark;
  float veil = 1.0 - 0.45 * behindText;

  float side = exp(-(az + 0.8) * (az + 0.8) / 0.5);
  float haze = exp(-h * 6.5);
  vec3 col = mix(vec3(0.062, 0.088, 0.16), vec3(0.012, 0.02, 0.052), pow(h, 0.4));
  col += vec3(0.02, 0.03, 0.055) * moonlight * (0.4 + 0.6 * haze);
  col += u_palette[3] * haze * (0.05 + 0.34 * side);

  col += vec3(0.03, 0.052, 0.08) * exp(-h * 8.0);

  float clearAir = smoothstep(0.0, 0.3, h) * (1.0 - 0.7 * moonlight * exp(-md * 0.03)) * (1.0 - 0.6 * side * haze) * dark * dark;
  if (dark > 0.004) {
  float b = dot(u_galPole, d);
  float cl = dot(u_galCenter, d);
  float sl = dot(cross(u_galPole, u_galCenter), d);
  vec2 g = vec2(cl, sl) * 8.0 + b * vec2(9.0, -9.0);
  float n1 = noise(g);
  float n2 = noise(g * 2.3 + 4.1);
  float cloud = 0.5 * n1 + 0.32 * n2 + 0.18 * noise(g * 5.1 + 9.7);
  float core = smoothstep(-0.5, 1.0, cl);
  float bm = b + 0.1 * (n1 - 0.5);
  float width = 0.17 + 0.09 * core;
  float band = exp(-bm * bm / (width * width));
  vec2 along = vec2(cl, sl);
  float lane = 0.62 * noise(along * 3.6 + b * vec2(12.0, -12.0)) + 0.38 * noise(along * 9.0 + b * vec2(25.0, -25.0) + 5.3);
  float rift = 1.0 - 0.68 * smoothstep(0.46, 0.74, lane + 0.16 * core * exp(-bm * bm / 0.004)) * exp(-bm * bm / (0.45 * width * width));
  float milky = (band * (0.3 + 1.9 * cloud * cloud) + 0.22 * exp(-abs(bm) / (2.2 * width))) * (0.66 + 0.1 * core) * rift;
  col += mix(vec3(0.46, 0.58, 0.9), vec3(0.9, 0.76, 0.6), core * core) * milky * 0.44 * clearAir;

  float lat = asin(clamp(b, -1.0, 1.0));
  vec2 gl = vec2(atan(sl, cl), lat);
  float glitter = band * rift;
  float dust = faint(gl, lat, 46.0, 0.76 - 0.45 * glitter);
  float gh = hash21(floor(gl * 46.0));
  col += vec3(0.8, 0.86, 1.0) * dust * 0.7 * clearAir * (0.75 + 0.25 * sin(u_time * (1.0 + 2.0 * gh) + gh * 40.0));
  col += mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.9, 0.78), core) * faint(gl, lat, 120.0, 0.9 - 0.6 * glitter * (0.4 + 0.6 * cloud)) * 0.55 * clearAir;
  }

  vec3 zenith = mix(vec3(0.035, 0.07, 0.21), vec3(0.1, 0.32, 0.76), day);
  vec3 low = mix(vec3(0.12, 0.18, 0.37), vec3(0.62, 0.79, 0.95), day);
  vec3 air = mix(low, zenith, pow(h, 0.42));
  air *= 1.0 - 0.16 * day * (1.0 - sunward) * (1.0 - haze);
  vec3 ember = mix(vec3(1.0, 0.6, 0.24), vec3(0.95, 0.36, 0.12), deep);
  float toSun = sunward * sunward * sunward;
  air = mix(air, ember, glow * haze * (0.12 + 0.62 * toSun));
  air += glow * ember * (0.25 * exp(-(1.0 - mu) * 7.0 - h * 3.0) + 0.18 * haze * haze * toSun);
  float anti = (1.0 - sunward) * (1.0 - sunward);
  float belt = h - 0.2;
  air += glow * anti * (vec3(0.4, 0.19, 0.25) * exp(-belt * belt / 0.008) - vec3(0.07, 0.06, 0.02) * exp(-h * 16.0));
  air += day * vec3(1.0, 0.95, 0.86) * (0.28 * exp(-(1.0 - mu) * 60.0) + 0.1 * exp(-(1.0 - mu) * 5.0));
  col = mix(col, air, lit);

  vec4 layer = texture2D(u_layer, uv);
  float ci = hash21(floor(gl_FragCoord.xy / (u_resolution.y * 0.011)));
  float twinkle = 1.0 - 0.34 * dark * smoothstep(0.2, 0.7, max(layer.r, max(layer.g, layer.b))) * (0.5 + 0.5 * sin(u_time * (1.3 + 2.2 * ci) + ci * 60.0));
  col += layer.rgb * twinkle * 1.12;

  vec2 sq = p - vec2(u_center, u_view.y) - u_view.x * 2.0 * u_sun.xy / max(1.0 + u_sun.z, 0.2);
  float sd = length(sq);
  float ang = atan(sq.y, sq.x);
  float lowSun = 1.0 - smoothstep(0.0, 0.32, sunSin);
  vec3 sunCol = mix(vec3(1.0, 0.97, 0.9), ember, lowSun * lowSun);
  float beam = pow(0.5 + 0.5 * sin(ang * 9.0 + 2.0 * sin(ang * 4.0 + u_time * 0.04)), 2.0) * exp(-sd * 3.6) * lowSun * 0.2;
  float sunUp = step(-0.2, u_sun.z) * lit * smoothstep(-0.075, 0.005, sunSin);
  col += sunCol * sunUp * (0.8 * exp(-sd * 30.0) + 0.2 * exp(-sd * 5.5) + beam);
  col = mix(col, mix(sunCol, vec3(1.0), 0.5) * 1.3, sunUp * smoothstep(0.013 + px, 0.013 - px, sd));

  col += vec3(0.55, 0.62, 0.8) * moonlight * veil * (0.45 * exp(-md * 0.5) + 0.07 * exp(-md * 0.09));
  float mz = sqrt(max(1.0 - md * md, 0.0));
  float shade = smoothstep(-0.06, 0.1, dot(vec3(mq, mz), u_moonLit.xyz));
  float maria = 0.8 + 0.2 * noise(mq * 2.6 + 3.0) - 0.17 * smoothstep(0.45, 0.7, noise(mq * 1.4 + 7.0));
  vec3 face = vec3(0.93, 0.92, 0.86) * (0.03 + 0.97 * shade);
  face = mix(face, vec3(0.6, 0.17, 0.08), u_moonLit.w) * maria * (0.6 + 0.4 * mz) * veil;
  face = mix(face, col + vec3(0.6, 0.62, 0.66) * shade * maria, lit);
  col = mix(col, face, smoothstep(1.0 + px / u_moon.z, 1.0 - px / u_moon.z, md) * u_moon.w);

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float period = 23.0 + 7.0 * mod(fi * 3.0, 5.0) + fi;
    float turn = u_time / period + fi * 0.37;
    float n = floor(turn);
    float fall = fract(turn) * period / 0.8;
    if (fi >= u_meteors || fall >= 1.0) continue;
    vec2 start = vec2(aspect * (0.08 + 0.84 * hash21(vec2(n, fi + 1.0))), 0.42 + 0.53 * hash21(vec2(fi + 2.0, n)));
    vec2 dir = normalize(vec2(hash21(vec2(n, fi + 5.0)) - 0.5, -0.35 - 0.5 * hash21(vec2(fi + 9.0, n))));
    if (u_radiant.z > 0.5 && i > 0) dir = normalize(start - u_radiant.xy + 0.0001);
    vec2 rel = p - start - dir * fall * (0.1 + 0.16 * hash21(vec2(n + 3.0, fi)));
    col += vec3(0.9, 0.95, 1.0) * dark * sin(3.1416 * fall) * streak(rel, dir, 0.07, px * 1.1);
  }

  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5) continue;
    float t = fract(w.x * 3.7 + w.y * 0.0075);
    float lane = hash21(vec2(w.x * 91.0, 4.0));
    vec2 from = vec2(-0.03, 0.36 + 0.5 * lane);
    vec2 to = vec2(aspect + 0.03, 0.36 + 0.5 * fract(lane * 7.3));
    vec2 sp = w.x > 0.5 ? mix(from, to, t) : mix(to, from, t);
    float sd = length(p - sp);
    col += mix(u_workerColor, vec3(1.0), 0.5 * lit) * (1.0 - 0.7 * day) * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.9, t) * (1.2 * exp(-sd * sd * 350000.0) + 0.3 * exp(-sd * 220.0));
  }

  vec2 nq = p - vec2(focus, 0.905);
  float nd = length(nq);
  float pulse = 0.6 + 0.4 * sin(u_time * 2.4);
  float spikes = exp(-abs(nq.x) * 900.0 - abs(nq.y) * 45.0) + exp(-abs(nq.y) * 900.0 - abs(nq.x) * 45.0);
  col += u_needsYouColor * u_needsYou * pulse * (1.6 * exp(-nd * nd * 60000.0) + 0.4 * exp(-nd * 40.0) + 0.7 * spikes) * (1.0 - 0.5 * day);
  col = mix(col, mix(u_needsYouColor, vec3(1.0), 0.45), day * u_needsYou * (0.55 + 0.45 * pulse) * max(smoothstep(0.0075, 0.0055, nd), 0.7 * smoothstep(0.003, 0.0, abs(nd - 0.013 - 0.004 * pulse))));

  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    if (r.w < 0.5) continue;
    vec2 dir = normalize(vec2(r.x > 0.5 ? -0.8 : 0.8, -0.55));
    vec2 start = vec2(r.x * aspect, 0.9);
    vec2 end = start + dir * 0.42;
    vec3 tint = r.w > 1.5 ? u_errorColor : u_finishedColor;
    float trail = r.w > 1.5 ? 0.0 : day;
    col += mix(tint, vec3(1.0), trail) * (1.4 - 0.6 * trail) * sin(3.1416 * clamp(r.z / 1.6, 0.0, 1.0)) * streak(p - mix(start, end, clamp(r.z / 1.3, 0.0, 1.0)), dir, 0.16 + 0.2 * trail, px * (1.7 + 2.6 * trail));
    float e = length(p - end);
    col += u_errorColor * step(1.5, r.w) * step(1.2, r.z) * smoothstep(0.004, 0.0, abs(e - 0.012 - (r.z - 1.2) * 0.05)) * clamp(1.0 - (r.z - 1.2) / 1.4, 0.0, 1.0) * 0.8;
  }

  float edge = 1.5 * px / u_view.x;
  float farRidge = 0.028 + 0.036 * noise(vec2(az * 2.2 + 3.0, 1.0)) + 0.012 * noise(vec2(az * 7.0, 5.0));
  vec3 hills = mix(vec3(0.018, 0.026, 0.044) + u_palette[3] * 0.035 * side * dark, mix(vec3(0.15, 0.25, 0.24), air, 0.5), day) + glow * (1.0 - day) * ember * 0.1 * sunward * sunward;
  col = mix(col, hills, smoothstep(farRidge + edge, farRidge - edge, sinAlt));
  float tx = az * 64.0;
  float spire = 1.0 - 2.0 * abs(fract(tx) - 0.5);
  float tree = (0.012 + 0.03 * hash21(vec2(floor(tx), 3.0))) * spire * (0.82 + 0.18 * step(0.5, fract(spire * 3.5))) * step(0.22, hash21(vec2(floor(tx), 8.0)));
  float nearRidge = 0.008 + 0.03 * noise(vec2(az * 3.4 + 11.0, 9.0)) + tree;
  float crown = smoothstep(nearRidge - 0.045, nearRidge, sinAlt);
  vec3 trees = mix(vec3(0.035, 0.075, 0.05), mix(vec3(0.07, 0.15, 0.08), vec3(0.2, 0.13, 0.05), step(0.7, hash21(vec2(floor(tx), 21.0)))), crown * (0.5 + 0.5 * spire));
  col = mix(col, mix(vec3(0.005, 0.008, 0.013), trees + 0.12 * air, day * day), smoothstep(nearRidge + edge, nearRidge - edge, sinAlt));

  gl_FragColor = vec4(mix(mix(u_palette[0], vec3(0.72, 0.8, 0.9), day), col, u_intensity), 1.0);
}
`;

const DISPLAY = `"Gill Sans", "Avenir Next", -apple-system, system-ui, sans-serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const TONIGHTS_SKY: ThemePackage = {
  format: 1,
  id: "tonights-sky",
  name: "Tonight's Sky",
  kind: "scene",
  palette: ["#040712", "#8fb0ff", "#e9e6d8", "#c98a52"],
  variants: {
    light: { canvas: "#f5f8fc", ink: "#131a2a", sidebar: "#edf2f8", accent: "#2453c4", accentInk: "#ffffff", selection: "#6f9bf2", error: "#b3261e", warning: "#8a5a10", success: "#1f6b45" },
    dark: { canvas: "#060a16", ink: "#eaeef8", sidebar: "#070b18", accent: "#8fb0ff", accentInk: "#060a16", selection: "#8fb0ff", error: "#ff6b6b", warning: "#ffc266", success: "#7fe8b0" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.74, blur: 22 },
    saturate: 1.15,
    edge: null,
    modes: { light: { sidebar: { opacity: 0.6, blur: 14 }, transcript: { opacity: 0.7, blur: 14 }, composer: { opacity: 0.86, blur: 16 } } },
  },
  type: { heading: DISPLAY, body: BODY, mono: MONO, headingWeight: 600 },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 900 },
  effects: {
    worker: { color: "#7fe8d0", character: "satellite crossing the sky" },
    needsYou: { color: "#ffc266" },
    finished: { color: "#cfe4ff" },
    error: { color: "#ff6b6b" },
  },
  defaults: { intensity: 0.8, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: TONIGHTS_SKY_SHADER,
    uniforms: {
      u_view: [0.6799, 0.267, 0.2419, 0.9703],
      u_center: 0.8,
      u_galPole: [-0.6558, -0.1498, -0.7399],
      u_galCenter: [0.7477, -0.2642, -0.6092],
      u_moon: [0, 0, 0.011, 0],
      u_moonLit: [0, 0, 1, 0],
      u_meteors: 1,
      u_radiant: [0, 0, 0],
      u_sun: [0, -1, 0],
      u_light: [0, 0, 0],
    },
    fallback: { color: "#040712", image: null },
    still: 50,
    backdrop: { dark: "#020308", light: "#ffffff", modes: { light: { dark: "#020308", light: "#ffffff" }, dark: { dark: "#020308", light: "#808aa4" } } },
  },
  credit: { source: "https://github.com/cosinekitty/astronomy", license: "MIT", copyright: "Astronomy Engine, Copyright (c) 2019-2023 Don Cross; stars: Yale Bright Star Catalogue; constellation lines: d3-celestial, Copyright (c) 2015 Olaf Frohn (BSD-3-Clause)" },
};
