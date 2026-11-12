import type { Sky } from "../forest/sky";
import { localClock } from "../tonight/report";
import { readGarden } from "./scene";

export interface GardenReportInput {
  now: number;
  sky: Sky | null;
  previewAt: number | null;
  clock?: (at: number) => string;
}

export function gardenReport(input: GardenReportInput): string {
  const clock = input.clock ?? localClock;
  const at = input.previewAt ?? input.now;
  const previewing = input.previewAt !== null;
  const reading = readGarden(new Date(at), input.sky, { liveWeather: !previewing });
  const place = input.sky?.place ?? null;
  const weather = previewing ? null : input.sky?.weather ?? null;
  const blend = Object.entries(reading.weights).filter(([name, share]) => share > 0 && name !== reading.season).map(([name, share]) => `${Math.round(share * 100)}% ${name}`);
  return [
    `Place: ${place ? `${place.name} (${place.latitude.toFixed(1)}, ${place.longitude.toFixed(1)}), from ${place.source}` : "none; the clock and the northern seasons"}`,
    `Showing: ${clock(at)} (${previewing ? "preview" : "the clock"})`,
    `Season: ${reading.season}${blend.length ? `, ${blend.join(", ")}` : ""}`,
    `Time of day: ${reading.hour}, Sun ${Math.abs(reading.elevation)}° ${reading.elevation < 0 ? "below the horizon" : "up"}`,
    `Variant: ${reading.mode}`,
    `Weather: ${previewing ? "fair, for a preview" : weather ? `${weather.kind}${weather.temperature === null ? "" : `, ${Math.round(weather.temperature)}°C`}` : "unknown"}`,
  ].join("\n");
}
