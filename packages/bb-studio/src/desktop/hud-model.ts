import type { HostWindowOptions } from "../kit/app/windows";
import type { DesktopPin, DesktopState } from "./host";

export function desktopHudWindowOptions(threadId: string | null, hotkey: string, screen?: { availLeft?: number; availTop?: number; availWidth: number; availHeight: number }): HostWindowOptions {
  const width = 420;
  const height = 600;
  const place =
    screen === undefined
      ? {}
      : { x: (screen.availLeft ?? 0) + screen.availWidth - width - 24, y: (screen.availTop ?? 0) + screen.availHeight - height - 24 };
  return {
    title: "BB Studio HUD",
    width,
    height,
    minWidth: 340,
    minHeight: 320,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    rememberBounds: true,
    ...place,
    ...(hotkey.trim().length > 0 ? { hotkey: hotkey.trim() } : {}),
    params: threadId === null ? {} : { thread: threadId },
  };
}

export function pinsToInsert(state: DesktopState | null, threadId: string | null, done: ReadonlySet<string>): DesktopPin[] {
  if (state === null || threadId === null) return [];
  return state.pins.filter((pin) => pin.threadId === threadId && pin.placed && !pin.taken && !done.has(pin.id));
}

export function activityLine(state: DesktopState, threadId: string): string | null {
  const activity = state.activity;
  if (activity === null || activity.threadId !== threadId) return null;
  const where = activity.app === null ? "" : ` in ${activity.app}`;
  if (activity.phase === "stopped") return `Stopped${where}`;
  if (activity.phase === "paused") return `Paused · you are using ${activity.app ?? "that window"}`;
  return activity.foreground ? `Using your cursor${where}` : `Acting${where} · background · your cursor is free`;
}
