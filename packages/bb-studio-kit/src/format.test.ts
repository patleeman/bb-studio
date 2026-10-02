import { describe, expect, it } from "vitest";
import { errorMessage, formatBytes, quoteMessage, relativeTime, untitled } from "./format";
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

describe("quoteMessage", () => {
  it("quotes the passage, says where, then adds the note", () => {
    expect(quoteMessage({ text: "First line\nSecond", note: " Make this shorter ", where: "version 2" })).toBe(
      "> First line\n> Second\n\n(version 2)\n\nMake this shorter",
    );
  });

  it("names an area when there's no text", () => {
    expect(quoteMessage({ text: null, note: "Wrong color", where: "area x 0–10, y 0–10 px of the 100×100 image, version 1" })).toBe(
      "About the area x 0–10, y 0–10 px of the 100×100 image, version 1:\n\nWrong color",
    );
  });
});
