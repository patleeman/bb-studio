import type {
  Blockquote,
  List,
  ListItem,
  Nodes,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { EMBED_KINDS, MAX_HTML_CHARS, MENTION_KINDS, type MentionKind } from "./schema-config";

// Agents read and write pages as markdown. This module converts between
// markdown and BlockNote blocks without a DOM (BlockNote's own converters need
// one), and adds the page-specific syntax:
//
//   ```chart / ```stats / ```embed   fenced JSON for data blocks
//   ```mermaid                        Mermaid diagrams
//   ```html                           raw HTML, rendered in a sandboxed iframe
//   > [!NOTE] text                    callouts (NOTE, TIP, WARNING, CAUTION)
//   <details><summary>…</summary>     expandable toggles; `## …` in the summary
//   … </details>                      makes a toggle heading
//   @[Label](bot:bot_…)               mentions (bot, page, thread, date, agent, item)
//   <!-- ^1a2b3c4d -->                block ids in read output; ignored on input

export interface StyledText {
  type: "text";
  text: string;
  styles: Record<string, true>;
}
export interface LinkContent {
  type: "link";
  href: string;
  content: StyledText[];
}
export interface MentionContent {
  type: "mention";
  props: { kind: MentionKind; target: string; label: string };
}
export type InlineContent = StyledText | LinkContent | MentionContent;

export interface TableContent {
  type: "tableContent";
  headerRows?: number;
  rows: { cells: (InlineContent[] | { type: "tableCell"; content: InlineContent[] })[] }[];
}

/** The subset of BlockNote's PartialBlock this plugin produces and reads. */
export interface PageBlock {
  id?: string;
  type: string;
  props?: Record<string, string | number | boolean>;
  content?: InlineContent[] | TableContent | string;
  children?: PageBlock[];
}

const ID_COMMENT = /^\s*<!--\s*\^[\w-]+\s*-->\s*$/;
const MENTION_HREF = new RegExp(`^(${MENTION_KINDS.join("|")}):(.+)$`);
const ALERT_TONES: Record<string, string> = {
  NOTE: "info",
  IMPORTANT: "info",
  TIP: "success",
  WARNING: "warning",
  CAUTION: "danger",
};
const TONE_ALERTS: Record<string, string> = {
  info: "NOTE",
  success: "TIP",
  warning: "WARNING",
  danger: "CAUTION",
};
const DATA_FENCES: Record<string, string> = { chart: "chart", stats: "stats", embed: "embed" };

// ---------------------------------------------------------------------------
// markdown -> blocks

export function markdownToBlocks(markdown: string): PageBlock[] {
  const source = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !ID_COMMENT.test(line))
    .join("\n");
  return convertBlocks(parseMarkdown(source));
}

const DETAILS_TAG = /<details\b[^>]*>|<\/details\s*>|<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi;

type DetailsToken = { kind: "open" } | { kind: "close" } | { kind: "summary"; text: string } | { kind: "node"; node: RootContent };

/**
 * Converts sibling nodes, folding `<details>` … `</details>` runs into toggles.
 * Markdown splits an HTML block at blank lines, so the tags and the content
 * between them arrive as separate siblings.
 */
function convertBlocks(nodes: RootContent[]): PageBlock[] {
  const root: PageBlock[] = [];
  const open: { summary: string | null; children: PageBlock[] }[] = [];
  const target = () => open[open.length - 1]?.children ?? root;
  const close = () => {
    const frame = open.pop();
    if (frame) target().push(toggleBlock(frame.summary ?? "", frame.children));
  };
  for (const token of nodes.flatMap(detailsTokens)) {
    if (token.kind === "open") open.push({ summary: null, children: [] });
    else if (token.kind === "close") close();
    else if (token.kind === "summary") {
      const frame = open[open.length - 1];
      if (frame && frame.summary === null && !frame.children.length) frame.summary = token.text;
      else target().push({ type: "paragraph", content: [plain(token.text)] });
    } else target().push(...convertBlock(token.node));
  }
  while (open.length) close();
  return root;
}

