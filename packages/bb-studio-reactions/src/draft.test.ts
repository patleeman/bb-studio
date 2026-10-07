import { describe, expect, it } from "vitest";
import {
  composeReactionDraft,
  parseQuotePosition,
} from "./draft";

describe("parseQuotePosition", () => {
  it("accepts both values", () => {
    expect(parseQuotePosition("before")).toBe("before");
    expect(parseQuotePosition("after")).toBe("after");
  });

  it("falls back to before for anything else", () => {
    expect(parseQuotePosition(undefined)).toBe("before");
    expect(parseQuotePosition("")).toBe("before");
    expect(parseQuotePosition("sideways")).toBe("before");
    expect(parseQuotePosition(42)).toBe("before");
  });
});

describe("composeReactionDraft", () => {
  const quote = "> selected text";

  it("places the quote first with quotePosition before (default)", () => {
    expect(composeReactionDraft(quote, "👍 Agree", true, "before")).toBe(
      "> selected text\n\n👍 Agree",
    );
  });

  it("places the reaction first with quotePosition after", () => {
    expect(composeReactionDraft(quote, "👍 Agree", true, "after")).toBe(
      "👍 Agree\n\n> selected text",
    );
  });

  it("keeps the reaction next to its quote after an existing draft with quotePosition after", () => {
    // `addQuote` appends the quote below what the user already typed.
    expect(
      composeReactionDraft("my notes\n> selected text\n", "👍 Agree", true, "after", "my notes"),
    ).toBe("my notes\n\n👍 Agree\n\n> selected text\n");
  });

  it("appends the reaction when there is no quote, regardless of position", () => {
    expect(composeReactionDraft("existing draft", "👍 Agree", false, "before")).toBe(
      "existing draft\n\n👍 Agree",
    );
    expect(composeReactionDraft("existing draft", "👍 Agree", false, "after")).toBe(
      "existing draft\n\n👍 Agree",
    );
  });

  it("handles an empty draft", () => {
    expect(composeReactionDraft("", "👍 Agree", false, "before")).toBe("👍 Agree");
  });

  it("keeps the draft unchanged for an empty reaction", () => {
    expect(composeReactionDraft(quote, "   ", true, "before")).toBe(quote);
  });
});
