import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import type { Appearance } from "./appearance";
import { parseSkyPreview, parseThemeCli, previewInstant, runThemeCli, THEME_CLI_USAGE, type ThemeCliDeps } from "./cli";
import type { Sky } from "./forest/sky";
import type { SkyView } from "./tonight/projection";
import { ThemeService, type ThemeBot } from "./service";
import { ThemeStore } from "./store";
import { THEME_TEMPLATE } from "./template";

describe("parseThemeCli", () => {
  it("reads each command's arguments", () => {
    expect(parseThemeCli(["list"])).toEqual({ ok: true, value: { command: "list", json: false } });
    expect(parseThemeCli(["list", "--json"])).toEqual({ ok: true, value: { command: "list", json: true } });
    expect(parseThemeCli(["show", "grid"])).toEqual({ ok: true, value: { command: "show", id: "grid" } });
    expect(parseThemeCli(["create", "--file", "t.json"])).toEqual({ ok: true, value: { command: "create", file: "t.json" } });
    expect(parseThemeCli(["check", "--file", "t.json", "--json"])).toEqual({ ok: true, value: { command: "check", file: "t.json", json: true } });
    expect(parseThemeCli(["update", "grid", "--file", "p.json", "--new-id", "grid-warm"])).toEqual({ ok: true, value: { command: "update", id: "grid", file: "p.json", newId: "grid-warm" } });
    expect(parseThemeCli(["delete", "ember"])).toEqual({ ok: true, value: { command: "delete", id: "ember" } });
    expect(parseThemeCli(["template"])).toEqual({ ok: true, value: { command: "template" } });
  });

  it("reads apply's Bot, sliders and effect switches, and none", () => {
    expect(parseThemeCli(["apply", "grid", "--bot", "Home", "--intensity", "0.4", "--motion", "0", "--on", "workers,needsyou", "--off", "error"])).toEqual({
      ok: true, value: { command: "apply", themeId: "grid", bot: "Home", intensity: 0.4, motion: 0, effects: { workers: true, needsYou: true, error: false } },
    });
    expect(parseThemeCli(["apply", "none"])).toEqual({ ok: true, value: { command: "apply", themeId: null, bot: null, effects: {} } });
  });

  it("refuses unknown commands and flags, missing values and files, extra words, bad numbers and effects", () => {
    expect(parseThemeCli([])).toEqual({ ok: false, usage: THEME_CLI_USAGE });
    expect(parseThemeCli(["paint"])).toEqual({ ok: false, usage: THEME_CLI_USAGE });
    expect(parseThemeCli(["create"])).toEqual({ ok: false, usage: "bb studio theme create --file <theme.json>" });
    expect(parseThemeCli(["create", "--file"])).toMatchObject({ ok: false, usage: expect.stringContaining("--file needs a value.") });
    expect(parseThemeCli(["list", "--all"])).toMatchObject({ ok: false, usage: expect.stringContaining("Unknown option --all.") });
    expect(parseThemeCli(["show"])).toEqual({ ok: false, usage: "bb studio theme show <id>" });
    expect(parseThemeCli(["delete", "a", "b"])).toEqual({ ok: false, usage: "bb studio theme delete <id>" });
    expect(parseThemeCli(["apply", "grid", "--glass", "1.5"])).toMatchObject({ ok: false, usage: expect.stringContaining("--glass is a number from 0 to 1.") });
    expect(parseThemeCli(["apply", "grid", "--glass", "lots"])).toMatchObject({ ok: false, usage: expect.stringContaining("--glass is a number from 0 to 1.") });
    expect(parseThemeCli(["apply", "grid", "--on", "sparkles"])).toMatchObject({ ok: false, usage: expect.stringContaining("Unknown effect sparkles") });
    expect(parseThemeCli(["apply", "grid", "--on", "error", "--off", "error"])).toMatchObject({ ok: false, usage: expect.stringContaining("error is both on and off.") });
  });
});

