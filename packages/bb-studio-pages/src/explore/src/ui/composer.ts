// What a Next suggestion adds to the draft. Picking the composer is the
// kit's (`@bb-studio/kit/composer`), shared with Studio Reactions.

/** Adds `text` to the draft, after anything already there. */
export function appendDraft(current: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return current;
  return current.trim() ? `${current.trimEnd()}\n\n${trimmed}` : trimmed;
}
