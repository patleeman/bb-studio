// Visual Chat as an app window, on a BB that opens plugins in windows
// (src/host-windows.ts): the page in a window of its own, whose header is
// the title bar (hidden-inset: the traffic lights sit in it). It opens from
// BB Studio's launcher, "Visual Chat" in BB's New menu, "Open in window" in
// the page's header (the page stays in BB's rail), the "Visual Chat: Open
// window" command, or a system-wide shortcut when the user assigned one (the
// "Window shortcut" setting; none by default).
// "Open thread in BB" in the window shows a chat's thread in BB's main
// window, through Studio, whose main-window bridge opens what a plugin
// window asks for (Studio's `window.openInMain`).
import { lazy, Suspense, useCallback, useEffect } from "react";
import { useSdk, useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { inHostWindow, registerHostWindow, registerLauncherItem, registerNewItem, useHostWindows, type HostWindowOptions } from "./host-windows";
import { assignedWindowHotkey, WINDOW_HOTKEY_SETTING } from "./settings";
import { isMac } from "./ui/shortcuts";
import { CANVAS_NEW_SEGMENT } from "./shared";

/** The chat the window opens on: `?chat=<threadId>` or `?chat=new` (src/ui/panel.tsx reads it). */
export const WINDOW_CHAT_PARAM = "chat";

export const WINDOW_ID = "canvas";
export const WINDOW_TITLE = "Visual Chat";
export const WINDOW_COMMAND_ID = "window";
export const WINDOW_NEW_ITEM_ID = "visual-chat";
/** The plugin's own icon, as its rail page uses it. */
export const WINDOW_ICON = "studio-visual-chat/visual-chat";
/** Sized like an app, not a panel; never smaller than the header and the composer need. */
export const WINDOW_SIZE = { width: 1280, height: 860, minWidth: 560, minHeight: 420 } as const;
export const WINDOW_LAUNCHER_ITEM_ID = "visual-chat";
export const WINDOW_LAUNCHER_KEYWORDS = ["visual", "chat", "canvas", "board", "whiteboard", "charts", "ask"] as const;
/** Where a window that is not BB's main one asks the main one to open Visual Chat (the launcher runs items in its own window). */
export const WINDOW_OPEN_CHANNEL = "bb-studio-visual-chat:window";
const STUDIO_PLUGIN_ID = "studio";

/**
 * The window as BB opens it: no title bar (the page's header is it), reopened where it was, and with a
 * system-wide shortcut only when the user assigned one.
 */
export function canvasWindowOptions(hotkey: string): HostWindowOptions {
  const key = hotkey.trim();
  return { title: WINDOW_TITLE, ...WINDOW_SIZE, titleBar: "hiddenInset", rememberBounds: true, ...(key ? { hotkey: key } : {}) };
}

/** The shortcut the user assigned in the plugin's settings ("" for none); undefined while they load. */
export function windowHotkey(values: Record<string, unknown> | undefined): string | undefined {
  return values ? assignedWindowHotkey(values[WINDOW_HOTKEY_SETTING]) : undefined;
}

/** The chat a rail page's sub-path shows, for the window: null for its root (the last chat); `new`, or a thread id. */
export function windowChatAt(subPath: string): string | null {
  const [segment = ""] = subPath.replace(/^\/+|\/+$/g, "").split("/");
  if (!segment) return null;
  try { return decodeURIComponent(segment); } catch { return null; }
}

const CanvasWindow = lazy(() => import("../bundle/canvas-ui.js").then((module) => ({ default: module.CanvasWindow })));

function WindowRoot() {
  const sdk = useSdk();
  const openThread = useCallback((threadId: string) => {
    void sdk.plugins.callRpc({ pluginId: STUDIO_PLUGIN_ID, method: "window.openInMain", input: { path: `/threads/${encodeURIComponent(threadId)}` } as never, outputSchema: z.unknown() }).catch(() => {});
  }, [sdk]);
  const windows = useHostWindows();
  // Cmd/Ctrl+W: BB closes its window; a browser popup closes itself.
  const close = useCallback(() => {
    if (windows.native) void windows.close(WINDOW_ID);
    else window.close();
  }, [windows]);
  // The traffic lights are in the header only in the macOS desktop app; a popup keeps the browser's own frame.
  return <Suspense fallback={null}><CanvasWindow onOpenThread={openThread} onClose={close} inset={windows.native && isMac()} /></Suspense>;
}

export interface WindowApp {
  /** Shows a chat in the window; null is a new chat. */
  openChat(threadId: string | null): void;
  /** Shows what the page at `subPath` shows (its rail page's sub-path) in the window: "" is the last chat, `new` a new one. */
  openPage(subPath: string): void;
}

/**
 * Registers the window, its launchers and its shortcut. Null, having done
 * nothing, on a BB without plugin windows.
 */
export function registerWindowApp(app: Pick<PluginAppBuilder, "slots" | "commands">): WindowApp | null {
  if (!registerHostWindow(app.slots, { id: WINDOW_ID, title: WINDOW_TITLE, component: WindowRoot })) return null;
  // The launchers run outside React; the bridge in BB's main window lends them the open call.
  let open: ((chat?: string) => void) | null = null;
  function Bridge() {
    const windows = useHostWindows();
    const hotkey = windowHotkey(useSettings().values);
    // BB forgets windows when it restarts: the shortcut is set up each time the plugin loads, and when it changes.
    useEffect(() => { if (hotkey !== undefined) void windows.register(WINDOW_ID, canvasWindowOptions(hotkey)); }, [windows, hotkey]);
    useEffect(() => {
      const options = canvasWindowOptions(hotkey ?? "");
      const mine = (chat?: string) => void (async () => {
        if (chat === undefined) { await windows.open(WINDOW_ID, options); return; }
        // An open window keeps its page, so it is closed first to show this chat; the shortcut then goes back to the last chat.
        await windows.close(WINDOW_ID);
        await windows.open(WINDOW_ID, { ...options, params: { [WINDOW_CHAT_PARAM]: chat } });
        await windows.register(WINDOW_ID, options);
      })();
      open = mine;
      // Another window (the launcher's) asks this one to open Visual Chat.
      const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(WINDOW_OPEN_CHANNEL);
      if (channel) channel.onmessage = () => mine();
      return () => {
        if (open === mine) open = null;
        channel?.close();
      };
    }, [windows, hotkey]);
    return null;
  }
  // The window itself mounts no bridge, so it never registers itself.
  app.slots.experimental_appOverlay({ id: "window-bridge", component: () => (inHostWindow() ? null : <Bridge />) });
  const run = () => open?.();
  registerNewItem(app.slots, { id: WINDOW_NEW_ITEM_ID, title: WINDOW_TITLE, icon: "GridView", group: "apps", run });
  // The launcher runs this in its own window, where no bridge is mounted: it then asks BB's main window.
  const runAnywhere = () => {
    if (open) { open(); return; }
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(WINDOW_OPEN_CHANNEL);
    channel.postMessage("open");
    channel.close();
  };
  registerLauncherItem(app.slots, { id: WINDOW_LAUNCHER_ITEM_ID, title: WINDOW_TITLE, icon: WINDOW_ICON, section: "apps", keywords: WINDOW_LAUNCHER_KEYWORDS, order: 10, run: runAnywhere });
  app.commands.register({ id: WINDOW_COMMAND_ID, title: "Visual Chat: Open window", run });
  return {
    openChat: (threadId) => open?.(threadId ?? CANVAS_NEW_SEGMENT),
    openPage: (subPath) => {
      const chat = windowChatAt(subPath);
      if (chat === null) open?.();
      else open?.(chat);
    },
  };
}