function detailsTokens(node: RootContent): DetailsToken[] {
  if (node.type !== "html" || !/<\/?details\b/i.test(node.value)) return [{ kind: "node", node }];
  const tokens: DetailsToken[] = [];
  const text = (value: string) => {
    if (value.trim()) tokens.push(...(parseMarkdown(value) as RootContent[]).flatMap(detailsTokens));
  };
  let last = 0;
  for (const match of node.value.matchAll(DETAILS_TAG)) {
    text(node.value.slice(last, match.index));
    last = match.index + match[0].length;
    const tag = match[0].toLowerCase();
    tokens.push(tag.startsWith("<summary") ? { kind: "summary", text: match[1]!.trim() } : tag.startsWith("</") ? { kind: "close" } : { kind: "open" });
  }
  text(node.value.slice(last));
  return tokens;
}

/** A toggle list item, or a toggle heading when the summary is a `#` heading. */
function toggleBlock(summary: string, children: PageBlock[]): PageBlock {
  const first = parseMarkdown(summary)[0];
  const block: PageBlock =
    first?.type === "heading"
      ? { type: "heading", props: { level: Math.min(Math.max(first.depth, 1), 6), isToggleable: true }, content: inline(first.children) }
      : { type: "toggleListItem", content: first?.type === "paragraph" ? inline(first.children) : [] };
  if (children.length) block.children = children;
  return block;
}

function parseMarkdown(source: string): RootContent[] {
  return (fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Root).children;
}

function convertBlock(node: RootContent): PageBlock[] {
  switch (node.type) {
    case "heading":
      return [
        {
          type: "heading",
          props: { level: Math.min(Math.max(node.depth, 1), 6) },
          content: inline(node.children),
        },
      ];
    case "paragraph": {
      const only = node.children.length === 1 ? node.children[0] : null;
      if (only?.type === "image") {
        return [{ type: "image", props: { url: only.url, caption: only.alt ?? "", name: only.alt ?? "" } }];
      }
      return [{ type: "paragraph", content: inline(node.children) }];
    }
    case "list":
      return convertList(node);
    case "blockquote":
      return [convertQuote(node)];
    case "code": {
      const lang = (node.lang ?? "").toLowerCase();
      const fence = DATA_FENCES[lang];
      if (fence === "chart") return [{ type: "chart", props: { spec: node.value.trim() } }];
      if (fence === "stats") return [{ type: "stats", props: { items: node.value.trim() } }];
      if (fence === "embed") return [embedBlock(node.value)];
      if (lang === "mermaid") return [{ type: "mermaid", content: node.value }];
      // Oversized HTML stays a code block: kept, but never rendered. So does
      // ```html source, which is how an HTML code block is written back.
      if (lang === "html" && node.meta?.trim() !== HTML_SOURCE_META && node.value.length <= MAX_HTML_CHARS) return [{ type: "html", content: node.value }];
      return [{ type: "codeBlock", props: { language: node.lang ?? "text" }, content: node.value }];
    }
    case "thematicBreak":
      return [{ type: "divider" }];
    case "table":
      return [convertTable(node)];
    case "html": {
      const text = node.value.trim();
      if (!text || /^<!--[\s\S]*-->$/.test(text)) return [];
      return [{ type: "paragraph", content: [plain(text)] }];
    }
    default:
      return [];
  }
}

function convertList(list: List): PageBlock[] {
  return list.children.map((item: ListItem) => {
    const [first, ...rest] = item.children;
    const type = list.ordered
      ? "numberedListItem"
      : typeof item.checked === "boolean"
        ? "checkListItem"
        : "bulletListItem";
    const block: PageBlock = {
      type,
      content: first?.type === "paragraph" ? inline(first.children) : [],
    };
    if (type === "checkListItem") block.props = { checked: item.checked === true };
    const childNodes = first?.type === "paragraph" ? rest : item.children;
    const children = convertBlocks(childNodes as RootContent[]);
    if (children.length) block.children = children;
    return block;
  });
}

