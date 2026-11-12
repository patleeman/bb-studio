// Studio's windows' side in BB's main window, always mounted there (an app
// overlay):
// - registers the launcher's hotkey, and the HUD's menu bar entry (with a
//   hotkey only when the user set one), when Studio loads (BB forgets windows
//   when it restarts) and again when their settings change; checks that each
//   hotkey took and falls back when another app holds it (src/hud/hotkey.ts);
// - closes the "display only" window older Studios opened;
// - opens what a plugin window asks for in the main view and brings the main
//   window forward ("Pop back in" in the HUD, a launcher row, links in a
//   popped-out item).
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
import { noteWindowHotkey, registerWithHotkey, useHudHotkey, type HudHotkey } from "../hotkey";
import { HUD_WINDOW_ID, hudWindowOptions, LEGACY_HUD_DISPLAY_WINDOW_ID, MAIN_WINDOW_CHANNEL } from "../shared";

/**
 * Sets the HUD up for `settings`: its menu bar entry, and a hotkey when the
 * user set one, or none of it when off. The HUD has no alternate: a taken
 * shortcut leaves it with the menu bar entry. Answers the hotkey in use; null
 * when off.
 */
export function applyHudSettings(windows: HostWindows, settings: { hudEnabled: boolean; hudHotkey: string }, screen: Screen = window.screen): Promise<HudHotkey | null> {
  if (settings.hudEnabled) return registerWithHotkey(windows, HUD_WINDOW_ID, settings.hudHotkey, (hotkey) => hudWindowOptions({ hotkey, screen }), null);
  // BB has no "forget this window": a registration with no hotkey and no menu bar entry drops both.
  return windows.register(HUD_WINDOW_ID, {}).then(() => windows.close(HUD_WINDOW_ID)).then(() => null);
}

/** Registers the launcher with its hotkey, falling back to the alternate when another app holds it. Answers the hotkey in use. */
export function applyLauncherSettings(windows: HostWindows, settings: { launcherHotkey: string }): Promise<HudHotkey> {
  return registerWithHotkey(windows, LAUNCHER_WINDOW_ID, settings.launcherHotkey, launcherWindowOptions);
}

/**
 * Both windows, the launcher first: where the two settings name one
 * shortcut, the launcher holds it and the HUD is told it is taken.
 */
export async function applyWindowSettings(windows: HostWindows, settings: { hudEnabled: boolean; hudHotkey: string; launcherHotkey: string }, screen: Screen = window.screen): Promise<{ launcher: HudHotkey; hud: HudHotkey | null }> {
  // Older Studios opened a second, click-through HUD window; one left open has nothing to show now.
  void windows.close(LEGACY_HUD_DISPLAY_WINDOW_ID).catch(() => false);
  const launcher = await applyLauncherSettings(windows, settings);
  const hud = await applyHudSettings(windows, settings, screen);
  return { launcher, hud };
}

/** Where the HUD is turned on, for a control that finds it off. */
export const HUD_OFF_MESSAGE = "The HUD is off. Turn it on in Settings → Studio → Windows.";

/**
 * Shows the HUD, for a control outside the HUD's own places (the Bot
 * sidebar's ··· menu, a conversation's "Pop out to HUD"). With the HUD off
 * in settings nothing opens and nothing is turned on: it says where the
 * switch is. With `threadId` the HUD shows that conversation: an open HUD
 * loads it in place, where it is, at its size. Answers whether it opened.
 */
export async function showHudWindow(windows: Pick<HostWindows, "open">, settings: { hudEnabled: boolean; hotkey: string; threadId?: string }, screen: Screen = window.screen): Promise<boolean> {
  if (!settings.hudEnabled) { toast(HUD_OFF_MESSAGE); return false; }
  if (!(await windows.open(HUD_WINDOW_ID, hudWindowOptions({ hotkey: settings.hotkey, screen, threadId: settings.threadId })))) { toast.error("Couldn't open the HUD."); return false; }
  return true;
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

let show: ((threadId?: string) => Promise<boolean>) | null = null;

/** Shows the HUD through the main window's bridge, which holds BB's windows and Studio's settings; on `threadId` when given. */
export async function showHud(threadId?: string): Promise<boolean> {
  if (!show) { toast.error("Studio is still starting. Try again in a moment."); return false; }
  return show(threadId);
}

function MainWindowBridge() {
  const windows = useHostWindows();
  const { values } = useStudioSettings();
  const enabled = values?.hudEnabled;
  const hotkey = values?.hudHotkey;
  const launcherHotkey = values?.launcherHotkey;
  // The shortcut BB holds, which is not the setting's when another app has that one.
  const { inUse } = useHudHotkey(hotkey ?? "");
  useEffect(() => {
    if (enabled === undefined) return;
    const mine = (threadId?: string) => showHudWindow(windows, { hudEnabled: enabled, hotkey: inUse, ...(threadId ? { threadId } : {}) });
    show = mine;
    return () => { if (show === mine) show = null; };
  }, [windows, enabled, inUse]);
  useEffect(() => {
    if (enabled === undefined || hotkey === undefined || launcherHotkey === undefined) return;
    let current = true;
    void applyWindowSettings(windows, { hudEnabled: enabled, hudHotkey: hotkey, launcherHotkey }).then((held) => {
      if (!current) return;
      noteWindowHotkey("launcher", held.launcher);
      noteWindowHotkey("hud", held.hud);
    }, () => {});
    return () => { current = false; };
  }, [windows, enabled, hotkey, launcherHotkey]);
  const navigate = useBbNavigate();
  const openLink = useOpenLink();
  const commands = useAppCommandList();
  const latest = useRef(commands);
  latest.current = commands;
  useRealtime(MAIN_WINDOW_CHANNEL, (payload) => {
    if (runRelayed(payload, { commands: latest.current, openUrl: (url) => navigate.openUrl(url), openLink: (link, how) => { void openLink(link, { how, source: "hud" }); } })) { window.focus(); return; }
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

export function HudBridge() {
  return hasHostWindows && inMainWindow() ? <MainWindowBridge /> : null;
}
