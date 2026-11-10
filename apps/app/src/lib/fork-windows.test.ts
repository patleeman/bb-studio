// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginWindows, forkWindowPath } from "./fork-windows";

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { bbDesktop?: unknown }).bbDesktop;
});

describe("plugin windows", () => {
  it("builds the bare window route with the plugin's params and the transparent flag", () => {
    expect(forkWindowPath("studio", "hud")).toBe("/fork-window/studio/hud");
    expect(
      forkWindowPath("studio", "item", {
        transparent: true,
        params: { kind: "page", id: "pg 1" },
      }),
    ).toBe("/fork-window/studio/item?kind=page&id=pg+1&bbTransparent=1");
  });

  it("opens a plain popup in a browser, focuses it when open, and toggles it closed", async () => {
    const popup = { closed: false, focus: vi.fn(), close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(popup as unknown as Window);
    const windows = createPluginWindows("studio");

    expect(windows.native).toBe(false);
    expect(await windows.register("hud", { hotkey: "Alt+Space" })).toBe(false);
    expect(await windows.open("hud", { width: 600, height: 200 })).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "/fork-window/studio/hud",
      "bb-studio/hud",
      "popup,width=600,height=200",
    );
    expect(await windows.open("hud")).toBe(true);
    expect(popup.focus).toHaveBeenCalledTimes(1);
    expect(await windows.toggle("hud")).toBe(true);
    expect(popup.close).toHaveBeenCalledTimes(1);
  });
});
