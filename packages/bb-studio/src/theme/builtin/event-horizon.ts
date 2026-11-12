import type { ThemePackage } from "../schema";

export const EVENT_HORIZON_SHADER = `uniform vec2 u_center;
uniform float u_distance;
uniform float u_tilt;
uniform float u_fov;
uniform float u_diskIn;
uniform float u_diskOut;
uniform float u_step;
uniform float u_spin;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 starLayer(vec3 d, float scale, float size, float density) {
  vec3 q = d * scale;
  vec3 id = floor(q);
  float h = hash31(id);
  vec3 jitter = vec3(h, fract(h * 13.7), fract(h * 71.3)) - 0.5;
  float dist = length(fract(q) - 0.5 - jitter * 0.6);
  float star = step(density, h) * exp(-dist * dist / (size * size * scale * scale));
  vec3 tint = mix(vec3(0.86, 0.91, 1.0), vec3(1.0, 0.86, 0.7), step(0.5, fract(h * 37.1)));
  return tint * star * (0.4 + 0.6 * fract(h * 91.7));
}

vec3 sky(vec3 d, float pixel) {
  float a = u_time * 0.004;
  float c = cos(a);
  float s = sin(a);
  d = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
  vec3 col = vec3(0.011, 0.008, 0.007);
  col += vec3(0.3, 0.14, 0.06) * 0.06 * pow(max(dot(d, vec3(-0.6, -0.5, -0.62)), 0.0), 3.0);
  col += vec3(0.28, 0.12, 0.2) * 0.04 * pow(max(dot(d, vec3(0.7, -0.4, -0.59)), 0.0), 3.0);
  col += starLayer(d, 70.0, pixel * 1.3, 0.94) * 0.9;
  col += starLayer(d, 190.0, pixel * 1.1, 0.9) * 0.45;
  return col;
}

vec3 blackbody(float t) {
  vec3 c = mix(vec3(0.7, 0.16, 0.02), vec3(1.0, 0.48, 0.08), smoothstep(0.25, 0.75, t));
  c = mix(c, u_palette[1], smoothstep(0.75, 1.15, t));
  c = mix(c, u_palette[3], smoothstep(1.15, 1.6, t));
  return mix(c, vec3(1.0, 0.92, 0.78), smoothstep(1.6, 2.4, t));
}

vec4 disk(vec3 P, vec3 dir) {
  float r = length(P.xz);
  if (r < u_diskIn || r > u_diskOut) return vec4(0.0);
  float x = u_diskIn / r;
  float flux = 17.6 * x * x * x * (1.0 - sqrt(x));
  vec3 v = vec3(-P.z, 0.0, P.x) / r;
  float beta = sqrt(0.5 / (r - 1.0));
  float gamma = 1.0 / sqrt(1.0 - beta * beta);
  float g = sqrt(1.0 - 1.0 / r) / (gamma * (1.0 - beta * dot(v, -dir)));
  float temp = sqrt(sqrt(flux)) * g;
  float bright = flux * g * g * g;
  float omega = 0.7071 * pow(r, -1.5);
  float ang = atan(P.z, P.x) - u_time * u_spin * omega;
  float bands = 0.8 + 0.2 * sin(r * 7.0 + 3.0 * sin(ang * 2.0 + r * 0.5)) * (0.6 + 0.4 * sin(ang * 7.0 - r * 3.0));
  float edge = smoothstep(u_diskIn, u_diskIn + 0.4, r) * smoothstep(u_diskOut, u_diskOut - 5.0, r);
  float alpha = clamp(bright * 1.6, 0.0, 0.92) * edge;
  return vec4(blackbody(temp) * bright * bands * 4.2 * edge, alpha);
}

void over(vec4 layer, inout vec3 col, inout float cover) {
  col += (1.0 - cover) * layer.rgb;
  cover += (1.0 - cover) * layer.a;
}

vec4 straightDisk(vec3 a, vec3 dir, float tMax) {
  if (abs(dir.y) < 1e-4) return vec4(0.0);
  float t = -a.y / dir.y;
  if (t <= 0.0 || t > tMax) return vec4(0.0);
  return disk(a + dir * t, dir);
}

vec3 bendFar(vec3 pos, vec3 dir, float share) {
  vec3 closest = pos - dir * dot(pos, dir);
  float b = max(length(closest), 1.0);
  return normalize(dir - closest / b * (share * 2.0 / b));
}

void main() {
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  vec2 center = strip > 0.09 * u_resolution.x ? vec2((u_clear.x + 0.82 * (u_clear.z - u_clear.x)) / u_resolution.x, u_center.y) : u_center;
  float dist = u_distance;
  float sys = u_diskOut / (dist * u_fov);
  vec2 sp = (gl_FragCoord.xy - center * u_resolution) / u_resolution.y;
  float pixel = u_fov / u_resolution.y;
  vec3 ro = vec3(0.0, dist * sin(u_tilt), dist * cos(u_tilt));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw + u_fov * (sp.x * rt + sp.y * up));

  vec3 col = vec3(0.0);
  float cover = 0.0;
  float R = u_diskOut + 2.0;
  float b = length(cross(ro, rd));
  float near = dot(ro, rd);
  float h = near * near - dot(ro, ro) + R * R;
  float rmin = b;
  bool captured = false;
  vec3 outDir = rd;

  if (h <= 0.0) {
    over(straightDisk(ro, rd, 1e4), col, cover);
    outDir = bendFar(ro, rd, 1.0);
  } else {
    float tIn = -near - sqrt(h);
    over(straightDisk(ro, rd, tIn), col, cover);
    vec3 pos = ro + rd * tIn;
    vec3 vel = rd;
    vec3 hv = cross(pos, vel);
    float h2 = dot(hv, hv);
    vec3 hit0 = vec3(0.0);
    vec3 dir0 = vec3(0.0);
    vec3 hit1 = vec3(0.0);
    vec3 dir1 = vec3(0.0);
    int hits = 0;
    for (int i = 0; i < 64; i++) {
      float r2 = dot(pos, pos);
      float r = sqrt(r2);
      rmin = min(rmin, r);
      if (r < 1.0) { captured = true; break; }
      if (r > R && dot(pos, vel) > 0.0) break;
      float dt = u_step * r;
      vel += -1.5 * h2 * pos / (r2 * r2 * r) * dt;
      vec3 next = pos + vel * dt;
      if (next.y * pos.y < 0.0) {
        vec3 cross0 = mix(pos, next, pos.y / (pos.y - next.y));
        if (hits == 0) { hit0 = cross0; dir0 = vel; }
        else if (hits == 1) { hit1 = cross0; dir1 = vel; }
        hits += 1;
      }
      pos = next;
    }
    if (hits > 0) over(disk(hit0, normalize(dir0)), col, cover);
    if (hits > 1) over(disk(hit1, normalize(dir1)), col, cover);
    outDir = normalize(vel);
    if (!captured) {
      over(straightDisk(pos, outDir, 1e4), col, cover);
      float s0 = sqrt(max(R * R - b * b, 0.0));
      outDir = bendFar(pos, outDir, 1.0 - s0 / R);
    }
  }

  float ring = exp(-max(rmin - 1.5, 0.0) * 7.0) * (captured ? 0.0 : 1.0);
  col += (1.0 - cover) * u_palette[3] * ring * 0.55;
  if (!captured) col += (1.0 - cover) * sky(outDir, pixel);
  col += u_palette[1] * 0.06 * exp(-length(sp) / sys * 2.4) * (captured ? 0.0 : 1.0);

  vec2 hp = sp;
  float dc = length(hp);
  float pulse = 0.6 + 0.4 * sin(u_time * 2.6);
  col += u_needsYouColor * u_needsYou * pulse * (ring * 0.9 + 0.22 * exp(-dc * 3.0 / sys) * (captured ? 0.0 : 1.0));

  for (int i = 0; i < 4; i++) {
    vec4 rp = u_ripples[i];
    if (rp.w < 0.5) continue;
    float e = length(hp * vec2(1.0, 1.12));
    float fade = clamp(1.0 - rp.z / 2.6, 0.0, 1.0);
    vec3 rc = rp.w > 1.5 ? u_errorColor : u_finishedColor;
    col += rc * exp(-abs(e - sys * (0.33 + rp.z * 0.46)) * 90.0) * fade * 0.5;
  }

  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5) continue;
    float side = center.x * u_resolution.x;
    float wr = clamp(mix(u_open.x - side + 0.13 * u_resolution.y, u_open.z - side - 0.03 * u_resolution.y, fract(w.x * 3.1)) / u_resolution.y, sys * 0.3, sys * 0.85);
    float a = w.x * 6.2832 - w.y * (0.5 / wr) * 0.16;
    a -= 0.6 * sin(a);
    vec2 q = hp;
    q = vec2(q.x * 0.984 - q.y * 0.179, q.x * 0.179 + q.y * 0.984);
    q.y /= 0.3;
    float qa = atan(q.y, q.x);
    float lag = mod(qa - a, 6.2832);
    float radial = abs(length(q) - wr);
    float behind = step(0.0, sin(a)) * step(dc, sys * 0.19);
    vec2 head = vec2(cos(a), sin(a)) * wr;
    float dh = length((q - head) * vec2(1.0, 0.3));
    float tail = step(lag, 0.5) * (1.0 - lag / 0.5) * exp(-radial * 260.0);
    col += u_workerColor * openFade(gl_FragCoord.xy) * step(u_open.x + 1.0, u_open.z) * (1.0 - behind) * (tail * 0.35 + exp(-dh * 160.0) * 1.3 + exp(-dh * 40.0) * 0.25);
  }

  float peak = max(max(col.r, col.g), max(col.b, 1e-4));
  col = mix(col * (1.0 - exp(-peak * 1.3)) / peak, vec3(1.0) - exp(-col * 1.3), 0.45);
  gl_FragColor = vec4(mix(u_palette[0], col, u_intensity), 1.0);
}
`;

