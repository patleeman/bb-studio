import { onThemeOptions } from "../options";
import type { SceneDriver } from "../scene/live";
import { composeSky, tonightUniforms } from "./compose";
import { tonightSettingsSchema, type TonightSettings } from "./settings";
import type { Mode } from "../schema";
import { skyVariant } from "./daylight";
import { nightSky } from "./ephemeris";
import { paintSky, type SkyContext } from "./paint";
import { fallbackPlace } from "./place";
import { aimSky, cameraSettled, DEFAULT_VIEW, easeCamera, frameAim, restCamera, type CameraMotion } from "./projection";

export const TONIGHT_THEME_ID = "tonights-sky";
export const SKY_TICK_MS = 15_000;
export const SETTINGS_POLL_MS = 15_000;
export const MAX_LAYER_RATIO = 2;
export const MAX_LAYER_EDGE = 4096;
export const MOTION_STEP_MS = 33;
export const LAPSE_ABOVE_MS = 90_000;
export const LAPSE_SECONDS = 2;
export const LAPSE_SPAN_MS = 86_400_000;

export function lapseStart(shown: number, goal: number): number {
  const gap = goal - shown;
  const folded = gap - Math.round(gap / LAPSE_SPAN_MS) * LAPSE_SPAN_MS;
  return goal - folded;
}

export interface SkyCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): SkyContext | null;
}

export interface TonightDriverDeps {
  loadSettings(timeZone: string | null): Promise<TonightSettings>;
  now(): number;
  timeZone(): string | null;
  zoneOffsetMinutes(): number;
  every(ms: number, run: () => void): () => void;
  size(): { width: number; height: number; ratio: number };
  onResize(run: () => void): () => void;
  visible(): boolean;
  reducedMotion(): boolean;
  createCanvas(): SkyCanvas | null;
}

export async function loadSettingsOverRpc(timeZone: string | null): Promise<TonightSettings> {
  const response = await fetch("/api/v1/plugins/studio/rpc/theme.sky", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timeZone }) });
  const body = await response.json() as { ok?: boolean; result?: unknown };
  if (!body.ok) throw new Error("No sky settings");
  return tonightSettingsSchema.parse(body.result);
}

export const browserTonightDeps: TonightDriverDeps = {
  loadSettings: loadSettingsOverRpc,
  now: () => Date.now(),
  timeZone: () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
  },
  zoneOffsetMinutes: () => -new Date().getTimezoneOffset(),
  every: (ms, run) => {
    const handle = setInterval(run, ms);
    return () => clearInterval(handle);
  },
  size: () => ({ width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio || 1 }),
  onResize: (run) => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const listener = () => {
      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(() => { pending = null; run(); }, 120);
    };
    window.addEventListener("resize", listener);
    return () => { window.removeEventListener("resize", listener); if (pending !== null) clearTimeout(pending); };
  },
  visible: () => document.visibilityState !== "hidden",
  reducedMotion: () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  createCanvas: () => document.createElement("canvas") as unknown as SkyCanvas,
};

export function tonightDriver(deps: TonightDriverDeps = browserTonightDeps): SceneDriver {
  return (publish, scene) => {
    let settings: TonightSettings | null = null;
    let stopped = false;
    let version = 0;
    let drawn = false;
    let shownAt: number | null = null;
    let lapse: { from: number; to: number; elapsed: number } | null = null;
    let motion: CameraMotion | null = null;
    let mode: Mode | null = null;
    let stopMotion: (() => void) | null = null;
    const canvas = deps.createCanvas();
    const context = canvas?.getContext("2d") ?? null;
    const rest = () => { if (stopMotion) { stopMotion(); stopMotion = null; } };
    const draw = (seconds = 0, snap = false) => {
      if (stopped) return;
      if (drawn && !deps.visible()) { rest(); return; }
      const place = settings?.place ?? fallbackPlace(deps.zoneOffsetMinutes());
      const goal = settings?.previewAt ?? deps.now();
      const still = snap || shownAt === null || deps.reducedMotion();
      if (still || (!lapse && Math.abs(goal - shownAt!) <= LAPSE_ABOVE_MS)) {
        shownAt = goal;
        lapse = null;
      } else {
        if (!lapse || Math.abs(goal - lapse.to) > LAPSE_ABOVE_MS) lapse = { from: lapseStart(shownAt!, goal), to: goal, elapsed: 0 };
        lapse.to = goal;
        lapse.elapsed += seconds;
        const t = Math.min(1, lapse.elapsed / LAPSE_SECONDS);
        shownAt = lapse.from + (goal - lapse.from) * t * t * (3 - 2 * t);
        if (t >= 1) { shownAt = goal; lapse = null; }
      }
      drawn = true;
      const sky = nightSky(new Date(shownAt), place);
      mode = skyVariant(sky.sun.altitude, mode);
      const view = deps.size();
      const target = frameAim(aimSky(sky, settings?.view ?? DEFAULT_VIEW), place.latitude, view, scene?.layout() ?? null);
      motion = still || !motion ? restCamera(target) : easeCamera(motion, target, seconds);
      const turning = !cameraSettled(motion, target);
      if (!turning) motion = restCamera(target);
      const camera = motion.camera;
      if (lapse || turning) stopMotion ??= deps.every(MOTION_STEP_MS, () => draw(MOTION_STEP_MS / 1000));
      else rest();
      const uniforms = tonightUniforms(sky, camera);
      if (!canvas || !context) { publish({ ...uniforms }, undefined, mode); return; }
      const ratio = Math.min(Math.max(view.ratio, 1), MAX_LAYER_RATIO, MAX_LAYER_EDGE / Math.max(1, view.width, view.height));
      const width = Math.max(1, Math.round(view.width * ratio)), height = Math.max(1, Math.round(view.height * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      paintSky(context, width, height, ratio, composeSky(sky, camera));
      version += 1;
      publish({ ...uniforms }, { source: canvas as unknown as TexImageSource, version }, mode);
    };
    const tick = () => { if (!stopMotion) draw(); };
    const refresh = () => {
      if (drawn && !deps.visible()) return;
      deps.loadSettings(deps.timeZone()).then((next) => {
        const first = settings === null;
        const changed = JSON.stringify(next) !== JSON.stringify(settings);
        settings = next;
        if (changed) draw(0, first);
      }, () => {});
    };
    draw();
    refresh();
    const stopClock = deps.every(SKY_TICK_MS, tick);
    const stopSettings = deps.every(SETTINGS_POLL_MS, refresh);
    const stopResize = deps.onResize(() => draw());
    const stopLayout = scene?.onLayout(() => draw());
    const stopOptions = onThemeOptions((themeId) => { if (themeId === TONIGHT_THEME_ID) refresh(); });
    return () => { stopped = true; rest(); stopClock(); stopSettings(); stopResize(); stopLayout?.(); stopOptions(); };
  };
}
