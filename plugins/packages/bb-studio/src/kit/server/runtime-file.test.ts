import { expect, it } from "vitest";
import { runtimeFile } from "./runtime-file";

it("resolves from node_modules where no bundled copy sits beside the server", () => {
  expect(runtimeFile("@resvg/resvg-wasm/index_bg.wasm")).toMatch(/resvg-wasm[/\\]index_bg\.wasm$/);
});
