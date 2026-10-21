// Copy a reference to a Studio item, then paste it into another Studio item,
// where it shows as a pill. The clipboard carries a Markdown link to the
// item's view, which reads as a link in a thread or any other app, an HTML
// link, and the item itself for Studio fields that read it back.
import { untitled } from "../format";
import { pluginViewPath, type StudioItemLink } from "./studio-item";

/** The clipboard type a copied reference carries, besides plain text and HTML. */
export const ITEM_REFERENCE_TYPE = "application/x-bb-studio-item";

const MARKDOWN_LINK = /^@?\[([^\]\n]*)\]\(([^)\s]+)\)$/;

/** The plain-text form of a reference: a Markdown link to the item's view. */
export function itemReferenceText(item: StudioItemLink): string {
  return `[${untitled(item.title ?? "").replace(/[[\]]/g, "")}](${item.href})`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

/** A same-origin link's in-app path, else the link itself. */
function localPath(href: string, origin: string): string {
  if (!origin || !href.startsWith(`${origin}/`)) return href;
  return href.slice(origin.length);
}

/** The item a reference names, from its plain text: a Markdown link or a bare link to an item's view. */
export function parseItemReference(text: string, origin = typeof window === "undefined" ? "" : window.location.origin): StudioItemLink | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2_000) return null;
  const link = MARKDOWN_LINK.exec(trimmed);
  const href = pluginViewPath(localPath(link ? link[2]! : trimmed, origin));
  if (!href) return null;
  const title = link?.[1]?.trim();
  return { href, ...(title ? { title } : {}) };
}

/** The reference on a clipboard or drop, if it carries one. Bare links count only with `bare`. */
export function itemReferenceFrom(data: DataTransfer | null | undefined, options: { bare?: boolean } = {}): StudioItemLink | null {
  if (!data) return null;
  try {
    const raw = data.getData(ITEM_REFERENCE_TYPE);
    if (raw) {
      const item = JSON.parse(raw) as Partial<StudioItemLink>;
      if (typeof item.href === "string" && pluginViewPath(item.href)) {
        return {
          href: item.href,
          ...(typeof item.title === "string" && item.title ? { title: item.title } : {}),
          ...(typeof item.icon === "string" && item.icon ? { icon: item.icon } : {}),
        };
      }
    }
  } catch {
    // Not one of ours; read the text instead.
  }
  const text = data.getData("text/plain");
  if (!options.bare && !MARKDOWN_LINK.test(text.trim())) return null;
  return parseItemReference(text);
}

/** Copies a reference to `item`. False when the clipboard refused. */
export async function copyItemReference(item: StudioItemLink): Promise<boolean> {
  const text = itemReferenceText(item);
  const url = `${window.location.origin}${item.href}`;
  const html = `<a href="${escapeHtml(url)}">${escapeHtml(untitled(item.title ?? ""))}</a>`;
  // A copy event can carry Studio's own type; the async clipboard API can't.
  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData(ITEM_REFERENCE_TYPE, JSON.stringify(item));
    event.preventDefault();
    copied = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } catch {
    // Fall back to plain text below.
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
  if (copied) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
