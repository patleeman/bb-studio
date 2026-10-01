import type Database from "better-sqlite3";
import type { HubItem, StudioHub } from "./hub";

export interface SearchRange { start: number; end: number }
export interface SearchSnippet { text: string; ranges: SearchRange[] }
export interface SearchHit {
  ref: { pluginId: string; id: string };
  kind: string;
  title: string;
  snippet: SearchSnippet;
  href: string;
  projectId: string | null;
  updatedAt: number;
  score: number;
}

export function tokens(query: string): string[] {
  return [...query.normalize("NFKC").matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0]!.toLocaleLowerCase()).slice(0, 12);
}

export function excerpt(text: string, words: readonly string[]): SearchSnippet {
  const lower = text.toLocaleLowerCase();
  const first = words.reduce((best, word) => {
    const at = lower.indexOf(word);
    return at < 0 ? best : Math.min(best, at);
  }, Infinity);
  if (!Number.isFinite(first)) return { text: text.slice(0, 160), ranges: [] };
  const start = Math.max(0, first - 55);
  const end = Math.min(text.length, first + 105);
  const shown = `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  const offset = start ? 1 : 0;
  const ranges: SearchRange[] = [];
  const segment = lower.slice(start, end);
  for (const word of words) {
    let at = 0;
    while ((at = segment.indexOf(word, at)) >= 0) {
      ranges.push({ start: at + offset, end: at + offset + word.length });
      at += word.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  return { text: shown, ranges: ranges.filter((range, i) => i === 0 || range.start >= ranges[i - 1]!.end) };
}

type Row = { plugin_id: string; item_id: string; kind: string; project_id: string | null; href: string; updated_at: number; title: string; body: string; rank: number };

export class SearchIndex {
  private ready = false;
  private initializing: Promise<void> | null = null;
  private syncing: Promise<void> = Promise.resolve();

  constructor(private readonly db: Database.Database, private readonly hub: StudioHub) {}

  private put(item: HubItem, body: string): void {
    this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?").run(item.pluginId, item.id);
    if (!item.archived) this.db.prepare("INSERT INTO studio_search_fts (plugin_id,item_id,kind,project_id,href,updated_at,title,body) VALUES (?,?,?,?,?,?,?,?)")
      .run(item.pluginId, item.id, item.kind, item.projectId, item.href, item.updatedAt, item.title, body);
  }

  private async content(item: HubItem, v2: boolean): Promise<string> {
    if (!v2) return "";
    return (await this.hub.call(item.pluginId, "studio_read", { id: item.id, format: "text" }).catch(() => ({ content: null }))).content ?? "";
  }

  private async add(items: HubItem[], versions: Map<string, boolean>): Promise<void> {
    for (let at = 0; at < items.length; at += 8) {
      const batch = items.slice(at, at + 8);
      const bodies = await Promise.all(batch.map((item) => this.content(item, versions.get(item.pluginId) ?? false)));
      this.db.transaction(() => batch.forEach((item, i) => this.put(item, bodies[i]!)))();
    }
  }

  async rebuild(): Promise<number> {
    const result = await this.hub.overview();
    const versions = new Map(result.providers.map((provider) => [provider.pluginId, this.hub.version(provider.pluginId) === 2]));
    this.db.exec("DELETE FROM studio_search_fts");
    await this.add(result.items, versions);
    this.ready = true;
    return result.items.length;
  }

  async ensure(): Promise<void> {
    if (!this.ready) await (this.initializing ??= this.queue(() => this.rebuild().then(() => {})).finally(() => { this.initializing = null; }));
    else await this.syncing;
  }

  private queue(work: () => Promise<void>): Promise<void> {
    this.syncing = this.syncing.catch(() => {}).then(work);
    return this.syncing;
  }

  changed(pluginId: string, ids?: string[], removed?: string[]): Promise<void> {
    if (!this.ready) return Promise.resolve();
    return this.queue(async () => {
      if (!ids && !removed) { await this.rebuild(); return; }
      for (const id of removed ?? []) this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?").run(pluginId, id);
      if (ids?.length) {
        const found = await this.hub.get(pluginId, ids);
        const live = new Set(found.map((item) => item.id));
        for (const id of ids) if (!live.has(id)) this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?").run(pluginId, id);
        await this.add(found, new Map([[pluginId, this.hub.version(pluginId) === 2]]));
      }
    });
  }

  search(raw: string, options: { kinds?: string[]; projectId?: string | null; limit?: number } = {}): SearchHit[] {
    const words = tokens(raw);
    if (!words.length) return [];
    const match = words.map((word) => `"${word}"*`).join(" AND ");
    const clauses = ["studio_search_fts MATCH ?"];
    const args: unknown[] = [match];
    if (options.kinds?.length) { clauses.push(`kind IN (${options.kinds.map(() => "?").join(",")})`); args.push(...options.kinds); }
    if (options.projectId !== undefined) { clauses.push("project_id IS ?"); args.push(options.projectId); }
    args.push(Math.min(options.limit ?? 40, 100));
    const rows = this.db.prepare(`SELECT plugin_id,item_id,kind,project_id,href,updated_at,title,body,bm25(studio_search_fts,0,0,0,0,0,0,8,1) AS rank FROM studio_search_fts WHERE ${clauses.join(" AND ")} ORDER BY rank, updated_at DESC LIMIT ?`).all(...args) as Row[];
    return rows.map((row) => ({
      ref: { pluginId: row.plugin_id, id: row.item_id }, kind: row.kind, title: row.title,
      snippet: excerpt(row.body.toLocaleLowerCase().includes(words[0]!) ? row.body : row.title, words),
      href: row.href, projectId: row.project_id, updatedAt: row.updated_at,
      score: (row.title.toLocaleLowerCase().includes(raw.trim().toLocaleLowerCase()) ? 10 : 1) - row.rank,
    }));
  }

  /** The latest items; `skip` leaves out kinds, as `pluginId:kind`. */
  recent(limit = 12, options: { kinds?: string[]; projectId?: string | null; skip?: string[] } = {}): SearchHit[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (options.skip?.length) { clauses.push(`plugin_id || ':' || kind NOT IN (${options.skip.map(() => "?").join(",")})`); args.push(...options.skip); }
    if (options.kinds?.length) { clauses.push(`kind IN (${options.kinds.map(() => "?").join(",")})`); args.push(...options.kinds); }
    if (options.projectId !== undefined) { clauses.push("project_id IS ?"); args.push(options.projectId); }
    const rows = this.db.prepare(`SELECT plugin_id,item_id,kind,project_id,href,updated_at,title,body,0 AS rank FROM studio_search_fts ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`).all(...args, limit) as Row[];
    return rows.map((row) => ({ ref: { pluginId: row.plugin_id, id: row.item_id }, kind: row.kind, title: row.title, snippet: { text: "", ranges: [] }, href: row.href, projectId: row.project_id, updatedAt: row.updated_at, score: 0 }));
  }
}
