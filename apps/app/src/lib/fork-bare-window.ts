import { getBbDesktopInfo } from "./bb-desktop";
import { resolveRouteHref } from "./route-paths";
import { SPLIT_LAYOUT_STORAGE_KEY } from "./split-layout/persistence";

export const FORK_BARE_QUERY_KEY = "bbBare";
const POP_OUT_DEFAULT_WIDTH = 960;
const POP_OUT_DEFAULT_HEIGHT = 720;
const POP_OUT_MIN_WIDTH = 360;
const POP_OUT_MIN_HEIGHT = 240;
const POP_OUT_MAX_SIZE = 10_000;

export function isBareSearch(search: string): boolean {
  return new URLSearchParams(search).get(FORK_BARE_QUERY_KEY) === "1";
}

let bareWindow: boolean | null = null;

export function isBareWindow(): boolean {
  if (bareWindow === null) {
    bareWindow =
      typeof window !== "undefined" && isBareSearch(window.location.search);
    if (bareWindow) {
      try {
        window.sessionStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, "");
      } catch {
        return bareWindow;
      }
    }
  }
  return bareWindow;
}

isBareWindow();

export function barePath(path: unknown, origin: string): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  if (path.startsWith("//") || path.includes("\\")) return null;
  const route = resolveRouteHref({ currentOrigin: origin, href: path });
  if (route === null) return null;
  const url = new URL(route.path, origin);
  url.searchParams.set(FORK_BARE_QUERY_KEY, "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function popOutKey(path: string): string {
  let hash = 5381;
  for (let index = 0; index < path.length; index += 1) {
    hash = ((hash << 5) + hash + path.charCodeAt(index)) >>> 0;
  }
  return `bb-popout-${hash.toString(36)}-${path.length.toString(36)}`;
}

export interface PopOutOptions {
  path: string;
  title?: string;
  width?: number;
  height?: number;
}

function popOutSize(value: unknown, fallback: number, min: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.max(Math.round(value), min), POP_OUT_MAX_SIZE)
    : fallback;
}

const popups = new Map<string, Window>();

export async function popOutAppPath(options: PopOutOptions): Promise<boolean> {
  if (typeof options !== "object" || options === null) return false;
  const path = barePath(options.path, window.location.origin);
  if (path === null) return false;
  return openPopOutWindow(path, options);
}

export async function openPopOutWindow(
  path: string,
  options: Omit<PopOutOptions, "path">,
  key: string = popOutKey(path),
): Promise<boolean> {
  const width = popOutSize(
    options.width,
    POP_OUT_DEFAULT_WIDTH,
    POP_OUT_MIN_WIDTH,
  );
  const height = popOutSize(
    options.height,
    POP_OUT_DEFAULT_HEIGHT,
    POP_OUT_MIN_HEIGHT,
  );
  const desktop = getBbDesktopInfo()?.experimental_window;
  if (desktop !== undefined) {
    try {
      return await desktop({
        op: "open",
        key,
        path,
        options: {
          ...(typeof options.title === "string" && options.title.trim() !== ""
            ? { title: options.title.trim() }
            : {}),
          width,
          height,
          minWidth: POP_OUT_MIN_WIDTH,
          minHeight: POP_OUT_MIN_HEIGHT,
          titleBar: "hiddenInset",
          rememberBounds: true,
        },
      });
    } catch {
      return false;
    }
  }
  const open = popups.get(key);
  if (open !== undefined && !open.closed) {
    open.focus();
    return true;
  }
  const popup = window.open(
    path,
    key,
    `popup,width=${String(width)},height=${String(height)}`,
  );
  if (popup === null) return false;
  popups.set(key, popup);
  return true;
}
