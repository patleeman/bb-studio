import { windowColumn } from "../scene/contract";
import { openSpot, type SceneLayout } from "../scene/layout";
import type { Vec3 } from "./catalog";
import type { NightSky, SkyBody } from "./ephemeris";

const RAD = Math.PI / 180;

export const PITCH = 14;
export const HORIZON_Y = 0.1;
export const SKY_TOP_ALTITUDE = 70;
export const FOCAL_MAX_Y = 0.82;
export const FOCAL_FALLBACK_X = 0.8;
export const WIDE_STRIP = 0.09;
export const MOON_FOCUS_ALTITUDE = 6;
export const PLANET_FOCUS_ALTITUDE = 10;
export const PLANET_FOCUS_MAGNITUDE = 1.5;
export const MIN_SCALE = 0.5;
export const MAX_TURN = 100;
export const SHIFT_STEPS = 8;
export const FOCAL_SLACK = 0.01;

const plane = (degrees: number) => 2 * Math.tan((degrees * RAD) / 2);
export const BASE_SCALE = (0.99 - HORIZON_Y) / (plane(PITCH) + plane(SKY_TOP_ALTITUDE - PITCH));

export interface Camera {
  azimuth: number;
  pitch: number;
  scale: number;
  anchorX: number;
  anchorY: number;
  aspect: number;
}

export interface Projected { x: number; y: number; depth: number }

export function cameraVector(camera: Pick<Camera, "azimuth" | "pitch">, horizontal: Vec3): Vec3 {
  const a = camera.azimuth * RAD, p = camera.pitch * RAD;
  const sinA = Math.sin(a), cosA = Math.cos(a), sinP = Math.sin(p), cosP = Math.cos(p);
  const [n, w, z] = horizontal;
  return [
    -sinA * n - cosA * w,
    -sinP * cosA * n + sinP * sinA * w + cosP * z,
    cosP * cosA * n - cosP * sinA * w + sinP * z,
  ];
}

export function project(camera: Camera, horizontal: Vec3): Projected {
  const [x, y, z] = cameraVector(camera, horizontal);
  const k = 2 / Math.max(0.02, 1 + z);
  return { x: camera.anchorX + camera.scale * x * k, y: camera.anchorY + camera.scale * y * k, depth: z };
}

export function cameraAt(azimuth: number, scale: number, aspect: number, anchorX: number = aspect / 2): Camera {
  return { azimuth: ((azimuth % 360) + 360) % 360, pitch: PITCH, scale, anchorX, anchorY: HORIZON_Y + plane(PITCH) * scale, aspect };
}

export function chooseFocus(sky: Pick<NightSky, "moon" | "planets">): SkyBody | null {
  if (sky.moon.altitude >= MOON_FOCUS_ALTITUDE) return sky.moon;
  const planets = sky.planets.filter((planet) => planet.altitude >= PLANET_FOCUS_ALTITUDE && planet.magnitude <= PLANET_FOCUS_MAGNITUDE);
  return planets.length ? planets.reduce((best, each) => (each.magnitude < best.magnitude ? each : best)) : null;
}

export function focalX(view: { width: number; height: number }, layout: SceneLayout | null = null): number {
  if (layout && layout.width > 0) {
    const spot = openSpot(layout, WIDE_STRIP * layout.width);
    return ((spot ? spot.x / layout.width : FOCAL_FALLBACK_X) * view.width) / view.height;
  }
  const column = windowColumn(view);
  const strip = Math.max(0, view.width - column.right);
  return (strip > WIDE_STRIP * view.width ? column.right + strip / 2 : FOCAL_FALLBACK_X * view.width) / view.height;
}

export const SKY_VIEWS = ["follow", "south", "east", "west"] as const;
export type SkyView = (typeof SKY_VIEWS)[number];
export const DEFAULT_VIEW: SkyView = "follow";
export const VIEW_NAMES: Record<SkyView, string> = { follow: "Follow the sun", south: "South", east: "East", west: "West" };
export const VIEW_AZIMUTHS: Record<Exclude<SkyView, "follow">, number> = { south: 180, east: 90, west: 270 };
export const SUN_FOLLOW_ALTITUDE = -9;

export interface SkyAim { focus: Pick<SkyBody, "vector" | "azimuth"> | null; heading: number | null; name: string | null }

