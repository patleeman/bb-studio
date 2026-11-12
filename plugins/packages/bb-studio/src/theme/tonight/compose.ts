import { constellationCatalog, equatorialVector, starCatalog, type Vec3 } from "./catalog";
import { skyInk, skyLight, type SkyInk } from "./daylight";
import { rotate, type NightSky, type SkyBody } from "./ephemeris";
import { cameraVector, project, type Camera } from "./projection";

const RAD = Math.PI / 180;

export const MOON_RADIUS = 0.011;
export const LABEL_ALTITUDE = 10;
export const GALACTIC_POLE = equatorialVector(192.85948, 27.12825);
export const GALACTIC_CENTER = equatorialVector(266.40499, -28.93617);

export interface StarDot { x: number; y: number; magnitude: number; color: number; dim: number }
export interface PlanetDot { id: SkyBody["id"]; x: number; y: number; magnitude: number; dim: number }
export interface Segment { x0: number; y0: number; x1: number; y1: number; dim: number }
export interface SkyLabel { kind: "constellation" | "planet" | "event"; x: number; y: number; text: string }

export interface SkyPicture {
  aspect: number;
  ink: SkyInk;
  stars: StarDot[];
  planets: PlanetDot[];
  segments: Segment[];
  labels: SkyLabel[];
}

