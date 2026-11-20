// A page's Markdown made readable by chat's renderer, for the inline preview
// under a `::page` card. Chat knows none of Pages' extensions, so mentions
// become links or plain labels, callouts a bold label, and JSON blocks a short
// line of text.
import { isLocalImageSrc, pageImageUrl, studioFileUrl } from "../../kit/pages-contract";
import { pagePath } from "../constants";

const MENTION = /@\[((?:\\.|[^\]\\])*)\]\((bot|page|thread|date|agent|item):([^)\s]+)\)/g;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;
const DATA_BLOCKS = new Set(["embed", "chart", "stats"]);

const CALLOUT = /^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

function callout(line: string): string {
  const match = CALLOUT.exec(line);
  if (!match) return line;
  const rest = line.slice(match[0].length);
  return `${match[1]}**${match[2]![0]!.toUpperCase()}${match[2]!.slice(1).toLowerCase()}**${rest ? ` ${rest}` : ""}`;
}

function mentions(line: string): string {
  return line.replace(MENTION, (_, label: string, kind: string, target: string) => {
    if (kind === "page") return `[${label}](${pagePath(target)})`;
    return kind === "bot" || kind === "agent" ? `@${label}` : label;
  });
}

const IMAGE = /(!\[(?:\\.|[^\]\\])*\]\(\s*)(?:<([^>\n]+)>|([^)\s]+))/g;

/**
 * Image srcs made absolute: chat's renderer reads a src starting with "/" as a
 * path on the thread's host, for any path. A page file's address
 * (`/api/v1/plugins/studio/http/pages/files?id=…`) becomes the app's, and with
 * `pageId`, a local path goes through Studio's route, which shows it only if
 * a thread of the page can read it, as the full editor and the phone do.
 */
function appImages(line: string, origin: string | undefined, pageId: string | undefined): string {
  if (!origin || !line.includes("![")) return line;
  return line.replace(IMAGE, (whole, head: string, angled: string | undefined, bare: string | undefined) => {
    const src = angled ?? bare ?? "";
    if (src.startsWith("/api/")) return `${head}${origin}${studioFileUrl(src)}`;
    if (pageId && isLocalImageSrc(src)) return `${head}${origin}${pageImageUrl(pageId, src)}`;
    return whole;
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

/** `origin` is the app's (`location.origin`), for image addresses; `pageId` the page's, for its local image paths. */
export function chatMarkdown(markdown: string, origin?: string, pageId?: string): string {
  const out: string[] = [];
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const open = FENCE.exec(lines[index]);
    if (!open) {
      out.push(callout(mentions(appImages(lines[index], origin, pageId))));
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
