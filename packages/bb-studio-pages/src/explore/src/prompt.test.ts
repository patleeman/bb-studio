import { describe, expect, it } from "vitest";
import { INSTRUCTIONS_LIMIT, exploreInstructions } from "./prompt";
import { parseExploreItems } from "./shared";

describe("the instructions", () => {
  const text = exploreInstructions();

  it("fit in what bb.agents.configure keeps", () => {
    expect(text.length).toBeLessThan(INSTRUCTIONS_LIMIT);
    expect(text).not.toMatch(/explore_explain|Studio Page/);
  });

  it("show a directive that parses", () => {
    const example = /::explore\{items="([^"]+)"\}/.exec(text);
    expect(parseExploreItems(example?.[1])).toHaveLength(2);
  });

  it("put ::explore before a ::reactions line, and last otherwise", () => {
    expect(text).toMatch(/::reactions line, put this line immediately before it; otherwise make it the last line/);
    expect(text).toMatch(/never inside a code block/);
  });
});
