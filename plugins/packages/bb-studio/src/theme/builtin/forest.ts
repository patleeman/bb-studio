import type { ThemePackage } from "../schema";

export const FOREST_SHADER = `uniform float u_daylight;
uniform float u_twilight;
uniform float u_sunHeight;
uniform float u_cloud;
uniform float u_rain;
uniform float u_snow;
uniform float u_fog;

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

vec3 skyColor(float h) {
  vec3 nightTop = vec3(0.027, 0.039, 0.086);
  vec3 nightLow = vec3(0.09, 0.11, 0.18);
  vec3 dayTop = vec3(0.30, 0.48, 0.68);
  vec3 dayLow = vec3(0.62, 0.72, 0.78);
  vec3 top = mix(nightTop, dayTop, u_daylight);
  vec3 low = mix(nightLow, dayLow, u_daylight);
  vec3 col = mix(low, top, smoothstep(0.0, 1.0, h));
  vec3 dusk = mix(vec3(0.765, 0.58, 0.47), vec3(0.525, 0.408, 0.435), smoothstep(0.0, 0.25, h));
  dusk = mix(dusk, vec3(0.227, 0.231, 0.369), smoothstep(0.25, 0.6, h));
  dusk = mix(dusk, vec3(0.09, 0.11, 0.2), smoothstep(0.6, 1.0, h));
  col = mix(col, dusk, u_twilight * 0.85);
  float grey = dot(col, vec3(0.3, 0.55, 0.15));
  return mix(col, vec3(grey) * vec3(0.95, 0.97, 1.0), u_cloud * 0.7);
}

float pineLayer(vec2 p, float base, float height, float seed, float gap) {
  float cw = height * 0.16;
  float sway = sin(u_time * 0.3 + p.x * 2.5 + seed * 1.7) + 0.5 * sin(u_time * 0.71 + p.x * 4.0 + seed);
  float cell = floor(p.x / cw);
  float inside = step(p.y, base);
  for (int k = -1; k <= 1; k++) {
    float id = cell + float(k);
    float h1 = hash21(vec2(id, seed));
    float h2 = hash21(vec2(seed, id));
    float cx = (id + 0.5 + 0.35 * (h1 - 0.5)) * cw;
    if (gap > 0.0 && cx > 0.36 * gap && cx < 0.87 * gap) continue;
    float th = height * (0.6 + 0.6 * h2);
    float t = (p.y - base) / th;
    float tiers = 0.55 + 0.45 * (1.0 - fract(t * (5.0 + floor(h1 * 4.0))));
    float hw = th * 0.18 * (1.0 - t) * tiers;
    float x = p.x - cx - sway * th * 0.022 * max(t, 0.0) * max(t, 0.0);
    inside = max(inside, step(0.0, t) * step(t, 1.0) * step(abs(x), hw));
    inside = max(inside, step(abs(x), th * 0.012) * step(base - th * 0.05, p.y) * step(p.y, base + th * 0.1));
  }
  return inside;
}

float rainLayer(vec2 p, float scale, float speed, float seed) {
  vec2 q = vec2(p.x * scale + p.y * scale * 0.12, p.y * scale * 0.22 + u_time * speed);
  vec2 id = floor(q);
  vec2 f = fract(q);
  float h = hash21(id + seed);
  float x = abs(f.x - (0.15 + 0.7 * h));
  return smoothstep(0.07, 0.0, x) * smoothstep(0.0, 0.35, f.y) * smoothstep(1.0, 0.65, f.y) * step(0.45, fract(h * 7.3));
}

float snowLayer(vec2 p, float scale, float speed, float seed) {
  vec2 q = p * scale + vec2(0.0, u_time * speed);
  vec2 id = floor(q);
  vec2 f = fract(q);
  float h = hash21(id + seed);
  vec2 c = vec2(0.5 + 0.3 * sin(u_time * 0.6 + h * 6.28), 0.3 + 0.4 * fract(h * 3.7));
  return smoothstep(0.12, 0.04, length(f - c)) * step(0.35, h);
}

float fireflies(vec2 p, float scale, float seed) {
  vec2 q = p * scale;
  vec2 id = floor(q);
  vec2 f = fract(q);
  float h = hash21(id + seed);
  float ph = h * 6.2832;
  float rate = 0.5 + 1.1 * fract(h * 5.1);
  vec2 c = vec2(0.5 + 0.3 * sin(u_time * 0.4 * rate + ph), 0.5 + 0.3 * cos(u_time * 0.5 * rate + ph * 1.3));
  float blink = max(0.0, sin(u_time * rate + ph));
  float d = length(f - c);
  return step(0.55, h) * blink * blink * (exp(-d * d * 520.0) + 0.35 * exp(-d * d * 80.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float dark = 1.0 - u_daylight;

  float skyH = clamp((uv.y - 0.36) / 0.64, 0.0, 1.0);
  vec3 col = skyColor(skyH);
  vec3 horizon = skyColor(0.05);

  vec2 starCell = gl_FragCoord.xy / (u_resolution.y * 0.007);
  float star = step(0.985, hash21(floor(starCell))) * smoothstep(0.3, 0.05, length(fract(starCell) - 0.5));
  col += vec3(0.85, 0.9, 1.0) * star * dark * (1.0 - u_twilight) * (1.0 - u_cloud) * smoothstep(0.2, 0.6, skyH);

  float strip = max(u_resolution.x - u_clear.z, 0.0);
  float open = strip > 0.09 * u_resolution.x ? (u_clear.z + 0.5 * strip) / u_resolution.x : 0.736;
  vec2 sunP = vec2(open * aspect, 0.6 + 0.35 * u_sunHeight);
  float sd = length(p - sunP);
  col += vec3(1.0, 0.75, 0.55) * 0.35 * exp(-sd * 3.0) * u_twilight * (1.0 - u_cloud * 0.5);
  col += vec3(0.95, 0.92, 0.84) * smoothstep(0.019, 0.016, sd) * u_daylight * (1.0 - u_twilight) * (1.0 - u_cloud * 0.9) * step(0.0, u_sunHeight);
  col += vec3(1.0, 0.95, 0.85) * 0.25 * exp(-sd * 6.0) * u_daylight * (1.0 - u_cloud * 0.8);
  vec2 moonP = vec2(open * aspect, 0.8);
  col += vec3(0.85, 0.88, 0.95) * smoothstep(0.024, 0.02, length(p - moonP)) * dark * (1.0 - u_twilight) * (1.0 - u_cloud * 0.85);

  vec2 cp = vec2(p.x * 2.2 + u_time * 0.03, p.y * 5.0);
  float cn = noise(cp) * 0.55 + noise(cp * 2.1 + vec2(3.0 + u_time * 0.02, 3.0)) * 0.3 + noise(cp * 4.3 + 9.0) * 0.15;
  float cover = max(u_cloud, 0.42);
  float clouds = smoothstep(1.05 - cover, 1.3 - cover * 0.6, cn) * smoothstep(0.1, 0.4, skyH);
  vec3 cloudCol = mix(vec3(0.16, 0.17, 0.22), vec3(0.88, 0.9, 0.93), u_daylight);
  cloudCol = mix(cloudCol, vec3(0.62, 0.48, 0.5), u_twilight * 0.6);
  col = mix(col, cloudCol, clouds * 0.85);

  vec3 nearPine = mix(vec3(0.02, 0.035, 0.04), vec3(0.08, 0.15, 0.1), u_daylight);
  nearPine = mix(nearPine, vec3(0.047, 0.075, 0.075), u_twilight * 0.6);
  vec3 mist = mix(horizon, vec3(0.8, 0.82, 0.86) * (0.3 + 0.7 * u_daylight), 0.3);
  float fogLift = u_fog * 0.35;

  float b0 = pineLayer(p, 0.633, 0.078, 1.0, 0.0);
  col = mix(col, mix(nearPine, horizon, min(1.0, 0.68 + fogLift)), b0);
  col = mix(col, mist, (0.25 + u_fog * 0.4) * smoothstep(0.633 + 0.05, 0.633, uv.y) * smoothstep(0.55, 0.633, uv.y));
  float b1 = pineLayer(p, 0.572, 0.122, 2.0, 0.0);
  col = mix(col, mix(nearPine, horizon, min(1.0, 0.52 + fogLift)), b1);
  col = mix(col, mist, (0.22 + u_fog * 0.4) * smoothstep(0.572 + 0.07, 0.572, uv.y) * smoothstep(0.47, 0.572, uv.y));
  float b2 = pineLayer(p, 0.494, 0.167, 3.0, 0.0);
  col = mix(col, mix(nearPine, horizon, min(1.0, 0.36 + fogLift)), b2);

  vec2 mp = vec2(p.x * 1.4 - u_time * 0.035, p.y * 7.0 + 0.4 * sin(u_time * 0.11));
  float mn = noise(mp) * 0.6 + noise(mp * 2.3 + vec2(5.0 - u_time * 0.03, 5.0)) * 0.4;
  float band = smoothstep(0.24, 0.42, uv.y) * smoothstep(0.74, 0.5, uv.y);
  col = mix(col, mist, band * smoothstep(0.4, 0.8, mn) * (0.32 + u_fog * 0.4));

  float b3 = pineLayer(p, 0.361, 0.256, 4.0, 0.0);
  col = mix(col, mix(nearPine, horizon, min(1.0, 0.18 + fogLift * 0.8)), b3);
  col = mix(col, mist, (0.15 + u_fog * 0.3) * smoothstep(0.42, 0.361, uv.y) * smoothstep(0.25, 0.361, uv.y));

  vec2 pondC = vec2(open * aspect, 0.08);
  vec2 pq = (p - pondC) / vec2(0.093, 0.019);
  float pond = smoothstep(1.0, 0.94, length(pq));
  vec3 pondCol = mix(skyColor(0.4), nearPine, 0.45);
  float pr = 0.0;
  for (int i = 0; i < 3; i++) {
    float tt = u_time * 0.5 + float(i) * 0.37;
    float cyc = floor(tt);
    vec2 rc = (vec2(hash21(vec2(cyc, float(i))), hash21(vec2(float(i), cyc))) - 0.5) * vec2(1.3, 1.0);
    pr += smoothstep(0.04, 0.0, abs(length((pq - rc) * vec2(1.0, 3.3)) - fract(tt) * 0.5)) * (1.0 - fract(tt));
  }
  pondCol += vec3(0.85, 0.88, 0.94) * pr * u_rain * 0.5;
  col = mix(col, pondCol, pond);

  float b4 = pineLayer(p, -0.033, 0.578, 5.0, aspect);
  col = mix(col, nearPine, b4);

  float bugs = (fireflies(p, 9.0, 11.0) + fireflies(p + vec2(0.31, 0.17), 14.0, 23.0)) * smoothstep(0.62, 0.3, uv.y);
  col += vec3(0.894, 0.949, 0.486) * bugs * max(dark, u_twilight) * (1.0 - u_snow) * (1.0 - u_rain * 0.4);

  float lantern = length((p - vec2(0.86 * aspect, 0.33)) * vec2(1.0, 1.4));
  float pulse = 0.6 + 0.4 * sin(u_time * 2.4);
  col += u_needsYouColor * u_needsYou * pulse * (0.9 * exp(-lantern * 70.0) + 0.3 * exp(-lantern * 12.0));

  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5) continue;
    float glade = (u_open.z - u_open.x) / u_resolution.y;
    float roam = clamp(0.25 * (glade - 0.12), 0.0, 0.083);
    vec2 base = vec2(u_open.x / u_resolution.y + 0.11 + roam + max(glade - 0.13 - 2.0 * roam, 0.0) * fract(w.x * 1.9 + 0.4), 0.4 + 0.2 * fract(w.x * 3.3 + 0.2));
    vec2 wp = base + vec2(roam * sin(w.y * 0.45 + w.x * 6.0) + 0.01 * sin(w.y * 1.3), 0.04 * sin(w.y * 0.9 + w.x * 3.0) + 0.009 * cos(w.y * 1.7));
    float d = length(p - wp);
    float glow = 0.75 + 0.25 * sin(w.y * 2.2);
    col += u_workerColor * glow * openFade(gl_FragCoord.xy) * step(0.001, glade) * (exp(-d * d * 9000.0) * 1.2 + exp(-d * 38.0) * 0.45);
  }

  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    if (r.w < 0.5) continue;
    float e = length(vec2((uv.x - r.x) * aspect, (uv.y - r.y) / 0.24));
    float fade = clamp(1.0 - r.z / 2.6, 0.0, 1.0);
    vec3 rc = r.w > 1.5 ? u_errorColor : u_finishedColor;
    col += rc * smoothstep(0.005, 0.0, abs(e - 0.01 - r.z * 0.04)) * fade * 0.8;
  }

  float rain = rainLayer(p, 90.0, 10.0, 1.0) * 0.8 + rainLayer(p + 0.37, 55.0, 7.0, 2.0);
  col = mix(col, mix(vec3(0.55, 0.6, 0.7), vec3(0.85, 0.88, 0.95), u_daylight), rain * u_rain * 0.3);
  float snow = snowLayer(p, 26.0, 1.4, 3.0) + snowLayer(p + 0.21, 15.0, 0.9, 4.0) * 0.8;
  col = mix(col, vec3(0.92, 0.94, 0.97) * (0.55 + 0.45 * u_daylight), snow * u_snow * 0.85);

  col = mix(col, mist, u_fog * 0.3 * (1.0 - uv.y * 0.5));
  gl_FragColor = vec4(mix(u_palette[0], col, u_intensity), 1.0);
}
`;

