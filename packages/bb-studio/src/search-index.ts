import type Database from "better-sqlite3";
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import type { HubItem, StudioHub } from "./hub";
import type { SearchStatus } from "./contract";

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
  private started = false;
  private initializing: Promise<void> | null = null;
  private syncing: Promise<void> = Promise.resolve();
  /** Providers whose last snapshot or content read was incomplete. */
  private readonly pending = new Set<string>();
  private discoveryIncomplete = false;
  private readonly unavailable = new Set<string>();
  private queued = 0;
  private revision = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recovering = false;
  private disposed = false;
  private inventoryCheck: Promise<void> | null = null;
  private inventoryCheckedAt = 0;

  constructor(private readonly db: Database.Database, private readonly hub: StudioHub, private readonly recovered: () => void = () => {}) {}

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    await this.inventoryCheck;
    await this.syncing.catch(() => {});
  }

  status(): SearchStatus {
    this.checkInventory();
    return {
      state: !this.ready ? "initializing" : this.recovering || this.queued > 0 ? "recovering" : this.pending.size || this.discoveryIncomplete ? "stale" : "current",
      pendingProviders: [...this.pending].sort(), unavailableProviders: [...this.unavailable].sort(),
      discoveryIncomplete: this.discoveryIncomplete, revision: this.revision,
    };
  }

  /** Coalesced while search is in use; never blocks an interactive query. */
  private checkInventory(): void {
    if (!this.ready || this.disposed || this.inventoryCheck || Date.now() - this.inventoryCheckedAt < 3_000) return;
    this.inventoryCheckedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Plugin inventory timed out")), 2_500); });
    this.inventoryCheck = Promise.race([this.hub.inventoryChanges(), timeout]).then(async changed => {
      if (this.disposed || !changed.size) return;
      for (const id of changed) this.pending.add(id);
      await this.queue(() => this.reconcile(changed).then(() => {}));
      if (!this.disposed) this.recovered();
    }).catch(() => {
      if (this.disposed) return;
      this.discoveryIncomplete = true;
      this.scheduleRecovery();
      this.recovered();
    }).finally(() => { clearTimeout(timer); this.inventoryCheck = null; });
  }

  retry(): SearchStatus {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.scheduleRecovery(0);
    return this.status();
  }

  private scheduleRecovery(delay = 5_000): void {
    if (this.disposed || this.recovering || this.recoveryTimer || (!this.discoveryIncomplete && !this.pending.size)) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      this.recovering = true;
      void this.queue(async () => {
        if (!this.disposed) await this.reconcile(this.discoveryIncomplete ? undefined : new Set(this.pending));
      }).catch(() => { this.discoveryIncomplete = true; }).finally(() => {
        this.recovering = false;
        if (!this.disposed) this.recovered();
        this.scheduleRecovery();
      });
    }, delay);
    this.recoveryTimer.unref?.();
  }

  private put(item: HubItem, body: string): void {
    this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?").run(item.pluginId, item.id);
    if (!item.archived) this.db.prepare("INSERT INTO studio_search_fts (plugin_id,item_id,kind,project_id,href,updated_at,title,body) VALUES (?,?,?,?,?,?,?,?)")
      .run(item.pluginId, item.id, item.kind, item.projectId, item.href, item.updatedAt, item.title, body);
  }

  private async content(item: HubItem): Promise<string | null> {
    if (item.archived || item.pluginId === STUDIO_PLUGIN_ID) return "";
    try {
      return (await this.hub.call(item.pluginId, "studio_read", { id: item.id, format: "text" })).content ?? "";
    } catch {
      this.pending.add(item.pluginId);
      return null;
    }
  }

  private async add(items: HubItem[]): Promise<void> {
    for (let at = 0; at < items.length; at += 8) {
      const batch = items.slice(at, at + 8);
      const bodies = await Promise.all(batch.map((item) => this.content(item)));
      this.db.transaction(() => batch.forEach((item, i) => {
        // Keep the last searchable body through a temporary read failure.
        const previous = bodies[i] === null
          ? this.db.prepare("SELECT body FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?").get(item.pluginId, item.id) as { body: string } | undefined
          : undefined;
        this.put(item, bodies[i] ?? previous?.body ?? "");
      }))();
    }
  }

  async rebuild(): Promise<number> {
    this.started = true;
    let count = 0;
    await this.queue(async () => { count = await this.reconcile(); });
    return count;
  }

  private async reconcile(only?: ReadonlySet<string>): Promise<number> {
    const result = await this.hub.overview(only);
    const discoveryComplete = result.discoveryComplete !== false;
    this.discoveryIncomplete = !discoveryComplete;
    const installed = new Set(result.providers.map((provider) => provider.pluginId));
    const stored = this.db.prepare("SELECT DISTINCT plugin_id FROM studio_search_fts").all() as { plugin_id: string }[];
    for (const { plugin_id: pluginId } of stored) {
      if (discoveryComplete && (!only || only.has(pluginId)) && !installed.has(pluginId)) this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ?").run(pluginId);
    }
    if (discoveryComplete) for (const pluginId of this.pending) if ((!only || only.has(pluginId)) && !installed.has(pluginId)) { this.pending.delete(pluginId); this.unavailable.delete(pluginId); }
    for (const provider of result.providers) {
      const pluginId = provider.pluginId;
      if (only && !only.has(pluginId)) continue;
      if (provider.state !== "ready") { this.pending.add(pluginId); this.unavailable.add(pluginId); continue; }
      this.pending.delete(pluginId);
      this.unavailable.delete(pluginId);
      const items = result.items.filter((item) => item.pluginId === pluginId);
      if (result.truncated.has(pluginId)) this.pending.add(pluginId);
      else {
        const live = new Set(items.map((item) => item.id));
        const rows = this.db.prepare("SELECT item_id FROM studio_search_fts WHERE plugin_id = ?").all(pluginId) as { item_id: string }[];
        const remove = this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?");
        this.db.transaction(() => { for (const row of rows) if (!live.has(row.item_id)) remove.run(pluginId, row.item_id); })();
      }
      await this.add(items);
    }
    this.ready = true;
    return result.items.length;
  }

  async ensure(): Promise<void> {
    if (!this.ready) {
      await (this.initializing ??= this.rebuild().then(() => {}).finally(() => { this.initializing = null; }));
      // Replay events received during initialization before serving its first search.
      await this.syncing;
    }
    // Once initialized, serve the saved snapshot while recovery runs in the background.
    this.scheduleRecovery();
    this.checkInventory();
  }

  private queue(work: () => Promise<void>): Promise<void> {
    this.queued += 1;
    this.syncing = this.syncing.catch(() => {}).then(() => this.disposed ? undefined : work()).finally(() => {
      this.queued -= 1;
      this.revision += 1;
      this.scheduleRecovery();
    });
    return this.syncing;
  }

  changed(pluginId: string, ids?: string[], removed?: string[]): Promise<void> {
    if (!this.started) return Promise.resolve();
    return this.queue(async () => {
      if (!ids && !removed) { await this.reconcile(new Set([pluginId])); return; }
      for (const id of removed ?? []) this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?").run(pluginId, id);
      if (ids?.length) {
        const result = await this.hub.itemsResult(pluginId, ids);
        if (result.status === "unavailable") { this.pending.add(pluginId); this.unavailable.add(pluginId); return; }
        this.unavailable.delete(pluginId);
        const found = result.status === "ready" ? result.items : [];
        const live = new Set(found.map((item) => item.id));
        if (result.status === "ready" && !result.complete) this.pending.add(pluginId);
        else for (const id of ids) if (!live.has(id)) this.db.prepare("DELETE FROM studio_search_fts WHERE plugin_id = ? AND item_id = ?").run(pluginId, id);
        await this.add(found);
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
