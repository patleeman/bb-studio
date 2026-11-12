import { describe, expect, it } from "vitest";
import type { SceneLayout } from "../scene/layout";
import { composeSky, MOON_RADIUS, tonightUniforms } from "./compose";
import { nightSky } from "./ephemeris";
import { aimSky, BASE_SCALE, cameraAt, cameraSettled, chooseFocus, easeCamera, focalX, frameAim, frameSky, FOCAL_MAX_Y, HORIZON_Y, project, restCamera, SKY_VIEWS, turnBetween, VIEW_NAMES } from "./projection";

const WHITE_PLAINS = { latitude: 41.03, longitude: -73.76 };
const HONOLULU = { latitude: 21.3, longitude: -157.86 };
const VIEW = { width: 1600, height: 1000 };
const horizontal = (altitude: number, azimuth: number): [number, number, number] => {
  const alt = (altitude * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
  return [Math.cos(alt) * Math.cos(az), -Math.cos(alt) * Math.sin(az), Math.sin(alt)];
};

describe("the view of tonight's sky", () => {
  it("looks south with the horizon low in the window when nothing bright is up, north from the southern hemisphere", () => {
    const camera = frameSky(null, 41, VIEW);
    expect(camera.azimuth).toBe(180);
    expect(camera.anchorX).toBe(0.8);
    expect(project(camera, horizontal(0, 180)).y).toBeCloseTo(HORIZON_Y, 5);
    expect(project(camera, horizontal(0, 180)).x).toBeCloseTo(0.8, 5);
    expect(project(camera, horizontal(70, 180)).y).toBeCloseTo(0.99, 2);
    expect(project(camera, horizontal(30, 150)).x).toBeLessThan(0.8);
    expect(project(camera, horizontal(30, 210)).x).toBeGreaterThan(0.8);
    expect(frameSky(null, -34, VIEW).azimuth).toBe(0);
  });

  it("frames the Moon, else the brightest planet well up, in the strip right of the transcript column", () => {
    const cases: [string, { latitude: number; longitude: number }, string][] = [
      ["2026-11-12T02:00:00Z", WHITE_PLAINS, "Saturn"],
      ["2026-11-17T07:00:00Z", WHITE_PLAINS, "Jupiter"],
      ["2026-11-24T02:00:00Z", WHITE_PLAINS, "Moon"],
      ["2026-03-03T11:33:00Z", HONOLULU, "Moon"],
    ];
    for (const [iso, place, name] of cases) {
      const sky = nightSky(new Date(iso), place);
      const focus = chooseFocus(sky)!;
      expect(focus.name, iso).toBe(name);
      const at = project(frameSky(focus, place.latitude, VIEW), focus.vector);
      expect(at.x, iso).toBeCloseTo(focalX(VIEW), 2);
      expect(at.x * VIEW.height, iso).toBeGreaterThan(1364);
      expect(at.y, iso).toBeLessThanOrEqual(FOCAL_MAX_Y + 1e-6);
      expect(at.y, iso).toBeGreaterThan(HORIZON_Y);
    }
    expect(focalX({ width: 1200, height: 900 })).toBeCloseTo((0.8 * 1200) / 900, 5);
  });

  it("frames the Sun in the open area the layout leaves: beside the transcript, between it and an open side panel, or at the fixed spot when nothing is open", () => {
    const sky = nightSky(new Date("2026-11-12T20:30:00Z"), WHITE_PLAINS);
    const aim = aimSky(sky, "follow");
    expect(aim.name).toBe("Sun");
    const side = (left: number, width: number, height: number) => ({ left, top: 10, right: left + width, bottom: height - 12 });
    const cases: [SceneLayout, number][] = [
      [{ width: 1600, height: 1000, sidebar: 318, panel: null }, 1481.5],
      [{ width: 1600, height: 1000, sidebar: 318, panel: side(1086, 504, 1000) }, 1081],
      [{ width: 2200, height: 1200, sidebar: 318, panel: side(1650, 540, 1200) }, 1519],
      [{ width: 2200, height: 1200, sidebar: 318, panel: side(1290, 900, 1200) }, 1249],
      [{ width: 1600, height: 1000, sidebar: 0, panel: null }, 1402],
      [{ width: 1280, height: 800, sidebar: 318, panel: null }, 1222.4],
      [{ width: 1100, height: 800, sidebar: 318, panel: null }, 880],
    ];
    for (const [layout, x] of cases) {
      const view = { width: layout.width, height: layout.height };
      expect(focalX(view, layout) * view.height, JSON.stringify(layout)).toBeCloseTo(x, 3);
      const at = project(frameAim(aim, WHITE_PLAINS.latitude, view, layout), sky.sun.vector);
      expect(Math.abs(at.x * view.height - x), JSON.stringify(layout)).toBeLessThan(0.012 * view.height);
    }
    expect(focalX(VIEW, { width: 1600, height: 1000, sidebar: 318, panel: null })).toBeCloseTo(focalX(VIEW), 2);
    expect(focalX({ width: 800, height: 500 }, { width: 1600, height: 1000, sidebar: 318, panel: side(1086, 504, 1000) })).toBeCloseTo(1081 / 1000, 5);
  });

  it("composes the stars, thin constellation lines and labels that are above the horizon and in the window", () => {
    const sky = nightSky(new Date("2026-11-12T02:00:00Z"), WHITE_PLAINS);
    const camera = frameSky(chooseFocus(sky), WHITE_PLAINS.latitude, VIEW);
    const picture = composeSky(sky, camera);
    expect(picture.stars.length).toBeGreaterThan(300);
    expect(picture.stars.length).toBeLessThan(1500);
    expect(picture.segments.length).toBeGreaterThan(60);
    for (const star of picture.stars) {
      expect(star.x).toBeGreaterThan(-0.03);
      expect(star.x).toBeLessThan(1.63);
      expect(star.dim).toBeGreaterThan(0);
      expect(star.dim).toBeLessThanOrEqual(1);
    }
    const names = picture.labels.filter((label) => label.kind === "constellation").map((label) => label.text);
    expect(names).toEqual(expect.arrayContaining(["Perseus", "Auriga", "Orion", "Taurus"]));
    expect(names).not.toContain("Scorpius");
    expect(names).not.toContain("Crux");
    expect(picture.labels.filter((label) => label.kind !== "constellation")).toEqual([{ kind: "planet", x: expect.closeTo(1.482, 2), y: expect.any(Number), text: "Saturn" }]);
    expect(picture.planets.map((planet) => planet.id)).toEqual(["saturn"]);
  });

  it("labels a conjunction once for the pair, and a lunar eclipse under a reddened Moon", () => {
    const dawn = nightSky(new Date("2026-11-17T07:00:00Z"), WHITE_PLAINS);
    const labels = composeSky(dawn, frameSky(chooseFocus(dawn), WHITE_PLAINS.latitude, VIEW)).labels.filter((label) => label.kind !== "constellation");
    expect(labels.map((label) => [label.kind, label.text])).toEqual([["event", "Mars · Jupiter 1.3°"]]);

    const eclipse = nightSky(new Date("2026-03-03T11:33:00Z"), HONOLULU);
    const camera = frameSky(chooseFocus(eclipse), HONOLULU.latitude, VIEW);
    const uniforms = tonightUniforms(eclipse, camera);
    expect(uniforms.u_moon).toEqual([expect.closeTo(1.482, 2), expect.any(Number), MOON_RADIUS, 1]);
    expect(uniforms.u_moonLit[3]).toBe(1);
    expect(uniforms.u_moonLit[2]).toBeGreaterThan(0.99);
    expect(composeSky(eclipse, camera).labels.filter((label) => label.kind === "event").map((label) => label.text)).toEqual(["Total lunar eclipse"]);
    const plain = nightSky(new Date("2026-11-24T02:00:00Z"), WHITE_PLAINS);
    expect(tonightUniforms(plain, frameSky(chooseFocus(plain), WHITE_PLAINS.latitude, VIEW)).u_moonLit[3]).toBe(0);
  });

  it("hides the Moon's disk when it is down, and points Leonid meteors away from the radiant in Leo", () => {
    const tonight = nightSky(new Date("2026-11-12T02:00:00Z"), WHITE_PLAINS);
    expect(tonightUniforms(tonight, frameSky(chooseFocus(tonight), WHITE_PLAINS.latitude, VIEW)).u_moon[3]).toBe(0);
    const peak = nightSky(new Date("2026-11-18T07:00:00Z"), WHITE_PLAINS);
    const camera = frameSky(chooseFocus(peak), WHITE_PLAINS.latitude, VIEW);
    const uniforms = tonightUniforms(peak, camera);
    expect(uniforms.u_meteors).toBe(5);
    expect(uniforms.u_radiant[2]).toBe(1);
    const regulus = project(camera, peak.rotation.length ? horizontalOf(peak, 152.09, 11.97) : [0, 0, 0]);
    expect(Math.hypot(uniforms.u_radiant[0] - regulus.x, uniforms.u_radiant[1] - regulus.y)).toBeLessThan(0.2);
  });
});

describe("the view setting", () => {
  it("follows the Sun into the strip right of the transcript while it is up and through civil twilight, then the Moon or a planet", () => {
    expect(SKY_VIEWS).toEqual(["follow", "south", "east", "west"]);
    expect(SKY_VIEWS.map((view) => VIEW_NAMES[view])).toEqual(["Follow the sun", "South", "East", "West"]);
    for (const iso of ["2026-11-12T17:00:00Z", "2026-11-12T21:10:00Z", "2026-06-21T17:00:00Z"]) {
      const sky = nightSky(new Date(iso), WHITE_PLAINS);
      const aim = aimSky(sky, "follow");
      expect(aim.name, iso).toBe("Sun");
      const at = project(frameAim(aim, WHITE_PLAINS.latitude, VIEW), sky.sun.vector);
      expect(at.x * VIEW.height, iso).toBeGreaterThan(1364);
      expect(at.x, iso).toBeLessThanOrEqual(focalX(VIEW) + 1e-6);
      expect(at.y, iso).toBeLessThanOrEqual(FOCAL_MAX_Y + 1e-6);
    }
    const dusk = nightSky(new Date("2026-11-12T22:10:00Z"), WHITE_PLAINS);
    expect(aimSky(dusk, "follow").name).toBe("Sun");
    expect(project(frameAim(aimSky(dusk, "follow"), WHITE_PLAINS.latitude, VIEW), dusk.sun.vector).y).toBeLessThan(HORIZON_Y);
    expect(aimSky(nightSky(new Date("2026-11-12T22:40:00Z"), WHITE_PLAINS), "follow").name).toBe("Moon");
    const night = nightSky(new Date("2026-11-12T02:00:00Z"), WHITE_PLAINS);
    expect(aimSky(night, "follow")).toMatchObject({ name: "Saturn", heading: null });
    expect(frameAim(aimSky(night, "follow"), WHITE_PLAINS.latitude, VIEW)).toEqual(frameSky(chooseFocus(night), WHITE_PLAINS.latitude, VIEW));
  });

  it("looks south, east or west whatever is up", () => {
    const noon = nightSky(new Date("2026-11-12T17:00:00Z"), WHITE_PLAINS);
    for (const [view, azimuth] of [["south", 180], ["east", 90], ["west", 270]] as const) {
      const aim = aimSky(noon, view);
      expect(aim).toEqual({ focus: null, heading: azimuth, name: null });
      expect(frameAim(aim, -34, VIEW)).toEqual(cameraAt(azimuth, BASE_SCALE, 1.6));
    }
  });
});

describe("the camera's easing", () => {
  it("turns the short way round", () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(turnBetween(90, 270)).toBe(-180);
    expect(turnBetween(200, 200)).toBe(0);
  });

  it("eases from south to west without a jump, never overshoots, and has arrived after about two seconds", () => {
    const from = cameraAt(180, BASE_SCALE, 1.6);
    const target = cameraAt(270, 0.55, 1.6, 1.1);
    let motion = restCamera(from);
    let last = from;
    const turns: number[] = [];
    for (let step = 0; step < 61; step += 1) {
      motion = easeCamera(motion, target, 0.033);
      const turned = turnBetween(last.azimuth, motion.camera.azimuth);
      turns.push(turned);
      expect(turned, String(step)).toBeGreaterThanOrEqual(0);
      expect(turned, String(step)).toBeLessThan(4);
      expect(Math.abs(motion.camera.scale - last.scale)).toBeLessThan(0.008);
      expect(Math.abs(motion.camera.anchorX - last.anchorX)).toBeLessThan(0.02);
      expect(turnBetween(motion.camera.azimuth, 270)).toBeGreaterThanOrEqual(0);
      expect(motion.camera.anchorY).toBeCloseTo(cameraAt(0, motion.camera.scale, 1.6).anchorY, 9);
      last = motion.camera;
    }
    expect(turns[0]).toBeLessThan(0.6);
    expect(Math.max(...turns)).toBeGreaterThan(2);
    expect(turnBetween(last.azimuth, 270)).toBeLessThan(1);
    expect(cameraSettled(motion, target)).toBe(false);
    for (let step = 0; step < 40; step += 1) motion = easeCamera(motion, target, 0.033);
    expect(cameraSettled(motion, target)).toBe(true);
    expect(cameraSettled(restCamera(from), target)).toBe(false);
  });

  it("crosses north the short way, and follows a target that moves while it turns", () => {
    let motion = restCamera(cameraAt(350, BASE_SCALE, 1.6));
    for (let step = 0; step < 20; step += 1) motion = easeCamera(motion, cameraAt(20, BASE_SCALE, 1.6), 0.033);
    expect(turnBetween(350, motion.camera.azimuth)).toBeGreaterThan(5);
    expect(turnBetween(350, motion.camera.azimuth)).toBeLessThan(30);
    const before = motion.camera.azimuth;
    motion = easeCamera(motion, cameraAt(300, BASE_SCALE, 1.6), 0.033);
    expect(Math.abs(turnBetween(before, motion.camera.azimuth))).toBeLessThan(2);
  });
});

function horizontalOf(sky: ReturnType<typeof nightSky>, ra: number, dec: number): [number, number, number] {
  const r = (ra * Math.PI) / 180, d = (dec * Math.PI) / 180;
  const v = [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
  const m = sky.rotation;
  return [m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!, m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!, m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!];
}
