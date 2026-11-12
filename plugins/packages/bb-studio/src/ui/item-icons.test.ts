import { expect, it } from "vitest";
import { hostIcon, itemTabIcon } from "./item-icons";

it("gives a tab its kind's glyph from its params, and nothing for params it doesn't know", () => {
  expect(itemTabIcon({ kind: "page", id: "pg_1" })).toBe("FileText");
  expect(itemTabIcon({ kind: "drawing", id: "d_1" })).toBe("Edit");
  expect(itemTabIcon({ kind: "something-new", id: "x" })).toBeNull();
  expect(itemTabIcon(null)).toBeNull();
  expect(itemTabIcon(["page"])).toBeNull();
});

it("draws an emoji where one is given and a glyph otherwise", () => {
  expect(hostIcon("page", "📚")).toBe("📚");
  expect(hostIcon("mini")).toBe("AppWindow");
  expect(hostIcon("unknown")).toBe("FileText");
});