function convertQuote(node: Blockquote): PageBlock {
  const paragraphs = node.children.filter((child) => child.type === "paragraph");
  const content: InlineContent[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) content.push(plain("\n"));
    content.push(...inline(paragraph.children));
  });
  const first = content[0];
  if (first?.type === "text") {
    const match = /^\[!(\w+)\]\s*/.exec(first.text);
    const tone = match ? ALERT_TONES[match[1]!.toUpperCase()] : undefined;
    if (match && tone) {
      const rest = first.text.slice(match[0].length);
      const body = rest ? [{ ...first, text: rest }, ...content.slice(1)] : content.slice(1);
      return { type: "callout", props: { tone }, content: trimLeadingBreak(body) };
    }
  }
  return { type: "quote", content };
}

function trimLeadingBreak(content: InlineContent[]): InlineContent[] {
  const first = content[0];
  if (first?.type === "text" && first.text.startsWith("\n")) {
    const text = first.text.slice(1);
    return text ? [{ ...first, text }, ...content.slice(1)] : content.slice(1);
  }
  return content;
}

function convertTable(table: Table): PageBlock {
  return {
    type: "table",
    content: {
      type: "tableContent",
      // A Markdown table's first row is always its header.
      headerRows: 1,
      rows: table.children.map((row) => ({
        cells: row.children.map((cell) => inline(cell.children)),
      })),
    },
  };
}

function embedBlock(value: string): PageBlock {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // An unparseable embed becomes a bookmark to whatever was written.
    raw = { kind: "bookmark", target: value.trim() };
  }
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  return {
    type: "embed",
    props: {
      kind: (EMBED_KINDS as readonly string[]).includes(str("kind")) ? str("kind") : "bookmark",
      target: str("target") || str("url") || str("id"),
      title: str("title"),
      description: str("description"),
      image: str("image"),
    },
  };
}

function plain(text: string): StyledText {
  return { type: "text", text, styles: {} };
}

function inline(nodes: PhrasingContent[], styles: Record<string, true> = {}): InlineContent[] {
  const out: InlineContent[] = [];
  const push = (item: InlineContent) => {
    const last = out[out.length - 1];
    if (item.type === "text" && last?.type === "text" && sameStyles(last.styles, item.styles)) {
      last.text += item.text;
    } else {
      out.push(item);
    }
  };
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        push({ type: "text", text: node.value, styles: { ...styles } });
        break;
      case "strong":
        inline(node.children, { ...styles, bold: true }).forEach(push);
        break;
      case "emphasis":
        inline(node.children, { ...styles, italic: true }).forEach(push);
        break;
      case "delete":
        inline(node.children, { ...styles, strike: true }).forEach(push);
        break;
      case "inlineCode":
        push({ type: "text", text: node.value, styles: { ...styles, code: true } });
        break;
      case "break":
        push({ type: "text", text: "\n", styles: { ...styles } });
        break;
      case "link": {
        const mention = parseMention(node.url, textOf(node.children));
        if (mention) {
          // `@[Label](bot:…)` parses as "@" text followed by a link.
          const last = out[out.length - 1];
          if (last?.type === "text" && last.text.endsWith("@")) {
            last.text = last.text.slice(0, -1);
            if (!last.text) out.pop();
          }
          out.push(mention);
        } else {
          const content = inline(node.children, styles).filter(
            (item): item is StyledText => item.type === "text",
          );
          out.push({ type: "link", href: node.url, content });
        }
        break;
      }
      case "image":
        push({ type: "text", text: node.alt ?? "", styles: { ...styles } });
        break;
      case "html":
        push({ type: "text", text: node.value, styles: { ...styles } });
        break;
      default:
        if ("children" in node) inline(node.children as PhrasingContent[], styles).forEach(push);
        else if ("value" in node) push({ type: "text", text: String(node.value), styles: { ...styles } });
    }
  }
  return out;
}

function parseMention(href: string, label: string): MentionContent | null {
  const match = MENTION_HREF.exec(href);
  if (!match) return null;
  return {
    type: "mention",
    props: { kind: match[1] as MentionKind, target: match[2]!, label: label || match[2]! },
  };
}

function textOf(nodes: Nodes[]): string {
  return nodes
    .map((node) =>
      "value" in node ? String(node.value) : "children" in node ? textOf(node.children as Nodes[]) : "",
    )
    .join("");
}

function sameStyles(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key) => a[key] === b[key]);
}

// ---------------------------------------------------------------------------
// blocks -> markdown

