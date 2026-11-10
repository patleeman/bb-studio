import { useMemo } from "react";
import type {
  ExperimentalWindowOptions,
  ExperimentalWindows,
} from "@get-bb/plugin-sdk";
import { usePluginId } from "@/components/plugin/plugin-context";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export const FORK_WINDOW_PATH_PREFIX = "/fork-window/";

export function forkWindowPath(
  pluginId: string,
  windowId: string,
  options: ExperimentalWindowOptions = {},
): string {
  const query = new URLSearchParams(options.params ?? {});
  if (options.transparent === true) query.set("bbTransparent", "1");
  const suffix = query.toString();
  return `${FORK_WINDOW_PATH_PREFIX}${encodeURIComponent(pluginId)}/${encodeURIComponent(windowId)}${suffix.length > 0 ? `?${suffix}` : ""}`;
}

type Op = "register" | "open" | "close" | "toggle" | "hotkey" | "clickThrough";

export function createPluginWindows(pluginId: string): ExperimentalWindows {
  const desktop = getBbDesktopInfo()?.experimental_window;
  const popups = new Map<string, Window>();
  const call = async (
    op: Op,
    windowId: string,
    options: ExperimentalWindowOptions = {},
    on?: boolean,
    hold?: boolean,
  ): Promise<boolean> => {
    const key = `${pluginId}/${windowId}`;
    const path = forkWindowPath(pluginId, windowId, options);
    if (desktop !== undefined) {
      const { params: _params, ...native } = options;
      return desktop({ op, key, path, options: native, on, hold });
    }
    const open = popups.get(key);
    const isOpen = open !== undefined && !open.closed;
    if (op === "register" || op === "hotkey" || op === "clickThrough") {
      return false;
    }
    if (op === "close" || (op === "toggle" && isOpen)) {
      open?.close();
      popups.delete(key);
      return isOpen;
    }
    if (isOpen) {
      open.focus();
      return true;
    }
    const popup = window.open(
      path,
      `bb-${key}`,
      `popup,width=${String(options.width ?? 480)},height=${String(options.height ?? 360)}`,
    );
    if (popup === null) return false;
    popups.set(key, popup);
    return true;
  };
  return {
    native: desktop !== undefined,
    register: (windowId, options) => call("register", windowId, options),
    open: (windowId, options) => call("open", windowId, options),
    toggle: (windowId, options) => call("toggle", windowId, options),
    close: (windowId) => call("close", windowId),
    hotkeyRegistered: (windowId) => call("hotkey", windowId),
    setClickThrough: (windowId, on, how) =>
      call("clickThrough", windowId, {}, on, how?.hold === true),
  };
}

export function usePluginWindows(): ExperimentalWindows {
  const pluginId = usePluginId();
  return useMemo(() => createPluginWindows(pluginId), [pluginId]);
}
