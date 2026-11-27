import type { Nodes, Paragraph, Root } from "mdast";
import remarkBreaks from "remark-breaks";
import type { PluggableList } from "unified";
import type { MarkdownThreadMentions } from "./markdown-preview";
import { visit } from "unist-util-visit";

const WRAPPED_MIN_LINE = 40;
const WRAPPED_AVERAGE_LINE = 60;

const keepsShortLines = new WeakSet<object>();

export function withShortLineBreaks<Options extends object>(
  options: Options,
): Options {
  keepsShortLines.add(options);
  return options;
}

export function keepsShortLineBreaks(options: object | undefined): boolean {
  return options !== undefined && keepsShortLines.has(options);
}

function nodeText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) {
    return (node.children as Nodes[]).map(nodeText).join("");
  }
  return "";
}

export function looksHardWrapped(text: string): boolean {
  const lines = text.split("\n").map((line) => line.trim().length);
  const body = lines.slice(0, -1);
  if (body.length === 0) return false;
  const average = body.reduce((sum, length) => sum + length, 0) / body.length;
  return (
    body.every((length) => length >= WRAPPED_MIN_LINE) &&
    average >= WRAPPED_AVERAGE_LINE
  );
}

export function remarkShortLineBreaks() {
  const breaks = remarkBreaks();
  return (tree: Root): undefined => {
    visit(tree, "paragraph", (paragraph: Paragraph) => {
      const text = nodeText(paragraph);
      if (!text.includes("\n") || looksHardWrapped(text)) return;
      breaks(paragraph as unknown as Root);
    });
    return undefined;
  };
}

const shortBreakLists = new WeakMap<PluggableList, PluggableList>();

export function withShortLineBreakPlugins(
  options: object | undefined,
  plugins: PluggableList,
): PluggableList {
  if (!keepsShortLineBreaks(options)) return plugins;
  const cached = shortBreakLists.get(plugins);
  if (cached !== undefined) return cached;
  const extended: PluggableList = [...plugins, remarkShortLineBreaks];
  shortBreakLists.set(plugins, extended);
  return extended;
}

export const ASSISTANT_MARKDOWN_THREAD_MENTIONS: MarkdownThreadMentions =
  withShortLineBreaks({ mentions: [], preserveSoftBreaks: false });
