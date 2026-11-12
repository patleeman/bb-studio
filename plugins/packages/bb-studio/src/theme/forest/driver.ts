import type { SceneDriver } from "../scene/live";
import { forestUniforms, skySchema, type Sky } from "./sky";

export const CLOCK_TICK_MS = 60_000;
export const WEATHER_POLL_MS = 15 * 60_000;

export interface ForestDriverDeps {
  loadSky(timeZone: string | null): Promise<Sky>;
  now(): number;
  timeZone(): string | null;
  every(ms: number, run: () => void): () => void;
}

export async function loadSkyOverRpc(timeZone: string | null): Promise<Sky> {
  const response = await fetch("/api/v1/plugins/studio/rpc/theme.weather", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timeZone }) });
  const body = await response.json() as { ok?: boolean; result?: unknown };
  if (!body.ok) throw new Error("No weather");
  return skySchema.parse(body.result);
}

export const browserForestDeps: ForestDriverDeps = {
  loadSky: loadSkyOverRpc,
  now: () => Date.now(),
  timeZone: () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
  },
  every: (ms, run) => {
    const handle = setInterval(run, ms);
    return () => clearInterval(handle);
  },
};

export function forestDriver(deps: ForestDriverDeps = browserForestDeps): SceneDriver {
  return (publish) => {
    let sky: Sky | null = null;
    let stopped = false;
    let last = "";
    const emit = () => {
      if (stopped) return;
      const uniforms = forestUniforms(new Date(deps.now()), sky);
      const key = JSON.stringify(uniforms);
      if (key === last) return;
      last = key;
      publish({ ...uniforms });
    };
    const refresh = () => {
      deps.loadSky(deps.timeZone()).then((next) => { sky = next; emit(); }, () => {});
    };
    emit();
    refresh();
    const stopClock = deps.every(CLOCK_TICK_MS, emit);
    const stopWeather = deps.every(WEATHER_POLL_MS, refresh);
    return () => { stopped = true; stopClock(); stopWeather(); };
  };
}
