import { describe, expect, it } from "vitest";
import { parseEmojiItems } from "./emoji-items";
import {
  MAX_SMART_REACTIONS,
  parseSmartReactions,
  smartReactionInstructions,
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

  it("collapses whitespace, including newlines", () => {
    expect(parseSmartReactions("✅\n Do   it")[0]?.text).toBe("✅ Do it");
  });

  it("caps the number of items", () => {
    const raw = Array.from({ length: 9 }, (_, i) => `🔢 Option ${i + 1}`).join("|");
    expect(parseSmartReactions(raw)).toHaveLength(MAX_SMART_REACTIONS);
  });
});

describe("smartReactionInstructions", () => {
  it("lists the configured reactions as the preferred set", () => {
    const text = smartReactionInstructions(parseEmojiItems("👍 Agree, 👎 Disagree"));
    expect(text).toContain('::reactions{items="');
    expect(text).toContain("👍 Agree | 👎 Disagree");
  });

  it("still explains the directive with no configured reactions", () => {
    const text = smartReactionInstructions([]);
    expect(text).toContain("::reactions{");
    expect(text).not.toContain("from the user's settings");
  });

  it("stays well under the host's 4096-character limit", () => {
    const many = parseEmojiItems(
      Array.from({ length: 8 }, (_, i) => `🔢 A long configured label ${i}`).join(", "),
    );
    expect(smartReactionInstructions(many).length).toBeLessThan(2000);
  });
});