export function aimSky(sky: Pick<NightSky, "sun" | "moon" | "planets">, view: SkyView): SkyAim {
  if (view !== "follow") return { focus: null, heading: VIEW_AZIMUTHS[view], name: null };
  if (sky.sun.altitude >= SUN_FOLLOW_ALTITUDE) return { focus: sky.sun, heading: null, name: "Sun" };
  const focus = chooseFocus(sky);
  return { focus, heading: null, name: focus?.name ?? null };
}

export function frameAim(aim: SkyAim, latitude: number, view: { width: number; height: number }, layout: SceneLayout | null = null): Camera {
  return frameSky(aim.focus, latitude, view, aim.heading, layout);
}

export function frameSky(focus: Pick<SkyBody, "vector" | "azimuth"> | null, latitude: number, view: { width: number; height: number }, heading: number | null = null, layout: SceneLayout | null = null): Camera {
  const aspect = view.width / Math.max(1, view.height);
  if (!focus) return cameraAt(heading ?? (latitude >= 0 ? 180 : 0), BASE_SCALE, aspect);
  const target = focalX(view, layout);
  const framed = (anchorX: number) => {
    const fits = (camera: Camera) => {
      const at = project(camera, focus.vector);
      return at.x <= target + 1e-9 && at.y <= FOCAL_MAX_Y;
    };
    let scale = BASE_SCALE;
    while (scale > MIN_SCALE && !fits(cameraAt(focus.azimuth, scale, aspect, anchorX))) scale = Math.max(MIN_SCALE, scale * 0.97);
    let low = 0, high = MAX_TURN;
    for (let step = 0; step < 28; step += 1) {
      const middle = (low + high) / 2;
      if (fits(cameraAt(focus.azimuth - middle, scale, aspect, anchorX))) low = middle; else high = middle;
    }
    return cameraAt(focus.azimuth - low, scale, aspect, anchorX);
  };
  let camera = framed(aspect / 2);
  for (let step = 1; step <= SHIFT_STEPS && project(camera, focus.vector).x < target - FOCAL_SLACK; step += 1) {
    camera = framed(aspect / 2 + ((target - aspect / 2) * step) / SHIFT_STEPS);
  }
  return camera;
}

export const CAMERA_RATE = 3.3;
export const CAMERA_SETTLED = { azimuth: 0.15, scale: 0.002, anchorX: 0.002 } as const;

export interface CameraMotion { camera: Camera; velocity: { azimuth: number; scale: number; anchorX: number } }

export function restCamera(camera: Camera): CameraMotion {
  return { camera, velocity: { azimuth: 0, scale: 0, anchorX: 0 } };
}

export function turnBetween(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function spring(gap: number, velocity: number, seconds: number): { gap: number; velocity: number } {
  const decay = Math.exp(-CAMERA_RATE * seconds);
  const pull = (velocity + CAMERA_RATE * gap) * seconds;
  return { gap: (gap + pull) * decay, velocity: (velocity - CAMERA_RATE * pull) * decay };
}

export function easeCamera(motion: CameraMotion, target: Camera, seconds: number): CameraMotion {
  const azimuth = spring(-turnBetween(motion.camera.azimuth, target.azimuth), motion.velocity.azimuth, seconds);
  const scale = spring(motion.camera.scale - target.scale, motion.velocity.scale, seconds);
  const anchorX = spring(motion.camera.anchorX - target.anchorX, motion.velocity.anchorX, seconds);
  return {
    camera: cameraAt(target.azimuth + azimuth.gap, target.scale + scale.gap, target.aspect, target.anchorX + anchorX.gap),
    velocity: { azimuth: azimuth.velocity, scale: scale.velocity, anchorX: anchorX.velocity },
  };
}

export function cameraSettled(motion: CameraMotion, target: Camera): boolean {
  return Math.abs(turnBetween(motion.camera.azimuth, target.azimuth)) <= CAMERA_SETTLED.azimuth
    && Math.abs(motion.camera.scale - target.scale) <= CAMERA_SETTLED.scale
    && Math.abs(motion.camera.anchorX - target.anchorX) <= CAMERA_SETTLED.anchorX
    && Math.abs(motion.velocity.azimuth) <= CAMERA_SETTLED.azimuth * CAMERA_RATE
    && Math.abs(motion.velocity.scale) <= CAMERA_SETTLED.scale * CAMERA_RATE
    && Math.abs(motion.velocity.anchorX) <= CAMERA_SETTLED.anchorX * CAMERA_RATE;
}
