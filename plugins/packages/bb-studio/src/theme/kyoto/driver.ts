import { loadSkyOverRpc } from "../forest/driver";
import type { Sky } from "../forest/sky";
import type { SceneDriver, SceneLayer } from "../scene/live";
import type { Mode } from "../schema";
import { loadSettingsOverRpc } from "../tonight/driver";
import { ATLAS_SIZE, gardenSpec, specKey } from "./atlas";
import { paintGarden, type GardenContext } from "./paint";
import { readGarden, type KyotoUniforms } from "./scene";

export const GARDEN_TICK_MS = 60_000;
export const GARDEN_WEATHER_MS = 15 * 60_000;
export const GARDEN_PREVIEW_MS = 15_000;
export const FADE_STEP_MS = 50;
export const FADE_STEPS = 30;
export const FADE_ABOVE = 0.08;

export interface GardenCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): GardenContext | null;
}

export function gardenPainter(createCanvas: () => GardenCanvas | null): (uniforms: KyotoUniforms) => SceneLayer | undefined {
  let canvas: GardenCanvas | null | undefined;
  let context: GardenContext | null = null;
  let painted = "";
  let version = 0;
  return (uniforms) => {
    if (canvas === undefined) {
      canvas = createCanvas();
      context = canvas?.getContext("2d") ?? null;
      if (canvas && context) { canvas.width = ATLAS_SIZE; canvas.height = ATLAS_SIZE; }
    }
    if (!canvas || !context) return undefined;
    const spec = gardenSpec(uniforms);
    const key = specKey(spec);
    if (key === painted) return undefined;
    painted = key;
    paintGarden(context, spec);
    version += 1;
    return { source: canvas as unknown as TexImageSource, version };
  };
}

export const browserGardenCanvas = (): GardenCanvas | null => (typeof document === "undefined" ? null : document.createElement("canvas") as unknown as GardenCanvas);

export interface KyotoDriverDeps {
  createCanvas(): GardenCanvas | null;
  loadSky(timeZone: string | null): Promise<Sky>;
  loadPreview(timeZone: string | null): Promise<number | null>;
  now(): number;
  timeZone(): string | null;
  every(ms: number, run: () => void): () => void;
}

export const browserKyotoDeps: KyotoDriverDeps = {
  createCanvas: browserGardenCanvas,
  loadSky: loadSkyOverRpc,
  loadPreview: async (timeZone) => (await loadSettingsOverRpc(timeZone)).previewAt,
  now: () => Date.now(),
  timeZone: () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
  },
  every: (ms, run) => {
    const handle = setInterval(run, ms);
    return () => clearInterval(handle);
  },
};

const KEYS = ["u_season", "u_sky", "u_weather"] as const;

export function uniformGap(a: KyotoUniforms, b: KyotoUniforms): number {
  let gap = 0;
  for (const key of KEYS) a[key].forEach((value, index) => { gap = Math.max(gap, Math.abs(value - b[key][index]!)); });
  return gap;
}

export function mixUniforms(from: KyotoUniforms, to: KyotoUniforms, t: number): KyotoUniforms {
  const eased = t * t * (3 - 2 * t);
  const mix = <T extends number[]>(a: T, b: T) => a.map((value, index) => Math.round((value + (b[index]! - value) * eased) * 1000) / 1000) as T;
  return { u_season: mix(from.u_season, to.u_season), u_sky: mix(from.u_sky, to.u_sky), u_weather: mix(from.u_weather, to.u_weather) };
}

export function kyotoDriver(deps: KyotoDriverDeps = browserKyotoDeps): SceneDriver {
  return (publish) => {
    let sky: Sky | null = null;
    let previewAt: number | null = null;
    let mode: Mode | null = null;
    let shown: KyotoUniforms | null = null;
    let shownMode: Mode | null = null;
    let last = "";
    let stopped = false;
    let stopFade = () => {};
    const paint = gardenPainter(deps.createCanvas);
    const emit = () => {
      if (stopped) return;
      const reading = readGarden(new Date(previewAt ?? deps.now()), sky, { liveWeather: previewAt === null, previous: mode });
      const target = reading.uniforms;
      const key = JSON.stringify([target, reading.mode]);
      if (key === last) return;
      last = key;
      mode = reading.mode;
      stopFade();
      const from = shown;
      if (!from || uniformGap(from, target) < FADE_ABOVE) {
        shown = target;
        shownMode = mode;
        publish({ ...target }, paint(target), mode);
        return;
      }
      let step = 0;
      const chosen = mode;
      const started = deps.now();
      publish({ ...from }, paint(target), shownMode ?? chosen);
      const stop = deps.every(FADE_STEP_MS, () => {
        step = Math.min(FADE_STEPS, Math.max(step + 1, Math.floor((deps.now() - started) / FADE_STEP_MS)));
        shown = step >= FADE_STEPS ? target : mixUniforms(from, target, step / FADE_STEPS);
        if (step * 2 >= FADE_STEPS) shownMode = chosen;
        publish({ ...shown }, undefined, shownMode ?? chosen);
        if (step >= FADE_STEPS) stop();
      });
      stopFade = stop;
    };
    const refreshSky = () => {
      deps.loadSky(deps.timeZone()).then((next) => { sky = next; emit(); }, () => {});
    };
    const refreshPreview = () => {
      deps.loadPreview(deps.timeZone()).then((next) => { if (next !== previewAt) { previewAt = next; emit(); } }, () => {});
    };
    emit();
    refreshSky();
    refreshPreview();
    const stops = [deps.every(GARDEN_TICK_MS, emit), deps.every(GARDEN_WEATHER_MS, refreshSky), deps.every(GARDEN_PREVIEW_MS, refreshPreview)];
    return () => { stopped = true; stopFade(); for (const stop of stops) stop(); };
  };
}
