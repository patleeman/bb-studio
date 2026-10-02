import { expect, it } from "vitest";
import { pluginViewPath, studioItemProps } from "./studio-item";

it("marks an item for the right-click menu", () => {
  expect(studioItemProps({ href: "/plugins/pages/pages/pg_1", title: "Plan" })).toEqual({
    "data-studio-item": "/plugins/pages/pages/pg_1",
    "data-studio-item-title": "Plan",
  });
  expect(studioItemProps(null)).toEqual({});
  expect(studioItemProps({ href: "https://example.com" })).toEqual({});
});

it("treats links into a plugin view as items", () => {
  expect(pluginViewPath("/plugins/excalidraw/drawings/d_1?x=1")).toBe("/plugins/excalidraw/drawings/d_1?x=1");
  expect(pluginViewPath("/plugins/pages/pages")).toBeNull();
  expect(pluginViewPath("/plugins/pages/pages/")).toBeNull();
  expect(pluginViewPath("/threads/thr_1")).toBeNull();
  expect(pluginViewPath("//evil.com/plugins/a/b/c")).toBeNull();
});
