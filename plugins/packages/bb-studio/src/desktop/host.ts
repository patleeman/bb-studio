import * as sdkApp from "@get-bb/plugin-sdk/app";
import { member } from "../kit/app/host-sdk";

export type DesktopPermission = "accessibility" | "screenRecording" | "inputMonitoring";
export type DesktopTalkKey = "fn" | "AltRight" | "MetaRight" | "ControlRight";

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopPin {
  id: string;
  number: number;
  threadId: string | null;
  createdAt: number;
  x: number;
  y: number;
  app: string | null;
  bundleId: string | null;
  pid: number | null;
  windowId: number | null;
  windowTitle: string | null;
  windowBounds: DesktopRect | null;
  url: string | null;
  role: string | null;
  label: string | null;
  elementFrame: DesktopRect | null;
  secure: boolean;
  imagePath: string | null;
  thumbnail: string | null;
  placed: boolean;
  taken: boolean;
}

export interface DesktopActivity {
  threadId: string;
  agent: string;
  caption: string;
  app: string | null;
  phase: "acting" | "paused" | "stopped";
  foreground: boolean;
  updatedAt: number;
}

export interface DesktopAsk {
  id: string;
  threadId: string;
  agent: string;
  reason: string;
  app: string | null;
}

export interface DesktopState {
  supported: boolean;
  driver: { status: string; version: string | null; error: string | null };
  helper: boolean;
  permissions: Record<DesktopPermission, boolean> & { checked: boolean };
  restartAdvised: boolean;
  hud: { shown: boolean; threadId: string | null };
  pointing: boolean;
  talkKey: string;
  talking: boolean;
  pins: readonly DesktopPin[];
  activity: DesktopActivity | null;
  grant: { kind: "none" | "once" | "session"; threadId: string | null };
  ask: DesktopAsk | null;
}

export type DesktopRequest =
  | { op: "state" }
  | { op: "refreshPermissions" }
  | { op: "requestPermission"; permission: DesktopPermission }
  | { op: "openSettings"; permission: DesktopPermission }
  | { op: "relaunch" }
  | { op: "hud"; shown: boolean; threadId?: string | null }
  | { op: "pointing"; on: boolean }
  | { op: "talkKey"; key: DesktopTalkKey }
  | { op: "talk"; down: boolean }
  | { op: "pinsTaken"; ids: readonly string[] }
  | { op: "clearPins" }
  | { op: "answer"; id: string; answer: "session" | "once" | "no" }
  | { op: "stop" }
  | { op: "resume" };

export interface DesktopControl {
  native: boolean;
  state: DesktopState | null;
  request(request: DesktopRequest): Promise<DesktopState | null>;
}

const NO_DESKTOP: DesktopControl = { native: false, state: null, request: () => Promise.resolve(null) };

const hook = member(sdkApp, "experimental_useDesktopControl");

export const hasDesktopControl = typeof hook === "function";

export const useDesktopControl: () => DesktopControl =
  typeof hook === "function" ? (hook as () => DesktopControl) : () => NO_DESKTOP;

export const DESKTOP_PERMISSIONS: readonly { id: DesktopPermission; title: string; reason: string }[] = [
  { id: "accessibility", title: "Accessibility", reason: "Read the button, field or link under your pointer." },
  { id: "screenRecording", title: "Screen Recording", reason: "Take a picture of the window you point at, and read window titles." },
  { id: "inputMonitoring", title: "Input Monitoring", reason: "Notice when you hold the talk key while another app is in front." },
];

export function allGranted(state: DesktopState | null): boolean {
  if (state === null || !state.permissions.checked) return false;
  return DESKTOP_PERMISSIONS.every((permission) => state.permissions[permission.id]);
}

export const DESKTOP_HUD_WINDOW_ID = "desktop-hud";

export const TALK_KEY_LABELS: Record<DesktopTalkKey, string> = {
  fn: "fn",
  AltRight: "Right Option",
  MetaRight: "Right Command",
  ControlRight: "Right Control",
};

export function threadIdFromPath(pathname: string): string | null {
  const match = /\/threads\/(thr_[A-Za-z0-9_-]+)/u.exec(pathname);
  return match?.[1] ?? null;
}
