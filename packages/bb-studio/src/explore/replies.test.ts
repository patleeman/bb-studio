import { describe, expect, it } from "vitest";
import { nextInstructions } from "./prompt";
import { DEFAULT_REPLIES } from "./prompt";
import { repliesFrom } from "./server";

describe("quick replies", () => {
  it("are on by default with the default replies", () => {
    expect(repliesFrom({})).toEqual(DEFAULT_REPLIES);
    expect(repliesFrom({ explore_quickReplies: true, explore_replyItems: "👍 Agree, ❓ Clarify" })).toEqual(["👍 Agree", "❓ Clarify"]);
    expect(repliesFrom({ explore_replyItems: "" })).toEqual([]);
  });

  it("are null when turned off", () => {
    expect(repliesFrom({ explore_quickReplies: false, explore_replyItems: "👍 Agree" })).toBeNull();
  });
});

describe("nextInstructions without replies", () => {
  it("leaves the reply attribute out entirely", () => {
    const text = nextInstructions({ explore: true, replies: null });
    expect(text).not.toContain('reply="');
    expect(text).not.toContain("- reply:");
    expect(text).toContain("No reply attribute");
    expect(nextInstructions({ explore: true, replies: [] })).toContain('reply="');
  });
});
