// What a Next suggestion adds to the draft. Picking the composer is shared
// with Reactions (`src/reactions`) through Studio's internal `src/kit`.

/** Adds `text` to the draft, after anything already there. */
export function appendDraft(current: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return current;
  return current.trim() ? `${current.trimEnd()}\n\n${trimmed}` : trimmed;
}
