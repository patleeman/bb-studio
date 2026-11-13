export const BB_DESKTOP_FORK_WINDOW_CHANNEL = "bb-desktop:fork-window";

export const FORK_WINDOW_PATH_PREFIX = "/fork-window/";

export const FORK_BARE_QUERY_KEY = "bbBare";

export interface ForkWindowOptions {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  transparent?: boolean;
  frame?: boolean;
  alwaysOnTop?: boolean;
  resizable?: boolean;
  hotkey?: string;
  minWidth?: number;
  minHeight?: number;
  titleBar?: "hiddenInset";
  rememberBounds?: boolean;
  center?: boolean;
  hideOnBlur?: boolean;
}

export interface ForkWindowRequest {
  op:
    | "register"
    | "open"
    | "close"
    | "toggle"
    | "unregister"
    | "hotkey";
  key: string;
  path: string;
  options: ForkWindowOptions;
}
