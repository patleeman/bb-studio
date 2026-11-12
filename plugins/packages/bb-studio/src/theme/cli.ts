import { parseCliArgs, type CliSpec } from "../cli-args";
import { EFFECTS, type EffectSwitch } from "./appearance";
import type { Place, Sky } from "./forest/sky";
import { gardenReport } from "./kyoto/report";
import { formatListing, formatReport, type ThemeOutcome, type ThemeService } from "./service";
import type { ThemeCreator } from "./store";
import { themeTemplateJson } from "./template";
import { fallbackPlace } from "./tonight/place";
import { SKY_VIEWS, type SkyView } from "./tonight/projection";
import { tonightReport } from "./tonight/report";

export const THEME_CLI_USAGE = "bb studio theme <list|show|create|update|apply|check|delete|template|weather|sky|preview> …";

const USAGE = {
  list: "bb studio theme list [--json]",
  show: "bb studio theme show <id>",
  create: "bb studio theme create --file <theme.json>",
  update: "bb studio theme update <id> --file <patch.json> [--new-id <id>]",
  apply: "bb studio theme apply <id|none> [--bot <id|name>] [--intensity 0-1] [--glass 0-1] [--motion 0-1] [--on workers,finished,needsYou,error] [--off …]",
  check: "bb studio theme check --file <theme.json> [--json]",
  delete: "bb studio theme delete <id>",
  template: "bb studio theme template",
  weather: "bb studio theme weather [--city <name> | --clear]",
  sky: "bb studio theme sky [--date <yyyy-mm-dd[Thh:mm]> [--time <hh:mm>] | --clear] [--view <follow|south|east|west>]",
  preview: "bb studio theme preview [--date <yyyy-mm-dd[Thh:mm]> [--time <hh:mm>] | --clear]",
} as const;
type Command = keyof typeof USAGE;

const SPECS: Record<Command, CliSpec & { positional: number }> = {
  list: { flags: ["--json"], positional: 0 },
  show: { positional: 1 },
  create: { options: ["--file"], positional: 0 },
  update: { options: ["--file", "--new-id"], positional: 1 },
  apply: { options: ["--bot", "--intensity", "--glass", "--motion", "--on", "--off"], positional: 1 },
  check: { options: ["--file"], flags: ["--json"], positional: 0 },
  delete: { positional: 1 },
  template: { positional: 0 },
  weather: { options: ["--city"], flags: ["--clear"], positional: 0 },
  sky: { options: ["--date", "--time", "--view"], flags: ["--clear"], positional: 0 },
  preview: { options: ["--date", "--time"], flags: ["--clear"], positional: 0 },
};

export type ThemeCliCommand =
  | { command: "list"; json: boolean }
  | { command: "show"; id: string }
  | { command: "create"; file: string }
  | { command: "update"; id: string; file: string; newId: string | null }
  | { command: "apply"; themeId: string | null; bot: string | null; intensity?: number; glass?: number; motion?: number; effects: Partial<Record<EffectSwitch, boolean>> }
  | { command: "check"; file: string; json: boolean }
  | { command: "delete"; id: string }
  | { command: "template" }
  | { command: "weather"; city: string | null | undefined }
  | { command: "sky"; preview: SkyPreview | null | undefined; view: SkyView | undefined }
  | { command: "preview"; preview: SkyPreview | null | undefined };

export interface SkyPreview { year: number; month: number; day: number; hour: number | null; minute: number | null }

export function parseSkyPreview(date: string, time: string | undefined): SkyPreview | string {
  const found = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(date.trim());
  if (!found) return "--date is yyyy-mm-dd or yyyy-mm-ddThh:mm.";
  const clock = time === undefined ? null : /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (time !== undefined && !clock) return "--time is hh:mm.";
  if (clock && found[4] !== undefined) return "Give the time once, in --date or in --time.";
  const year = Number(found[1]), month = Number(found[2]), day = Number(found[3]);
  const hour = clock ? Number(clock[1]) : found[4] !== undefined ? Number(found[4]) : null;
  const minute = clock ? Number(clock[2]) : found[5] !== undefined ? Number(found[5]) : null;
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return `${date} isn't a date.`;
  if (year < 1900 || year > 2100) return "--date is between 1900 and 2100.";
  if (hour !== null && (hour > 23 || minute! > 59)) return `${time ?? date} isn't a time.`;
  return { year, month, day, hour, minute };
}

