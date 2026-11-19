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
  upstreamAhead?: number | null;
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

export type ForkFinderShowResult = "shown" | "opened" | "missing" | "invalid";

export interface ForkFolderEntry {
  name: string;
  path: string;
  kind: "directory" | "package" | "file";
  sizeBytes: number | null;
  modifiedAtMs: number | null;
}

export type ForkFolderListResult =
  | {
      kind: "folder";
      path: string;
      parent: string | null;
      entries: ForkFolderEntry[];
      totalCount: number;
      hiddenCount: number;
    }
  | { kind: "unreadable"; path: string; parent: string | null }
  | { kind: "package"; path: string }
  | { kind: "file"; path: string }
  | { kind: "missing" }
  | { kind: "invalid" };

export interface ForkFileLinkMenuRequest {
  path: string;
  href: string;
  selectionText: string;
  point: { x: number; y: number } | null;
}

/** The Mac's input idle time and lock state (Studio's "at the desk" heartbeat). */
export interface ForkSystemActivity {
  idleSeconds: number;
  locked: boolean;
}

export interface ForkDesktopApi {
  experimental_finderLabel?: string;
  experimental_showInFinder?(path: string): Promise<ForkFinderShowResult>;
  experimental_listFolder?(path: string): Promise<ForkFolderListResult>;
  experimental_fileLinkMenu?(
    request: ForkFileLinkMenuRequest,
  ): Promise<boolean>;
  experimental_studioBuild?: ForkStudioBuild | null;
  experimental_launchAppearance?: ForkLaunchAppearance | null;
  experimental_saveLaunchAppearance?(value: ForkLaunchAppearance | null): void;
  experimental_answerApproval?(
    approvalId: string,
  ): Promise<"answered" | "unavailable">;
  experimental_window?(request: ForkDesktopWindowRequest): Promise<boolean>;
  experimental_systemActivity?(): Promise<ForkSystemActivity>;
  experimental_onSystemActivity?(
    listener: (activity: ForkSystemActivity) => void,
  ): () => void;
}
