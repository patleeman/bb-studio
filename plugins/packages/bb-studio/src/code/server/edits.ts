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

/**
 * What to do with a live edit's answer. Only an edit no editor took ("no
 * window", or none open) goes to disk: after a timeout the editor may still
 * be typing, so writing the file too could apply it twice.
 */
export function editOutcome(result: { ok: boolean; detail: string; code?: string } | null): "done" | "disk" | "fail" {
  if (result === null || result.code === "no-window") return "disk";
  return result.ok ? "done" : "fail";
}

/** Files this size and up aren't edited on disk. */
export const MAX_DISK_EDIT_BYTES = 1024 * 1024;

/**
 * The edits applied to a file on disk, when no editor is open. The path is
 * resolved through symlinks and must stay inside `folders`, and the resolved
 * file is the one written. Files that aren't plain UTF-8 text (or are too
 * big) are refused rather than risk damaging them.
 */
export async function editOnDisk(path: string, folders: string[], edits: TextEdit[]): Promise<void> {
  const { contained } = await import("./files");
  const { readFile, stat, writeFile } = await import("node:fs/promises");
  const real = await contained(folders, path);
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${path} isn't a file.`);
  if (info.size >= MAX_DISK_EDIT_BYTES) throw new Error(`${path} is too large to edit this way (${info.size} bytes).`);
  const bytes = await readFile(real);
  if (bytes.includes(0)) throw new Error(`${path} isn't a text file.`);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${path} isn't UTF-8 text; editing it this way could damage it.`);
  await writeFile(real, applyEdits(text, edits));
}