export interface TonightUniforms {
  u_view: [number, number, number, number];
  u_center: number;
  u_galPole: [number, number, number];
  u_galCenter: [number, number, number];
  u_moon: [number, number, number, number];
  u_moonLit: [number, number, number, number];
  u_meteors: number;
  u_radiant: [number, number, number];
  u_sun: [number, number, number];
  u_light: [number, number, number];
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function extinction(sineAltitude: number): number {
  return 0.22 + 0.78 * smooth(-0.01, 0.26, sineAltitude);
}

function inFrame(point: { x: number; y: number; depth: number }, aspect: number, margin: number): boolean {
  return point.depth > -0.3 && point.x > -margin && point.x < aspect + margin && point.y > -margin && point.y < 1 + margin;
}

export function composeSky(sky: NightSky, camera: Camera): SkyPicture {
  const aspect = camera.aspect;
  const catalog = starCatalog();
  const stars: StarDot[] = [];
  for (let index = 0; index < catalog.count; index += 1) {
    const horizontal = rotate(sky.rotation, [catalog.vectors[index * 3]!, catalog.vectors[index * 3 + 1]!, catalog.vectors[index * 3 + 2]!]);
    if (horizontal[2] < -0.01) continue;
    const point = project(camera, horizontal);
    if (!inFrame(point, aspect, 0.02)) continue;
    stars.push({ x: point.x, y: point.y, magnitude: catalog.magnitudes[index]!, color: catalog.colors[index]!, dim: extinction(horizontal[2]) });
  }

  const segments: Segment[] = [];
  const labels: SkyLabel[] = [];
  for (const constellation of constellationCatalog()) {
    let drawn = 0;
    for (const line of constellation.lines) {
      let previous: { point: { x: number; y: number; depth: number }; sine: number } | null = null;
      for (const vertex of line) {
        const horizontal = rotate(sky.rotation, vertex);
        const current = { point: project(camera, horizontal), sine: horizontal[2] };
        if (previous && previous.sine > -0.02 && current.sine > -0.02 && previous.point.depth > -0.3 && current.point.depth > -0.3 && (inFrame(previous.point, aspect, 0.05) || inFrame(current.point, aspect, 0.05))) {
          segments.push({ x0: previous.point.x, y0: previous.point.y, x1: current.point.x, y1: current.point.y, dim: Math.min(extinction(previous.sine), extinction(current.sine)) });
          drawn += 1;
        }
        previous = current;
      }
    }
    const at = rotate(sky.rotation, constellation.label);
    const point = project(camera, at);
    if (drawn > 0 && at[2] > Math.sin(LABEL_ALTITUDE * RAD) && inFrame(point, aspect, -0.03)) labels.push({ kind: "constellation", x: point.x, y: point.y, text: constellation.name });
  }

  const planets: PlanetDot[] = [];
  const paired = new Set<string>();
  for (const pair of sky.conjunctions) {
    if (pair.a.altitude < 3 || pair.b.altitude < 3) continue;
    const a = project(camera, pair.a.vector), b = project(camera, pair.b.vector);
    if (!inFrame(a, aspect, 0) || !inFrame(b, aspect, 0)) continue;
    paired.add(pair.a.id);
    paired.add(pair.b.id);
    labels.push({ kind: "event", x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 0.03, text: `${pair.a.name} · ${pair.b.name} ${pair.separation.toFixed(1)}°` });
  }
  for (const planet of sky.planets) {
    if (planet.vector[2] < 0) continue;
    const point = project(camera, planet.vector);
    if (!inFrame(point, aspect, 0.02)) continue;
    planets.push({ id: planet.id, x: point.x, y: point.y, magnitude: planet.magnitude, dim: extinction(planet.vector[2]) });
    if (!paired.has(planet.id) && planet.altitude > 3) labels.push({ kind: "planet", x: point.x, y: point.y, text: planet.name });
  }
  const eclipse = sky.moon.eclipse;
  if (eclipse && eclipse.phase !== "penumbral" && sky.moon.altitude > 3) {
    const point = project(camera, sky.moon.vector);
    if (inFrame(point, aspect, 0)) labels.push({ kind: "event", x: point.x, y: point.y - MOON_RADIUS - 0.022, text: `${eclipse.phase === "total" ? "Total" : "Partial"} lunar eclipse` });
  }
  return { aspect, ink: skyInk(skyLight(sky.sun.altitude).daylight), stars, planets, segments, labels };
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function tonightUniforms(sky: NightSky, camera: Camera): TonightUniforms {
  const pitch = camera.pitch * RAD;
  const toCamera = (equatorial: Vec3) => cameraVector(camera, rotate(sky.rotation, equatorial)).map(round) as [number, number, number];
  const moon = sky.moon;
  const at = project(camera, moon.vector);
  const shown = at.depth > 0 && at.x > -0.1 && at.x < camera.aspect + 0.1 && at.y < 1.1 ? smooth(-0.02, 0.12, moon.vector[2]) : 0;
  const toSun: Vec3 = normalize([
    sky.sun.vector[0] - moon.vector[0],
    sky.sun.vector[1] - moon.vector[1],
    sky.sun.vector[2] - moon.vector[2],
  ]);
  const along = toSun[0] * moon.vector[0] + toSun[1] * moon.vector[1] + toSun[2] * moon.vector[2];
  const tangent = normalize([toSun[0] - along * moon.vector[0], toSun[1] - along * moon.vector[1], toSun[2] - along * moon.vector[2]]);
  const nudged = project(camera, normalize([moon.vector[0] + 0.02 * tangent[0], moon.vector[1] + 0.02 * tangent[1], moon.vector[2] + 0.02 * tangent[2]]));
  const length = Math.hypot(nudged.x - at.x, nudged.y - at.y) || 1;
  const sine = Math.sin(moon.phaseAngle * RAD), cosine = Math.cos(moon.phaseAngle * RAD);
  const shower = sky.showers.find((each) => each.visible > 0);
  const radiant = shower ? project(camera, shower.radiant) : null;
  const light = skyLight(sky.sun.altitude);
  return {
    u_view: [round(camera.scale), round(camera.anchorY), round(Math.sin(pitch)), round(Math.cos(pitch))],
    u_center: round(camera.anchorX),
    u_galPole: toCamera(GALACTIC_POLE),
    u_galCenter: toCamera(GALACTIC_CENTER),
    u_moon: [round(at.x), round(at.y), MOON_RADIUS, round(shown)],
    u_moonLit: [round((sine * (nudged.x - at.x)) / length), round((sine * (nudged.y - at.y)) / length), round(cosine), moon.eclipse ? moon.eclipse.level : 0],
    u_meteors: sky.meteorLevel,
    u_radiant: radiant && radiant.depth > -0.2 ? [round(radiant.x), round(radiant.y), 1] : [0, 0, 0],
    u_sun: cameraVector(camera, sky.sun.vector).map(round) as [number, number, number],
    u_light: [light.day, light.glow, light.lit],
  };
}
