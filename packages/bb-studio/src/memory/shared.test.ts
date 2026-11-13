import { expect, it } from "vitest";
import { recordLine } from "./shared";

it("a record's line has no Markdown marks: bold, bullets, headings, links and code go, lines join with a dot", () => {
  expect(recordLine("Lisbon trip\n\n**Decisions**\n- Three days, one line per day\n- Stay in *Alfama*\n\n**Left open**\n- [Flights](https://example.com) and `budget`"))
    .toBe("Lisbon trip · Decisions · Three days, one line per day · Stay in Alfama · Left open · Flights and budget");
  expect(recordLine("## Plans\n> quoted\n1. first\n- [x] done\n---\n__under__ ~~old~~")).toBe("Plans · quoted · first · done · under old");
  expect(recordLine("Sam's sister Ana: birthday is December 3.")).toBe("Sam's sister Ana: birthday is December 3.");
  expect(recordLine("2*3 = 6 and snake_case_name stay")).toBe("2*3 = 6 and snake_case_name stay");
});
