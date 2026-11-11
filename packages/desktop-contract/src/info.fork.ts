export type ForkDesktopWindowOp =
  | "register"
  | "open"
  | "close"
  | "toggle"
  | "unregister"
  | "hotkey"
  | "clickThrough";

export interface ForkDesktopWindowRequest {
  op: ForkDesktopWindowOp;
  key: string;
  path: string;
  options: Record<string, unknown>;
  on?: boolean;
  hold?: boolean;
}

export interface ForkStudioBuild {
  upstreamCommit: string;
  upstreamVersion: string;
  version: string;
}

export interface ForkDesktopApi {
  experimental_studioBuild?: ForkStudioBuild | null;
  experimental_answerApproval?(
    approvalId: string,
  ): Promise<"answered" | "unavailable">;
  experimental_window?(request: ForkDesktopWindowRequest): Promise<boolean>;
}