export interface MarkdownOptions {
  /** Prefix each block with an `<!-- ^id -->` comment carrying its short id. */
  ids?: boolean;
}

export const SHORT_ID_LENGTH = 8;
export const shortId = (id: string) => id.replace(/-/g, "").slice(0, SHORT_ID_LENGTH);

export function blocksToMarkdown(blocks: PageBlock[], options: MarkdownOptions = {}): string {
  return renderBlocks(blocks, "", options).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const LIST_TYPES = ["bulletListItem", "numberedListItem", "checkListItem"];

function renderBlocks(blocks: PageBlock[], indent: string, options: MarkdownOptions): string[] {
  const out: string[] = [];
  let number = 0;
  let listRun: string[] | null = null;
  const flushList = () => {
    if (listRun) out.push(listRun.join("\n"));
    listRun = null;
  };
  for (const block of blocks) {
    const isList = LIST_TYPES.includes(block.type);
    number = block.type === "numberedListItem" ? number + 1 : 0;
    const text = renderBlock(block, indent, number, options);
    if (isList) {
      listRun ??= [];
      listRun.push(text);
    } else {
      flushList();
      out.push(text);
    }
  }
  flushList();
  return out;
}

function renderBlock(block: PageBlock, indent: string, number: number, options: MarkdownOptions): string {
  const idLine = options.ids && block.id ? `${indent}<!-- ^${shortId(block.id)} -->\n` : "";
  const props = block.props ?? {};
  const content = Array.isArray(block.content) ? block.content : [];
  // A heading's text follows its `#`s, so it can't start a block.
  const text = block.type === "heading" ? renderInline(content) : escapeLineStarts(renderInline(content));
  // A list item's children line up with its text, past the `1. ` marker.
  const childIndent = indent + " ".repeat(block.type === "numberedListItem" ? String(number).length + 2 : 2);
  const children = block.children?.length ? renderBlocks(block.children, childIndent, options) : [];
  // Only nested lists can sit tight under an item: a paragraph or a rule
  // right below the item's text would join it or turn it into a heading.
  const tight = block.children?.every((child) => LIST_TYPES.includes(child.type));
  const listChildren = children.length ? (tight ? "\n" + children.join("\n") : "\n\n" + children.join("\n\n")) : "";
  const nestedChildren = children.length ? "\n\n" + children.join("\n\n") : "";
  const quoted = (value: string) =>
    value
      .split("\n")
      .map((line) => `${indent}> ${line}`.trimEnd())
      .join("\n");
  let body: string;
  // Toggles' children stay at the same indent: they sit between the tags.
  const toggle = (summary: string) =>
    [`${indent}<details>\n${indent}<summary>${summary}</summary>`, ...renderBlocks(block.children ?? [], indent, options), `${indent}</details>`].join("\n\n");
  switch (block.type) {
    case "heading":
      if (props.isToggleable) {
        body = toggle(`${"#".repeat(Number(props.level ?? 1))} ${text}`);
        break;
      }
      body = `${indent}${"#".repeat(Number(props.level ?? 1))} ${text}${nestedChildren}`;
      break;
    case "toggleListItem":
      body = toggle(text);
      break;
    case "bulletListItem":
      body = `${indent}- ${text}${listChildren}`;
      break;
    case "numberedListItem":
      body = `${indent}${number}. ${text}${listChildren}`;
      break;
    case "checkListItem":
      body = `${indent}- [${props.checked ? "x" : " "}] ${text}${listChildren}`;
      break;
    case "quote":
      body = quoted(text) + nestedChildren;
      break;
    case "callout":
      body = quoted(`[!${TONE_ALERTS[String(props.tone)] ?? "NOTE"}] ${text}`) + nestedChildren;
      break;
    case "codeBlock": {
      const code = typeof block.content === "string" ? block.content : plainText(content);
      const language = props.language && props.language !== "text" ? String(props.language) : "";
      // A bare ```html fence reads back as a rendered HTML block; keep code as code.
      body = fence(language.toLowerCase() === "html" ? `${language} ${HTML_SOURCE_META}` : language, code, indent);
      break;
    }
    case "mermaid":
      body = fence("mermaid", typeof block.content === "string" ? block.content : plainText(content), indent);
      break;
    case "html":
      body = fence("html", typeof block.content === "string" ? block.content : plainText(content), indent);
      break;
    case "chart":
      body = fence("chart", prettyJson(String(props.spec ?? "")), indent);
      break;
    case "stats":
      body = fence("stats", prettyJson(String(props.items ?? "[]")), indent);
      break;
    case "embed":
      body = fence(
        "embed",
        JSON.stringify(
          Object.fromEntries(
            ["kind", "target", "title", "description", "image"]
              .map((key) => [key, props[key]])
              .filter(([, value]) => value !== undefined && value !== ""),
          ),
        ),
        indent,
      );
      break;
    case "divider":
      body = `${indent}---`;
      break;
    case "image":
      body = `${indent}![${escapeText(String(props.caption || props.name || ""))}](${props.url ?? ""})`;
      break;
    case "video":
    case "audio":
    case "file":
      body = `${indent}[${escapeText(String(props.name || props.caption || block.type))}](${props.url ?? ""})`;
      break;
    case "table":
      body = renderTable(block.content, indent);
      break;
    default:
      body = `${indent}${text}${nestedChildren}`;
  }
  return idLine + body;
}

/** The info-string word that keeps an ```html fence a code block instead of rendered HTML. */
const HTML_SOURCE_META = "source";

function fence(language: string, code: string, indent: string): string {
  // Longer than any backtick run inside, so HTML and scripts can't close it early.
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return [`${indent}${ticks}${language}`, ...code.split("\n").map((line) => indent + line), `${indent}${ticks}`].join("\n");
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}

function renderTable(content: PageBlock["content"], indent: string): string {
  if (!content || typeof content === "string" || Array.isArray(content)) return "";
  const rows = content.rows.map((row) =>
    row.cells.map((cell) => {
      const items = Array.isArray(cell) ? cell : cell.content;
      return renderInline(items).replace(/\|/g, "\\|").replace(/\n/g, " ");
    }),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) =>
    `${indent}| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]!), `${indent}|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
}

/**
 * Escapes what would start a list, heading, quote, rule or fence at the start
 * of a line of text, so a paragraph that reads "1. Draft" stays a paragraph.
 */
function escapeLineStarts(text: string): string {
  return text
    .split("\\\n")
    .map((line) =>
      line
        .replace(/^([ \t]*)([-+](?=[ \t]|$)|[-=](?=[-= \t]*$)|#(?=#{0,5}(?:[ \t]|$))|>|~(?=~~))/, "$1\\$2")
        .replace(/^([ \t]*\d{1,9})([.)])(?=[ \t]|$)/, "$1\\$2"),
    )
    .join("\\\n");
}

export function renderInline(content: InlineContent[]): string {
  return content
    .map((item) => {
      if (item.type === "mention") {
        return `@[${escapeText(item.props.label)}](${item.props.kind}:${item.props.target})`;
      }
      if (item.type === "link") {
        return `[${item.content.map(renderStyled).join("")}](${item.href})`;
      }
      return renderStyled(item);
    })
    .join("");
}

function renderStyled(item: StyledText): string {
  if (!item.text) return "";
  if (item.text === "\n") return "\\\n";
  const styles = item.styles ?? {};
  if (styles.code) return "`" + item.text.replace(/`/g, "\u02cb") + "`";
  // Markdown emphasis can't wrap leading/trailing spaces; keep them outside.
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(item.text)!;
  if (!core) return item.text;
  let text = escapeText(core!).replace(/\n/g, "\\\n");
  if (styles.strike) text = `~~${text}~~`;
  if (styles.italic) text = `*${text}*`;
  if (styles.bold) text = `**${text}**`;
  return lead + text + trail;
}

function escapeText(text: string): string {
  return text.replace(/([\\`*[\]<])/g, "\\$1").replace(/(^|\W)_|_(?=\W|$)/g, (m) => m.replace("_", "\\_"));
}

export function plainText(content: InlineContent[] | undefined): string {
  if (!content) return "";
  return content
    .map((item) =>
      item.type === "mention"
        ? `@${item.props.label}`
        : item.type === "link"
          ? item.content.map((part) => part.text).join("")
          : item.text,
    )
    .join("");
}
