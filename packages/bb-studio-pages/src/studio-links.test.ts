import { expect, it } from "vitest";
import { outgoingStudioLinks } from "./studio-links";

it("finds item mentions and embeds without duplicate edges", () => {
  const markdown = "@[Task](item:studio-tasks:task_a) [Drawing](/plugins/excalidraw/drawings/draw_b) [Again](/plugins/excalidraw/drawings/draw_b)";
  expect(outgoingStudioLinks("page_c", markdown)).toEqual([
    { from: { pluginId: "pages", id: "page_c" }, to: { pluginId: "studio-tasks", id: "task_a" }, kind: "mention", source: "pages" },
    { from: { pluginId: "pages", id: "page_c" }, to: { pluginId: "excalidraw", id: "draw_b" }, kind: "embed", source: "pages" },
  ]);
});
