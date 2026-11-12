// Editing text right on the canvas. The screen reports an element's inner
// HTML as the browser serialized it, before and after the edit; here the old
// HTML is found in the screen's source and replaced. Only text and simple
// inline formatting (a <br>, an <em>) come through. The browser may write a
// character the source spells as an entity (’ for &rsquo;), so those match
// either way. As with design_edit_screen, the old HTML must match exactly
// one place, or nothing changes.

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NBSP = " ";

/** Matches `before` in source HTML: tags as written; in text, any entity may stand for a special or non-ASCII character. */
function sourcePattern(before: string): RegExp {
  const parts = before.split(/(<[^>]*>)/).flatMap((part, index) => {
    if (index % 2) return [escapeRegExp(part)];
    // innerHTML writes &amp; &lt; &gt; &nbsp; for these; the source may use any entity or the character.
    const decoded = part.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, NBSP).replace(/&quot;/g, "\"");
    return [...decoded].map((char) => /[\w\s]/.test(char) && char !== NBSP ? escapeRegExp(char) : `(?:${escapeRegExp(char)}|&[#\\w]+;)`);
  });
  // Only between tags: an element's content, not attribute values or scripts' strings that happen to match.
  return new RegExp(`(>)${parts.join("")}(<)`, "g");
}

/** Tags an edit may hold. Keep in step with INLINE in src/server/screen-script.ts. */
const INLINE_TAGS = new Set(["br", "em", "strong", "b", "i", "u", "s", "span", "a", "small", "mark", "code", "sub", "sup"]);

/** Text and inline formatting only: no other tags, event handlers or script URLs. */
export function isInlineMarkup(html: string): boolean {
  for (const [, name] of html.matchAll(/<\/?\s*([a-zA-Z][\w-]*)/g)) if (!INLINE_TAGS.has(name!.toLowerCase())) return false;
  if (/[\s/"'=]on[a-z]+\s*=|<!--/i.test(html)) return false;
  // A browser reads "java&#115;cript:" and "java\tscript:" as a script URL too.
  return !/(?:java|vb)script:/i.test(withoutEntities(html).replace(/[\u0000-\u0020]/g, ""));
}

/** Numeric character references and &colon; spelled out, the way a browser reads an attribute. */
function withoutEntities(html: string): string {
  return html
    .replace(/&#(x[0-9a-f]{1,6}|\d{1,7});?/gi, (entity, code: string) => {
      const point = code[0] === "x" || code[0] === "X" ? parseInt(code.slice(1), 16) : Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/&colon;/gi, ":")
    .replace(/&(?:tab|newline);/gi, " ");
}

/**
 * Whether html[open] (a ">") ends an element's opening tag and html[close]
 * (a "<") starts the same element's closing tag: the match is that element's
 * whole content, not the start of a longer paragraph whose DOM differs.
 */
function wholeContent(html: string, open: number, close: number): boolean {
  const tag = /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?$/.exec(html.slice(Math.max(0, open - 2000), open));
  if (!tag || VOID_TAGS.has(tag[1]!.toLowerCase())) return false;
  const end = new RegExp(`^</\\s*${tag[1]}\\s*>`, "i");
  return end.test(html.slice(close, close + tag[1]!.length + 8));
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export type TextEdit = { ok: true; html: string } | { ok: false; reason: "missing" | "ambiguous" | "markup" };

/** Replaces the one element whose inner HTML is `before` with `after`, both as the browser serialized them. */
export function applyTextEdit(html: string, before: string, after: string): TextEdit {
  if (!before.trim()) return { ok: false, reason: "missing" };
  if (!isInlineMarkup(after)) return { ok: false, reason: "markup" };
  // Not inside a script, style or comment: text a script draws can look like markup in its source.
  const hidden = [...html.matchAll(/<(script|style|textarea|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<!--[\s\S]*?(?:-->|$)/gi)].map((block) => [block.index!, block.index! + block[0].length] as const);
  const matches = [...html.matchAll(sourcePattern(before))].filter((match) => !hidden.some(([from, to]) => match.index! > from && match.index! < to) && wholeContent(html, match.index!, match.index! + match[0].length - 1));
  if (!matches.length) return { ok: false, reason: "missing" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  const match = matches[0]!;
  const start = match.index! + 1;
  const end = match.index! + match[0].length - 1;
  // Keep the source's own leading and trailing whitespace around the content.
  const original = html.slice(start, end);
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  return { ok: true, html: html.slice(0, start) + lead + after.trim() + trail + html.slice(end) };
}
