export const FORK_DESKTOP_CONTROL_CHANNEL = "bb-desktop:fork-desktop-control";
export const FORK_DESKTOP_CONTROL_EVENT_CHANNEL =
  "bb-desktop:fork-desktop-control-event";
export const FORK_DESKTOP_CONTROL_ENV = "BB_STUDIO_DESKTOP_CONTROL";

export type DesktopPermissionName =
  | "accessibility"
  | "screenRecording"
  | "inputMonitoring";

export interface DesktopPermissions {
  accessibility: boolean;
  screenRecording: boolean;
  inputMonitoring: boolean;
  checked: boolean;
}

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

export type DesktopGrantKind = "none" | "once" | "session";

export type DesktopGrantAnswer = "session" | "once" | "no";

export interface DesktopAsk {
  id: string;
  threadId: string;
  agent: string;
  reason: string;
  app: string | null;
}

export type DesktopActivityPhase = "acting" | "paused" | "stopped";

export interface DesktopActivity {
  threadId: string;
  agent: string;
  caption: string;
  app: string | null;
  phase: DesktopActivityPhase;
  x: number | null;
  y: number | null;
  clickAt: number | null;
  foreground: boolean;
  updatedAt: number;
}

export type DesktopDriverStatus =
  | "unavailable"
  | "stopped"
  | "starting"
  | "ready"
  | "failed";

export interface DesktopControlState {
  supported: boolean;
  driver: {
    status: DesktopDriverStatus;
    version: string | null;
    error: string | null;
  };
  helper: boolean;
  permissions: DesktopPermissions;
  restartAdvised: boolean;
  hud: { shown: boolean; threadId: string | null };
  pointing: boolean;
  talkKey: string;
  talking: boolean;
  hover: DesktopPin | null;
  pins: DesktopPin[];
  activity: DesktopActivity | null;
  grant: { kind: DesktopGrantKind; threadId: string | null };
  ask: DesktopAsk | null;
}

export type DesktopControlRequest =
  | { op: "state" }
  | { op: "refreshPermissions" }
  | { op: "requestPermission"; permission: DesktopPermissionName }
  | { op: "openSettings"; permission: DesktopPermissionName }
  | { op: "relaunch" }
  | { op: "hud"; shown: boolean; threadId?: string | null }
  | { op: "pointing"; on: boolean }
  | { op: "talkKey"; key: string }
  | { op: "talk"; down: boolean }
  | { op: "point"; x: number; y: number; click: boolean }
  | { op: "pinsTaken"; ids: string[] }
  | { op: "clearPins" }
  | { op: "answer"; id: string; answer: DesktopGrantAnswer }
  | { op: "stop" }
  | { op: "resume" }
  | {
      op: "preview";
      state: Partial<
        Pick<
          DesktopControlState,
          "pointing" | "talking" | "hover" | "pins" | "activity" | "ask"
        >
      >;
    };
