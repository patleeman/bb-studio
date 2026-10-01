// Saved views: named collection queries (src/query.ts). A space holds
// members; a view is a filter, so it can reach across spaces.
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";

export const MAX_VIEW_NAME = 60;
export const MAX_VIEW_QUERY = 500;

export interface SavedView {
  id: string;
  name: string;
  query: string;
}

export class ViewStore {
  constructor(private readonly db: Database.Database) {}

  list(): SavedView[] {
    return this.db.prepare("SELECT id, name, query FROM views ORDER BY position, created_at").all() as SavedView[];
  }

  /** Saves a query under a name; a view with that name is overwritten. */
  save(name: string, query: string): SavedView {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the view a name.");
    if (trimmed.length > MAX_VIEW_NAME) throw new Error(`View names are at most ${MAX_VIEW_NAME} characters.`);
    if (query.length > MAX_VIEW_QUERY) throw new Error(`Queries are at most ${MAX_VIEW_QUERY} characters.`);
    const existing = this.db.prepare("SELECT id FROM views WHERE name = ? COLLATE NOCASE").get(trimmed) as { id: string } | undefined;
    if (existing) {
      this.db.prepare("UPDATE views SET name = ?, query = ? WHERE id = ?").run(trimmed, query.trim(), existing.id);
      return { id: existing.id, name: trimmed, query: query.trim() };
    }
    const id = newId("view");
    const position = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM views").get() as { next: number }).next;
    this.db.prepare("INSERT INTO views (id, name, query, position, created_at) VALUES (?, ?, ?, ?, ?)").run(id, trimmed, query.trim(), position, Date.now());
    return { id, name: trimmed, query: query.trim() };
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM views WHERE id = ?").run(id);
  }
}
