import { expect, it } from "vitest";
import { pluginViewPath, studioItemProps, studioThreadProps, targetHref, threadLinkId } from "./studio-item";

it("marks an item for the menu, the clicks and dragging", () => {
  expect(studioItemProps({ href: "/plugins/pages/pages/pg_1", title: "Plan" })).toEqual({
    "data-studio-item": "/plugins/pages/pages/pg_1",
    "data-studio-item-title": "Plan",
    draggable: "true",
  });
  expect(studioItemProps({ href: "/plugins/pages/pages/pg_1" }, { drag: false })).toEqual({ "data-studio-item": "/plugins/pages/pages/pg_1" });
  expect(studioItemProps(null)).toEqual({});
  expect(studioItemProps({ href: "https://example.com" })).toEqual({});
  expect(studioThreadProps("thr_1", "Launch")).toEqual({ "data-studio-thread": "thr_1", "data-studio-item-title": "Launch", draggable: "true" });
  expect(studioThreadProps(null)).toEqual({});
});

it("treats links into a plugin view as items", () => {
  expect(pluginViewPath("/plugins/excalidraw/drawings/d_1?x=1")).toBe("/plugins/excalidraw/drawings/d_1?x=1");
  expect(pluginViewPath("/plugins/pages/pages")).toBeNull();
  expect(pluginViewPath("/plugins/pages/pages/")).toBeNull();
  expect(pluginViewPath("/threads/thr_1")).toBeNull();
  expect(pluginViewPath("//evil.com/plugins/a/b/c")).toBeNull();
});

it("treats links to a thread as threads", () => {
  expect(threadLinkId("/threads/thr_1")).toBe("thr_1");
  expect(threadLinkId("/projects/proj_1/threads/thr_2?x=1")).toBe("thr_2");
  expect(threadLinkId("/threads/thr_1/files")).toBeNull();
  expect(threadLinkId("/plugins/a/threads/thr_1")).toBeNull();
  expect(targetHref({ kind: "thread", threadId: "thr_1" })).toBe("/threads/thr_1");
});
