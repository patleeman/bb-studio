// A page's Markdown made readable by chat's renderer, for the inline preview
// under a `::page` card. Chat knows none of Pages' extensions, so mentions
// become links or plain labels and JSON blocks become a short line of text.
import { panelHref } from "@bb-studio/kit/app";

const MENTION = /@\[((?:\\.|[^\]\\])*)\]\((bot|page|thread|date|agent|item):([^)\s]+)\)/g;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;
const DATA_BLOCKS = new Set(["embed", "chart", "stats"]);

function mentions(line: string): string {
  return line.replace(MENTION, (_, label: string, kind: string, target: string) => {
    if (kind === "page") return `[${label}](${panelHref("pages", "pages", target)})`;
    return kind === "bot" || kind === "agent" ? `@${label}` : label;
  });
}

function parse(json: string): unknown {
  try { return JSON.parse(json); }
  catch { return null; }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** One line standing in for an ```embed, ```chart or ```stats block. */
function dataBlock(kind: string, json: string): string {
  const value = parse(json);
  if (kind === "stats" && Array.isArray(value)) {
    const items = value.map((item) => {
      const stat = (item ?? {}) as Record<string, unknown>;
      const delta = text(stat.delta);
      return `- **${text(stat.label)}**: ${text(stat.value)}${delta ? ` (${delta})` : ""}`;
    });
    if (items.length) return items.join("\n");
  }
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const title = text(record.title);
  const name = kind === "chart" ? "Chart" : `Embedded ${text(record.kind) || "item"}`;
  return `*${title ? `${name}: ${title}` : name}*`;
}

export function chatMarkdown(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const open = FENCE.exec(lines[index]);
    if (!open) {
      out.push(mentions(lines[index]));
      continue;
    }
    // A fence runs to a closing fence of the same character, at least as long.
    const marker = open[1];
    const body: string[] = [];
    let end = index + 1;
    while (end < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[end])) body.push(lines[end++]);
    if (DATA_BLOCKS.has(open[2])) out.push(dataBlock(open[2], body.join("\n")));
    else out.push(...lines.slice(index, end + 1));
    index = end;
  }
  return out.join("\n");
}
