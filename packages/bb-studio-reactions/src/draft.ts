// Draft composition for emoji reactions — shared, pure, unit-tested.
//
// The reaction draft shape is: an optional quote block of the highlighted
// text plus the reaction text ("👍 Agree"). The setting `quotePosition`
// decides the order:
//
//   "before" (default) → quote first, then the reaction text
//   "after"            → reaction text first, then the quote

export type QuotePosition = "before" | "after";

/** Parse a stored settings value into a valid QuotePosition. */
export function parseQuotePosition(raw: unknown): QuotePosition {
  return raw === "after" ? "after" : "before";
}

/**
 * Compose the next draft text after a reaction. `current` is the draft as it
 * stands once the quote block (if any) has been added; `reaction` is the
 * trimmed reaction text; `hasQuote` tells whether a quote block is present
 * (the position only applies when there is a quote to position).
 * `draftBeforeQuote` is the draft as it stood before the quote was appended,
 * so "after" puts the reaction between that text and its quote instead of
 * above the user's existing draft.
 */
export function composeReactionDraft(
  current: string,
  reaction: string,
  hasQuote: boolean,
  quotePosition: QuotePosition,
  draftBeforeQuote = "",
): string {
  const trimmed = reaction.trim();
  if (trimmed.length === 0) return current;
  if (current.length === 0) return trimmed;
  // "after" = the quote sits AFTER the reaction text → reaction goes first.
  if (hasQuote && quotePosition === "after") {
    const kept =
      draftBeforeQuote.trim().length > 0 && current.startsWith(draftBeforeQuote)
        ? draftBeforeQuote
        : "";
    const quote = current.slice(kept.length).replace(/^\s+/, "");
    return kept.length > 0
      ? `${kept.trimEnd()}\n\n${trimmed}\n\n${quote}`
      : `${trimmed}\n\n${quote}`;
  }
  // `addQuote` ends the quote with a newline; trim it so one blank line separates them.
  return `${current.trimEnd()}\n\n${trimmed}`;
}