const DISPLAY = `"Avenir Next", "SF Pro Display", -apple-system, system-ui, sans-serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const EVENT_HORIZON: ThemePackage = {
  format: 1,
  id: "event-horizon",
  name: "Event Horizon",
  kind: "scene",
  palette: ["#020308", "#ffb54d", "#a9dcff", "#ffd58a"],
  variants: {
    dark: { canvas: "#06070e", ink: "#eef0f6", sidebar: "#070810", accent: "#ffb54d", accentInk: "#1a0e00", selection: "#a9dcff", error: "#ff6b5e", warning: "#ffb54d", success: "#7fe0a8" },
  },
  glass: {
    sidebar: { opacity: 0.14, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.16, blur: 6 },
    composer: { opacity: 0.42, blur: 10 },
    hud: { opacity: 0.72, blur: 26 },
    saturate: 1.25,
    edge: "#ffb54d",
  },
  type: { heading: DISPLAY, body: BODY, mono: MONO, headingWeight: 600 },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 900 },
  effects: {
    worker: { color: "#a9dcff", character: "orbiting particle" },
    needsYou: { color: "#ffb54d" },
    finished: { color: "#ffe2aa" },
    error: { color: "#ff6b5e" },
  },
  defaults: { intensity: 0.7, glass: 0.6, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: EVENT_HORIZON_SHADER,
    uniforms: { u_center: [0.68, 0.64], u_distance: 18, u_tilt: 0.13, u_fov: 1.11, u_diskIn: 3, u_diskOut: 17, u_step: 0.12, u_spin: 1.5 },
    fallback: { color: "#020308", image: null },
    still: 20,
    backdrop: { dark: "#000000", light: "#ffcc7a" },
  },
  credit: null,
};
