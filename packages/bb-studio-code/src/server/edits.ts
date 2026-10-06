// Search-and-replace edits, the shape code_edit takes. In an open editor the
// bridge types them into the buffer; with no editor open they're applied to
// the file on disk here, by the same rules.
import { z } from "zod";

export const editSchema = z.object({
  /** Text that appears exactly once in the file; empty appends to the end. */
  oldText: z.string().max(100_000),
  newText: z.string().max(100_000),
});
export type TextEdit = z.infer<typeof editSchema>;

/** Where one edit applies in `text`: [start, end). Throws when it's ambiguous. */
export function locate(text: string, edit: TextEdit): [number, number] {
  if (!edit.oldText) return [text.length, text.length];
  const at = text.indexOf(edit.oldText);
  if (at < 0) throw new Error(`Couldn't find the text to replace: ${JSON.stringify(edit.oldText.slice(0, 80))}`);
  if (text.indexOf(edit.oldText, at + 1) >= 0) throw new Error(`The text to replace appears more than once; include more around it: ${JSON.stringify(edit.oldText.slice(0, 80))}`);
  return [at, at + edit.oldText.length];
}

/** The edits applied in order, each to the result of the one before. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  return edits.reduce((current, edit) => {
    const [start, end] = locate(current, edit);
    return current.slice(0, start) + edit.newText + current.slice(end);
  }, text);
}