const DISPLAY = `"Avenir Next", -apple-system, system-ui, sans-serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const FOREST: ThemePackage = {
  format: 1,
  id: "forest",
  name: "Forest",
  kind: "scene",
  palette: ["#141a22", "#1f272e", "#e4f27c", "#f2a65a"],
  variants: {
    dark: { canvas: "#0f1418", ink: "#eef1ea", sidebar: "#0e1317", accent: "#e4f27c", accentInk: "#1a1f08", selection: "#b9c79a", error: "#ff7a6b", warning: "#f2a65a", success: "#a8d672" },
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
  type: { heading: DISPLAY, body: BODY, mono: MONO, headingWeight: 600 },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 900 },
  effects: {
    worker: { color: "#e4f27c", character: "firefly" },
    needsYou: { color: "#f2a65a" },
    finished: { color: "#ecf896" },
    error: { color: "#ff7a6b" },
  },
  defaults: { intensity: 0.8, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: FOREST_SHADER,
    uniforms: { u_daylight: 0.2, u_twilight: 0.9, u_sunHeight: -0.03, u_cloud: 0.6, u_rain: 0.45, u_snow: 0, u_fog: 0.2 },
    fallback: { color: "#141a22", image: null },
    still: 14,
    backdrop: { dark: "#101615", light: "#d3e2f2" },
  },
  credit: { source: "https://open-meteo.com/", license: "CC BY 4.0", copyright: "Weather data by Open-Meteo.com" },
};