export function previewInstant(preview: SkyPreview): number {
  return new Date(preview.year, preview.month - 1, preview.day, preview.hour ?? 12, preview.minute ?? 0).getTime();
}

export type ParsedThemeCli = { ok: true; value: ThemeCliCommand } | { ok: false; usage: string };

function unitOption(value: string | undefined, name: string): number | undefined | string {
  if (value === undefined) return undefined;
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && number >= 0 && number <= 1 ? number : `${name} is a number from 0 to 1.`;
}

function effectList(value: string | undefined, on: boolean, into: Partial<Record<EffectSwitch, boolean>>): string | null {
  if (value === undefined) return null;
  for (const raw of value.split(",").map((each) => each.trim()).filter(Boolean)) {
    const key = EFFECTS.find((each) => each.toLowerCase() === raw.toLowerCase());
    if (!key) return `Unknown effect ${raw}; one of ${EFFECTS.join(", ")}.`;
    if (into[key] !== undefined && into[key] !== on) return `${key} is both on and off.`;
    into[key] = on;
  }
  return null;
}

export function parseThemeCli(argv: readonly string[]): ParsedThemeCli {
  const name = argv[0] as Command | undefined;
  if (!name || !(name in SPECS)) return { ok: false, usage: THEME_CLI_USAGE };
  const spec = SPECS[name];
  const parsed = parseCliArgs(argv.slice(1), spec);
  if (!parsed.ok) return { ok: false, usage: `${USAGE[name]}\n${parsed.error}` };
  if (parsed.positional.length !== spec.positional) return { ok: false, usage: USAGE[name] };
  const [first] = parsed.positional;
  const file = parsed.options.get("--file");
  const json = parsed.flags.has("--json");
  switch (name) {
    case "list": return { ok: true, value: { command: "list", json } };
    case "show": return { ok: true, value: { command: "show", id: first! } };
    case "delete": return { ok: true, value: { command: "delete", id: first! } };
    case "template": return { ok: true, value: { command: "template" } };
    case "weather": {
      const city = parsed.options.get("--city");
      const clear = parsed.flags.has("--clear");
      if (clear && city !== undefined) return { ok: false, usage: USAGE.weather };
      if (city !== undefined && !city.trim()) return { ok: false, usage: USAGE.weather };
      return { ok: true, value: { command: "weather", city: clear ? null : city?.trim() } };
    }
    case "sky":
    case "preview": {
      const date = parsed.options.get("--date");
      const time = parsed.options.get("--time");
      const clear = parsed.flags.has("--clear");
      const wanted = parsed.options.get("--view")?.trim().toLowerCase();
      const view = SKY_VIEWS.find((each) => each === wanted);
      if (wanted !== undefined && !view) return { ok: false, usage: `${USAGE[name]}\n--view is one of ${SKY_VIEWS.join(", ")}.` };
      const made = (preview: SkyPreview | null | undefined): ParsedThemeCli => ({ ok: true, value: name === "sky" ? { command: "sky", preview, view } : { command: "preview", preview } });
      if (clear) return date === undefined && time === undefined ? made(null) : { ok: false, usage: USAGE[name] };
      if (date === undefined) return time === undefined ? made(undefined) : { ok: false, usage: `${USAGE[name]}\n--time goes with --date.` };
      const preview = parseSkyPreview(date, time);
      return typeof preview === "string" ? { ok: false, usage: `${USAGE[name]}\n${preview}` } : made(preview);
    }
    case "create": return file ? { ok: true, value: { command: "create", file } } : { ok: false, usage: USAGE.create };
    case "check": return file ? { ok: true, value: { command: "check", file, json } } : { ok: false, usage: USAGE.check };
    case "update": return file ? { ok: true, value: { command: "update", id: first!, file, newId: parsed.options.get("--new-id") ?? null } } : { ok: false, usage: USAGE.update };
    case "apply": {
      const sliders: Record<"intensity" | "glass" | "motion", number | undefined> = { intensity: undefined, glass: undefined, motion: undefined };
      for (const key of ["intensity", "glass", "motion"] as const) {
        const value = unitOption(parsed.options.get(`--${key}`), `--${key}`);
        if (typeof value === "string") return { ok: false, usage: `${USAGE.apply}\n${value}` };
        sliders[key] = value;
      }
      const effects: Partial<Record<EffectSwitch, boolean>> = {};
      const problem = effectList(parsed.options.get("--on"), true, effects) ?? effectList(parsed.options.get("--off"), false, effects);
      if (problem) return { ok: false, usage: `${USAGE.apply}\n${problem}` };
      return {
        ok: true,
        value: {
          command: "apply", themeId: first === "none" ? null : first!, bot: parsed.options.get("--bot") ?? null, effects,
          ...(sliders.intensity !== undefined ? { intensity: sliders.intensity } : {}),
          ...(sliders.glass !== undefined ? { glass: sliders.glass } : {}),
          ...(sliders.motion !== undefined ? { motion: sliders.motion } : {}),
        },
      };
    }
  }
}

