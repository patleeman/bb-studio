import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { registerHostWindow } from "../kit/app/windows";
import { DesktopComposerBridge, DesktopHudButton, DesktopHudHotkey, DesktopHudWindow } from "./DesktopHud";
import { DESKTOP_HUD_WINDOW_ID, hasDesktopControl } from "./host";

export function registerDesktopApp(app: PluginAppBuilder): boolean {
  if (!hasDesktopControl) return false;
  if (!registerHostWindow(app.slots, { id: DESKTOP_HUD_WINDOW_ID, title: "BB Studio HUD", component: DesktopHudWindow })) return false;
  app.slots.experimental_appOverlay({ id: "desktop-hud-hotkey", component: DesktopHudHotkey });
  app.composer.customize({
    id: "desktop-hud",
    scopes: ["thread"],
    actions: [{ id: "desktop-hud", component: DesktopHudButton }],
    banners: [{ id: "desktop", chrome: "bare", component: DesktopComposerBridge }],
  });
  return true;
}