describe("runThemeCli", () => {
  const setup = (files: Record<string, string>) => {
    const db = new Database(":memory:");
    for (const migration of MIGRATIONS) db.exec(migration);
    const bots: ThemeBot[] = [{ id: "cos", name: "Chief of Staff", appearance: null }];
    const setAppearance = vi.fn(async (botId: string, appearance: Appearance | null) => { bots.find((bot) => bot.id === botId)!.appearance = appearance; });
    const service = new ThemeService({ store: new ThemeStore(db), bots: () => bots, setAppearance });
    const deps = {
      service,
      readFile: async (path: string) => { if (!(path in files)) throw new Error("ENOENT"); return files[path]!; },
      resolveBot: async (ref: string | null) => (!ref || ref === "cos" ? { id: "cos", name: "Chief of Staff" } : `No Bot ${ref}.`),
    };
    return { run: (argv: string[]) => runThemeCli(argv, deps), service };
  };
  const ember = JSON.stringify({ ...THEME_TEMPLATE, id: "ember", name: "Ember" });

  it("checks a file without saving, creates it marked CLI, applies and deletes it", async () => {
    const { run, service } = setup({ "ember.json": ember, "bad.json": "{", "patch.json": JSON.stringify({ name: "Embers" }) });
    const checked = await run(["check", "--file", "ember.json"]);
    expect(checked).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("Checks passed for ember:") });
    expect(service.get("ember")).toBeNull();
    expect(await run(["check", "--file", "bad.json"])).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("bad.json isn't JSON") });
    expect(await run(["create", "--file", "missing.json"])).toMatchObject({ exitCode: 1, stderr: "Couldn't read missing.json: ENOENT\n" });
    expect(await run(["create", "--file", "ember.json"])).toMatchObject({ exitCode: 0, stdout: expect.stringMatching(/^Saved ember \(Ember\)\./) });
    expect((await run(["list"])).stdout).toContain("ember\tEmber (scene, stored, dark) · made by CLI");
    expect(await run(["update", "ember", "--file", "patch.json"])).toMatchObject({ exitCode: 0, stdout: expect.stringMatching(/^Updated ember \(Embers\)/) });
    expect(await run(["apply", "ember", "--intensity", "0.5"])).toEqual({ exitCode: 0, stdout: "Chief of Staff: ember, intensity 0.5, glass 0.6, motion 0.5, effects workers,finished,needsYou,error\n" });
    expect(await run(["delete", "ember"])).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("ember is in use by Chief of Staff.") });
    expect(await run(["apply", "none"])).toEqual({ exitCode: 0, stdout: "Chief of Staff: no theme\n" });
    expect(await run(["delete", "ember"])).toEqual({ exitCode: 0, stdout: "Deleted ember.\n" });
    expect(await run(["apply", "grid", "--bot", "lab"])).toEqual({ exitCode: 1, stderr: "No Bot lab.\n" });
  });

  it("prints a failed check's report with exit code 1, and usage for bad arguments", async () => {
    const murky = { ...THEME_TEMPLATE, id: "murk", variants: { dark: { ...THEME_TEMPLATE.variants.dark!, ink: "#0a0d14" } } };
    const { run } = setup({ "murk.json": JSON.stringify(murky) });
    const checked = await run(["check", "--file", "murk.json", "--json"]);
    expect(checked.exitCode).toBe(1);
    expect(JSON.parse(checked.stdout!)).toMatchObject({ pass: false, results: expect.arrayContaining([expect.objectContaining({ id: "contrast:dark:sidebar", pass: false })]) });
    expect(await run(["create", "--file", "murk.json"])).toMatchObject({ exitCode: 1, stderr: expect.stringMatching(/^Not saved\.\n- contrast:dark:sidebar/) });
    expect(await run(["show", "grid"])).toMatchObject({ exitCode: 0, stdout: expect.stringMatching(/^grid\tGrid \(scene, builtin, dark\)\n\{/) });
    expect(await run(["nope"])).toEqual({ exitCode: 1, stderr: `usage: ${THEME_CLI_USAGE}\n` });
    expect(JSON.parse((await run(["template"])).stdout!)).toMatchObject({ id: "northern-lights" });
  });
});