export interface ThemeCliDeps {
  service: ThemeService;
  readFile(path: string): Promise<string>;
  resolveBot(ref: string | null): Promise<{ id: string; name: string } | string>;
  weather?: { sky(): Promise<Sky>; setCity(city: string | null): Promise<Sky> };
  sky?: { place(): Promise<Place | null>; preview(): Promise<number | null>; setPreview(at: number | null): Promise<void>; view(): Promise<SkyView>; setView(view: SkyView): Promise<void>; now(): number; zoneOffsetMinutes(): number };
}

export function formatSky(sky: Sky): string {
  const place = sky.place ? `${sky.place.name} (${sky.place.latitude.toFixed(1)}, ${sky.place.longitude.toFixed(1)}), from ${sky.place.source}` : "none";
  const weather = sky.weather ? `${sky.weather.kind}${sky.weather.temperature === null ? "" : `, ${Math.round(sky.weather.temperature)}°C`}` : "unknown";
  return `Place: ${place}\nWeather: ${weather}\nSource: Open-Meteo.com`;
}

export type CliResult = { exitCode: number; stdout?: string; stderr?: string };

const CLI_CREATOR: ThemeCreator = { name: "CLI", botId: null };

async function readJson(deps: ThemeCliDeps, file: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let text: string;
  try { text = await deps.readFile(file); } catch (error) { return { ok: false, error: `Couldn't read ${file}: ${error instanceof Error ? error.message : String(error)}` }; }
  try { return { ok: true, value: JSON.parse(text) as unknown }; } catch (error) { return { ok: false, error: `${file} isn't JSON: ${error instanceof Error ? error.message : String(error)}` }; }
}

function outcomeResult(outcome: ThemeOutcome, verb: string): CliResult {
  if (outcome.ok) return { exitCode: 0, stdout: `${verb} ${outcome.theme.id} (${outcome.theme.name}).\n${formatReport(outcome.report)}\n` };
  return { exitCode: 1, stderr: `Not saved.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}${outcome.report ? `\n${formatReport(outcome.report)}` : ""}\n` };
}

