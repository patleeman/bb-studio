import { tileVec } from "../kyoto/atlas";
import type { ThemePackage } from "../schema";

export const KYOTO_GARDEN_SHADER = `uniform vec4 u_season;
uniform vec4 u_sky;
uniform vec3 u_weather;

vec3 amb;
vec3 sun;
vec3 mistCol;

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

vec4 tile(vec4 r, vec2 uv) {
  vec2 c = clamp(uv, 0.002, 0.998);
  return texture2D(u_layer, vec2(r.x + c.x * r.z, 1.0 - r.y - (1.0 - c.y) * r.w)) * step(abs(uv.x - 0.5), 0.5) * step(abs(uv.y - 0.5), 0.5);
}

float mirror(float x) {
  return 1.0 - abs(1.0 - mod(x, 2.0));
}

vec3 tone(vec4 t) {
  float l = dot(t.rgb, vec3(0.3, 0.55, 0.15)) / max(t.a, 0.02);
  return t.rgb * (amb * 0.9 + sun * (0.28 + 0.62 * l));
}

vec3 over(vec3 col, vec4 t, float haze) {
  return col * (1.0 - t.a) + mix(tone(t), mistCol * t.a, haze);
}

vec4 drift(vec2 p, float scale, vec2 fall, float seed, float soft, float amount, float snowShare) {
  vec2 q = p * scale + fall * u_time;
  vec2 id = floor(q);
  float h = hash21(id + seed);
  float turn = u_time * (0.3 + 0.5 * h) + h * 40.0;
  vec2 d = fract(q) - 0.5 - 0.22 * vec2(sin(turn * 0.7), cos(turn * 0.5));
  float c = cos(turn);
  float s = sin(turn);
  d = vec2(d.x * c - d.y * s, (d.x * s + d.y * c) / (0.45 + 0.55 * abs(cos(turn * 1.3 + h * 9.0)))) / (0.2 + 0.1 * fract(h * 5.0)) + 0.5;
  float kind = floor(fract(h * 3.0) * 2.0) + 2.0 * step(fract(h * 17.0), snowShare);
  float gust = noise(vec2(id.x * 0.4 + u_time * 0.03, id.y * 0.4 + seed));
  return tile(${tileVec("sprites")}, (vec2(kind, 1.0 - soft) + clamp(d, 0.03, 0.97)) / vec2(4.0, 2.0)) * step(abs(d.x - 0.5), 0.5) * step(abs(d.y - 0.5), 0.5) * step(1.0 - amount * (0.25 + 0.75 * gust), fract(h * 7.0));
}

float stars(vec2 c, float cell) {
  float h = hash21(floor(c));
  float b = fract(h * 57.3);
  float d = length(fract(c) - 0.5 - 0.7 * (vec2(fract(h * 17.3), fract(h * 91.7)) - 0.5)) * cell;
  return step(0.7, h) * b * b * smoothstep(1.6, 0.3, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float px = 1.0 / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float strip = max(u_resolution.x - u_clear.z, 0.0);
  float focus = (strip > 0.09 * u_resolution.x ? (u_clear.z + 0.5 * strip) / u_resolution.x : 0.86) * aspect;
  float gap = u_clear.x / u_resolution.x * aspect;
  float sway = sin(u_time * 0.11);
  float spring = u_season.x;
  float summer = u_season.y;
  float autumn = u_season.z;
  float winter = u_season.w;
  float day = u_sky.x;
  float gold = u_sky.y * day;
  float night = 1.0 - day;
  float cloud = u_weather.x;
  float snowy = max(winter * 0.9, u_weather.z);
  float petals = spring + autumn;
  float fallen = autumn / max(petals, 0.001);
  float have = texture2D(u_layer, vec2(0.997, 0.003)).a;
  vec3 white = vec3(0.94, 0.96, 1.0);

  sun = (mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.7, 0.42), gold) * day + vec3(0.1, 0.13, 0.22) * night) * (1.0 - 0.5 * cloud);
  amb = mix(mix(vec3(0.05, 0.075, 0.15), vec3(0.5, 0.58, 0.68), day), vec3(0.56, 0.46, 0.5), gold * 0.5) * (1.0 + 0.4 * cloud);
  vec3 lit = amb + sun;
  mistCol = mix(vec3(0.07, 0.1, 0.17), mix(vec3(0.9, 0.93, 0.95), vec3(1.0, 0.84, 0.7), gold * 0.7), day);

  vec2 g = vec2(p.x + sway * (0.004 + 0.03 * max(0.42 - p.y, 0.0)), p.y);
  float gz = 1.0 / (0.5 - min(g.y, 0.44));
  vec2 gp = vec2((g.x - 0.5 * aspect) * gz, gz);
  float gB = noise(gp * vec2(7.0, 5.0));
  float gC = noise(gp * vec2(31.0, 19.0));

  vec2 pc = vec2(focus - 0.34, 0.265);
  vec2 pd = (g - pc) / vec2(0.52, 0.11);
  vec2 pu = vec2((g.x - focus + 1.0) / 1.44, (g.y - 0.07) / 0.38);
  vec4 mk = tile(${tileVec("mask")}, pu);
  float pond = mix(smoothstep(1.0, 0.985, length(pd)), smoothstep(0.42, 0.58, mk.r), have);
  float wv = noise(vec2(gp.x * 3.0 + u_time * 0.05, gp.y * 8.0 - u_time * 0.07)) - 0.5;
  float ring = 0.0;
  vec3 glint = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float tt = u_time * 0.07 + float(i) * 0.37;
    float cyc = floor(tt);
    float rr = length(pd - (vec2(hash21(vec2(cyc, float(i))), hash21(vec2(float(i), cyc))) - 0.5) * vec2(1.3, 1.1)) - fract(tt) * 0.5;
    ring += sin(rr * 60.0) * exp(-rr * rr * 90.0) * (1.0 - fract(tt));
  }
  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    if (r.w < 0.5) continue;
    float rr = length(pd - vec2((r.x - 0.5) * 1.4, 0.0)) - 0.05 - r.z * 0.34;
    float live = exp(-rr * rr * 70.0) * clamp(1.0 - r.z / 2.6, 0.0, 1.0);
    ring += 2.0 * sin(rr * 50.0) * live;
    glint += (r.w > 1.5 ? u_errorColor : u_finishedColor) * live * 0.4;
  }
  wv += ring * 0.5;
  float haze = summer * day * (1.0 - cloud) * 0.0012 * sin(p.y * 140.0 + u_time * 1.6);
  vec2 q = mix(vec2(p.x + haze, p.y), vec2(g.x + wv * 0.008, 0.42 + (0.42 - g.y) * 1.1 + wv * 0.016), pond);

  float h = clamp((q.y - 0.5) / 0.5, 0.0, 1.0);
  float nA = noise(q * 7.0);
  float nB = noise(q * vec2(19.0, 31.0));
  vec3 skyLow = mix(mix(vec3(0.06, 0.09, 0.17), mix(vec3(0.8, 0.88, 0.93), vec3(0.9, 0.9, 0.86), summer * 0.6), day), vec3(1.0, 0.7, 0.42), min(gold * 1.5, 0.92));
  vec3 skyTop = mix(mix(vec3(0.015, 0.028, 0.075), mix(vec3(0.3, 0.52, 0.8), vec3(0.24, 0.44, 0.78), winter), day), vec3(0.5, 0.45, 0.66), gold * 0.8);
  vec3 col = mix(skyLow, skyTop, pow(h, 0.65 + 0.5 * gold) + 0.02 * (nA - 0.5));
  col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))) * vec3(0.97, 0.98, 1.0), cloud * 0.8);
  vec2 sunAt = vec2(0.3 * aspect, mix(0.98, 0.52, min(gold * 1.4, 1.0)));
  col += mix(vec3(1.0, 0.95, 0.8) * 0.3, vec3(1.0, 0.66, 0.34) * 0.6, gold) * day * (1.0 - 0.7 * cloud) * exp(-length((q - sunAt) * vec2(0.6, 1.0 + 1.2 * gold)) * 2.0);

  vec2 sc = q * u_resolution.y;
  col += white * (0.8 * stars(sc / 6.0, 6.0) + 1.5 * stars(sc / 26.0, 26.0) * (0.75 + 0.25 * sin(u_time * 1.3 + 40.0 * nB))) * night * night * (1.0 - cloud) * smoothstep(0.52, 0.7, q.y);

  vec2 mq = (q - vec2(focus - 0.08, 0.684)) / 0.027;
  float md = length(mq);
  float ph = u_sky.w * 6.2832;
  float moonUp = smoothstep(0.45, 0.9, night) * (1.0 - 0.8 * cloud);
  vec3 face = vec3(1.0, 0.98, 0.9) * (0.06 + 0.94 * smoothstep(-0.08, 0.12, dot(vec3(mq, sqrt(max(1.0 - md * md, 0.0))), vec3(sin(ph), 0.0, -cos(ph))))) * (0.8 + 0.2 * nB - 0.16 * smoothstep(0.45, 0.7, nA));
  col += vec3(0.5, 0.58, 0.8) * moonUp * (0.4 * exp(-md * 0.5) + 0.08 * exp(-md * 0.1));
  col = mix(col, face, smoothstep(1.0 + px / 0.027, 1.0 - px / 0.027, md) * min(moonUp * 1.6, 1.0));

  vec2 cq = vec2(q.x * 0.5 + u_time * 0.006, (q.y - 0.55) / 0.5);
  vec4 c1 = tile(${tileVec("clouds")}, vec2(fract(cq.x), cq.y)) * (0.5 + 0.5 * cloud);
  vec4 c2 = tile(${tileVec("clouds")}, vec2(fract(cq.x * 0.6 + 0.43 - u_time * 0.002), cq.y * 0.7 + 0.24)) * smoothstep(0.2, 0.7, cloud);
  vec3 glow = vec3(0.5, 0.2, 0.1) * gold * (1.0 - h);
  col = col * (1.0 - c2.a) + tone(c2) * 0.9 + glow * c2.a;
  col = col * (1.0 - c1.a) + tone(c1) + glow * c1.a;

  float far = step(q.y, 0.5 + 0.07 * noise(vec2(q.x * 2.5, 3.0))) * (1.0 - have);
  col = mix(col, mix(vec3(0.22, 0.36, 0.16) * lit, mistCol, 0.5), far);

  float x0 = q.x + sway * 0.0015;
  col = over(col, tile(${tileVec("dist")}, vec2(mirror((x0 - gap + 0.9) / 2.56), (q.y - 0.44) / 0.36)), 0.1 + 0.3 * u_sky.z + 0.2 * night);
  float mist = noise(vec2(q.x * 1.6 - u_time * 0.02, q.y * 22.0 + 0.3 * sin(u_time * 0.09)));
  col = mix(col, mistCol, smoothstep(0.66, 0.46, q.y) * smoothstep(0.3, 0.75, mist) * (0.22 + 0.6 * u_sky.z));

  float x2 = q.x + sway * 0.004;
  col = over(col, tile(${tileVec("mid")}, vec2(mirror((x2 - gap + 0.9) / 2.56), (q.y - 0.41) / 0.38)), 0.05 + 0.2 * u_sky.z);
  col = mix(col, mistCol, smoothstep(0.56, 0.44, q.y) * smoothstep(0.4, 0.85, noise(vec2(q.x * 2.3 + u_time * 0.025, q.y * 30.0))) * (0.1 + 0.6 * u_sky.z));

  float rise = max(q.y - 0.42, 0.0);
  if (q.x < 0.7) {
    float bx = q.x + sway * 0.006 - rise * rise * (0.03 + 0.035 * sin(u_time * 0.31 + 3.0 * q.x));
    col = over(col, tile(${tileVec("bamboo")}, vec2((bx - 0.06) / 0.56, (q.y - 0.42) / 0.64)), 0.04 + 0.2 * u_sky.z);
  }

  vec2 lq = (vec2(q.x + sway * 0.004, q.y) - vec2(focus - 0.052, 0.42)) / 0.1;
  float lamp = night * (0.8 + 0.06 * sin(u_time * 1.7)) + u_needsYou * (0.9 + 0.5 * sin(u_time * 2.4));
  vec3 warm = mix(vec3(1.0, 0.68, 0.3), u_needsYouColor, min(u_needsYou, 1.0) * 0.7) * lamp;
  vec2 wn = lq - vec2(0.0, 1.2);
  float wd = length(wn);
  vec2 mu = vec2((q.x + sway * (0.004 + 0.02 * rise) - focus + 1.0) / 1.44, (q.y - 0.38) / 0.64);
  mu += 0.0009 * rise * vec2(sin(u_time * 0.9 + q.y * 46.0 + q.x * 23.0), cos(u_time * 0.7 + q.x * 37.0));
  vec4 mp = tile(${tileVec("maple")}, mu);
  col = over(col, mp, 0.0);
  col += mp.rgb * vec3(1.0, 0.45, 0.15) * gold * 0.3;
  float pane = step(abs(wn.x), 0.105) * step(abs(wn.y), 0.14) * mp.a;
  col += warm * vec3(0.9, 0.55, 0.3) * 0.5 * exp(-wd * 2.2) * mp.a;
  col = mix(col, warm * (1.25 - wd), pane * min(lamp * 1.4, 1.0));
  col += warm * (0.42 * exp(-wd * 2.6) + 0.1 * exp(-wd * 0.75)) * (1.0 - pane);

  if (p.y < 0.46) {
    vec3 shed = mix(mix(vec3(0.98, 0.78, 0.84), mix(vec3(0.72, 0.1, 0.05), vec3(0.95, 0.55, 0.1), fract(gC * 7.0)), fallen), white, snowy * (1.0 - petals));
    float fres = smoothstep(0.12, 0.4, g.y);
    vec3 water = mix(mix(vec3(0.03, 0.06, 0.07), vec3(0.14, 0.21, 0.19), day) + col * 0.55, col * 0.9 + skyLow * 0.1, fres);
    water += lit * (0.1 * ring + 0.05 * smoothstep(0.3, 0.5, wv) * fres) + glint;
    vec2 lc = vec2(gp.x * 8.0 + pond * u_time * 0.02, gp.y * 4.5);
    float lh = hash21(floor(lc));
    vec2 ld = (fract(lc) - 0.5 - 0.6 * (vec2(lh, fract(lh * 13.0)) - 0.5)) * vec2(1.0, 1.7);
    water = mix(water * (1.0 - 0.3 * smoothstep(0.2, 0.1, length(ld - vec2(0.05, -0.05)))), shed * lit, smoothstep(0.16, 0.1, length(ld)) * step(1.0 - petals * 0.3, lh));
    float ice = smoothstep(0.62, 0.86, length(pd) + 0.25 * (gB - 0.5)) * winter;
    water = mix(water, mix(vec3(0.7, 0.8, 0.88), white, smoothstep(0.4, 0.7, gC + 0.4 * (length(pd) - 0.8))) * (amb * 1.1 + sun * 0.8), ice * 0.9);

    vec4 gt = mix(vec4(0.24, 0.36, 0.14, 1.0) * step(g.y, 0.43), tile(${tileVec("ground")}, vec2(mirror(g.x / 2.56), (g.y - 0.07) / 0.38)), have);
    vec4 pt = tile(${tileVec("pond")}, pu);
    float dapple = tile(${tileVec("mask")}, pu + 0.004 * vec2(sin(u_time * 0.5 + g.x * 31.0), cos(u_time * 0.4 + g.y * 57.0))).g;
    vec3 shadow = mix(vec3(1.0), vec3(0.5, 0.58, 0.74), min(dapple * 1.2, 1.0) * 0.64 * day * (1.0 - 0.6 * cloud));
    vec3 ground = mix(tone(gt) * shadow, water * gt.a, pond);
    ground = ground * (1.0 - pt.a) + tone(pt) * mix(shadow, vec3(1.0), pond);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float sr = 0.052 - 0.005 * fi;
      vec4 st = tile(${tileVec("stone")}, (g - vec2(gap - 0.07 + (pc.x - 0.22 - gap) * fi / 4.0 + 0.03 * mod(fi, 2.0), 0.112 + 0.042 * fi)) / vec2(sr * 2.4, sr) + 0.5);
      ground = ground * (1.0 - st.a) + tone(st);
    }
    ground += vec3(1.0, 0.62, 0.28) * (night * 0.8 + u_needsYou) * 0.3 * exp(-length((g - vec2(focus - 0.052, 0.41)) * vec2(1.0, 3.2)) * 7.0) * (0.6 + 0.4 * gC) * gt.a;
    ground = mix(ground, mistCol * gt.a, smoothstep(0.2, 0.42, g.y) * (0.1 + 0.3 * u_sky.z));
    float keep = 1.0 - mp.a * (1.0 - pond) * step(0.36, g.y);
    col = col * (1.0 - gt.a * keep) + ground * keep;
  }

  for (int i = 0; i < 8; i++) {
    vec4 w = u_workers[i];
    if (w.z < 0.5) continue;
    float a = w.y * 0.035 + w.x * 6.2832;
    float lo = max(u_open.x / u_resolution.y + 0.13, pc.x - 0.4);
    float reach = 0.5 * (min(u_open.z / u_resolution.y - 0.03, pc.x + 0.4) - lo);
    float clearing = openFade(gl_FragCoord.xy) * step(0.0, reach);
    vec2 lp = vec2(lo + reach * (1.0 + cos(a) * (0.45 + 0.5 * fract(w.x * 7.3))), pc.y + 0.045 * sin(a * 1.3 + w.x * 4.0) - 0.012);
    vec2 d = (g - lp) / (0.011 + 0.045 * (0.38 - lp.y));
    float body = clearing * step(abs(d.x), 0.7) * step(0.0, d.y) * step(d.y, 1.5);
    float away = length(d - vec2(0.0, 0.7));
    vec3 paper = mix(u_workerColor * (1.25 - 0.5 * away) + vec3(0.25) * day, vec3(0.2, 0.1, 0.05), max(step(0.56, abs(d.x)), step(1.36, d.y)) * 0.8);
    col = mix(col, paper, body);
    col += u_workerColor * clearing * (1.0 - body) * (0.3 * exp(-away * 1.1) * (0.35 + 0.65 * night) + 0.6 * pond * step(d.y, 0.0) * exp(-abs(d.x + wv * 5.0) * 1.6 + d.y * 0.55));
  }

  float fogBand = noise(vec2(p.x * 1.2 - u_time * 0.03, p.y * 6.0 + 0.4 * sin(u_time * 0.1)));
  col = mix(col, mistCol, u_sky.z * smoothstep(0.75, 0.2, p.y) * (0.18 + 0.5 * smoothstep(0.3, 0.8, fogBand)));

  float snowfall = max(u_weather.z, winter * 0.45);
  float amount = max(petals, snowfall);
  float share = snowfall / max(petals + snowfall, 0.001);
  float under = mix(1.0, 0.3 + 0.7 * smoothstep(focus - 1.3, focus - 0.2, p.x), 1.0 - share);
  vec2 wind = p + vec2(0.02 * sin(u_time * 0.23 + p.y * 3.0), 0.0);
  col = over(col, drift(wind, 10.0, vec2(0.26, 0.36), 3.0, 0.0, amount * under, share) * 0.8, 0.25);
  col = over(col, drift(wind + 0.37, 6.0, vec2(0.2, 0.3), 7.0, 0.0, amount * under, share), 0.0);

  if (p.y < 0.1) {
    float vz = 1.0 / (0.5 - p.y);
    float board = (p.x - 0.5 * aspect + sway * 0.016) * vz * 3.4;
    float lip = smoothstep(0.072, 0.074, p.y);
    vec4 dk = tile(${tileVec("deck")}, mix(vec2(fract(board / 8.0), (vz - 2.0) / 0.42), vec2(0.02 + 8.0 * (p.y - 0.072), fract(p.x * 0.8)), lip));
    vec3 deck = tone(dk) * (1.0 - 0.3 * smoothstep(0.012, 0.0, abs(p.y - 0.072))) + skyLow * (0.1 + 0.2 * dk.g) * smoothstep(0.0, 0.07, p.y) * (1.0 - lip);
    deck = mix(vec3(0.5, 0.38, 0.26) * lit, deck, have);
    deck = mix(deck, white * (amb * 1.1 + sun), snowy * 0.75 * smoothstep(0.066, 0.074, p.y + 0.004 * gC));
    col = mix(col * (1.0 - 0.35 * smoothstep(0.1, 0.085, p.y)), deck, smoothstep(0.085 + px, 0.085 - px, p.y) * mix(1.0, dk.a, have));
  }

  float sx = p.x + sway * 0.02;
  if (sx < 0.1) {
    vec4 sh = tile(${tileVec("shoji")}, vec2(max(sx, 0.001) / 0.096, p.y)) * step(0.03 + 0.5 * sx, p.y);
    col = col * (1.0 - 0.25 * smoothstep(0.1, 0.09, sx)) * (1.0 - sh.a) + mix(sh.rgb * vec3(0.62, 0.42, 0.2), tone(sh), day);
  }

  col = over(col, drift(wind + 0.71, 3.5, vec2(0.14, 0.24), 11.0, 1.0, amount * under, share) * 0.9, 0.0);
  if (u_weather.y > 0.0) {
    vec2 rq = vec2(p.x * 80.0 + p.y * 9.0, p.y * 18.0 + u_time * 9.0);
    float rh = hash21(floor(rq));
    float drop = smoothstep(0.07, 0.0, abs(fract(rq.x) - 0.15 - 0.7 * rh)) * smoothstep(0.0, 0.35, fract(rq.y)) * smoothstep(1.0, 0.65, fract(rq.y)) * step(0.45, fract(rh * 7.3));
    col = mix(col, mix(vec3(0.5, 0.56, 0.68), vec3(0.86, 0.9, 0.96), day), drop * u_weather.y * 0.3);
  }
  vec2 bugQ = p * 11.0;
  float bh = hash21(floor(bugQ));
  float rate = 0.5 + 1.1 * fract(bh * 5.1);
  float bd = length(fract(bugQ) - vec2(0.5 + 0.3 * sin(u_time * 0.4 * rate + bh * 6.28), 0.5 + 0.3 * cos(u_time * 0.5 * rate + bh * 8.2)));
  float blink = max(0.0, sin(u_time * rate + bh * 6.28));
  col += vec3(0.85, 0.95, 0.45) * step(0.5, bh) * blink * blink * (exp(-bd * bd * 500.0) + 0.3 * exp(-bd * bd * 60.0)) * smoothstep(0.62, 0.3, p.y) * step(0.1, p.y) * night * summer;
  col *= 0.98 + 0.04 * noise(gl_FragCoord.xy * 0.7);

  gl_FragColor = vec4(mix(mix(vec3(0.03, 0.04, 0.07), u_palette[0], day), col, u_intensity), 1.0);
}
`;

