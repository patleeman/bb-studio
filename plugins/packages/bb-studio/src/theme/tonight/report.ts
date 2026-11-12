import type { Place } from "../forest/sky";
import { skyPhase, skyVariant } from "./daylight";
import { compass, eventsNear, nightSky, type SkyBody, type SkyPlace } from "./ephemeris";
import { aimSky, frameAim, VIEW_NAMES, type SkyView } from "./projection";

export interface TonightReportInput {
  now: number;
  place: Place | null;
  fallback: SkyPlace;
  previewAt: number | null;
  view: SkyView;
  clock?: (at: number) => string;
}

const two = (value: number) => String(value).padStart(2, "0");

export function localClock(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

const REPORT_VIEW = { width: 1600, height: 1000 } as const;

function where(body: SkyBody): string {
  return `${Math.round(body.altitude)}° up in the ${compass(body.azimuth)}`;
}

export function tonightReport(input: TonightReportInput): string {
  const clock = input.clock ?? localClock;
  const place: SkyPlace = input.place ?? input.fallback;
  const at = input.previewAt ?? input.now;
  const sky = nightSky(new Date(at), place);
  const aim = aimSky(sky, input.view);
  const camera = frameAim(aim, place.latitude, REPORT_VIEW);
  const sun = sky.sun;
  const sunLine = `${sun.altitude >= 0 ? `${Math.round(sun.altitude)}° up` : `${Math.round(-sun.altitude)}° below the horizon`} in the ${compass(sun.azimuth)}, azimuth ${Math.round(sun.azimuth)}°`;
  const placeLine = input.place
    ? `${input.place.name} (${input.place.latitude.toFixed(1)}, ${input.place.longitude.toFixed(1)}), from ${input.place.source}`
    : `${place.latitude.toFixed(1)}, ${place.longitude.toFixed(1)}, from the clock's offset`;
  const showing = `${clock(at)} (${input.previewAt === null ? "the clock" : "preview"})`;
  const moon = sky.moon;
  const moonLine = `${moon.phaseName}, ${Math.round(moon.illuminated * 100)}% lit, ${moon.altitude > 0 ? where(moon) : "below the horizon"}`;
  const up = sky.planets.filter((planet) => planet.altitude > 0).sort((a, b) => a.magnitude - b.magnitude);
  const planets = up.length ? up.map((planet) => `${planet.name} (${where(planet)}, magnitude ${planet.magnitude.toFixed(1)})`).join(", ") : "none";
  const meteors = sky.showers.length
    ? sky.showers.map((each) => `${each.shower.name}${each.peak === null ? "" : `, peak ${clock(each.peak)}`}, ${Math.round(each.visible)} an hour here now (${each.shower.zhr} at best), radiant ${each.radiantAltitude > 0 ? `${Math.round(each.radiantAltitude)}° up` : "below the horizon"}`).join("; ")
    : "no shower active";
  const events = eventsNear(sky, clock);
  return [
    `Place: ${placeLine}`,
    `Showing: ${showing}`,
    `Sun: ${sunLine}`,
    `Sky: ${skyPhase(sun.altitude)}`,
    `Looking: ${compass(camera.azimuth)}, view ${VIEW_NAMES[input.view]}${aim.name ? `, ${aim.name} in view` : ""}`,
    `Variant: ${skyVariant(sun.altitude, null)}`,
    `Moon: ${moonLine}`,
    `Planets up: ${planets}`,
    `Meteors: ${meteors}`,
    `Events: ${events.length ? events.map((event) => event.text).join("; ") : "none"}`,
  ].join("\n");
}
