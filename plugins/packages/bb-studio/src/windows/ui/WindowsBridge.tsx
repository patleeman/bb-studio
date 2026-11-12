// Studio's windows' side in BB's main window, always mounted there (an app
// overlay):
// - registers the launcher's hotkey when Studio loads (BB forgets windows
//   when it restarts) and again when its setting changes; checks that the
//   hotkey took and falls back when another app holds it (src/windows/hotkey.ts);
// - opens what a plugin window asks for in the main view and brings the main
//   window forward (a launcher row, links in a popped-out item).
// A plugin window mounts none of this, so no window registers itself.
import { useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { hasHostWindows, useHostWindows, type HostWindows } from "../../kit/app/windows";
import { inMainWindow, useOpenLink } from "../../links/open";
import { LINK_HOWS, type LinkHow } from "../../links/router";
import { useStudioSettings } from "../../settings/ui/use-settings";
import { openFrom } from "../../ui/studio-open";
import { mainWindowAction } from "../../launcher/main-actions";
import { useAppCommandList } from "../../launcher/ui/omnibar-data";
import type { HostAppCommand } from "../../kit/app/host-sdk";
import { LAUNCHER_WINDOW_ID, launcherWindowOptions } from "../../launcher/shared";
import { noteWindowHotkey, registerWithHotkey, type WindowHotkey } from "../hotkey";
import { MAIN_WINDOW_CHANNEL } from "../shared";

const RETIRED_WINDOW_IDS = ["hud", "hud-display"];

export function retireOldWindows(windows: Pick<HostWindows, "register" | "close">): Promise<void> {
  return Promise.all(RETIRED_WINDOW_IDS.map((id) => windows.register(id, {}).then(() => windows.close(id)).catch(() => false))).then(() => undefined);
}

/** Registers the launcher with its hotkey, falling back to the alternate when another app holds it. Answers the hotkey in use. */
export function applyLauncherSettings(windows: HostWindows, settings: { launcherHotkey: string }): Promise<WindowHotkey> {
  return registerWithHotkey(windows, LAUNCHER_WINDOW_ID, settings.launcherHotkey, launcherWindowOptions);
}

export function runRelayed(payload: unknown, deps: { commands: readonly HostAppCommand[]; openUrl(url: string): boolean; openLink(link: string, how: LinkHow): void }): boolean {
  if (!payload || typeof payload !== "object") return false;
  const { command, url, link, how } = payload as { command?: unknown; url?: unknown; link?: unknown; how?: unknown };
  if (typeof link === "string" && LINK_HOWS.includes(how as LinkHow)) {
    deps.openLink(link, how as LinkHow);
    return true;
  }
  if (typeof command === "string") {
    const found = deps.commands.find((each) => each.id === command);
    if (found) found.run();
    else toast.error("That command isn't available in this window.");
    return true;
  }
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    if (!deps.openUrl(url)) window.open(url, "_blank", "noopener");
    return true;
  }
  return false;
}

function MainWindowBridge() {
  const windows = useHostWindows();
  const { values } = useStudioSettings();
  const launcherHotkey = values?.launcherHotkey;
  useEffect(() => { void retireOldWindows(windows); }, [windows]);
  useEffect(() => {
    if (launcherHotkey === undefined) return;
    let current = true;
    void applyLauncherSettings(windows, { launcherHotkey }).then((held) => {
      if (current) noteWindowHotkey("launcher", held);
    }, () => {});
    return () => { current = false; };
  }, [windows, launcherHotkey]);
  const navigate = useBbNavigate();
  const openLink = useOpenLink();
  const commands = useAppCommandList();
  const latest = useRef(commands);
  latest.current = commands;
  useRealtime(MAIN_WINDOW_CHANNEL, (payload) => {
    if (runRelayed(payload, { commands: latest.current, openUrl: (url) => navigate.openUrl(url), openLink: (link, how) => { void openLink(link, { how, source: "window" }); } })) { window.focus(); return; }
    const path = (payload as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return;
    // An action of the main window's own (VS Code for where it is), else the
    // path in the main view, by Studio's open rule, whatever it shows now.
    const action = mainWindowAction(path);
    if (action) void Promise.resolve().then(action).catch(() => {});
    else openFrom(null, { href: path }, { target: "main" }, { toThread: () => {}, openUrl: () => false });
    window.focus();
  });
  return null;
}

export function WindowsBridge() {
  return hasHostWindows && inMainWindow() ? <MainWindowBridge /> : null;
}
