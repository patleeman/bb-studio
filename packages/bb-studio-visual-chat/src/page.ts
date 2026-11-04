// A canvas page: one HTML document the agent writes for the whole board,
// with parts marked data-cv-id="…" so a new version can animate part by
// part. These helpers work on the source text (the server has no DOM): find
// a part by its id and replace or remove it, list the parts, and read a
// title from the page's first heading.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);

interface Tag { name: string; start: number; end: number; close: boolean; selfClosing: boolean; attrs: string }

/** The tags in a document, in order, skipping comments and the insides of script and style. */
function tags(html: string): Tag[] {
  const out: Tag[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("<!--")) continue;
    const name = match[2]!.toLowerCase();
    const close = match[1] === "/";
    const attrs = match[3] ?? "";
    out.push({ name, start: match.index, end: re.lastIndex, close, selfClosing: /\/\s*$/.test(attrs), attrs });
    if (!close && RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, re.lastIndex);
      if (end < 0) break;
      re.lastIndex = end;
    }
  }
  return out;
}

const idOf = (attrs: string) => /\bdata-cv-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs)?.slice(1).find((v) => v !== undefined) ?? null;

/** The source range [start, end) of the element with this data-cv-id, or null. */
export function findPart(html: string, id: string): { start: number; end: number } | null {
  const list = tags(html);
  for (let i = 0; i < list.length; i++) {
    const tag = list[i]!;
    if (tag.close || idOf(tag.attrs) !== id) continue;
    if (VOID.has(tag.name) || tag.selfClosing) return { start: tag.start, end: tag.end };
    let depth = 0;
    for (let j = i; j < list.length; j++) {
      const each = list[j]!;
      if (each.name !== tag.name || (!each.close && (VOID.has(each.name) || each.selfClosing))) continue;
      depth += each.close ? -1 : 1;
      if (depth === 0) return { start: tag.start, end: each.end };
    }
    return { start: tag.start, end: html.length }; // unclosed: to the end
  }
  return null;
}

const attrEsc = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Puts found pictures into the page: every card (data-block="card") whose data-cv-id is a key and that has no
 * data-img yet gets data-img (and data-alt when it has none). So the agent never copies picture addresses into
 * the page, and pictures land on a draft as soon as they're found. Returns the page and the ids it filled.
 */
export function fillPictures(html: string, pictures: ReadonlyMap<string, { url: string; alt?: string }>): { html: string; filled: string[] } {
  if (!pictures.size) return { html, filled: [] };
  const edits: { at: number; text: string; id: string }[] = [];
  for (const tag of tags(html)) {
    if (tag.close || !/\bdata-block\s*=\s*(?:"card"|'card'|card\b)/i.test(tag.attrs) || /\bdata-img\s*=/i.test(tag.attrs)) continue;
    const id = idOf(tag.attrs);
    const picture = id ? pictures.get(id) : undefined;
    if (!id || !picture || !/^https:\/\//i.test(picture.url)) continue;
    const alt = !/\bdata-alt\s*=/i.test(tag.attrs) && picture.alt ? ` data-alt="${attrEsc(picture.alt)}"` : "";
    const at = tag.end - (tag.selfClosing ? 2 : 1);
    edits.push({ at, text: ` data-img="${attrEsc(picture.url)}"${alt}`, id });
  }
  let out = html;
  for (const edit of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  return { html: out, filled: edits.map((edit) => edit.id).reverse() };
}

/** The page with the part replaced by html ("" removes it), or null when there's no such part. */
export function replacePart(html: string, id: string, replacement: string): string | null {
  const range = findPart(html, id);
  return range ? html.slice(0, range.start) + replacement + html.slice(range.end) : null;
}

/** The ids of the page's parts, in order, each with its tag and the start of its text. */
export function outline(html: string): { id: string; tag: string; text: string }[] {
  const out: { id: string; tag: string; text: string }[] = [];
  for (const tag of tags(html)) {
    if (tag.close) continue;
    const id = idOf(tag.attrs);
    if (!id) continue;
    const range = findPart(html, id);
    const text = range ? textOf(html.slice(range.start, range.end)).slice(0, 80) : "";
    out.push({ id, tag: tag.name, text });
  }
  return out;
}

/** Visible text, roughly: tags, scripts and styles removed, entities for the common few decoded. */
export function textOf(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

/** The page's first h1 (else h2) as text: its title when the agent gives none. */
export function pageTitle(html: string): string | null {
  for (const level of ["h1", "h2"]) {
    const match = new RegExp(`<${level}\\b[^>]*>([\\s\\S]*?)</${level}\\s*>`, "i").exec(html);
    const text = match ? textOf(match[1]!) : "";
    if (text) return text;
  }
  return null;
}
