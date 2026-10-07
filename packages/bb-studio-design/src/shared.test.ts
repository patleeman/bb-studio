import { describe, expect, it } from "vitest";
import { VIEWPORTS, VIEWPORT_PATTERN, frameSize, isDeck, parseSteps, parseViewport } from "./shared";

describe("slide decks", () => {
  const html = `<meta name="bb-design-steps" content="title=Title; plan=Our plan">`;

  it("is a slide-size screen whose steps are its slides", () => {
    expect(VIEWPORTS.slide).toEqual({ width: 1920, height: 1080 });
    expect(isDeck({ viewport: "slide", steps: parseSteps(html) })).toBe(true);
  });

  it("needs both the slide size and slides", () => {
    expect(isDeck({ viewport: "slide", steps: [] })).toBe(false);
    expect(isDeck({ viewport: "desktop", steps: parseSteps(html) })).toBe(false);
  });
});

describe("frame sizes", () => {
  it("takes presets and custom sizes within the bounds", () => {
    expect(parseViewport("square")).toBe("square");
    expect(parseViewport("1200×630")).toBe("1200x630");
    expect(frameSize("1200x630")).toEqual({ width: 1200, height: 630 });
    expect(VIEWPORT_PATTERN.test("1200x630")).toBe(true);
  });

  it("refuses sizes outside the bounds and falls back to desktop", () => {
    expect(parseViewport("100x100")).toBeNull();
    expect(parseViewport("5000x800")).toBeNull();
    expect(parseViewport("huge")).toBeNull();
    // Object.prototype keys are not presets: "constructor" would store and break backup restore.
    for (const key of ["constructor", "__proto__", "hasownproperty"]) expect(parseViewport(key)).toBeNull();
    expect(frameSize("constructor")).toEqual(VIEWPORTS.desktop);
    expect(frameSize("huge")).toEqual(VIEWPORTS.desktop);
  });
});
