import { describe, expect, it } from "vitest";
import { CANVAS_PLUGIN_IDS, isCanvasThreadOrigin } from "./canvas-plugin";

describe("Visual Chat's threads", () => {
  it("are the ones Visual Chat (or its earlier ids) spawned, and no others", () => {
    for (const pluginId of CANVAS_PLUGIN_IDS) expect(isCanvasThreadOrigin({ pluginId }), pluginId).toBe(true);
    expect(isCanvasThreadOrigin({ pluginId: "studio-visual-chat" })).toBe(true);
    for (const origin of [{ pluginId: null }, { pluginId: "studio" }, { pluginId: "side-chat" }, null, undefined]) expect(isCanvasThreadOrigin(origin)).toBe(false);
  });
});
