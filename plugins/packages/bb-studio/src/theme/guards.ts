export interface SceneEnvironment {
  visible: boolean;
  focused: boolean;
  reducedMotion: boolean;
  onBattery: boolean;
  batteryLevel: number;
  pixelRatio: number;
}

export type SceneMode = "run" | "still" | "paused";

export const FRONT_ENVIRONMENT: SceneEnvironment = { visible: true, focused: true, reducedMotion: false, onBattery: false, batteryLevel: 1, pixelRatio: 1 };

export function sceneMode(env: Pick<SceneEnvironment, "visible" | "focused" | "reducedMotion">, still: boolean): SceneMode {
  if (env.reducedMotion || still) return "still";
  if (!env.visible || !env.focused) return "paused";
  return "run";
}

export const MAX_PIXEL_RATIO = 2;

export function renderScale(env: Pick<SceneEnvironment, "onBattery" | "batteryLevel" | "pixelRatio">): number {
  const ratio = Math.min(Math.max(env.pixelRatio || 1, 1), MAX_PIXEL_RATIO);
  if (!env.onBattery) return ratio;
  return Math.max(0.35, (env.batteryLevel < 0.2 ? 0.35 : 0.5) * ratio);
}

interface BatteryLike extends EventTarget { charging: boolean; level: number }
interface WatchTarget {
  document: Pick<Document, "visibilityState" | "hasFocus" | "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener" | "devicePixelRatio"> & { matchMedia?: (query: string) => MediaQueryList };
  navigator?: object;
}

function batteryReader(nav: object | undefined): (() => Promise<BatteryLike>) | null {
  const read: unknown = nav ? Reflect.get(nav, "getBattery") : undefined;
  return typeof read === "function" ? () => Promise.resolve(read.call(nav) as BatteryLike) : null;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function readEnvironment(target: WatchTarget, battery: BatteryLike | null): SceneEnvironment {
  return {
    visible: target.document.visibilityState !== "hidden",
    focused: target.document.hasFocus(),
    reducedMotion: !!target.window.matchMedia?.(REDUCED_MOTION_QUERY).matches,
    onBattery: battery ? !battery.charging : false,
    batteryLevel: battery ? battery.level : 1,
    pixelRatio: target.window.devicePixelRatio || 1,
  };
}

export function watchEnvironment(target: WatchTarget, onChange: (env: SceneEnvironment) => void): () => void {
  let battery: BatteryLike | null = null;
  let stopped = false;
  const emit = () => { if (!stopped) onChange(readEnvironment(target, battery)); };
  const media = target.window.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  target.document.addEventListener("visibilitychange", emit);
  target.window.addEventListener("focus", emit);
  target.window.addEventListener("blur", emit);
  target.window.addEventListener("resize", emit);
  media?.addEventListener?.("change", emit);
  const getBattery = batteryReader(target.navigator);
  if (getBattery) {
    void getBattery().then((found) => {
      if (stopped) return;
      battery = found;
      found.addEventListener("chargingchange", emit);
      found.addEventListener("levelchange", emit);
      emit();
    }, () => {});
  }
  emit();
  return () => {
    stopped = true;
    target.document.removeEventListener("visibilitychange", emit);
    target.window.removeEventListener("focus", emit);
    target.window.removeEventListener("blur", emit);
    target.window.removeEventListener("resize", emit);
    media?.removeEventListener?.("change", emit);
    if (battery) { battery.removeEventListener("chargingchange", emit); battery.removeEventListener("levelchange", emit); }
  };
}