describe("bb studio theme weather", () => {
  const sky: Sky = { place: { name: "Brooklyn", latitude: 40.65, longitude: -73.95, source: "city" }, weather: { kind: "rain", code: 63, cloud: 0.9, rain: 0.75, snow: 0, fog: 0, temperature: 9.6, observedAt: 0 } };
  const run = (argv: string[], weather?: { sky(): Promise<Sky>; setCity(city: string | null): Promise<Sky> }) =>
    runThemeCli(["weather", ...argv], { service: {} as never, readFile: async () => "", resolveBot: async () => "none", ...(weather ? { weather } : {}) });

  it("parses showing, setting and clearing the city, and refuses both at once", () => {
    expect(parseThemeCli(["weather"])).toEqual({ ok: true, value: { command: "weather", city: undefined } });
    expect(parseThemeCli(["weather", "--city", " Brooklyn "])).toEqual({ ok: true, value: { command: "weather", city: "Brooklyn" } });
    expect(parseThemeCli(["weather", "--clear"])).toEqual({ ok: true, value: { command: "weather", city: null } });
    expect(parseThemeCli(["weather", "--clear", "--city", "Oslo"])).toEqual({ ok: false, usage: "bb studio theme weather [--city <name> | --clear]" });
  });

  it("prints the place and weather, sets or clears the city, and reports a failed lookup", async () => {
    const weather = { sky: vi.fn(async () => sky), setCity: vi.fn(async (city: string | null) => (city ? sky : { place: null, weather: null })) };
    expect(await run([], weather)).toEqual({ exitCode: 0, stdout: "Place: Brooklyn (40.6, -74.0), from city\nWeather: rain, 10°C\nSource: Open-Meteo.com\n" });
    await run(["--city", "Brooklyn"], weather);
    expect(weather.setCity).toHaveBeenCalledWith("Brooklyn");
    expect(await run(["--clear"], weather)).toEqual({ exitCode: 0, stdout: "Place: none\nWeather: unknown\nSource: Open-Meteo.com\n" });
    weather.setCity.mockRejectedValueOnce(new Error("No place named Atlantis."));
    expect(await run(["--city", "Atlantis"], weather)).toEqual({ exitCode: 1, stderr: "No place named Atlantis.\n" });
    expect(await run([])).toEqual({ exitCode: 1, stderr: "Weather isn't available here.\n" });
  });
});

