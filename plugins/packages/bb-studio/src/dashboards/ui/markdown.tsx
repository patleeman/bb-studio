// A note widget's Markdown, rendered as React elements: no raw HTML, and
// links only to http(s) addresses.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Nodes, Parents } from "mdast";
import { Fragment, useMemo, type ReactNode } from "react";

const safeHref = (url: string) => (/^https?:\/\//i.test(url) || url.startsWith("/plugins/") ? url : null);

function children(node: Parents, key: string): ReactNode[] {
  return node.children.map((child, index) => render(child as Nodes, `${key}.${index}`));
}

function render(node: Nodes, key: string): ReactNode {
  switch (node.type) {
    case "root": return <Fragment key={key}>{children(node, key)}</Fragment>;
    case "paragraph": return <p key={key} className="my-1.5">{children(node, key)}</p>;
    case "heading": {
      const size = node.depth <= 1 ? "text-lg" : node.depth === 2 ? "text-base" : "text-sm";
      const Tag = `h${Math.min(6, node.depth)}` as "h1";
      return <Tag key={key} className={`${size} mb-1 mt-2 font-semibold text-foreground first:mt-0`}>{children(node, key)}</Tag>;
    }
    case "text": return node.value;
    case "emphasis": return <em key={key}>{children(node, key)}</em>;
    case "strong": return <strong key={key} className="font-semibold text-foreground">{children(node, key)}</strong>;
    case "delete": return <del key={key}>{children(node, key)}</del>;
    case "inlineCode": return <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node.value}</code>;
    case "code": return <pre key={key} className="my-1.5 overflow-auto rounded-md bg-muted p-2 font-mono text-xs"><code>{node.value}</code></pre>;
    case "break": return <br key={key} />;
    case "thematicBreak": return <hr key={key} className="my-2 border-border" />;
    case "blockquote": return <blockquote key={key} className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground">{children(node, key)}</blockquote>;
    case "link": {
      const href = safeHref(node.url);
      return href
        ? <a key={key} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer noopener" className="text-foreground underline underline-offset-2">{children(node, key)}</a>
        : <span key={key}>{children(node, key)}</span>;
    }
    case "image": return <span key={key} className="text-muted-foreground">{node.alt ?? ""}</span>;
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return <Tag key={key} className={`my-1.5 pl-5 ${node.ordered ? "list-decimal" : "list-disc"}`}>{children(node, key)}</Tag>;
    }
    case "listItem": {
      const body = node.children.length === 1 && node.children[0]!.type === "paragraph" ? children(node.children[0] as Parents, key) : children(node, key);
      if (typeof node.checked === "boolean") {
        return <li key={key} className="list-none -ml-5 flex items-start gap-1.5"><input type="checkbox" checked={node.checked} readOnly disabled className="mt-1" aria-label={node.checked ? "Done" : "Not done"} /><span>{body}</span></li>;
      }
      return <li key={key}>{body}</li>;
    }
    case "table": {
      const [head, ...rows] = node.children;
      return (
        <table key={key} className="my-1.5 w-full border-collapse text-xs">
          {head ? <thead><tr>{head.children.map((cell, index) => <th key={index} className="border-b border-border px-1.5 py-1 text-left font-medium">{children(cell, `${key}.h${index}`)}</th>)}</tr></thead> : null}
          <tbody>{rows.map((row, r) => <tr key={r}>{row.children.map((cell, index) => <td key={index} className="border-b border-border/60 px-1.5 py-1">{children(cell, `${key}.${r}.${index}`)}</td>)}</tr>)}</tbody>
        </table>
      );
    }
    case "html": return node.value.replace(/<[^>]*>/g, "");
    default:
      return "children" in node ? <Fragment key={key}>{children(node as Parents, key)}</Fragment> : null;
  }
}

export function Markdown({ source }: { source: string }) {
  const tree = useMemo(() => {
    try {
      return fromMarkdown(source.slice(0, 50_000), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    } catch {
      return null;
    }
  }, [source]);
  if (!tree) return <p className="whitespace-pre-wrap">{source}</p>;
  return <div className="text-sm leading-relaxed text-foreground/90">{render(tree, "md")}</div>;
}
