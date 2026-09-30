import { describe, expect, it } from "vitest";
import { isPanelVisible, withPanelsVisible } from "./sidebar";

const ADDONS = ["pages/pages", "talk/recordings"];

describe("sidebar visibility", () => {
  it("reads null as everything but bb's default-hidden items", () => {
    expect(isPanelVisible([], null, "pages/pages")).toBe(true);
    expect(isPanelVisible([], null, "__bb__/search-threads")).toBe(false);
  });
  it("shows ids the user hasn't arranged yet", () => {
    expect(isPanelVisible(["__bb__/skills"], ["__bb__/skills"], "pages/pages")).toBe(true);
    expect(isPanelVisible(["pages/pages"], [], "pages/pages")).toBe(false);
  });

  it("hides the add-ons and keeps everything else as it was", () => {
    const order = ["__bb__/new-thread", "__bb__/search-threads", "pages/pages", "studio/studio"];
    const next = withPanelsVisible(order, null, ADDONS, false);
    expect(next.order).toEqual([...order, "talk/recordings"]);
    expect(next.visible).toEqual(["__bb__/new-thread", "studio/studio"]);
    for (const id of order.filter((id) => !ADDONS.includes(id))) {
      expect(isPanelVisible(next.order, next.visible, id)).toBe(isPanelVisible(order, null, id));
    }
    // Panels bb hasn't seen before still appear.
    expect(isPanelVisible(next.order, next.visible, "excalidraw/drawings")).toBe(true);
  });

  it("shows them again", () => {
    const hidden = withPanelsVisible(["studio/studio"], ["studio/studio"], ADDONS, false);
    const shown = withPanelsVisible(hidden.order, hidden.visible, ADDONS, true);
    expect(ADDONS.every((id) => isPanelVisible(shown.order, shown.visible, id))).toBe(true);
    expect(isPanelVisible(shown.order, shown.visible, "studio/studio")).toBe(true);
  });

  it("respects items the user already hid", () => {
    const next = withPanelsVisible(["__bb__/skills", "pages/pages"], ["pages/pages"], ["talk/recordings"], false);
    expect(isPanelVisible(next.order, next.visible, "__bb__/skills")).toBe(false);
    expect(isPanelVisible(next.order, next.visible, "pages/pages")).toBe(true);
  });
});