describe("bb studio theme sky", () => {
  const SKY_USAGE = "bb studio theme sky [--date <yyyy-mm-dd[Thh:mm]> [--time <hh:mm>] | --clear] [--view <follow|south|east|west>]";
  const place = { name: "White Plains", latitude: 41.03, longitude: -73.76, source: "city" as const };
  const night = Date.parse("2026-11-12T02:00:00Z");
  function sky(over: Partial<NonNullable<ThemeCliDeps["sky"]>> = {}) {
    const state = { preview: null as number | null, stored: [] as (number | null)[], view: "follow" as SkyView, views: [] as SkyView[] };
    const deps: NonNullable<ThemeCliDeps["sky"]> = {
      place: async () => place,
      preview: async () => state.preview,
      setPreview: async (at) => { state.stored.push(at); },
      view: async () => state.view,
      setView: async (view) => { state.views.push(view); state.view = view; },
      now: () => night,
      zoneOffsetMinutes: () => -300,
      ...over,
    };
    return { deps, state };
  }
  const run = (argv: string[], deps?: NonNullable<ThemeCliDeps["sky"]>) =>
    runThemeCli(["sky", ...argv], { service: {} as never, readFile: async () => "", resolveBot: async () => "none", ...(deps ? { sky: deps } : {}) });

  it("reads a date, a date with a time, a separate time, and --clear", () => {
    expect(THEME_CLI_USAGE).toContain("|sky|preview>");
    expect(parseThemeCli(["sky"])).toEqual({ ok: true, value: { command: "sky", preview: undefined, view: undefined } });
    expect(parseThemeCli(["sky", "--clear"])).toEqual({ ok: true, value: { command: "sky", preview: null, view: undefined } });
    expect(parseThemeCli(["sky", "--date", "2026-11-17"])).toEqual({ ok: true, value: { command: "sky", preview: { year: 2026, month: 11, day: 17, hour: null, minute: null }, view: undefined } });
    expect(parseThemeCli(["sky", "--date", "2026-11-17T02:00"])).toEqual({ ok: true, value: { command: "sky", preview: { year: 2026, month: 11, day: 17, hour: 2, minute: 0 }, view: undefined } });
    expect(parseThemeCli(["sky", "--date", "2026-11-17", "--time", "2:30"])).toEqual({ ok: true, value: { command: "sky", preview: { year: 2026, month: 11, day: 17, hour: 2, minute: 30 }, view: undefined } });
    expect(previewInstant({ year: 2026, month: 11, day: 17, hour: 2, minute: 30 })).toBe(new Date(2026, 10, 17, 2, 30).getTime());
    expect(previewInstant({ year: 2026, month: 11, day: 17, hour: null, minute: null })).toBe(new Date(2026, 10, 17, 12, 0).getTime());
  });

  it("refuses a bad date or time, a time given twice or alone, and --clear with a date", () => {
    expect(parseSkyPreview("17 Nov", undefined)).toBe("--date is yyyy-mm-dd or yyyy-mm-ddThh:mm.");
    expect(parseSkyPreview("2026-02-30", undefined)).toBe("2026-02-30 isn't a date.");
    expect(parseSkyPreview("2026-11-17", "25:00")).toBe("25:00 isn't a time.");
    expect(parseSkyPreview("2026-11-17T24:10", undefined)).toBe("2026-11-17T24:10 isn't a time.");
    expect(parseSkyPreview("2026-11-17", "2am")).toBe("--time is hh:mm.");
    expect(parseSkyPreview("2026-11-17T02:00", "03:00")).toBe("Give the time once, in --date or in --time.");
    expect(parseSkyPreview("1492-10-12", undefined)).toBe("--date is between 1900 and 2100.");
    expect(parseThemeCli(["sky", "--time", "02:00"])).toEqual({ ok: false, usage: `${SKY_USAGE}\n--time goes with --date.` });
    expect(parseThemeCli(["sky", "--clear", "--date", "2026-11-17"])).toEqual({ ok: false, usage: SKY_USAGE });
    expect(parseThemeCli(["sky", "--date", "soon"])).toEqual({ ok: false, usage: `${SKY_USAGE}\n--date is yyyy-mm-dd or yyyy-mm-ddThh:mm.` });
    expect(parseThemeCli(["sky", "tomorrow"])).toEqual({ ok: false, usage: SKY_USAGE });
  });

  it("prints the place, the time shown, the view, the Moon, the planets up, the meteors and the events", async () => {
    const { deps, state } = sky();
    const result = await run([], deps);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout!.trimEnd().split("\n");
    expect(lines.map((line) => line.split(":")[0])).toEqual(["Place", "Showing", "Sun", "Sky", "Looking", "Variant", "Moon", "Planets up", "Meteors", "Events"]);
    expect(lines[0]).toBe("Place: White Plains (41.0, -73.8), from city");
    expect(lines[1]).toMatch(/^Showing: 2026-11-1[12] \d\d:00 \(the clock\)$/);
    expect(lines[2]).toBe("Sun: 49° below the horizon in the WNW, azimuth 292°");
    expect(lines[3]).toBe("Sky: night");
    expect(lines[4]).toBe("Looking: SE, view Follow the sun, Saturn in view");
    expect(lines[5]).toBe("Variant: dark");
    expect(lines[6]).toBe("Moon: waxing crescent, 7% lit, below the horizon");
    expect(lines[7]).toBe("Planets up: Saturn (50° up in the S, magnitude 0.5)");
    expect(lines[8]).toMatch(/^Meteors: Northern Taurids, peak 2026-11-1[23] \d\d:\d\d, 3 an hour here now \(5 at best\), radiant 43° up; Southern Taurids, /);
    expect(lines[9]).toBe("Events: none");
    expect(state.stored).toEqual([]);
  });

  it("stores a preview time, shows that night with its Leonids and conjunction, and clears it", async () => {
    const { deps, state } = sky();
    state.preview = Date.parse("2026-11-17T07:00:00Z");
    const shown = await run(["--date", "2026-11-17", "--time", "02:00"], deps);
    expect(state.stored).toEqual([new Date(2026, 10, 17, 2, 0).getTime()]);
    expect(shown.stdout).toMatch(/Showing: 2026-11-1[67] \d\d:00 \(preview\)/);
    expect(shown.stdout).toContain("Looking: NE, view Follow the sun, Jupiter in view");
    expect(shown.stdout).toContain("Moon: first quarter, 48% lit, below the horizon");
    expect(shown.stdout).toMatch(/Planets up: Jupiter \(31° up in the E, magnitude -2\.1\), Saturn \(9° up in the W, magnitude 0\.5\), Mars \(31° up in the E, magnitude 0\.7\)/);
    expect(shown.stdout).toMatch(/Meteors: Leonids, peak 2026-11-1[78] \d\d:48, 4 an hour here now \(15 at best\), radiant 33° up/);
    expect(shown.stdout).toContain("Events: Mars 1.3° from Jupiter");
    state.preview = null;
    const cleared = await run(["--clear"], deps);
    expect(state.stored.at(-1)).toBeNull();
    expect(cleared.stdout).toContain("(the clock)");
  });

  it("shows the day for a daytime preview: the Sun's altitude and azimuth, the phase, the view and the variant", async () => {
    const at = (iso: string) => run([], sky({ now: () => Date.parse(iso) }).deps).then((result) => result.stdout!.split("\n"));
    const noon = await at("2026-11-12T17:00:00Z");
    expect(noon[1]).toMatch(/^Showing: 2026-11-1[12] \d\d:00 \(the clock\)$/);
    expect(noon.slice(2, 6)).toEqual(["Sun: 31° up in the S, azimuth 186°", "Sky: day", "Looking: ESE, view Follow the sun, Sun in view", "Variant: light"]);
    const golden = await at("2026-11-12T21:10:00Z");
    expect(golden.slice(2, 6)).toEqual(["Sun: 4° up in the WSW, azimuth 242°", "Sky: golden hour", "Looking: S, view Follow the sun, Sun in view", "Variant: light"]);
    const dusk = await at("2026-11-12T22:10:00Z");
    expect(dusk.slice(2, 6)).toEqual(["Sun: 6° below the horizon in the WSW, azimuth 252°", "Sky: nautical twilight", "Looking: SSW, view Follow the sun, Sun in view", "Variant: dark"]);
    expect((await at("2026-11-12T21:50:00Z")).slice(3, 6)).toEqual(["Sky: civil twilight", expect.stringContaining("Sun in view"), "Variant: light"]);
  });

  it("stores the view, prints it, and looks that way; follow is the default", async () => {
    expect(parseThemeCli(["sky", "--view", "West"])).toEqual({ ok: true, value: { command: "sky", preview: undefined, view: "west" } });
    expect(parseThemeCli(["sky", "--view", "follow", "--clear"])).toEqual({ ok: true, value: { command: "sky", preview: null, view: "follow" } });
    expect(parseThemeCli(["sky", "--date", "2026-11-17", "--view", "east"])).toMatchObject({ ok: true, value: { view: "east", preview: { day: 17 } } });
    expect(parseThemeCli(["sky", "--view", "north"])).toEqual({ ok: false, usage: `${SKY_USAGE}\n--view is one of follow, south, east, west.` });
    expect(parseThemeCli(["sky", "--view"]).ok).toBe(false);
    expect(parseThemeCli(["preview", "--view", "west"]).ok).toBe(false);
    const { deps, state } = sky({ now: () => Date.parse("2026-11-12T17:00:00Z") });
    const west = await run(["--view", "west"], deps);
    expect(state.views).toEqual(["west"]);
    expect(state.stored).toEqual([]);
    expect(west.stdout).toContain("Looking: W, view West\n");
    expect((await run([], deps)).stdout).toContain("Looking: W, view West\n");
    expect((await run(["--view", "east"], deps)).stdout).toContain("Looking: E, view East\n");
    expect((await run(["--view", "south"], deps)).stdout).toContain("Looking: S, view South\n");
    expect((await run(["--view", "follow"], deps)).stdout).toContain("Looking: ESE, view Follow the sun, Sun in view\n");
    expect(state.views).toEqual(["west", "east", "south", "follow"]);
  });

  it("uses the clock's offset with no place, and reports a failure", async () => {
    const nowhere = await run([], sky({ place: async () => null }).deps);
    expect(nowhere.stdout).toContain("Place: 40.0, -75.0, from the clock's offset");
    expect(await run([], sky({ place: async () => { throw new Error("The settings can't be read."); } }).deps)).toEqual({ exitCode: 1, stderr: "The settings can't be read.\n" });
    expect(await run([])).toEqual({ exitCode: 1, stderr: "The sky isn't available here.\n" });
  });
});

