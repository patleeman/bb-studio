// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findPiece } from "./read-along";
import { joinText } from "./register";

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