const SERIF = `"Iowan Old Style", Palatino, "Hoefler Text", Georgia, serif`;
const BODY = `-apple-system, "SF Pro Text", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const KYOTO_GARDEN: ThemePackage = {
  format: 1,
  id: "kyoto-garden",
  name: "Kyoto Garden",
  kind: "scene",
  palette: ["#e9e4d6", "#6c675e", "#55702f", "#b0402a"],
  variants: {
    light: { canvas: "#fbf8f1", ink: "#2a2620", sidebar: "#f6f1e7", accent: "#55702f", accentInk: "#ffffff", selection: "#8fa35f", error: "#a8321f", warning: "#8a5a10", success: "#4c6a28" },
    dark: { canvas: "#10141c", ink: "#f0ece2", sidebar: "#0e1219", accent: "#e8a860", accentInk: "#1c1206", selection: "#e8a860", error: "#ff7a6b", warning: "#f2b25a", success: "#a8d672" },
  },
  glass: {
    sidebar: { opacity: 0.2, blur: 6 },
    main: { opacity: 0.03, blur: 0 },
    transcript: { opacity: 0.22, blur: 6 },
    composer: { opacity: 0.5, blur: 10 },
    hud: { opacity: 0.82, blur: 20 },
    saturate: 1.1,
    edge: null,
    modes: { light: { sidebar: { opacity: 0.56, blur: 14 }, transcript: { opacity: 0.7, blur: 14 }, composer: { opacity: 0.86, blur: 16 } } },
  },
  type: { heading: SERIF, body: BODY, mono: MONO, transcript: SERIF, headingWeight: 600 },
  radius: 6,
  motion: { speed: 1, crossfadeMs: 1500 },
  effects: {
    worker: { color: "#ffb45c", character: "paper lantern floating on the pond" },
    needsYou: { color: "#ff8a3c" },
    finished: { color: "#fff3d2" },
    error: { color: "#e0442e" },
  },
  defaults: { intensity: 0.85, glass: 0.7, motion: 0.4 },
  scene: {
    kind: "shader",
    language: "glsl-es-100",
    source: KYOTO_GARDEN_SHADER,
    uniforms: { u_season: [0, 0, 1, 0], u_sky: [1, 0.2, 0, 0.5], u_weather: [0.25, 0, 0] },
    fallback: { color: "#e9e4d6", image: null },
    still: 30,
    backdrop: { dark: "#05070d", light: "#ffffff", modes: { light: { dark: "#383838", light: "#ffffff" }, dark: { dark: "#05070d", light: "#bcbcbc" } } },
  },
  credit: { source: "https://open-meteo.com/", license: "CC BY 4.0", copyright: "Weather data by Open-Meteo.com" },
};
