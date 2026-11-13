// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: { desktopControl: false } as Record<string, unknown> | null }));
vi.mock("../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: settings.values }) }));
vi.mock("./host", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDesktopControl: () => {
    throw new Error("desktop control is read only when the HUD is on");
  },
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ThreadChat: () => null,
  useComposer: () => {
    throw new Error("the composer is read only when the HUD is on");
  },
  useSdk: () => {
    throw new Error("the SDK is read only when the HUD is on");
  },
}));

describe("the desktop HUD when it is off", () => {
  it("draws no HUD button, HUD window or composer bridge, and never asks the desktop app or registers the shortcut", async () => {
    const { DesktopComposerBridge, DesktopHudButton, DesktopHudHotkey, DesktopHudWindow } = await import("./DesktopHud");
    for (const values of [{ desktopControl: false }, {}, null]) {
      settings.values = values;
      expect(renderToStaticMarkup(<DesktopHudButton />)).toBe("");
      expect(renderToStaticMarkup(<DesktopHudWindow />)).toBe("");
      expect(renderToStaticMarkup(<DesktopComposerBridge />)).toBe("");
      expect(renderToStaticMarkup(<DesktopHudHotkey />)).toBe("");
    }
  });
});