describe("bb studio theme preview", () => {
  const USAGE = "bb studio theme preview [--date <yyyy-mm-dd[Thh:mm]> [--time <hh:mm>] | --clear]";
  const KYOTO = { name: "Kyoto, Japan", latitude: 35, longitude: 135.8, source: "city" as const };
  const rain: Sky = { place: KYOTO, weather: { kind: "rain", code: 63, cloud: 1, rain: 0.75, snow: 0, fog: 0, temperature: 9.6, observedAt: 0 } };

  function preview(now: string) {
    const state = { preview: null as number | null, stored: [] as (number | null)[] };
    const deps: Pick<ThemeCliDeps, "sky" | "weather"> = {
      sky: { place: async () => KYOTO, preview: async () => state.preview, setPreview: async (at) => { state.stored.push(at); state.preview = at; }, view: async () => "follow", setView: async () => {}, now: () => Date.parse(now), zoneOffsetMinutes: () => 540 },
      weather: { sky: async () => rain, setCity: async () => rain },
    };
    return { state, run: (argv: string[]) => runThemeCli(["preview", ...argv], { service: {} as never, readFile: async () => "", resolveBot: async () => "none", ...deps }) };
  }

  it("reads a date, a date with a time, a separate time and --clear, as theme sky does", () => {
    expect(parseThemeCli(["preview"])).toEqual({ ok: true, value: { command: "preview", preview: undefined } });
    expect(parseThemeCli(["preview", "--clear"])).toEqual({ ok: true, value: { command: "preview", preview: null } });
    expect(parseThemeCli(["preview", "--date", "2027-04-03"])).toEqual({ ok: true, value: { command: "preview", preview: { year: 2027, month: 4, day: 3, hour: null, minute: null } } });
    expect(parseThemeCli(["preview", "--date", "2027-01-20T21:30"])).toEqual({ ok: true, value: { command: "preview", preview: { year: 2027, month: 1, day: 20, hour: 21, minute: 30 } } });
    expect(parseThemeCli(["preview", "--date", "2027-01-20", "--time", "6:05"])).toEqual({ ok: true, value: { command: "preview", preview: { year: 2027, month: 1, day: 20, hour: 6, minute: 5 } } });
    expect(parseThemeCli(["preview", "--time", "06:05"])).toEqual({ ok: false, usage: `${USAGE}\n--time goes with --date.` });
    expect(parseThemeCli(["preview", "--clear", "--date", "2027-01-20"])).toEqual({ ok: false, usage: USAGE });
    expect(parseThemeCli(["preview", "--date", "2027-02-30"])).toEqual({ ok: false, usage: `${USAGE}\n2027-02-30 isn't a date.` });
    expect(parseThemeCli(["preview", "spring"])).toEqual({ ok: false, usage: USAGE });
  });

  it("prints the place, the time shown, the season, the time of day, the variant and the weather from the clock", async () => {
    const { run, state } = preview("2026-11-11T03:00:00Z");
    const result = await run([]);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout!.trimEnd().split("\n");
    expect(lines.map((line) => line.split(":")[0])).toEqual(["Place", "Showing", "Season", "Time of day", "Variant", "Weather"]);
    expect(lines[0]).toBe("Place: Kyoto, Japan (35.0, 135.8), from city");
    expect(lines[1]).toMatch(/^Showing: 2026-11-1[01] \d\d:00 \(the clock\)$/);
    expect(lines[2]).toBe("Season: autumn");
    expect(lines[3]).toBe("Time of day: day, Sun 37.4° up");
    expect(lines[4]).toBe("Variant: light");
    expect(lines[5]).toBe("Weather: rain, 10°C");
    expect(state.stored).toEqual([]);
  });

  it("stores a preview time in the setting Tonight's Sky reads, shows that date's season and hour with fair weather, and clears it", async () => {
    const { run, state } = preview("2026-11-11T03:00:00Z");
    const shown = await run(["--date", "2027-01-20", "--time", "21:30"]);
    expect(state.stored).toEqual([new Date(2027, 0, 20, 21, 30).getTime()]);
    expect(shown.stdout).toMatch(/Showing: 2027-01-2[01] \d\d:30 \(preview\)/);
    expect(shown.stdout).toContain("Season: winter");
    expect(shown.stdout).toContain("Weather: fair, for a preview");
    state.preview = Date.parse("2026-11-24T12:30:00Z");
    const night = await run([]);
    expect(night.stdout).toMatch(/Season: autumn, 1\d% winter/);
    expect(night.stdout).toContain("Time of day: night, Sun 57.4° below the horizon");
    expect(night.stdout).toContain("Variant: dark");
    const cleared = await run(["--clear"]);
    expect(state.stored.at(-1)).toBeNull();
    expect(cleared.stdout).toContain("(the clock)");
    expect(cleared.stdout).toContain("Variant: light");
  });

  it("reports that it isn't available without the settings", async () => {
    expect(await runThemeCli(["preview"], { service: {} as never, readFile: async () => "", resolveBot: async () => "none" })).toEqual({ exitCode: 1, stderr: "The preview isn't available here.\n" });
  });
});
