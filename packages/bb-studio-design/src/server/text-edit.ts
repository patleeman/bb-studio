// Editing text right on the canvas. The screen reports an element's inner
// HTML as the browser serialized it and the new text; here that text is
// found in the screen's source and replaced. The browser may write a
// character the source spells as an entity (’ for &rsquo;), so those match
// either way. As with design_edit_screen, the text must match exactly one
// place, or nothing changes.

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches `text` in source HTML, where any entity may stand for a special or non-ASCII character. */
function sourcePattern(before: string): RegExp {
  // innerHTML writes &amp; &lt; &gt; &nbsp; for these; the source may use any entity or the character.
  const decoded = before.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"");
  const parts = [...decoded].map((char) => /[\w\s]/.test(char) && char !== " " ? escapeRegExp(char) : `(?:${escapeRegExp(char)}|&[#\\w]+;)`);
  // Only between tags: text content, not attribute values or scripts' strings that happen to match.
  return new RegExp(`(>)${parts.join("")}(<)`, "g");
}

export const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type TextEdit = { ok: true; html: string } | { ok: false; reason: "missing" | "ambiguous" };

/** Replaces the one element text `before` (as innerHTML) with plain `after`. */
export function applyTextEdit(html: string, before: string, after: string): TextEdit {
  if (!before.trim()) return { ok: false, reason: "missing" };
  const matches = [...html.matchAll(sourcePattern(before))];
  if (!matches.length) return { ok: false, reason: "missing" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  const match = matches[0]!;
  const start = match.index! + 1;
  const end = match.index! + match[0].length - 1;
  // Keep the source's own leading and trailing whitespace around the text.
  const original = html.slice(start, end);
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  return { ok: true, html: html.slice(0, start) + lead + escapeText(after.trim()) + trail + html.slice(end) };
}
