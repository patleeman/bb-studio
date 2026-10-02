import { describe, expect, it } from "vitest";
import { feedInstructions, INSTRUCTIONS_LIMIT } from "./prompt";
import { cardLine, parsePost } from "./shared";

describe("feed instructions", () => {
  it("fit, and point at the tool", () => {
    expect(feedInstructions().length).toBeLessThan(INSTRUCTIONS_LIMIT);
    expect(feedInstructions()).toContain("feed_post");
  });

  it("a reply ending in a card line doesn't publish a post of its own", () => {
    expect(parsePost(`Moved to 4 PM.\n\n${cardLine("post_1")}`)).toBeNull();
  });
});
