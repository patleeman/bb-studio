/** A failed send may restore into the composer only if it is still empty. */
export function canRestoreFailedDictation(draft: { text: string; mentions: readonly unknown[] }, attachments: number): boolean {
  return !draft.text.trim() && draft.mentions.length === 0 && attachments === 0;
}
