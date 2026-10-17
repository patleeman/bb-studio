// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findPiece } from "./read-along";
import { joinText, nextSpeed } from "./register";

describe("findPiece", () => {
  it("finds a spoken piece in rendered markdown, ignoring marks, case and spacing", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>It came back with <strong>391</strong>.</p><p>For the slide, <em>rounding</em> to 400 is fine.</p>";
    const range = findPiece(root, "For the slide, rounding to 400 is fine.");
    expect(range?.toString()).toBe("For the slide, rounding to 400 is fine");
    expect(findPiece(root, "it came back with 391")?.toString()).toBe("It came back with 391");
    expect(findPiece(root, "Not in this message.")).toBeNull();
  });
});

describe("joinText", () => {
  it("puts what was said after what was typed, with one space", () => {
    expect(joinText("", "Hello there")).toBe("Hello there");
    expect(joinText("Also", "check the build")).toBe("Also check the build");
    expect(joinText("Also ", "check the build")).toBe("Also check the build");
    expect(joinText("Typed", "")).toBe("Typed");
  });
});

describe("nextSpeed", () => {
  it("steps up through the speeds and wraps back to 1", () => {
    expect([1, 1.25, 1.5, 1.75, 2].map(nextSpeed)).toEqual([1.25, 1.5, 1.75, 2, 1]);
    expect(nextSpeed(1.1)).toBe(1.25);
    expect(nextSpeed(2.5)).toBe(1);
  });
});
