import { expect, it } from "vitest";
import { outgoingStudioLinks } from "./studio-links";

it("finds item mentions and embeds without duplicate edges", () => {
  const markdown = "@[Recording](item:talk:rec_a) [Drawing](/plugins/excalidraw/drawings/draw_b) [Again](/plugins/excalidraw/drawings/draw_b)";
  expect(outgoingStudioLinks("page_c", markdown)).toEqual([
    { from: { pluginId: "pages", id: "page_c" }, to: { pluginId: "talk", id: "rec_a" }, kind: "mention", source: "pages" },
    { from: { pluginId: "pages", id: "page_c" }, to: { pluginId: "excalidraw", id: "draw_b" }, kind: "embed", source: "pages" },
  ]);
});

it("preserves opaque mentions and rejects cross-origin paths and malformed URL escapes", () => {
  const links = outgoingStudioLinks("pg_source", "@[Custom](item:custom:part:50%2F) [Local](/plugins/pages/pages/pg_%252F) [Bad](/plugins/pages/pages/pg_%) [External](https://evil.example/plugins/pages/pages/pg_1) /plugins/unknown/settings/opaque");
  expect(links.map((link) => link.to)).toEqual([{ pluginId: "custom", id: "part:50%2F" }, { pluginId: "pages", id: "pg_%2F" }]);
});
