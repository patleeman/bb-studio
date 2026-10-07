import { describe, expect, it } from "vitest";
import { VIEWPORTS, isDeck, parseSteps } from "./shared";

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
