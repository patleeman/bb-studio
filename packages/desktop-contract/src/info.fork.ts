export type ForkDesktopWindowOp =
  | "register"
  | "open"
  | "close"
  | "toggle"
  | "unregister"
  | "hotkey";

export interface ForkDesktopWindowRequest {
  op: ForkDesktopWindowOp;
  key: string;
  path: string;
  options: Record<string, unknown>;
}

export interface ForkStudioBuild {
  upstreamCommit: string;
  upstreamVersion: string;
  version: string;
}

export interface ForkLaunchAppearance {
  version: 1;
  mode: "light" | "dark" | null;
  background: string;
  properties: [string, string][];
  attributes: [string, string][];
}

export type ForkDesktopPermissionName =
  | "accessibility"
  | "screenRecording"
  | "inputMonitoring";

export interface ForkDesktopPermissions {
  accessibility: boolean;
  screenRecording: boolean;
  inputMonitoring: boolean;
  checked: boolean;
}

export interface ForkDesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ForkDesktopPin {
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
  windowBounds: ForkDesktopRect | null;
  url: string | null;
  role: string | null;
  label: string | null;
  elementFrame: ForkDesktopRect | null;
  secure: boolean;
  imagePath: string | null;
  thumbnail: string | null;
  placed: boolean;
  taken: boolean;
}

export type ForkDesktopGrantKind = "none" | "once" | "session";

export type ForkDesktopGrantAnswer = "session" | "once" | "no";

export interface ForkDesktopAsk {
  id: string;
  threadId: string;
  agent: string;
  reason: string;
  app: string | null;
}

export type ForkDesktopActivityPhase = "acting" | "paused" | "stopped";

export interface ForkDesktopActivity {
  threadId: string;
  agent: string;
  caption: string;
  app: string | null;
  phase: ForkDesktopActivityPhase;
  x: number | null;
  y: number | null;
  clickAt: number | null;
  foreground: boolean;
  updatedAt: number;
}

export type ForkDesktopDriverStatus =
  | "unavailable"
  | "stopped"
  | "starting"
  | "ready"
  | "failed";

export interface ForkDesktopControlState {
  supported: boolean;
  driver: {
    status: ForkDesktopDriverStatus;
    version: string | null;
    error: string | null;
  };
  helper: boolean;
  permissions: ForkDesktopPermissions;
  restartAdvised: boolean;
  hud: { shown: boolean; threadId: string | null };
  pointing: boolean;
  talkKey: string;
  talking: boolean;
  hover: ForkDesktopPin | null;
  pins: ForkDesktopPin[];
  activity: ForkDesktopActivity | null;
  grant: { kind: ForkDesktopGrantKind; threadId: string | null };
  ask: ForkDesktopAsk | null;
}

export type ForkDesktopControlRequest =
  | { op: "state" }
  | { op: "refreshPermissions" }
  | { op: "requestPermission"; permission: ForkDesktopPermissionName }
  | { op: "openSettings"; permission: ForkDesktopPermissionName }
  | { op: "relaunch" }
  | { op: "hud"; shown: boolean; threadId?: string | null }
  | { op: "pointing"; on: boolean }
  | { op: "talkKey"; key: string }
  | { op: "talk"; down: boolean }
  | { op: "point"; x: number; y: number; click: boolean }
  | { op: "pinsTaken"; ids: string[] }
  | { op: "clearPins" }
  | { op: "answer"; id: string; answer: ForkDesktopGrantAnswer }
  | { op: "stop" }
  | { op: "resume" };

export interface ForkDesktopControlBridge {
  request(request: ForkDesktopControlRequest): Promise<ForkDesktopControlState>;
  subscribe(listener: (state: ForkDesktopControlState) => void): () => void;
}

export interface ForkDesktopApi {
  experimental_studioBuild?: ForkStudioBuild | null;
  experimental_launchAppearance?: ForkLaunchAppearance | null;
  experimental_saveLaunchAppearance?(value: ForkLaunchAppearance | null): void;
  experimental_answerApproval?(
    approvalId: string,
  ): Promise<"answered" | "unavailable">;
  experimental_window?(request: ForkDesktopWindowRequest): Promise<boolean>;
  experimental_desktopControl?: ForkDesktopControlBridge;
}
