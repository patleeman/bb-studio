import { describe, expect, it } from "vitest";
import { feedInstructions, INSTRUCTIONS_LIMIT } from "./prompt";

describe("feed instructions", () => {
  it("fit, and point at the tool", () => {
    expect(feedInstructions().length).toBeLessThan(INSTRUCTIONS_LIMIT);
    expect(feedInstructions()).toContain("feed_post");
  });
});
