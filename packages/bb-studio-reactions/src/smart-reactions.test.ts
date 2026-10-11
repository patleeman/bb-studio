import { describe, expect, it } from "vitest";
import {
  MAX_SMART_REACTIONS,
  parseSmartReactions,
} from "./smart-reactions";

describe("parseSmartReactions", () => {
  it("splits items on | and keeps commas inside labels", () => {
    expect(parseSmartReactions("👍 Ship it|🧪 Tests, then ship")).toEqual([
      { emoji: "👍", label: "Ship it", text: "👍 Ship it" },
      { emoji: "🧪", label: "Tests, then ship", text: "🧪 Tests, then ship" },
    ]);
  });

  it("returns nothing for a missing or empty attribute", () => {
    expect(parseSmartReactions(undefined)).toEqual([]);
    expect(parseSmartReactions("")).toEqual([]);
    expect(parseSmartReactions(" | ")).toEqual([]);
  });

  it("drops bare tokens, duplicates, and overlong items", () => {
    const long = `🐢 ${"slow ".repeat(20)}`;
    expect(
      parseSmartReactions(`👍|👍 Agree|👍  Agree|${long}|❓ Why`).map((item) => item.text),
    ).toEqual(["👍 Agree", "❓ Why"]);
  });

  it("drops items that don't start with an emoji, and keeps flags, keycaps and ZWJ emoji", () => {
    expect(
      parseSmartReactions("Ship it|Looks good to me|🇯🇵 Tokyo|1️⃣ First|🏳️‍🌈 Pride|👍🏽 Fine").map((item) => item.emoji),
    ).toEqual(["🇯🇵", "1️⃣", "🏳️‍🌈", "👍🏽"]);
  });

  it("collapses whitespace, including newlines", () => {
    expect(parseSmartReactions("✅\n Do   it")[0]?.text).toBe("✅ Do it");
  });

  it("caps the number of items", () => {
    const raw = Array.from({ length: 9 }, (_, i) => `🔢 Option ${i + 1}`).join("|");
    expect(parseSmartReactions(raw)).toHaveLength(MAX_SMART_REACTIONS);
  });
});
