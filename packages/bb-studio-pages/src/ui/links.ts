// Pasting a lone link on an empty line turns it into an embed: a page,
// thread, drawing, artifact, recording, task or live table for a BB link, a
// bookmark for anything else on the web.
import { parseTableSubPath, tableSubPath } from "@bb-studio/kit/tables";
import { STUDIO_EMBEDS, type EmbedKind, type StudioEmbedKind } from "../schema-config";

const PAGE_PATH = /^\/plugins\/pages\/pages\/(pg_[a-f0-9]{12}(?:[a-f0-9]{4})?)(?:\/|$)/;
const THREAD_PATH = /(?:^|\/)threads\/(thr_[a-z0-9]+)(?:\/|$)/;
const ITEM_PATH = /^\/plugins\/([a-z0-9-]+)\/([a-z0-9-]+)\/([A-Za-z0-9_-]+)\/?$/;
const TABLE_PATH = new RegExp(`^/plugins/${STUDIO_EMBEDS.table.pluginId}/${STUDIO_EMBEDS.table.panel}/(.+)$`);

/** The embed for a Studio add-on's item page, e.g. `/plugins/excalidraw/drawings/<id>`. */
export function studioLink(pathname: string): { kind: StudioEmbedKind; target: string } | null {
  const table = TABLE_PATH.exec(pathname);
  const linked = table ? parseTableSubPath(table[1]!) : null;
  // A table link keeps the view it points at; the embed opens rows itself.
  if (linked) return { kind: "table", target: tableSubPath({ tableId: linked.tableId, viewId: linked.viewId }) };
  const match = ITEM_PATH.exec(pathname);
  if (!match) return null;
  const [, pluginId, panel, id] = match;
  const kind = (Object.keys(STUDIO_EMBEDS) as StudioEmbedKind[]).find(
    (each) => STUDIO_EMBEDS[each].pluginId === pluginId && STUDIO_EMBEDS[each].panel === panel,
  );
  return kind ? { kind, target: decodeURIComponent(id!) } : null;
}

export function linkEmbed(text: string, origin: string): { kind: EmbedKind; target: string } | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === origin) {
    const page = PAGE_PATH.exec(url.pathname);
    if (page) return { kind: "page", target: page[1]! };
    const thread = THREAD_PATH.exec(url.pathname);
    if (thread) return { kind: "thread", target: thread[1]! };
    const item = studioLink(url.pathname);
    if (item) return item;
  }
  return { kind: "bookmark", target: url.toString() };
}
