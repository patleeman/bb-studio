import { describe, expect, it } from "vitest";
import { isShown } from "./Navigation";
import { projectIdOf } from "./routes";

describe("navigation", () => {
  const panel = (pluginId: string, panelId: string, isVisible = true) => ({ isVisible, action: { kind: "open-plugin-panel" as const, pluginId, panelId } });

  it("keeps BB's own items and other plugins' panels as BB shows them", () => {
    expect(isShown({ isVisible: true, action: { kind: "new-thread" } })).toBe(true);
    expect(isShown(panel("pages", "pages"))).toBe(true);
    expect(isShown(panel("pages", "pages", false))).toBe(false);
  });

  it("shows Studio's places only, not the panels that serve item links", () => {
    expect(["office-inbox", "projects", "studio"].map((id) => isShown(panel("studio", id)))).toEqual([true, true, true]);
    expect(["artifacts", "tasks", "channels", "bots", "chat", "feed"].map((id) => isShown(panel("studio", id)))).toEqual([false, false, false, false, false, false]);
  });
});

describe("project routes", () => {
  it("reads the project from the panel sub-path", () => {
    expect(projectIdOf("")).toBeNull();
    expect(projectIdOf("proj_abc")).toBe("proj_abc");
    expect(projectIdOf("/proj_abc/")).toBe("proj_abc");
  });
});
