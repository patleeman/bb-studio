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
  clickThrough?: boolean;
  resizable?: boolean;
  hotkey?: string;
  menuBarTitle?: string;
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
    | "hotkey"
    | "clickThrough";
  key: string;
  path: string;
  options: ForkWindowOptions;
  on?: boolean;
  hold?: boolean;
}

export const FORK_WINDOW_CLICK_THROUGH_EVENT = "bb-fork-window-click-through";
