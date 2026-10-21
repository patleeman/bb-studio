// Silent output: providers won't end a turn with an empty assistant message,
// so an agent with nothing to say replies exactly `[PASS]`. Studio (and any
// plugin that reads turns) treats such a turn as silent: no push, no unread,
// no preview, no Activity. See docs/silent-output.md.

/** The reply that means "nothing to say". */
export const PASS_REPLY = "[PASS]";

/** One line for prompts. */
export const PASS_INSTRUCTION = `If nothing changed, reply exactly ${PASS_REPLY}.`;

/** True when a final assistant message is `[PASS]` alone (any case, wrapped in whitespace, backticks or markdown emphasis). */
export function isPassOutput(text: string | null | undefined): boolean {
  return typeof text === "string" && /^[\s`*_~]*\[pass\][\s`*_~]*$/iu.test(text);
}

/** True when a turn's final text says nothing: empty, or `[PASS]`. */
export function isSilentOutput(text: string | null | undefined): boolean {
  return text == null || text.trim() === "" || isPassOutput(text);
}
