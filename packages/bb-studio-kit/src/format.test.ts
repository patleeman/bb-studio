import { describe, expect, it } from "vitest";
import { errorMessage, formatBytes, relativeTime, untitled } from "./format";
import { projectChoices } from "./app/item-menu";

describe("shared item formatting", () => {
  it("keeps binary size boundaries readable", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });

  it("uses one error, title, and relative time vocabulary", () => {
    expect(errorMessage(new Error("broken"))).toBe("broken");
    expect(errorMessage("offline")).toBe("offline");
    expect(untitled("  ")).toBe("Untitled");
    expect(relativeTime(9000, 10000)).toBe("just now");
  });

  it("offers Global before projects", () => {
    expect(projectChoices([{ id: "a", name: "Alpha" }])).toEqual([
      { id: null, name: "Global" },
      { id: "a", name: "Alpha" },
    ]);
  });
});