export async function runThemeCli(argv: readonly string[], deps: ThemeCliDeps): Promise<CliResult> {
  const parsed = parseThemeCli(argv);
  if (!parsed.ok) return { exitCode: 1, stderr: `usage: ${parsed.usage}\n` };
  const value = parsed.value;
  const { service } = deps;
  switch (value.command) {
    case "list": {
      const entries = service.list();
      return { exitCode: 0, stdout: value.json ? `${JSON.stringify(entries, null, 2)}\n` : `${entries.map(formatListing).join("\n")}\n` };
    }
    case "show": {
      const theme = service.get(value.id);
      const listing = service.listing(value.id);
      if (!theme || !listing) return { exitCode: 1, stderr: `No theme ${value.id}.\n` };
      return { exitCode: 0, stdout: `${formatListing(listing)}\n${JSON.stringify(theme, null, 2)}\n` };
    }
    case "template":
      return { exitCode: 0, stdout: `${themeTemplateJson()}\n` };
    case "check": {
      const input = await readJson(deps, value.file);
      if (!input.ok) return { exitCode: 1, stderr: `${input.error}\n` };
      const report = await service.check(input.value);
      return { exitCode: report.pass ? 0 : 1, stdout: value.json ? `${JSON.stringify({ pass: report.pass, results: report.results }, null, 2)}\n` : `${formatReport(report)}\n` };
    }
    case "create": {
      const input = await readJson(deps, value.file);
      if (!input.ok) return { exitCode: 1, stderr: `${input.error}\n` };
      return outcomeResult(await service.create(input.value, CLI_CREATOR), "Saved");
    }
    case "update": {
      const input = await readJson(deps, value.file);
      if (!input.ok) return { exitCode: 1, stderr: `${input.error}\n` };
      const copying = !!value.newId && value.newId !== value.id;
      return outcomeResult(await service.update(value.id, input.value, { ...(value.newId ? { newId: value.newId } : {}), creator: copying ? CLI_CREATOR : null }), copying ? "Saved a copy as" : "Updated");
    }
    case "apply": {
      const bot = await deps.resolveBot(value.bot);
      if (typeof bot === "string") return { exitCode: 1, stderr: `${bot}\n` };
      const outcome = await service.apply({
        botId: bot.id, themeId: value.themeId, effects: value.effects,
        ...(value.intensity !== undefined ? { intensity: value.intensity } : {}),
        ...(value.glass !== undefined ? { glass: value.glass } : {}),
        ...(value.motion !== undefined ? { motion: value.motion } : {}),
      });
      if (!outcome.ok) return { exitCode: 1, stderr: `Not applied.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}\n` };
      const appearance = outcome.appearance;
      return { exitCode: 0, stdout: appearance ? `${outcome.bot.name}: ${appearance.themeId}, intensity ${appearance.intensity}, glass ${appearance.glass}, motion ${appearance.motion}, effects ${EFFECTS.filter((key) => appearance.effects[key]).join(",") || "none"}\n` : `${outcome.bot.name}: no theme\n` };
    }
    case "weather": {
      if (!deps.weather) return { exitCode: 1, stderr: "Weather isn't available here.\n" };
      try {
        const sky = value.city === undefined ? await deps.weather.sky() : await deps.weather.setCity(value.city);
        return { exitCode: 0, stdout: `${formatSky(sky)}\n` };
      } catch (error) {
        return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
      }
    }
    case "sky": {
      if (!deps.sky) return { exitCode: 1, stderr: "The sky isn't available here.\n" };
      try {
        if (value.preview !== undefined) await deps.sky.setPreview(value.preview === null ? null : previewInstant(value.preview));
        if (value.view !== undefined) await deps.sky.setView(value.view);
        const report = tonightReport({ now: deps.sky.now(), place: await deps.sky.place(), fallback: fallbackPlace(deps.sky.zoneOffsetMinutes()), previewAt: await deps.sky.preview(), view: await deps.sky.view() });
        return { exitCode: 0, stdout: `${report}\n` };
      } catch (error) {
        return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
      }
    }
    case "preview": {
      if (!deps.sky) return { exitCode: 1, stderr: "The preview isn't available here.\n" };
      try {
        if (value.preview !== undefined) await deps.sky.setPreview(value.preview === null ? null : previewInstant(value.preview));
        const sky = deps.weather ? await deps.weather.sky() : { place: await deps.sky.place(), weather: null };
        return { exitCode: 0, stdout: `${gardenReport({ now: deps.sky.now(), sky, previewAt: await deps.sky.preview() })}\n` };
      } catch (error) {
        return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
      }
    }
    case "delete": {
      const outcome = service.remove(value.id);
      return outcome.ok ? { exitCode: 0, stdout: `Deleted ${outcome.id}.\n` } : { exitCode: 1, stderr: `Not deleted.\n${outcome.reasons.map((reason) => `- ${reason}`).join("\n")}\n` };
    }
  }
}
