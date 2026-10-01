import { expect, it } from "vitest";
import { applyItemChanges } from "./partial";

it("updates one provider item without replacing unrelated rows", () => {
  const initial = [{ pluginId: "pages", id: "a", title: "Old" }, { pluginId: "talk", id: "a", title: "Recording" }];
  expect(applyItemChanges(initial, [{ pluginId: "pages", id: "a", title: "New" }], [])).toEqual([
    initial[1], { pluginId: "pages", id: "a", title: "New" },
  ]);
  expect(applyItemChanges(initial, [], [{ pluginId: "pages", id: "a" }])).toEqual([initial[1]]);
});
