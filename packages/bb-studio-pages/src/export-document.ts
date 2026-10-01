import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { markdownToBlocks, type InlineContent, type PageBlock } from "./markdown";

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function safeUrl(value: string): string {
  return /^(https?:\/\/|assets\/|#|\/)/i.test(value) ? escape(value) : "#";
}

function inline(content: InlineContent[]): string {
  return content.map((part) => {
    if (part.type === "mention") return escape(part.props.label);
    if (part.type === "link") return `<a href="${safeUrl(part.href)}">${inline(part.content)}</a>`;
    let value = escape(part.text).replace(/\n/g, "<br>");
    if (part.styles.bold) value = `<strong>${value}</strong>`;
    if (part.styles.italic) value = `<em>${value}</em>`;
    if (part.styles.code) value = `<code>${value}</code>`;
    if (part.styles.strike) value = `<del>${value}</del>`;
    return value;
  }).join("");
}

function renderBlock(block: PageBlock): string {
  const content = Array.isArray(block.content) ? inline(block.content) : escape(typeof block.content === "string" ? block.content : "");
  const children = block.children?.map(renderBlock).join("") ?? "";
  switch (block.type) {
    case "heading": { const level = Math.max(1, Math.min(6, Number(block.props?.level) || 1)); return `<h${level}>${content}</h${level}>`; }
    case "paragraph": return `<p>${content}</p>`;
    case "bulletListItem": return `<ul><li>${content}${children}</li></ul>`;
    case "numberedListItem": return `<ol><li>${content}${children}</li></ol>`;
    case "checkListItem": return `<p>${block.props?.checked ? "☑" : "☐"} ${content}</p>${children}`;
    case "image": return `<figure><img src="${safeUrl(String(block.props?.url ?? ""))}" alt="${escape(String(block.props?.name ?? ""))}"><figcaption>${escape(String(block.props?.caption ?? ""))}</figcaption></figure>`;
    case "codeBlock": return `<pre><code>${content}</code></pre>`;
    case "divider": return "<hr>";
    case "quote": return `<blockquote>${content}${children}</blockquote>`;
    default: return `<pre>${content}</pre>${children}`;
  }
}

/** A self-contained document with print margins and safe markup. */
export function pageHtml(title: string, markdown: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
  :root{color-scheme:light}body{font:16px/1.55 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1.25rem;color:#202124}
  h1,h2,h3{line-height:1.25}h1{font-size:2rem}h2{font-size:1.5rem}a{color:#075a73}img{max-width:100%}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f6;padding:1rem;border-radius:.35rem}code{font-family:ui-monospace,monospace}
  blockquote{border-left:3px solid #9aa;padding-left:1rem;margin-left:0}figure{margin:1rem 0}figcaption{color:#666;font-size:.9rem}
  @page{size:auto;margin:18mm}@media print{body{max-width:none;margin:0;padding:0}pre,figure{break-inside:avoid}a{color:inherit}}
  </style></head><body><h1>${escape(title)}</h1>${markdownToBlocks(markdown).map(renderBlock).join("\n")}</body></html>`;
}

/** Render readable, multipage PDF text with no browser dependency. */
export async function pagePdf(title: string, markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 792;
  const draw = (source: string, heading = false) => {
    const font = heading ? bold : regular;
    const size = heading ? 16 : 11;
    const safe = source.replace(/[^\x20-\x7e]/g, "?");
    const words = safe.split(/\s+/);
    let line = "";
    const flush = () => {
      if (y < 54) { page = pdf.addPage([595, 842]); y = 792; }
      page.drawText(line, { x: 48, y, size, font, color: rgb(0.12, 0.13, 0.15) });
      y -= heading ? 23 : 16;
      line = "";
    };
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > 499 && line) flush();
      line = line ? `${line} ${word}` : word;
    }
    if (line) flush();
    y -= 7;
  };
  draw(title, true);
  for (const line of markdown.split("\n")) {
    const clean = line.replace(/^#{1,6}\s*/, "").replace(/[*_`]/g, "").trim();
    if (clean) draw(clean, line.startsWith("#"));
    else y -= 7;
  }
  return pdf.save();
}
