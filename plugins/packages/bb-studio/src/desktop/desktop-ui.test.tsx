// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: { desktopControl: false } as Record<string, unknown> | null }));
vi.mock("../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: settings.values }) }));
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
  it("draws no HUD button, no HUD window and no composer bridge", async () => {
    const { DesktopComposerBridge, DesktopHudButton, DesktopHudWindow } = await import("./DesktopHud");
    for (const values of [{ desktopControl: false }, {}, null]) {
      settings.values = values;
      expect(renderToStaticMarkup(<DesktopHudButton />)).toBe("");
      expect(renderToStaticMarkup(<DesktopHudWindow />)).toBe("");
      expect(renderToStaticMarkup(<DesktopComposerBridge />)).toBe("");
    }
  });
});
